import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import { PERIOD_EVENT_QUEUES, type PeriodDataUpdatedEvent } from '@app/period-events-contracts'
import type { Job } from 'bullmq'
import { REFRESH_QUEUES, type RefreshAdvanceJob, type RefreshCheckJob } from './refresh.constants'
import { RefreshService } from './refresh.service'

/**
 * Every `period.data-updated` event of supply and sales ends up here, one per store-period, so
 * it does nothing but schedule ONE debounced check — it neither reads the sources nor decides.
 * The event carries identifiers only; whether a month is available is read from the data.
 */
@HoldItProcessor(PERIOD_EVENT_QUEUES.PERIOD_DATA_UPDATED_INTELLIGENCE)
export class PeriodUpdatedRefreshWorker extends HoldItWorkerHost<PeriodDataUpdatedEvent> {
  constructor(private readonly refresh: RefreshService) {
    super()
  }

  async process(job: Job<PeriodDataUpdatedEvent>): Promise<unknown> {
    if (job.data.schemaVersion !== 1) throw new Error(`Unsupported period event schemaVersion ${job.data.schemaVersion} on job ${job.id}`)

    return this.refresh.scheduleCheck(job.data.correlationId)
  }
}

/** The debounced check: has `dataThrough` advanced beyond the current set? If so, start one refresh. */
@HoldItProcessor(REFRESH_QUEUES.CHECK)
export class RefreshCheckWorker extends HoldItWorkerHost<RefreshCheckJob> {
  constructor(private readonly refresh: RefreshService) {
    super()
  }

  async process(job: Job<RefreshCheckJob>): Promise<unknown> {
    if (job.data.schemaVersion !== 1) throw new Error(`Unsupported refresh check schemaVersion ${job.data.schemaVersion} on job ${job.id}`)

    return this.refresh.evaluate({ trigger: 'event', correlationId: job.data.correlationId })
  }
}

/** Looks at one running set; while it is still running it schedules the next look. */
@HoldItProcessor(REFRESH_QUEUES.ADVANCE)
export class RefreshAdvanceWorker extends HoldItWorkerHost<RefreshAdvanceJob> {
  constructor(private readonly refresh: RefreshService) {
    super()
  }

  async process(job: Job<RefreshAdvanceJob>): Promise<unknown> {
    if (job.data.schemaVersion !== 1) throw new Error(`Unsupported refresh advance schemaVersion ${job.data.schemaVersion} on job ${job.id}`)

    const result = await this.refresh.advance(job.data.setId)
    if (result.reschedule) await this.refresh.scheduleAdvance(job.data.setId)

    return result
  }
}
