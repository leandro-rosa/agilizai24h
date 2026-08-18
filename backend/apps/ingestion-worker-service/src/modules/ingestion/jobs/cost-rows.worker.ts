import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import { INGESTION_QUEUES, type CostRowsJob } from '@app/ingestion-contracts'
import type { Job } from 'bullmq'
import { IngestionService } from '../services/ingestion.service'
import { UpstreamClient } from '../services/upstream.client'

/**
 * Writes parsed price-sheet rows into products-service as dated cost versions.
 *
 * Unlike sales and supply, products-service has no queue of its own — costs are
 * recorded over HTTP — so this consumer lives here and turns the batch into
 * per-SKU calls. Each is effective from the uploaded period, which is what
 * makes "value a month with that month's cost" hold.
 */
@HoldItProcessor(INGESTION_QUEUES.COST_ROWS)
export class CostRowsWorker extends HoldItWorkerHost<CostRowsJob> {
  constructor(
    private readonly upstream: UpstreamClient,
    private readonly ingestions: IngestionService,
  ) {
    super()
  }

  async process(job: Job<CostRowsJob>): Promise<unknown> {
    const { schemaVersion, rows, correlationId, ingestionId } = job.data

    if (schemaVersion !== 1) {
      throw new Error(`Unsupported ingestion schemaVersion ${schemaVersion} on job ${job.id}`)
    }

    const failures: { rowReference: string; reason: string; detail: string }[] = []

    for (const row of rows) {
      try {
        await this.upstream.recordCost(row.sku, row.effectiveFrom, row.costCents, correlationId)
      } catch (error) {
        // Recorded rather than thrown: one unknown SKU must not discard the
        // rest of the sheet, and the operator needs to see which ones failed.
        failures.push({
          rowReference: row.sku,
          reason: 'cost_write_failed',
          detail: (error as Error).message,
        })
      }
    }

    if (failures.length > 0) {
      await this.ingestions.recordRejections(ingestionId, failures)
    }

    this.logger.log(`Recorded ${rows.length - failures.length}/${rows.length} costs for ingestion ${ingestionId}`)

    return { recorded: rows.length - failures.length, failed: failures.length }
  }
}
