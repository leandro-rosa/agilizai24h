import { Injectable } from '@nestjs/common'
import { HoldItBullMQBroker } from '@app/hold-it'
import {
  SEARCH_MATCH_REQUEST_QUEUE,
  SearchMatchRequestPayload,
  SearchMatchRequestPayloadV2,
  createSearchMatchJobEnvelope,
  createSearchMatchJobEnvelopeV2,
} from '@app/quote-search-match'

/**
 * Enqueues one match request per partner-API quote item — consumed by
 * apps/search's ProductMatchWorker, which publishes candidates back on
 * SEARCH_MATCH_RESULT_QUEUE for SearchMatchResultWorker (this app) to
 * score. See @app/quote-search-match's CLAUDE.md and the
 * quote-partner-api-matching OpenSpec change design.md for the full
 * cross-service design.
 */
@Injectable()
export class SearchMatchRequestProducer {
  constructor(private readonly broker: HoldItBullMQBroker) {}

  async enqueue(quoteId: number, payload: SearchMatchRequestPayload): Promise<void> {
    const message = createSearchMatchJobEnvelope(quoteId, payload)

    await this.broker.holdIt({
      queueName: SEARCH_MATCH_REQUEST_QUEUE,
      message,
      options: {
        // BullMQ rejects ':' in custom job ids.
        jobId: `${quoteId}.search-match-request.${payload.itemId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    })
  }

  async enqueueV2(quoteId: number, payload: SearchMatchRequestPayloadV2): Promise<void> {
    if (process.env.SEARCH_MATCH_V2_ENABLED === 'false') {
      if (payload.matchRevision !== 0) {
        throw new Error('Version 2 emission can be disabled only for matching revision zero')
      }
      await this.enqueue(quoteId, { itemId: payload.itemId, searchFields: payload.searchFields })
      return
    }

    await this.broker.holdIt({
      queueName: SEARCH_MATCH_REQUEST_QUEUE,
      message: createSearchMatchJobEnvelopeV2(quoteId, payload),
      options: {
        jobId: [quoteId, 'search-match-request', payload.itemId, payload.matchRevision, payload.attemptId]
          .filter(value => value !== undefined)
          .join('.'),
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    })
  }
}
