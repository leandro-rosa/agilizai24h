import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { QuoteRepository } from '../../db-client/repository/quote.repository'
import { QuoteItemRepository } from '../../db-client/repository/quote-item.repository'
import { Quote } from '../../db-client/entities/quote.entity'
import { QuoteItem } from '../../db-client/entities/quote-item.entity'
import { PartnerIntakeDto, PartnerQuoteLineDto } from '../dto/partner-intake.dto'
import { QuoteActivityService } from './quote-activity.service'
import { MatchItemProducer } from '../jobs/match-item.producer'
import { toSearchFields } from '../utils/search-fields.util'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import type { Prisma } from '../../db-client/generated/prisma/client'

/**
 * Entry point for source='partner_api' quotes. Each line carries only raw
 * identifying fields — the system finds and scores matching catalog
 * products itself, asynchronously, via the quote<->search matching queues
 * (see jobs/search-match-request.producer.ts, jobs/search-match-result.worker.ts)
 * instead of trusting a caller-supplied candidate/score. Today's only
 * caller is the local demo script `pnpm seed:demo-partner-quotes`, since
 * no real external partner system exists in this repository — flagged as
 * an open question in frontend/docs/api-contracts.md.
 */
@Injectable()
export class PartnerIntakeService {
  constructor(
    private readonly quoteRepository: QuoteRepository,
    private readonly quoteItemRepository: QuoteItemRepository,
    private readonly activityService: QuoteActivityService,
    private readonly matchItemProducer: MatchItemProducer,
    private readonly prisma: PrismaClientService,
  ) {}

  async intake(dto: PartnerIntakeDto, actor: string | null): Promise<Partial<Quote>> {
    const lines = dto.lines.map((line, index) => this.requireSearchFields(line, index))

    const quote = await this.quoteRepository.create({
      name: dto.displayName,
      source: 'partner_api',
      status: 'awaiting_review',
      created_by: actor,
      partner_name: dto.partnerName,
      external_id: dto.externalId,
      total_rows: dto.lines.length,
      processed_rows: 0,
      matched_rows: 0,
      unmatched_rows: 0,
      ambiguous_rows: 0,
      matching_config_revision: 0,
    } as Partial<Quote>)

    const items = await Promise.all(
      lines.map(({ line }, index) =>
        this.quoteItemRepository.create({
          quote_id: quote.id,
          row_number: index + 1,
          raw_input: line.originalFields as any,
          candidates: [],
          match_status: 'pending',
          review_status: 'pending',
          match_revision: 0,
        } as any),
      ),
    )

    await this.matchItemProducer.enqueueMany(
      quote.id as number,
      items.map(item => ({ itemId: item.id as number, matchRevision: 0 })),
    )

    await this.activityService.record(
      quote.id as number,
      'created',
      `Cotação de parceiro "${dto.displayName}" recebida (${dto.externalId})`,
      actor,
    )

    return quote
  }

  async addItem(quoteId: number, dto: PartnerQuoteLineDto, actor: string | null): Promise<Partial<QuoteItem>> {
    this.requireSearchFields(dto, 0)
    const item = await this.prisma.$transaction(async transaction => {
      const quote = await transaction.quote.findUnique({
        where: { id: quoteId },
        select: { source: true, matching_config_revision: true },
      })
      if (!quote) {
        throw new NotFoundException(`Quote ${quoteId} not found`)
      }
      if (quote.source !== 'partner_api') {
        throw new BadRequestException(`Quote ${quoteId} is not a partner-API quote (source: ${quote.source})`)
      }

      // Atomic quote-row increment serializes concurrent additions and provides
      // each item a distinct row number without scanning quote_item.
      const updatedQuote = await transaction.quote.update({
        where: { id: quoteId },
        data: { total_rows: { increment: 1 } },
        select: { total_rows: true },
      })

      return transaction.quoteItem.create({
        data: {
          quote_id: quoteId,
          row_number: updatedQuote.total_rows,
          raw_input: dto.originalFields as unknown as Prisma.InputJsonValue,
          candidates: [],
          match_status: 'pending',
          review_status: 'pending',
          match_revision: quote.matching_config_revision,
        },
      })
    })

    await this.matchItemProducer.enqueue(quoteId, {
      itemId: item.id as number,
      matchRevision: item.match_revision,
    })

    await this.activityService.record(quoteId, 'item_added', `Linha ${item.row_number} adicionada via API`, actor, {
      item_id: item.id,
    })

    return item
  }

  private requireSearchFields(line: PartnerQuoteLineDto, index: number) {
    const searchFields = toSearchFields(line.originalFields)
    if (!searchFields.length) {
      throw new BadRequestException(
        `Line ${index + 1} has no identifying field (sku/ean/main_code/oem/trade_number/name/brand)`,
      )
    }
    return { line, searchFields }
  }
}
