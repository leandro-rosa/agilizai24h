import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { QuoteItemRepository } from '../../db-client/repository/quote-item.repository'
import { QuoteRepository } from '../../db-client/repository/quote.repository'
import { QuoteItem } from '../../db-client/entities/quote-item.entity'
import { ListItemsQueryDto } from '../dto/list-items-query.dto'
import { ItemDecisionDto } from '../dto/item-decision.dto'
import { QuoteActivityService } from './quote-activity.service'
import { deriveQuoteStatusOnReviewProgress } from '../utils/quote-progress.util'

const DECISION_ACTIVITY_KIND: Record<string, string> = {
  approved: 'item_approved',
  changed: 'item_changed',
  not_found: 'item_not_found',
  ignored: 'item_ignored',
  rejected: 'item_rejected',
}

@Injectable()
export class QuoteItemsService {
  constructor(
    private readonly quoteItemRepository: QuoteItemRepository,
    private readonly quoteRepository: QuoteRepository,
    private readonly activityService: QuoteActivityService,
  ) {}

  async listItems(
    quoteId: number,
    query: ListItemsQueryDto,
  ): Promise<{ items: Partial<QuoteItem>[]; next_cursor: number | null; page_size: number }> {
    const where: Record<string, unknown> = { quote_id: quoteId }
    if (query.pending_only) {
      where.review_status = 'pending'
    } else if (query.status) {
      where.review_status = query.status
    }
    if (query.match_status) {
      where.match_status = query.match_status
    }

    let orderBy: Record<string, string>[] = [{ row_number: 'asc' }, { id: 'asc' }]
    if (query.sort === 'match_score') orderBy = [{ match_score: 'asc' }, { id: 'asc' }]
    if (query.sort === '-match_score') orderBy = [{ match_score: 'desc' }, { id: 'asc' }]
    if (query.sort === '-row_number') orderBy = [{ row_number: 'desc' }, { id: 'asc' }]

    const pageSize = query.page_size ?? 20
    const rows = await this.quoteItemRepository.findAll({
      where,
      orderBy,
      take: pageSize + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    } as any)
    const hasNextPage = rows.length > pageSize
    const items = hasNextPage ? rows.slice(0, pageSize) : rows

    return {
      items,
      next_cursor: hasNextPage ? (items.at(-1)?.id as number) : null,
      page_size: pageSize,
    }
  }

  async decideItem(
    quoteId: number,
    itemId: number,
    dto: ItemDecisionDto,
    actor: string | null,
  ): Promise<Partial<QuoteItem>> {
    const item = await this.requireItem(quoteId, itemId)

    const requiresSelection = dto.decision === 'approved' || dto.decision === 'changed'
    if (requiresSelection && !dto.selected_candidate_id && !dto.selected_candidate) {
      throw new BadRequestException('selected_candidate_id or selected_candidate is required for this decision')
    }

    let candidates = Array.isArray(item.candidates) ? (item.candidates as any[]) : []
    let selectedCandidateId: string | null = null

    if (dto.selected_candidate) {
      const alreadyPresent = candidates.some(candidate => candidate.productId === dto.selected_candidate!.productId)
      candidates = alreadyPresent ? candidates : [...candidates, dto.selected_candidate]
      selectedCandidateId = dto.selected_candidate.productId
    } else if (dto.selected_candidate_id) {
      const found = candidates.find(candidate => candidate.productId === dto.selected_candidate_id)
      if (!found) {
        throw new BadRequestException(
          `selected_candidate_id "${dto.selected_candidate_id}" is not among this item's candidates`,
        )
      }
      selectedCandidateId = dto.selected_candidate_id
    }

    const wasPending = item.review_status === 'pending'

    const updated = await this.quoteItemRepository.update(itemId, {
      candidates,
      selected_candidate_id: selectedCandidateId,
      review_status: 'reviewed',
      review_decision: dto.decision,
      reviewed_by: actor,
      reviewed_at: new Date(),
      notes: dto.notes ?? '',
    } as Partial<QuoteItem>)

    await this.activityService.record(
      quoteId,
      DECISION_ACTIVITY_KIND[dto.decision] ?? 'item_reviewed',
      `Linha ${item.row_number}: decisão "${dto.decision}" registrada`,
      actor,
      { item_id: itemId },
    )

    if (wasPending) {
      await this.recalculateReviewProgress(quoteId)
    }

    return updated as Partial<QuoteItem>
  }

  async decideItemsBatch(
    quoteId: number,
    itemIds: number[],
    decision: string,
    notes: string | undefined,
    actor: string | null,
  ): Promise<Partial<QuoteItem>[]> {
    const results: Partial<QuoteItem>[] = []
    // Sequential on purpose: each decision recalculates Quote-level review
    // counters, and concurrent writes to the same Quote row would race.
    for (const itemId of itemIds) {
      results.push(await this.decideItem(quoteId, itemId, { decision, notes } as ItemDecisionDto, actor))
    }
    return results
  }

  private async requireItem(quoteId: number, itemId: number): Promise<Partial<QuoteItem>> {
    const item = await this.quoteItemRepository.findUnique({ where: { id: itemId } } as any)
    if (!item || item.quote_id !== quoteId) {
      throw new NotFoundException(`Item ${itemId} not found in quote ${quoteId}`)
    }
    return item
  }

  private async recalculateReviewProgress(quoteId: number): Promise<void> {
    const [reviewedRows, totalRows, quote] = await Promise.all([
      this.quoteItemRepository.count({ where: { quote_id: quoteId, review_status: 'reviewed' } } as any),
      this.quoteItemRepository.count({ where: { quote_id: quoteId } } as any),
      this.quoteRepository.findUnique({ where: { id: quoteId } } as any),
    ])

    const nextStatus = deriveQuoteStatusOnReviewProgress(quote?.status as string | undefined, reviewedRows, totalRows)

    await this.quoteRepository.update(quoteId, {
      reviewed_rows: reviewedRows,
      ...(nextStatus ? { status: nextStatus } : {}),
    } as any)
  }
}
