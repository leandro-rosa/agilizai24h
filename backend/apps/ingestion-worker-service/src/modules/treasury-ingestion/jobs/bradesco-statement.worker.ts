import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HoldItProcessor, HoldItWorkerHost, HoldItBullMQBroker } from '@app/hold-it'
import { S3Service } from '@app/aws'
import { TREASURY_SOURCE_QUEUES } from '@app/treasury-ingestion-contracts'
import type { Job } from 'bullmq'
import { parseBradescoStatement } from '../parsers/bradesco.parser'
import { runParseJob, type SourceParseJob } from './run-parse-job'

/** The one spreadsheet source — `.xlsx`, not CSV (design.md D9). `readWorkbookRows` reads a
 * path, not a `Buffer`, so the S3 body is written to a temp file first — same pattern as
 * `parse-file.worker.ts`'s sales/supply/cost track. */
@HoldItProcessor(TREASURY_SOURCE_QUEUES.bradesco_statement)
export class BradescoStatementWorker extends HoldItWorkerHost<SourceParseJob> {
  constructor(
    private readonly s3: S3Service,
    private readonly broker: HoldItBullMQBroker,
  ) {
    super()
  }

  async process(job: Job<SourceParseJob>): Promise<unknown> {
    return runParseJob(this.logger, this.s3, this.broker, 'bradesco_statement', job.data, async buffer => {
      let workDir: string | undefined
      try {
        workDir = await mkdtemp(join(tmpdir(), 'agiliz-treasury-'))
        const filePath = join(workDir, 'bradesco.xlsx')
        await writeFile(filePath, buffer)
        return await parseBradescoStatement(filePath)
      } finally {
        if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
      }
    })
  }
}
