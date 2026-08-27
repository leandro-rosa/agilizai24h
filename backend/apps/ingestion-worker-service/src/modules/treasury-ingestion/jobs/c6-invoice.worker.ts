import { HoldItProcessor, HoldItWorkerHost, HoldItBullMQBroker } from '@app/hold-it'
import { S3Service } from '@app/aws'
import { TREASURY_SOURCE_QUEUES } from '@app/treasury-ingestion-contracts'
import type { Job } from 'bullmq'
import { parseC6Invoice } from '../parsers/c6-invoice.parser'
import { extractPdfPages } from '../utils/pdf-text'
import { runParseJob, type SourceParseJob } from './run-parse-job'

@HoldItProcessor(TREASURY_SOURCE_QUEUES.c6_invoice)
export class C6InvoiceWorker extends HoldItWorkerHost<SourceParseJob> {
  constructor(
    private readonly s3: S3Service,
    private readonly broker: HoldItBullMQBroker,
  ) {
    super()
  }

  async process(job: Job<SourceParseJob>): Promise<unknown> {
    return runParseJob(this.logger, this.s3, this.broker, 'c6_invoice', job.data, async buffer => {
      const pages = await extractPdfPages(buffer)
      return parseC6Invoice(pages, job.data.period)
    })
  }
}
