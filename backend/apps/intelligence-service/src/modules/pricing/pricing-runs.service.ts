import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { HoldItBullMQBroker } from '@app/hold-it'
import { randomUUID } from 'crypto'
import { PrismaClientService } from '../db-client/prisma-client.service'
import { shiftMonth } from '../refresh/months'
import { INTELLIGENCE_QUEUES, RETRY_OPTIONS, type PricingRunJob } from '../runs/runs.constants'
import { PricingParametersService } from './pricing-parameters.service'
import type { PricingReport } from './pricing.service'
import { ENGINE_VERSION } from './pricing.types'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
/** A run that has not finished by now is not coming back (worker down): it stops blocking a new one. */
export const STALE_AFTER_MS = 15 * 60_000

export interface PricingScope {
  period: string
  storeId: number | null
}

interface RunRow {
  id: string
  period: string
  store_id: number | null
  status: string
  engine_version: string
  parameter_version_id: number
  error: string | null
  report: unknown
  created_at: Date
  finished_at: Date | null
}

export interface PricingRunView {
  id: string
  period: string
  storeId: number | null
  status: string
  engineVersion: string
  parameterVersion: number
  computedAt: string | null
  createdAt: string
  error: string | null
}

export interface LatestPricingReport {
  scope: PricingScope
  /** `none` = this scope has never completed a run; it is never an empty report. */
  state: 'none' | 'ready'
  run: PricingRunView | null
  report: PricingReport | null
  /** A run for this scope that has not finished. */
  inProgress: PricingRunView | null
  /** The newest failed run, shown next to the report it did not replace. */
  lastFailure: PricingRunView | null
  currentParameterVersion: number
  /** The parameters changed after the report was computed: its numbers are the old rules'. */
  parametersStale: boolean
}

const toView = (row: RunRow): PricingRunView => ({
  id: row.id,
  period: row.period,
  storeId: row.store_id,
  status: row.status,
  engineVersion: row.engine_version,
  parameterVersion: row.parameter_version_id,
  computedAt: row.finished_at ? row.finished_at.toISOString() : null,
  createdAt: row.created_at.toISOString(),
  error: row.error,
})

/**
 * Starts pricing report runs and reads them back. Reading never computes: it returns the latest COMPLETED run of
 * the scope. A failed run keeps its reason and never replaces a completed one; a run already in progress is
 * returned instead of starting a second.
 */
@Injectable()
export class PricingRunsService {
  private readonly logger = new Logger(PricingRunsService.name)

  constructor(
    private readonly prisma: PrismaClientService,
    private readonly parameters: PricingParametersService,
    private readonly broker: HoldItBullMQBroker,
  ) {}

  scope(period?: string, storeId?: number | null): PricingScope {
    const resolved = period ?? shiftMonth(new Date().toISOString().slice(0, 7), -1)
    if (!MONTH.test(resolved)) throw new BadRequestException('period must be a month, YYYY-MM')
    if (storeId !== undefined && storeId !== null && (!Number.isInteger(storeId) || storeId <= 0)) throw new BadRequestException('storeId must be a positive integer')

    return { period: resolved, storeId: storeId ?? null }
  }

  async start(input: { period?: string; storeId?: number | null; correlationId?: string }): Promise<{ started: boolean; run: PricingRunView }> {
    const scope = this.scope(input.period, input.storeId)
    await this.expireStale(scope)

    const running = await this.prisma.pricingRun.findFirst({
      where: { period: scope.period, store_id: scope.storeId, status: { in: ['queued', 'running'] } },
      orderBy: { created_at: 'desc' },
    })
    if (running) return { started: false, run: toView(running as RunRow) }

    const version = await this.parameters.current()
    const created = await this.prisma.pricingRun.create({
      data: { id: randomUUID(), period: scope.period, store_id: scope.storeId, status: 'queued', engine_version: ENGINE_VERSION, parameter_version_id: version.id },
    })

    const job: PricingRunJob = { schemaVersion: 1, runId: created.id, correlationId: input.correlationId }
    await this.broker.holdIt({ queueName: INTELLIGENCE_QUEUES.PRICING_RUN, message: job, options: RETRY_OPTIONS })
    this.logger.log(`Pricing run ${created.id} queued for ${scope.period} / ${scope.storeId ?? 'network'}`)

    return { started: true, run: toView(created as RunRow) }
  }

  async latest(input: { period?: string; storeId?: number | null }): Promise<LatestPricingReport> {
    const scope = this.scope(input.period, input.storeId)
    await this.expireStale(scope)
    const where = { period: scope.period, store_id: scope.storeId }

    const [completed, inProgress, failed, current] = await Promise.all([
      this.prisma.pricingRun.findFirst({ where: { ...where, status: 'completed' }, orderBy: { finished_at: 'desc' } }),
      this.prisma.pricingRun.findFirst({ where: { ...where, status: { in: ['queued', 'running'] } }, orderBy: { created_at: 'desc' } }),
      this.prisma.pricingRun.findFirst({ where: { ...where, status: 'failed' }, orderBy: { created_at: 'desc' } }),
      this.parameters.current(),
    ])

    // A failure only matters while no newer completed run exists.
    const lastFailure = failed && (!completed || (completed.finished_at && failed.created_at > completed.finished_at)) ? toView(failed as RunRow) : null

    return {
      scope,
      state: completed ? 'ready' : 'none',
      run: completed ? toView(completed as RunRow) : null,
      report: completed ? (completed.report as unknown as PricingReport) : null,
      inProgress: inProgress ? toView(inProgress as RunRow) : null,
      lastFailure,
      currentParameterVersion: current.id,
      parametersStale: completed ? completed.parameter_version_id !== current.id : false,
    }
  }

  /**
   * The completed runs of a scope, newest first, each with the engine version and the rules version it was computed with. A new calculation is a NEW
   * run: nothing here edits an earlier one, so an old report stays readable exactly as it was.
   */
  async history(input: { period?: string; storeId?: number | null; limit?: number }): Promise<PricingRunView[]> {
    const scope = this.scope(input.period, input.storeId)
    const rows = await this.prisma.pricingRun.findMany({
      where: { period: scope.period, store_id: scope.storeId, status: 'completed' },
      orderBy: { finished_at: 'desc' },
      take: Math.min(Math.max(input.limit ?? 20, 1), 100),
    })

    return rows.map(row => toView(row as RunRow))
  }

  async get(id: string): Promise<PricingRunView> {
    const row = await this.prisma.pricingRun.findUnique({ where: { id } })
    if (!row) throw new NotFoundException(`Pricing run ${id} not found`)

    return toView(row as RunRow)
  }

  /** One completed run with its report; `null` when the run is unknown or has no report. */
  async getWithReport(id: string): Promise<{ view: PricingRunView; report: PricingReport | null } | null> {
    const row = await this.prisma.pricingRun.findUnique({ where: { id } })
    if (!row) return null

    return { view: toView(row as RunRow), report: row.status === 'completed' ? (row.report as unknown as PricingReport) : null }
  }

  /** Called by the worker. A finished run is left alone (delivery is at-least-once). */
  async markRunning(id: string): Promise<RunRow | null> {
    const row = await this.prisma.pricingRun.findUnique({ where: { id } })
    if (!row || row.status === 'completed' || row.status === 'failed') return null
    await this.prisma.pricingRun.updateMany({ where: { id, status: 'queued' }, data: { status: 'running' } })

    return row as RunRow
  }

  async complete(id: string, report: PricingReport): Promise<void> {
    await this.prisma.pricingRun.update({
      where: { id },
      data: { status: 'completed', report: report as never, parameter_version_id: report.meta.parameterVersion, engine_version: report.meta.engineVersion, error: null, finished_at: new Date() },
    })
  }

  async fail(id: string, reason: string): Promise<void> {
    await this.prisma.pricingRun.updateMany({ where: { id, status: { in: ['queued', 'running'] } }, data: { status: 'failed', error: reason.slice(0, 500), finished_at: new Date() } })
  }

  /** A run that sat in the queue past the limit is failed with a reason, so it cannot block a new run forever. */
  private async expireStale(scope: PricingScope): Promise<void> {
    await this.prisma.pricingRun.updateMany({
      where: { period: scope.period, store_id: scope.storeId, status: { in: ['queued', 'running'] }, created_at: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
      data: { status: 'failed', error: 'Timed out: the run did not finish', finished_at: new Date() },
    })
  }
}
