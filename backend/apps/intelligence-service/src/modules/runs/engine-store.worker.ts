import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import type { Job } from 'bullmq'
import { isSynthetic } from '../../common/synthetic'
import { PrismaClientService } from '../db-client/prisma-client.service'
import { runPair, type PairResult } from '../engine/engine'
import { ParametersService } from '../parameters/parameters.service'
import { RunInputBuilder, type RunContext } from './run-input.builder'
import { INTELLIGENCE_QUEUES, type EngineStoreJob } from './runs.constants'
import { RunFinalizer } from './run-finalizer'
import { monthsBetween } from './runs.service'

/**
 * Computes one store of a run. Delivery is at-least-once, so everything here is
 * safe to repeat: a finished run is left alone, a store's previous rows are
 * replaced rather than added to, and the run is finalised exactly once.
 *
 * A store whose data cannot be read is recorded as SKIPPED with the reason — it
 * is never counted as "no recommendations", and it does not stop the other stores.
 */
@HoldItProcessor(INTELLIGENCE_QUEUES.ENGINE_STORE)
export class EngineStoreWorker extends HoldItWorkerHost<EngineStoreJob> {
  private readonly contexts = new Map<string, Promise<RunContext>>()

  constructor(
    private readonly prisma: PrismaClientService,
    private readonly builder: RunInputBuilder,
    private readonly parameters: ParametersService,
    private readonly finalizer: RunFinalizer,
  ) {
    super()
  }

  async process(job: Job<EngineStoreJob>): Promise<unknown> {
    const { schemaVersion, runId, storeId, correlationId } = job.data
    if (schemaVersion !== 1) throw new Error(`Unsupported engine job schemaVersion ${schemaVersion} on job ${job.id}`)

    const run = await this.prisma.engineRun.findUnique({ where: { id: runId } })
    if (!run || run.status === 'completed' || run.status === 'failed') return { skipped: 'run already finished or unknown' }

    await this.prisma.engineRun.updateMany({ where: { id: runId, status: 'queued' }, data: { status: 'running' } })

    let pairs: PairResult[] = []
    let months: { month: string; supplyPresent: boolean; salesPresent: boolean }[] = []
    let skipReason: string | null = null

    try {
      const ctx = await this.context(run, correlationId)
      const built = await this.builder.buildStore(storeId, ctx, sku => isSynthetic(ctx.catalogue.get(sku)?.name))
      months = built.months
      pairs = built.inputs.map(runPair)
    } catch (error) {
      skipReason = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Run ${runId}: store ${storeId} skipped — ${skipReason}`)
    }

    await this.prisma.$transaction(async tx => {
      await tx.recommendation.deleteMany({ where: { run_id: runId, store_id: storeId } })
      await tx.engineRunStore.deleteMany({ where: { run_id: runId, store_id: storeId } })

      if (pairs.length > 0) {
        await tx.recommendation.createMany({
          data: pairs.map(result => ({
            run_id: runId,
            store_id: storeId,
            sku: result.sku,
            mix: result.mix.value,
            quantity_action: result.quantity.action,
            tolerance_status: result.balance.tolerance.status,
            coverage_category: result.coverage,
            releases_balance_use: result.balance.releasesBalanceUse,
            result: result as never,
          })),
        })
      }

      await tx.engineRunStore.create({
        data: { run_id: runId, store_id: storeId, status: skipReason === null ? 'done' : 'skipped', reason: skipReason, pairs: pairs.length, months: months as never },
      })
    })

    await this.finalizer.finalizeIfComplete(runId)

    return { storeId, pairs: pairs.length, skipped: skipReason }
  }

  /** Built once per run and shared by its jobs: the catalogue and the costs do not change within a run. */
  private context(run: { id: string; parameter_version_id: number; as_of: Date; range_from: string; range_to: string }, correlationId?: string): Promise<RunContext> {
    const cached = this.contexts.get(run.id)
    if (cached) return cached

    const built = this.parameters
      .byId(run.parameter_version_id)
      .then(version => this.builder.buildContext(run.range_from, run.range_to, run.as_of, version.values, monthsBetween(run.range_from, run.range_to), correlationId))
      .catch(error => {
        this.contexts.delete(run.id)
        throw error
      })

    this.contexts.set(run.id, built)
    // Keep the cache small: a worker sees few runs at a time.
    if (this.contexts.size > 3) this.contexts.delete(this.contexts.keys().next().value as string)

    return built
  }
}
