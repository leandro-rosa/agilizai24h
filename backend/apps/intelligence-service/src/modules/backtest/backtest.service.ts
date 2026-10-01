import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { HoldItBullMQBroker } from '@app/hold-it'
import { PrismaClientService } from '../db-client/prisma-client.service'
import { ENGINE_VERSION } from '../engine/engine'
import type { BacktestPort, BacktestStartInput, BacktestStatus } from '../refresh/refresh.ports'
import { ParametersService } from '../parameters/parameters.service'
import { BACKTEST_QUEUES, BACKTEST_RETRY_OPTIONS, type BacktestJob } from './backtest.constants'
import { monthEnd } from './history-view'
import type { BacktestOutput, BacktestRequest } from './backtest.runner'
import type { BacktestReport } from './report'
import { summarizeReport } from './summary'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

/** What is stored in `backtest_run.report` while the replay has not finished. */
interface PendingReport {
  status: 'running' | 'failed'
  request: BacktestRequest
  queuedAt: string
  error?: string
}

type StoredReport = BacktestReport | PendingReport

const statusOf = (report: unknown): BacktestStatus => ((report as StoredReport | null)?.status ?? 'failed') as BacktestStatus

export interface StartBacktestBody {
  rangeFrom?: string
  rangeTo?: string
  dataThrough?: string
  asOf?: string
  parameterVersionId?: number
  correlationId?: string
}

/**
 * Starts backtests and reads them back. `start` only records the backtest and
 * queues ONE job; the replay happens in `BacktestWorker`. A backtest is
 * `completed` only when its stored report is final — results and report are
 * written in one transaction — and it decides nothing: no verdict, no threshold.
 */
@Injectable()
export class BacktestService implements BacktestPort {
  private readonly logger = new Logger(BacktestService.name)

  constructor(
    private readonly prisma: PrismaClientService,
    private readonly parameters: ParametersService,
    private readonly broker: HoldItBullMQBroker,
  ) {}

  async start(input: BacktestStartInput): Promise<{ id: string }> {
    for (const [name, value] of [['rangeFrom', input.rangeFrom], ['rangeTo', input.rangeTo], ['dataThrough', input.dataThrough]] as const) {
      if (!PERIOD.test(value ?? '')) throw new BadRequestException(`${name} is required, as YYYY-MM`)
    }
    if (input.rangeFrom > input.rangeTo || input.dataThrough < input.rangeFrom || input.dataThrough > input.rangeTo) {
      throw new BadRequestException('rangeFrom <= dataThrough <= rangeTo is required')
    }
    if (Number.isNaN(input.asOf.getTime())) throw new BadRequestException('asOf must be a date')

    // Fails early, as a 404, when the parameter version does not exist.
    await this.parameters.byId(input.parameterVersionId)

    const id = randomUUID()
    const request: BacktestRequest = {
      rangeFrom: input.rangeFrom,
      rangeTo: input.rangeTo,
      dataThrough: input.dataThrough,
      asOf: input.asOf.toISOString(),
      parameterVersionId: input.parameterVersionId,
      correlationId: input.correlationId,
    }
    const pending: PendingReport = { status: 'running', request, queuedAt: new Date().toISOString() }

    await this.prisma.backtestRun.create({
      data: { id, engine_version: ENGINE_VERSION, parameter_version_id: input.parameterVersionId, origins: [], data_through: input.dataThrough, report: pending as never },
    })

    try {
      const job: BacktestJob = { schemaVersion: 1, backtestId: id, correlationId: input.correlationId }
      await this.broker.holdIt({ queueName: BACKTEST_QUEUES.BACKTEST, message: job, options: BACKTEST_RETRY_OPTIONS })
    } catch (error) {
      await this.fail(id, `could not be queued: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }

    this.logger.log(`Backtest ${id} queued (data through ${input.dataThrough})`)
    return { id }
  }

  /** The HTTP entry point: fills the defaults a person leaves out, then queues like any other caller. */
  async startFromBody(body: StartBacktestBody): Promise<{ id: string }> {
    const rangeTo = body.rangeTo as string
    const dataThrough = body.dataThrough ?? rangeTo
    const asOf = body.asOf ? new Date(body.asOf) : PERIOD.test(dataThrough ?? '') ? new Date(monthEnd(dataThrough)) : new Date(Number.NaN)
    const parameterVersionId = body.parameterVersionId ?? (await this.parameters.current()).id

    return this.start({ rangeFrom: body.rangeFrom as string, rangeTo, dataThrough, asOf, parameterVersionId, correlationId: body.correlationId })
  }

  async status(id: string): Promise<BacktestStatus> {
    const row = await this.prisma.backtestRun.findUnique({ where: { id }, select: { report: true } })
    if (!row) throw new NotFoundException(`Backtest ${id} not found`)

    return statusOf(row.report)
  }

  async list(limit = 20) {
    const rows = await this.prisma.backtestRun.findMany({ orderBy: { created_at: 'desc' }, take: Math.min(limit, 100) })

    return rows.map(row => ({
      id: row.id,
      status: statusOf(row.report),
      engineVersion: row.engine_version,
      parameterVersionId: row.parameter_version_id,
      dataThrough: row.data_through,
      origins: row.origins,
      createdAt: row.created_at.toISOString(),
    }))
  }

  async get(id: string) {
    const row = await this.prisma.backtestRun.findUnique({ where: { id } })
    if (!row) throw new NotFoundException(`Backtest ${id} not found`)

    const version = await this.parameters.byId(row.parameter_version_id)

    return {
      id: row.id,
      status: statusOf(row.report),
      engineVersion: row.engine_version,
      parameterVersionId: row.parameter_version_id,
      dataThrough: row.data_through,
      origins: row.origins,
      createdAt: row.created_at.toISOString(),
      /** The values the backtest used — still readable after newer versions exist. */
      parameters: { id: version.id, values: version.values },
      report: row.report,
    }
  }

  /** Plain text for reading with the owner; formats the stored report and adds nothing. */
  async summary(id: string): Promise<string> {
    const row = await this.prisma.backtestRun.findUnique({ where: { id } })
    if (!row) throw new NotFoundException(`Backtest ${id} not found`)

    const report = row.report as unknown as StoredReport
    if (report.status === 'completed') return summarizeReport(id, report)
    if (report.status === 'failed') return `BACKTEST ${id}\nStatus: failed.\n${report.error ?? ''}`

    return `BACKTEST ${id}\nStatus: running. The report is not final yet; nothing is shown until it is.`
  }

  async results(id: string, filter: { storeId?: number; sku?: string; origin?: string; action?: string; coherence?: string; limit?: number; offset?: number }) {
    await this.status(id)

    const where = {
      run_id: id,
      ...(filter.storeId !== undefined ? { store_id: filter.storeId } : {}),
      ...(filter.sku ? { sku: filter.sku } : {}),
      ...(filter.origin ? { origin: new Date(filter.origin) } : {}),
      ...(filter.action ? { action: filter.action } : {}),
      ...(filter.coherence ? { coherence: filter.coherence } : {}),
    }

    const [total, rows] = await Promise.all([
      this.prisma.backtestResult.count({ where }),
      this.prisma.backtestResult.findMany({ where, orderBy: [{ origin: 'asc' }, { store_id: 'asc' }, { sku: 'asc' }], take: Math.min(filter.limit ?? 100, 1000), skip: filter.offset ?? 0 }),
    ])

    return { backtestId: id, total, results: rows.map(row => row.outcome) }
  }

  /**
   * Stores the results and the final report in ONE transaction, so `completed`
   * can never be seen without its rows. Safe to repeat (redelivery): an advisory
   * lock serialises concurrent writers and a completed backtest is left alone.
   */
  async complete(id: string, output: BacktestOutput): Promise<boolean> {
    return this.prisma.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))::text AS locked`

        const row = await tx.backtestRun.findUnique({ where: { id }, select: { report: true } })
        if (!row || statusOf(row.report) === 'completed') return false

        await tx.backtestResult.deleteMany({ where: { run_id: id } })

        const rows = output.outcomes.map(outcome => ({
          run_id: id,
          origin: new Date(outcome.origin),
          store_id: outcome.storeId,
          sku: outcome.sku,
          action: outcome.action === 'no_evidence' ? 'no_evidence' : outcome.action,
          coherence: outcome.assessments.find(assessment => assessment.action === outcome.action)?.class ?? null,
          coverage_category: outcome.coverage,
          outcome: outcome as never,
        }))
        for (let i = 0; i < rows.length; i += 2000) await tx.backtestResult.createMany({ data: rows.slice(i, i + 2000) })

        await tx.backtestRun.update({ where: { id }, data: { origins: output.report.origins, data_through: output.report.request.dataThrough, report: output.report as never } })
        return true
      },
      { timeout: 300_000, maxWait: 10_000 },
    )
  }

  /** Marks a backtest failed with the reason (terminal: the queue gave up). A completed one is never touched. */
  async fail(id: string, reason: string): Promise<void> {
    const row = await this.prisma.backtestRun.findUnique({ where: { id }, select: { report: true } })
    if (!row || statusOf(row.report) === 'completed') return

    const previous = row.report as unknown as PendingReport
    await this.prisma.backtestRun.update({ where: { id }, data: { report: { ...previous, status: 'failed', error: reason } as never } })
  }

  async request(id: string): Promise<{ request: BacktestRequest; status: BacktestStatus } | null> {
    const row = await this.prisma.backtestRun.findUnique({ where: { id }, select: { report: true } })
    if (!row) return null

    const report = row.report as unknown as { request: BacktestRequest; status: BacktestStatus }
    return { request: report.request, status: report.status }
  }
}
