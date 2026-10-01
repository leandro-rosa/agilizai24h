import { randomUUID } from 'node:crypto'
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { HoldItBullMQBroker } from '@app/hold-it'
import { PrismaClientService } from '../db-client/prisma-client.service'
import { ENGINE_VERSION } from '../engine/engine'
import { ParametersService } from '../parameters/parameters.service'
import { RunsService } from '../runs/runs.service'
import { buildFreshness, unknownFreshness, type Freshness } from './freshness'
import { FreshnessService } from './freshness.service'
import { endOfMonth, monthEnded } from './months'
import { ADVANCE_DELAY_MS, DEFAULT_DEBOUNCE_SECONDS, MAX_RUNNING_MS, REFRESH_QUEUES, RETRY_OPTIONS, type RefreshAdvanceJob, type RefreshCheckJob } from './refresh.constants'
import { BACKTEST_PORT, type BacktestPort } from './refresh.ports'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
/** Serialises "is there already a set for this month?" + "create it" across workers. */
const LOCK_KEY = 7101
/** Marks the instant between claiming the right to start the backtest and having its id. */
const BACKTEST_STARTING = 'starting'

type RefreshSetRow = NonNullable<Awaited<ReturnType<PrismaClientService['refreshSet']['findUnique']>>>

export type RefreshOutcome =
  | { action: 'started'; set: RefreshSetView }
  | { action: 'already_running' | 'already_done'; set: RefreshSetView }
  | { action: 'up_to_date'; dataThrough: string | null }
  | { action: 'nothing_available'; pendingImport: Freshness['pendingImport'] }
  | { action: 'failed'; set: RefreshSetView }

export interface RefreshSetView {
  id: string
  status: string
  targetMonth: string
  /** The last month the set really covers; null until it completes. */
  dataThrough: string | null
  rangeFrom: string
  rangeTo: string
  asOf: string
  engineVersion: string
  parameterVersionId: number
  engineRunId: string | null
  backtestId: string | null
  trigger: string
  error: string | null
  createdAt: string
  /** When the whole set finished; the "last updated" of every figure in it. */
  computedAt: string | null
  isCurrent: boolean
}

/**
 * The monthly refresh (design D14): when a new month becomes available, one engine run over
 * the history through it plus the backtest (which also yields coverage and the count-rule
 * sensitivity) are tied together as ONE immutable set. The set becomes "current" only when
 * both have finished; a failed refresh leaves the previous current set exactly where it was.
 *
 * Nothing here computes anything: the engine run is `RunsService.create` and the backtest is
 * behind `BACKTEST_PORT`. This service starts them, watches them and records the outcome.
 */
@Injectable()
export class RefreshService {
  private readonly logger = new Logger(RefreshService.name)

  constructor(
    private readonly prisma: PrismaClientService,
    private readonly runs: RunsService,
    private readonly parameters: ParametersService,
    private readonly freshness: FreshnessService,
    private readonly broker: HoldItBullMQBroker,
    private readonly config: ConfigService,
    @Inject(BACKTEST_PORT) private readonly backtest: BacktestPort,
  ) {}

  /**
   * Called for every period event, so it must be cheap: it only schedules one debounced check.
   * The job id carries the time window, so every event of a burst lands on the same job and the
   * rest are ignored; an event that arrives while a check is running belongs to the next window
   * and schedules the next check, so a late import is never lost.
   */
  async scheduleCheck(correlationId?: string, nowMs: number = Date.now()): Promise<{ jobId: string; delayMs: number }> {
    const windowMs = (this.config.get<number>('REFRESH_DEBOUNCE_SECONDS') ?? DEFAULT_DEBOUNCE_SECONDS) * 1000
    const bucket = Math.floor(nowMs / windowMs)
    const delayMs = Math.max(1000, (bucket + 1) * windowMs - nowMs)
    const jobId = `refresh-check-${bucket}`

    const message: RefreshCheckJob = { schemaVersion: 1, correlationId }
    await this.broker.holdIt({ queueName: REFRESH_QUEUES.CHECK, message, options: { ...RETRY_OPTIONS, jobId, delay: delayMs } })

    return { jobId, delayMs }
  }

  /**
   * Starts a refresh when `dataThrough` has advanced beyond the current set (or when asked by hand).
   * A manual call may name a `month` (it must have ended) and may `force` a new set for a month that
   * already has a completed one (e.g. after new parameters); a running set for the same month is
   * never duplicated.
   */
  async evaluate(input: { trigger: 'event' | 'manual'; month?: string; force?: boolean; now?: Date; correlationId?: string }): Promise<RefreshOutcome> {
    const now = input.now ?? new Date()
    const current = await this.currentSet()

    let target: string | null
    if (input.month !== undefined) {
      if (!PERIOD.test(input.month)) throw new BadRequestException('month must be YYYY-MM')
      if (!monthEnded(input.month, now)) throw new BadRequestException(`${input.month} has not ended yet; a month that is still open is never covered`)
      if (input.month < this.freshness.historyStart()) throw new BadRequestException(`${input.month} is before the history start ${this.freshness.historyStart()}`)
      target = input.month
    } else {
      const summary = await this.freshness.probeFresh(current?.data_through ?? null, now, input.correlationId)
      if (summary.dataThrough === null) return current ? { action: 'up_to_date', dataThrough: current.data_through } : { action: 'nothing_available', pendingImport: summary.pendingImport }
      target = summary.dataThrough
    }

    return this.start(target, input.trigger, input.force === true, input.correlationId)
  }

  private async start(target: string, trigger: 'event' | 'manual', force: boolean, correlationId?: string): Promise<RefreshOutcome> {
    const version = await this.parameters.current()
    const rangeFrom = this.freshness.historyStart()
    const asOf = endOfMonth(target)

    const created = await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`

      const existing = await tx.refreshSet.findFirst({ where: { target_month: target, status: { in: ['running', 'completed'] } }, orderBy: { created_at: 'desc' } })
      if (existing && (existing.status === 'running' || !force)) return { existing }

      const row = await tx.refreshSet.create({
        data: { id: randomUUID(), status: 'running', target_month: target, range_from: rangeFrom, range_to: target, as_of: asOf, engine_version: ENGINE_VERSION, parameter_version_id: version.id, trigger },
      })

      return { row }
    })

    if ('existing' in created && created.existing) {
      return { action: created.existing.status === 'running' ? 'already_running' : 'already_done', set: await this.view(created.existing) }
    }

    const row = (created as { row: RefreshSetRow }).row

    try {
      const run = await this.runs.create({ rangeFrom, rangeTo: target, asOf: asOf.toISOString(), correlationId })
      const started = await this.prisma.refreshSet.update({ where: { id: row.id }, data: { engine_run_id: run.id, engine_version: run.engineVersion, parameter_version_id: run.parameterVersionId } })
      await this.scheduleAdvance(row.id)
      this.logger.log(`Refresh ${row.id} started for ${target} (${trigger}); engine run ${run.id}`)

      return { action: 'started', set: await this.view(started) }
    } catch (error) {
      return { action: 'failed', set: await this.view(await this.fail(row.id, `could not start the engine run: ${message(error)}`)) }
    }
  }

  /**
   * One look at a running set. Idempotent and safe to repeat: it starts the backtest at most once,
   * promotes the set at most once, and never touches a set that is no longer running.
   */
  async advance(setId: string, now: Date = new Date()): Promise<{ status: string; reschedule: boolean }> {
    const set = await this.prisma.refreshSet.findUnique({ where: { id: setId } })
    if (!set || set.status !== 'running') return { status: set?.status ?? 'unknown', reschedule: false }

    await this.prisma.refreshSet.updateMany({ where: { id: setId, status: 'running' }, data: { polls: { increment: 1 } } })

    try {
      if (now.getTime() - set.created_at.getTime() > MAX_RUNNING_MS) {
        await this.fail(setId, 'timed out before the engine run and the backtest both completed')
        return { status: 'failed', reschedule: false }
      }
      if (!set.engine_run_id) return { status: 'running', reschedule: true }

      const run = await this.prisma.engineRun.findUnique({ where: { id: set.engine_run_id } })
      if (!run) {
        await this.fail(setId, `engine run ${set.engine_run_id} not found`)
        return { status: 'failed', reschedule: false }
      }
      if (run.status === 'failed') {
        await this.fail(setId, `engine run failed: ${run.error ?? 'no reason recorded'}`)
        return { status: 'failed', reschedule: false }
      }
      if (run.status !== 'completed') return { status: 'running', reschedule: true }

      // A set never claims a month its engine run did not read.
      if (run.data_through === null) {
        await this.fail(setId, 'the engine run completed without reading any available month')
        return { status: 'failed', reschedule: false }
      }

      const backtestId = set.backtest_id
      if (backtestId === null) {
        // Exactly one caller wins the right to start the backtest.
        const claim = await this.prisma.refreshSet.updateMany({ where: { id: setId, status: 'running', backtest_id: null }, data: { backtest_id: BACKTEST_STARTING } })
        if (claim.count !== 1) return { status: 'running', reschedule: true }

        try {
          const started = await this.backtest.start({
            rangeFrom: run.range_from,
            rangeTo: run.range_to,
            dataThrough: run.data_through,
            asOf: run.as_of,
            parameterVersionId: run.parameter_version_id,
          })
          await this.prisma.refreshSet.update({ where: { id: setId }, data: { backtest_id: started.id } })
          return { status: 'running', reschedule: true }
        } catch (error) {
          await this.fail(setId, `could not start the backtest: ${message(error)}`)
          return { status: 'failed', reschedule: false }
        }
      }
      if (backtestId === BACKTEST_STARTING) return { status: 'running', reschedule: true }

      const status = await this.backtest.status(backtestId)
      if (status === 'failed') {
        await this.fail(setId, `backtest ${backtestId} failed`)
        return { status: 'failed', reschedule: false }
      }
      if (status !== 'completed') return { status: 'running', reschedule: true }

      return { status: (await this.promote(setId, run.data_through)) ? 'completed' : 'running', reschedule: false }
    } catch (error) {
      // A transient read failure must not strand the set: look again later (the timeout bounds it).
      this.logger.warn(`Refresh ${setId}: could not check progress — ${message(error)}`)
      return { status: 'running', reschedule: true }
    }
  }

  async scheduleAdvance(setId: string): Promise<void> {
    const set = await this.prisma.refreshSet.findUnique({ where: { id: setId }, select: { polls: true } })
    const job: RefreshAdvanceJob = { schemaVersion: 1, setId }

    await this.broker.holdIt({ queueName: REFRESH_QUEUES.ADVANCE, message: job, options: { jobId: `advance-${setId}-${set?.polls ?? 0}`, delay: ADVANCE_DELAY_MS, removeOnComplete: true, removeOnFail: true } })
  }

  /** The whole set has finished: stamp it and move the pointer, atomically. The pointer never moves back in time. */
  private async promote(setId: string, dataThrough: string): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`

      const claimed = await tx.refreshSet.updateMany({ where: { id: setId, status: 'running' }, data: { status: 'completed', data_through: dataThrough, computed_at: new Date() } })
      if (claimed.count !== 1) return false

      const pointer = await tx.refreshPointer.findUnique({ where: { id: 1 } })
      const currentSet = pointer ? await tx.refreshSet.findUnique({ where: { id: pointer.refresh_set_id } }) : null

      if (!currentSet || (currentSet.data_through ?? '') <= dataThrough) {
        await tx.refreshPointer.upsert({ where: { id: 1 }, create: { id: 1, refresh_set_id: setId }, update: { refresh_set_id: setId, moved_at: new Date() } })
        this.logger.log(`Refresh ${setId} completed: current set is now data through ${dataThrough}`)
      } else {
        this.logger.log(`Refresh ${setId} completed through ${dataThrough}, older than the current set; the pointer stays`)
      }

      return true
    })
  }

  /** A failed set records why and changes nothing else — in particular not the current pointer. */
  private async fail(setId: string, error: string): Promise<RefreshSetRow> {
    this.logger.error(`Refresh ${setId} failed: ${error}`)
    await this.prisma.refreshSet.updateMany({ where: { id: setId, status: 'running' }, data: { status: 'failed', error } })

    return (await this.prisma.refreshSet.findUnique({ where: { id: setId } })) as RefreshSetRow
  }

  async currentSet(): Promise<RefreshSetRow | null> {
    const pointer = await this.prisma.refreshPointer.findUnique({ where: { id: 1 } })

    return pointer ? this.prisma.refreshSet.findUnique({ where: { id: pointer.refresh_set_id } }) : null
  }

  /** The current set, any set in progress, the last failure, and how the current set compares with what is available. */
  async status(now: Date = new Date(), correlationId?: string) {
    const current = await this.currentSet()
    const [running, failed] = await Promise.all([
      this.prisma.refreshSet.findFirst({ where: { status: 'running' }, orderBy: { created_at: 'desc' } }),
      this.prisma.refreshSet.findFirst({ where: { status: 'failed', ...(current ? { created_at: { gt: current.created_at } } : {}) }, orderBy: { created_at: 'desc' } }),
    ])

    return {
      current: current ? await this.view(current, current.id) : null,
      freshness: await this.currentFreshness(current, now, correlationId),
      running: running ? await this.view(running, current?.id) : null,
      /** The latest failure newer than the current set; the current set stays in place regardless. */
      lastFailure: failed ? await this.view(failed, current?.id) : null,
      /** Skipped stores of the current set's engine run — listed so a partial set is never read as complete. */
      currentStoresSkipped: current?.engine_run_id ? await this.prisma.engineRunStore.count({ where: { run_id: current.engine_run_id, status: 'skipped' } }) : 0,
    }
  }

  private async currentFreshness(current: RefreshSetRow | null, now: Date, correlationId?: string): Promise<Freshness> {
    if (current) return this.freshness.freshnessOf(current.data_through, current.computed_at, now, correlationId)

    // Nothing computed yet: say so, and still show what could be refreshed.
    try {
      const summary = await this.freshness.probe(null, now, correlationId)
      return buildFreshness({ dataThrough: null, computedAt: null, latestAvailable: summary.dataThrough, pendingImport: summary.pendingImport })
    } catch (error) {
      return unknownFreshness(null, null, message(error))
    }
  }

  /** Every set, newest first (failed and running ones included, so nothing is hidden). */
  async sets(limit = 20) {
    const current = await this.currentSet()
    const rows = await this.prisma.refreshSet.findMany({ orderBy: { created_at: 'desc' }, take: Math.min(limit, 200) })

    return Promise.all(rows.map(row => this.view(row, current?.id)))
  }

  /**
   * The evolution of one Product x Store: its result in each COMPLETED set, oldest first, each stating
   * the period it covers and the versions that produced it. A set the pair is absent from says so
   * (`result: null`) instead of being left out.
   */
  async history(storeId: number, sku: string) {
    const current = await this.currentSet()
    const sets = await this.prisma.refreshSet.findMany({ where: { status: 'completed' }, orderBy: [{ data_through: 'asc' }, { computed_at: 'asc' }, { created_at: 'asc' }] })
    const runIds = sets.flatMap(set => (set.engine_run_id ? [set.engine_run_id] : []))
    const rows = await this.prisma.recommendation.findMany({ where: { store_id: storeId, sku, run_id: { in: runIds } }, select: { run_id: true, result: true } })
    const byRun = new Map(rows.map(row => [row.run_id, row.result]))

    return {
      storeId,
      sku,
      sets: await Promise.all(
        sets.map(async set => ({ ...(await this.view(set, current?.id)), result: set.engine_run_id ? (byRun.get(set.engine_run_id) ?? null) : null })),
      ),
    }
  }

  private async view(set: RefreshSetRow, currentId?: string | null): Promise<RefreshSetView> {
    const isCurrent = currentId !== undefined ? set.id === currentId : set.id === (await this.currentSet())?.id

    return {
      id: set.id,
      status: set.status,
      targetMonth: set.target_month,
      dataThrough: set.data_through,
      rangeFrom: set.range_from,
      rangeTo: set.range_to,
      asOf: set.as_of.toISOString(),
      engineVersion: set.engine_version,
      parameterVersionId: set.parameter_version_id,
      engineRunId: set.engine_run_id,
      backtestId: set.backtest_id === BACKTEST_STARTING ? null : set.backtest_id,
      trigger: set.trigger,
      error: set.error,
      createdAt: set.created_at.toISOString(),
      computedAt: set.computed_at ? set.computed_at.toISOString() : null,
      isCurrent,
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
