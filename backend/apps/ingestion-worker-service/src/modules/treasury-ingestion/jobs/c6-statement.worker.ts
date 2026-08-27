import { HoldItProcessor, HoldItWorkerHost, HoldItBullMQBroker } from '@app/hold-it'
import { S3Service } from '@app/aws'
import { TREASURY_SOURCE_QUEUES } from '@app/treasury-ingestion-contracts'
import type { Job } from 'bullmq'
import { parseC6Statement } from '../parsers/c6-statement.parser'
import { extractPdfPages } from '../utils/pdf-text'
import { runParseJob, type SourceParseJob } from './run-parse-job'

@HoldItProcessor(TREASURY_SOURCE_QUEUES.c6_statement)
export class C6StatementWorker extends HoldItWorkerHost<SourceParseJob> {
  constructor(
    private readonly s3: S3Service,
    private readonly broker: HoldItBullMQBroker,
  ) {
    super()
  }

  async process(job: Job<SourceParseJob>): Promise<unknown> {
    return runParseJob(this.logger, this.s3, this.broker, 'c6_statement', job.data, async buffer => {
      const pages = await extractPdfPages(buffer)
      return parseC6Statement(pages)
    })
  }
}
