import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import { TREASURY_QUEUES, type TreasuryRawRowsJob } from '@app/treasury-ingestion-contracts'
import type { Job } from 'bullmq'
import { PendingImportService } from '../services/pending-import.service'

/**
 * Consumes parsed rows from ingestion-worker-service's six parsers — one
 * queue for all of them (design: add-treasury-statement-ingestion D3), since
 * every source funnels into the same sink here.
 *
 * The whole file arrives as one job, not chunked: a monthly statement is
 * hundreds of lines, not thousands, so there is no multi-batch-clobbers-
 * itself failure mode the sales/supply ingestion has to guard against.
 */
@HoldItProcessor(TREASURY_QUEUES.RAW_ROWS)
export class RawRowsWorker extends HoldItWorkerHost<TreasuryRawRowsJob> {
  constructor(private readonly pendingImports: PendingImportService) {
    super()
  }

  async process(job: Job<TreasuryRawRowsJob>): Promise<unknown> {
    const { schemaVersion, source, accountId, period, rows, rejections, correlationId } = job.data

    if (schemaVersion !== 1) {
      throw new Error(`Unsupported treasury raw-rows schemaVersion ${schemaVersion} on job ${job.id}`)
    }

    this.logger.log(
      `Staging ${rows.length} row(s) (${rejections.length} rejected) from ${source} for account ${accountId} period ${period}` +
        (correlationId ? ` [correlation ${correlationId}]` : ''),
    )

    const result = await this.pendingImports.createOrReplace(job.data)

    this.logger.log(
      `Pending import ${result.pendingImportId} ${result.replaced ? 'replaced' : 'created'} for ${source}/${accountId}/${period}`,
    )

    return result
  }
}
