import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import { PERIOD_EVENT_QUEUES, type PeriodDataUpdatedEvent } from '@app/period-events-contracts'
import type { Job } from 'bullmq'
import { InventoryService } from '../services/inventory.service'

/**
 * Recomputes a store's stock when its period data changes.
 *
 * The event carries identifiers only, so current state is read here rather than
 * trusted from a snapshot taken at publish time — which also means a redelivered
 * event is harmless. Delivery is at-least-once, so that matters.
 */
@HoldItProcessor(PERIOD_EVENT_QUEUES.PERIOD_DATA_UPDATED)
export class PeriodUpdatedWorker extends HoldItWorkerHost<PeriodDataUpdatedEvent> {
  constructor(private readonly inventory: InventoryService) {
    super()
  }

  async process(job: Job<PeriodDataUpdatedEvent>): Promise<unknown> {
    const { schemaVersion, storeId, period, correlationId, source } = job.data

    if (schemaVersion !== 1) {
      throw new Error(`Unsupported period event schemaVersion ${schemaVersion} on job ${job.id}`)
    }

    this.logger.log(
      `Recomputing stock for store ${storeId} from ${period} (source: ${source})` +
        (correlationId ? ` [correlation ${correlationId}]` : ''),
    )

    const written = await this.inventory.recomputeStore(storeId, period, correlationId)

    return { storeId, period, snapshots: written }
  }
}
