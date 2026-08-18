import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import { PERIOD_EVENT_QUEUES, type InventoryPeriodDerivedEvent } from '@app/period-events-contracts'
import type { Job } from 'bullmq'
import { FinanceService } from '../services/finance.service'

/**
 * Reconciles a store-month once inventory-service has derived its stock.
 *
 * Triggered by inventory's completion rather than by the raw period event, and
 * not as an ordering nicety: run from the same event, this read a closing
 * balance inventory had not written yet and produced a remaining-stock value of
 * 31500 where 29250 was right — while still reporting itself complete.
 *
 * Inventory rebuilds every month from the change forward and emits one event
 * per rebuilt month, so later months get revalued too. Closing stock carries
 * forward; without that, correcting March would leave April's figure stale.
 *
 * The event carries identifiers only, so current state is read here rather than
 * trusted from a snapshot taken at publish time — which is also what makes a
 * redelivered event harmless.
 */
@HoldItProcessor(PERIOD_EVENT_QUEUES.INVENTORY_PERIOD_DERIVED_FINANCE)
export class PeriodUpdatedWorker extends HoldItWorkerHost<InventoryPeriodDerivedEvent> {
  constructor(private readonly finance: FinanceService) {
    super()
  }

  async process(job: Job<InventoryPeriodDerivedEvent>): Promise<unknown> {
    const { schemaVersion, storeId, period, correlationId, changedAt } = job.data

    if (schemaVersion !== 1) {
      throw new Error(`Unsupported inventory-period-derived schemaVersion ${schemaVersion} on job ${job.id}`)
    }

    this.logger.log(`Reconciling store ${storeId} period ${period}`)

    const result = await this.finance.recompute(storeId, period, { correlationId, inputsChangedAt: changedAt })

    return { storeId, period, complete: result.complete, loss_value_cents: result.loss_value_cents }
  }
}
