import { Injectable } from '@nestjs/common'
import { HoldItBullMQBroker } from '@app/hold-it'
import { QUOTE_GENERATE_EXPORT_QUEUE, createQuoteJobEnvelope, QuoteJobEnvelope } from './quote-job-envelope'

export interface GenerateExportPayload {
  exportId: number
}

@Injectable()
export class GenerateExportProducer {
  constructor(private readonly broker: HoldItBullMQBroker) {}

  async enqueue(quoteId: number, payload: GenerateExportPayload): Promise<QuoteJobEnvelope<GenerateExportPayload>> {
    const message = createQuoteJobEnvelope(quoteId, payload)

    await this.broker.holdIt({
      queueName: QUOTE_GENERATE_EXPORT_QUEUE,
      message,
      options: {
        jobId: `${quoteId}.generate-export.${payload.exportId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    })

    return message
  }
}
