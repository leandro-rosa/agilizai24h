import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import type { Job } from 'bullmq'
import { ParametersService } from '../parameters/parameters.service'
import { BACKTEST_QUEUES, type BacktestJob } from './backtest.constants'
import { BacktestRunner } from './backtest.runner'
import { BacktestService } from './backtest.service'

/**
 * Runs one backtest. Delivery is at-least-once, so everything here is safe to
 * repeat: a finished backtest is left alone and the results and final report are
 * written together in one transaction. A failure is retried by the queue and
 * only on the LAST attempt marked `failed` — never silently dropped.
 */
@HoldItProcessor(BACKTEST_QUEUES.BACKTEST)
export class BacktestWorker extends HoldItWorkerHost<BacktestJob> {
  constructor(
    private readonly service: BacktestService,
    private readonly runner: BacktestRunner,
    private readonly parameters: ParametersService,
  ) {
    super()
  }

  async process(job: Job<BacktestJob>): Promise<unknown> {
    const { schemaVersion, backtestId } = job.data
    if (schemaVersion !== 1) throw new Error(`Unsupported backtest job schemaVersion ${schemaVersion} on job ${job.id}`)

    const stored = await this.service.request(backtestId)
    if (!stored) return { skipped: 'unknown backtest' }
    if (stored.status !== 'running') return { skipped: `backtest already ${stored.status}` }

    try {
      const version = await this.parameters.byId(stored.request.parameterVersionId)
      const output = await this.runner.run({ ...stored.request, correlationId: job.data.correlationId ?? stored.request.correlationId }, version.values)
      const written = await this.service.complete(backtestId, output)

      return { backtestId, origins: output.report.origins.length, results: output.outcomes.length, written }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const lastAttempt = job.attemptsMade + 1 >= (job.opts?.attempts ?? 1)
      this.logger.error(`Backtest ${backtestId} failed (attempt ${job.attemptsMade + 1}): ${reason}`)
      if (lastAttempt) await this.service.fail(backtestId, reason)

      throw error
    }
  }
}
