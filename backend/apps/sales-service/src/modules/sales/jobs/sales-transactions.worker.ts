import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import { INGESTION_QUEUES, isValidPeriod, type SalesTransactionsJob } from '@app/ingestion-contracts'
import type { Job } from 'bullmq'
import { SalesTransactionsService } from '../services/sales-transactions.service'

/**
 * Consumes transaction-detail rows from ingestion-worker-service — a separate
 * queue and a separate table from `SalesRowsWorker`/`SalesRecord`, published
 * only for stores/periods ingested from the network-wide, per-transaction
 * sales format (see add-sales-transaction-detail). Never publishes
 * `period.data-updated`: nothing downstream (finance, inventory) reads
 * transaction detail — only the aggregate `SalesRecord` triggers that.
 */
@HoldItProcessor(INGESTION_QUEUES.SALES_TRANSACTIONS)
export class SalesTransactionsWorker extends HoldItWorkerHost<SalesTransactionsJob> {
  constructor(private readonly transactions: SalesTransactionsService) {
    super()
  }

  async process(job: Job<SalesTransactionsJob>): Promise<unknown> {
    const { schemaVersion, storeId, period, ingestionId, rows, correlationId } = job.data

    if (schemaVersion !== 1) {
      throw new Error(`Unsupported ingestion schemaVersion ${schemaVersion} on job ${job.id}`)
    }

    if (!isValidPeriod(period)) {
      throw new Error(`Malformed period "${period}" on job ${job.id} — expected YYYY-MM`)
    }

    this.logger.log(
      `Ingesting ${rows.length} sales transactions for store ${storeId} period ${period}` +
        (correlationId ? ` [correlation ${correlationId}]` : ''),
    )

    await this.transactions.ingestPeriodTransactions({ storeId, period, ingestionId, rows })

    return { accepted: rows.length }
  }
}
