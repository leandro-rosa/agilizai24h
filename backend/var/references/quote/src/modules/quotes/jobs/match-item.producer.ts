import { Injectable } from '@nestjs/common'
import { HoldItBullMQBroker } from '@app/hold-it'
import { QUOTE_MATCH_ITEM_QUEUE, createQuoteJobEnvelope, QuoteJobEnvelope } from './quote-job-envelope'

/**
 * Structurally certain regardless of unconfirmed business rules: if/when
 * matching a line item calls an external pricing/catalog provider, that
 * call is I/O-bound and retryable, so it belongs in a queue. Which
 * provider — none is confirmed yet, see backend/apps/quote/CLAUDE.md.
 */
export interface MatchItemPayload {
  itemId: number
  matchRevision?: number
  attemptId?: string
}

const ENQUEUE_CHUNK_SIZE = 25

@Injectable()
export class MatchItemProducer {
  constructor(private readonly broker: HoldItBullMQBroker) {}

  async enqueue(quoteId: number, payload: MatchItemPayload): Promise<QuoteJobEnvelope<MatchItemPayload>> {
    const message = createQuoteJobEnvelope(quoteId, payload)

    await this.broker.holdIt({
      queueName: QUOTE_MATCH_ITEM_QUEUE,
      message,
      options: {
        // BullMQ rejects ':' in custom job ids.
        jobId: payload.matchRevision === undefined
          ? `${quoteId}.match-item.${payload.itemId}`
          : `${quoteId}.match-item.${payload.itemId}.${payload.matchRevision}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    })

    return message
  }

  async enqueueMany(
    quoteId: number,
    payloads: MatchItemPayload[],
    options?: { attemptId?: string },
  ): Promise<void> {
    for (let index = 0; index < payloads.length; index += ENQUEUE_CHUNK_SIZE) {
      const messages = payloads.slice(index, index + ENQUEUE_CHUNK_SIZE).map(payload => {
        const attemptId = options?.attemptId ?? payload.attemptId
        return {
          ...createQuoteJobEnvelope(quoteId, { ...payload, ...(attemptId ? { attemptId } : {}) }),
          jobOptions: {
            jobId: [quoteId, 'match-item', payload.itemId, payload.matchRevision, attemptId]
              .filter(value => value !== undefined)
              .join('.'),
            attempts: 3,
            backoff: { type: 'exponential' as const, delay: 2000 },
          },
        }
      })

      await this.broker.holdItALot({ queueName: QUOTE_MATCH_ITEM_QUEUE, messages })
    }
  }
}
