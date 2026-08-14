import { Injectable } from '@nestjs/common'
import { QuoteActivityEventRepository } from '../../db-client/repository/quote-activity-event.repository'
import { QuoteActivityEvent } from '../../db-client/entities/quote-activity-event.entity'
import { ListActivityQueryDto } from '../dto/list-activity-query.dto'

@Injectable()
export class QuoteActivityService {
  constructor(private readonly activityRepository: QuoteActivityEventRepository) {}

  async record(
    quoteId: number,
    kind: string,
    message: string,
    actor?: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<Partial<QuoteActivityEvent>> {
    return this.activityRepository.create({
      quote_id: quoteId,
      kind,
      message,
      actor: actor ?? null,
      metadata: metadata ?? undefined,
    } as Partial<QuoteActivityEvent>)
  }

  async listByQuote(
    quoteId: number,
    query: ListActivityQueryDto,
  ): Promise<{ items: Partial<QuoteActivityEvent>[]; next_cursor: number | null; page_size: number }> {
    const pageSize = query.page_size ?? 20
    const rows = await this.activityRepository.findAll({
      where: { quote_id: quoteId },
      orderBy: { id: 'desc' },
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
}
