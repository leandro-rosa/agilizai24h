import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import { INGESTION_QUEUES, isValidPeriod, type SupplyRowsJob } from '@app/ingestion-contracts'
import type { Job } from 'bullmq'
import { PeriodEventsPublisher } from '../services/period-events.publisher'
import { SupplyService } from '../services/supply.service'

/**
 * Consumes parsed restock and removal rows from ingestion-worker-service.
 *
 * Removals arrive ALREADY SPLIT per reason — this service never parses the
 * free-text "Removals" field. Text interpretation is a property of the POS
 * export format and may change; the loss classification is a property of the
 * business and is stable, so they live in different services.
 */
@HoldItProcessor(INGESTION_QUEUES.SUPPLY_ROWS)
export class SupplyRowsWorker extends HoldItWorkerHost<SupplyRowsJob> {
  constructor(
    private readonly supply: SupplyService,
    private readonly events: PeriodEventsPublisher,
  ) {
    super()
  }

  async process(job: Job<SupplyRowsJob>): Promise<unknown> {
    const { schemaVersion, storeId, period, ingestionId, restocks, removals, adjustments, recordedClosingBalances, correlationId } =
      job.data

    if (schemaVersion !== 1) {
      throw new Error(`Unsupported ingestion schemaVersion ${schemaVersion} on job ${job.id}`)
    }

    if (!isValidPeriod(period)) {
      throw new Error(`Malformed period "${period}" on job ${job.id} — expected YYYY-MM`)
    }

    const result = await this.supply.ingestPeriod({
      storeId,
      period,
      ingestionId,
      restocks: restocks ?? [],
      removals: removals ?? [],
      adjustments: adjustments ?? [],
      recordedClosingBalances: recordedClosingBalances ?? [],
    })

    // After the commit, and only on a real change — re-uploading an identical
    // file is normal, and an unconditional publish would trigger a downstream
    // recomputation storm for nothing.
    if (result.changed) {
      await this.events.publishPeriodDataUpdated(storeId, period, correlationId)
    }

    return result
  }
}
