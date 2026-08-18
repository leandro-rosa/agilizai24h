import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import { INGESTION_QUEUES, isValidPeriod, type SalesRowsJob } from '@app/ingestion-contracts'
import type { Job } from 'bullmq'
import { SalesService } from '../services/sales.service'

/**
 * Consumes parsed sales rows from ingestion-worker-service.
 *
 * The whole batch for a store's period arrives as one job, not row by row: the
 * service replaces a period wholesale, so streaming rows individually would
 * make each one wipe the previous. That is the subtlest failure mode in the
 * ingestion design, and the batch envelope is what prevents it.
 */
@HoldItProcessor(INGESTION_QUEUES.SALES_ROWS)
export class SalesRowsWorker extends HoldItWorkerHost<SalesRowsJob> {
  constructor(private readonly sales: SalesService) {
    super()
  }

  async process(job: Job<SalesRowsJob>): Promise<unknown> {
    const { schemaVersion, storeId, period, ingestionId, rows, correlationId } = job.data

    // Reject a payload shape this consumer does not understand, rather than
    // mis-reading fields once the contract changes.
    if (schemaVersion !== 1) {
      throw new Error(`Unsupported ingestion schemaVersion ${schemaVersion} on job ${job.id}`)
    }

    if (!isValidPeriod(period)) {
      throw new Error(`Malformed period "${period}" on job ${job.id} — expected YYYY-MM`)
    }

    this.logger.log(
      `Ingesting ${rows.length} sales rows for store ${storeId} period ${period}` +
        (correlationId ? ` [correlation ${correlationId}]` : ''),
    )

    // Idempotent: BullMQ delivers at least once, so a retried job must converge
    // rather than accumulate. Whole-period replacement gives that for free.
    return this.sales.ingestPeriod({ storeId, period, ingestionId, rows })
  }
}
