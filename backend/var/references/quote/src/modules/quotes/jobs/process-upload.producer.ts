import { Injectable } from '@nestjs/common'
import { HoldItBullMQBroker } from '@app/hold-it'
import { QUOTE_PROCESS_UPLOAD_QUEUE, createQuoteJobEnvelope, QuoteJobEnvelope } from './quote-job-envelope'

/**
 * Structurally certain regardless of unconfirmed business rules: parsing an
 * uploaded spreadsheet is a longer-running, retryable operation, so it
 * belongs in a queue. Column mapping / matching rules are NOT part of this
 * payload — see backend/apps/quote/CLAUDE.md, "Decisões pendentes".
 */
export interface ProcessUploadPayload {
  sourceFileName: string
}

@Injectable()
export class ProcessUploadProducer {
  constructor(private readonly broker: HoldItBullMQBroker) {}

  async enqueue(quoteId: number, payload: ProcessUploadPayload): Promise<QuoteJobEnvelope<ProcessUploadPayload>> {
    const message = createQuoteJobEnvelope(quoteId, payload)

    await this.broker.holdIt({
      queueName: QUOTE_PROCESS_UPLOAD_QUEUE,
      message,
      options: {
        // BullMQ rejects ':' in custom job ids.
        jobId: `${quoteId}.process-upload`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    })

    return message
  }
}
