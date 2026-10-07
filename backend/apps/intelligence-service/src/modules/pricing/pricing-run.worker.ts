import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import type { Job } from 'bullmq'
import { INTELLIGENCE_QUEUES, type PricingRunJob } from '../runs/runs.constants'
import { PricingRunsService } from './pricing-runs.service'
import { PricingService } from './pricing.service'

/**
 * Computes one pricing report and stores it on its run. Delivery is at-least-once, so a finished run is left alone.
 * A transient failure is retried by the queue; the run is marked failed only on the last attempt, with the reason,
 * and a failed run never replaces the latest completed one.
 */
@HoldItProcessor(INTELLIGENCE_QUEUES.PRICING_RUN)
export class PricingRunWorker extends HoldItWorkerHost<PricingRunJob> {
  constructor(
    private readonly runs: PricingRunsService,
    private readonly pricing: PricingService,
  ) {
    super()
  }

  async process(job: Job<PricingRunJob>): Promise<unknown> {
    const { schemaVersion, runId, correlationId } = job.data
    if (schemaVersion !== 1) throw new Error(`Unsupported pricing job schemaVersion ${schemaVersion} on job ${job.id}`)

    const run = await this.runs.markRunning(runId)
    if (!run) return { skipped: 'run already finished or unknown' }

    try {
      const report = await this.pricing.report({ period: run.period, storeId: run.store_id ?? undefined }, correlationId)
      await this.runs.complete(runId, report)

      return { runId, products: report.products.length }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
      this.logger.warn(`Pricing run ${runId} failed (attempt ${job.attemptsMade + 1}): ${reason}`)
      if (!lastAttempt) throw error
      await this.runs.fail(runId, reason)

      return { runId, failed: reason }
    }
  }
}
