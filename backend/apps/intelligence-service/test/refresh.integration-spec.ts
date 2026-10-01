import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { HoldItBullMQBroker } from '@app/hold-it'
import { BaselineRepository } from '../src/modules/baseline/baseline.repository'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { REAL_PAIRS } from '../src/modules/engine/real-pairs.fixture'
import { ParametersModule } from '../src/modules/parameters/parameters.module'
import { ParametersService } from '../src/modules/parameters/parameters.service'
import { FreshnessService } from '../src/modules/refresh/freshness.service'
import { REFRESH_QUEUES } from '../src/modules/refresh/refresh.constants'
import { BACKTEST_PORT, type BacktestPort, type BacktestStartInput, type BacktestStatus } from '../src/modules/refresh/refresh.ports'
import { RefreshService, type RefreshOutcome } from '../src/modules/refresh/refresh.service'
import { EngineStoreWorker } from '../src/modules/runs/engine-store.worker'
import { RunFinalizer } from '../src/modules/runs/run-finalizer'
import { RunInputBuilder } from '../src/modules/runs/run-input.builder'
import { INTELLIGENCE_QUEUES, type EngineStoreJob } from '../src/modules/runs/runs.constants'
import { RunsService } from '../src/modules/runs/runs.service'
import { ProductsClient } from '../src/modules/sources/products.client'
import { SalesClient } from '../src/modules/sources/sales.client'
import { StoresClient } from '../src/modules/sources/stores.client'
import { SupplyClient, type SupplyVisitDto } from '../src/modules/sources/supply.client'
import { resetDisposableDb } from './support/reset-db'

/**
 * The monthly refresh end to end on a DISPOSABLE Postgres. The sibling services are stubbed from
 * compact fixtures of REAL history through August (two real stores); months after August are stubbed
 * as "imported" only when a test says so, with no rows — they exist to move `dataThrough`, nothing else.
 * The broker only records jobs and the backtest is a stub of the port.
 */
const STORE_A = 1
const STORE_B = 5
const PAIRS = Object.values(REAL_PAIRS)
const forStore = (id: number) => PAIRS.filter(pair => pair.storeId === id)

function visitsFor(storeId: number): SupplyVisitDto[] {
  const byTime = new Map<string, SupplyVisitDto>()
  for (const pair of forStore(storeId)) {
    for (const [endedAt, before, confirmed, restocked, removed, adjustment, after] of pair.visits) {
      const visit = byTime.get(endedAt) ?? { id: byTime.size + 1, period: endedAt.slice(0, 7), kind: 'combined', started_at: null, ended_at: endedAt, previous_ended_at: null, source_reference: 'x', lines: [] }
      visit.lines.push({ sku: pair.sku, balance_before: before, confirmed_count: confirmed, quantity_to_restock: null, restocked, removed_total: removed, adjustment, balance_after: after, capacity: null })
      byTime.set(endedAt, visit)
    }
  }
  return [...byTime.values()]
}

class StubBacktest implements BacktestPort {
  started: BacktestStartInput[] = []
  state: BacktestStatus = 'running'
  failStart = false

  async start(input: BacktestStartInput) {
    if (this.failStart) throw new Error('backtest could not start')
    this.started.push(input)
    return { id: `bt-${this.started.length}` }
  }

  async status() {
    return this.state
  }
}

describe('monthly refresh', () => {
  let app: TestingModule
  let prisma: PrismaClientService
  let refresh: RefreshService
  let worker: EngineStoreWorker
  const queued: { queueName: string; message: unknown }[] = []
  const backtest = new StubBacktest()
  /** Months after August that the stubbed sources hold (supply and sales both, no rows). */
  const imported = new Set<string>()

  const NOW_SEP = new Date('2026-09-05T12:00:00Z')
  const NOW_OCT = new Date('2026-10-05T12:00:00Z')
  const NOW_NOV = new Date('2026-11-05T12:00:00Z')

  const supplyStub = {
    visitStoreIds: async () => [STORE_A, STORE_B],
    visits: async (storeId: number) => visitsFor(storeId),
    period: async (storeId: number, month: string) => {
      if (imported.has(month)) return { store_id: storeId, period: month, restocks: [], removals: [], adjustments: [] }
      const known = forStore(storeId).some(pair => pair.monthly.some(m => m[0] === month))
      if (!known) return null

      return {
        store_id: storeId,
        period: month,
        restocks: forStore(storeId).flatMap(pair => pair.monthly.filter(m => m[0] === month && m[5] > 0).map(m => ({ sku: pair.sku, quantity_restocked: m[5] }))),
        removals: forStore(storeId).flatMap(pair => pair.monthly.filter(m => m[0] === month).flatMap(m => Object.entries(m[4]).map(([reason, quantity_removed]) => ({ sku: pair.sku, reason, counts_as_loss: true, quantity_removed })))),
        adjustments: [],
      }
    },
  }
  const salesStub = {
    period: async (storeId: number, month: string) => {
      if (imported.has(month)) return []
      const present = forStore(storeId).some(pair => pair.monthly.some(m => m[0] === month && m[1]))
      return present ? forStore(storeId).flatMap(pair => pair.monthly.filter(m => m[0] === month && m[1]).map(m => ({ sku: pair.sku, quantity_sold: m[2], revenue_cents: m[3] }))) : null
    },
  }
  const productsStub = {
    products: async () => PAIRS.map((pair, id) => ({ id: id + 1, sku: pair.sku, name: pair.name ?? pair.sku, package_type: null, units_per_package: null })),
    costsAsOf: async () => ({ as_of: '2026-08-31', resolved: PAIRS.map(pair => ({ sku: pair.sku, cost_cents: pair.costCents })), unresolved: [], complete: true }),
  }
  const storesStub = {
    stores: async () => [
      { id: STORE_A, name: 'Ascenty - ADM' },
      { id: STORE_B, name: 'Ascenty - JDI01' },
    ],
  }
  const brokerStub = { holdIt: async (call: { queueName: string; message: unknown }) => void queued.push({ queueName: call.queueName, message: call.message }) }

  const drainEngine = async () => {
    const engineJobs = queued.filter(call => call.queueName === INTELLIGENCE_QUEUES.ENGINE_STORE)
    for (const call of engineJobs) {
      queued.splice(queued.indexOf(call), 1)
      await worker.process({ id: 'j', data: call.message as EngineStoreJob } as never)
    }
  }
  const started = (outcome: RefreshOutcome) => {
    if (outcome.action !== 'started') throw new Error(`expected a started refresh, got ${outcome.action}`)
    return outcome.set
  }

  /** Runs one refresh to the end the way the queue would: engine jobs, then the polls of the set. */
  async function finish(setId: string, backtestState: BacktestStatus) {
    await drainEngine()
    backtest.state = 'running'
    await refresh.advance(setId) // engine completed -> backtest started
    backtest.state = backtestState
    return refresh.advance(setId)
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule, ParametersModule],
      providers: [
        BaselineRepository,
        RunsService,
        RunInputBuilder,
        RunFinalizer,
        FreshnessService,
        RefreshService,
        { provide: BACKTEST_PORT, useValue: backtest },
        { provide: SupplyClient, useValue: supplyStub },
        { provide: SalesClient, useValue: salesStub },
        { provide: ProductsClient, useValue: productsStub },
        { provide: StoresClient, useValue: storesStub },
        { provide: HoldItBullMQBroker, useValue: brokerStub },
      ],
    }).compile()

    app = await moduleRef.init()
    prisma = app.get(PrismaClientService)
    await resetDisposableDb(prisma)
    await app.get(ParametersService).ensureInitial()

    const baselines = app.get(BaselineRepository)
    for (const [sku, quantity] of [['5012', 21], ['1070', 12], ['1071', 12]] as [string, number][]) await baselines.add(sku, quantity, 'test', new Date('2026-09-30T00:00:00Z'))

    refresh = app.get(RefreshService)
    worker = new EngineStoreWorker(prisma, app.get(RunInputBuilder), app.get(ParametersService), app.get(RunFinalizer))
  }, 60000)

  afterAll(async () => {
    await app?.close()
  }, 30000)

  beforeEach(() => {
    queued.length = 0
  })

  it('has nothing current before the first refresh, and says what is available', async () => {
    const status = await refresh.status(NOW_SEP)

    expect(status.current).toBeNull()
    expect(status.freshness).toMatchObject({ status: 'not_computed', dataThrough: null, latestAvailableMonth: '2026-08' })
  })

  it('starts one linked set through the latest available month: an engine run now, the backtest once the run completes', async () => {
    const set = started(await refresh.evaluate({ trigger: 'event', now: NOW_SEP }))

    expect(set).toMatchObject({ status: 'running', targetMonth: '2026-08', dataThrough: null, rangeFrom: '2026-01', rangeTo: '2026-08', trigger: 'event', isCurrent: false })
    const run = await prisma.engineRun.findUnique({ where: { id: set.engineRunId as string } })
    expect(run).toMatchObject({ range_to: '2026-08', as_of: new Date('2026-09-01T00:00:00Z') })
    expect(queued.some(call => call.queueName === REFRESH_QUEUES.ADVANCE)).toBe(true)
    expect(backtest.started).toHaveLength(0)

    await drainEngine()
    await refresh.advance(set.id)

    // The backtest is started with the history the engine read and the end of that month as reference.
    expect(backtest.started).toHaveLength(1)
    expect(backtest.started[0]).toMatchObject({ rangeFrom: '2026-01', rangeTo: '2026-08', dataThrough: '2026-08', parameterVersionId: run?.parameter_version_id })
    expect(backtest.started[0].asOf.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect((await refresh.status(NOW_SEP)).current).toBeNull()
  })

  it('the pointer moves only when the engine run AND the backtest have completed, and the set is then stamped', async () => {
    const [set] = await refresh.sets()
    expect(await refresh.currentSet()).toBeNull()

    backtest.state = 'running'
    expect(await refresh.advance(set.id)).toMatchObject({ status: 'running', reschedule: true })
    expect(await refresh.currentSet()).toBeNull()

    backtest.state = 'completed'
    expect(await refresh.advance(set.id)).toMatchObject({ status: 'completed', reschedule: false })

    const current = await refresh.currentSet()
    expect(current).toMatchObject({ id: set.id, status: 'completed', data_through: '2026-08', engine_version: '1.0.0' })
    expect(current?.computed_at).toBeInstanceOf(Date)
    expect(current?.parameter_version_id).toBeGreaterThan(0)
    expect(current?.backtest_id).toBe('bt-1')
  })

  it('a finished set is not touched by another look, and the same month is not refreshed twice', async () => {
    const [set] = await refresh.sets()
    const before = JSON.stringify(await prisma.refreshSet.findUnique({ where: { id: set.id } }))

    expect(await refresh.advance(set.id)).toMatchObject({ status: 'completed', reschedule: false })
    expect(JSON.stringify(await prisma.refreshSet.findUnique({ where: { id: set.id } }))).toBe(before)

    expect(await refresh.evaluate({ trigger: 'event', now: NOW_SEP })).toEqual({ action: 'up_to_date', dataThrough: '2026-08' })
    expect(await refresh.evaluate({ trigger: 'manual', month: '2026-08', now: NOW_SEP })).toMatchObject({ action: 'already_done', set: { id: set.id } })
  })

  it('freshness: up to date, then a month pending import is not claimed, then a closed month not incorporated is out of date by 1', async () => {
    const upToDate = await refresh.status(NOW_SEP)
    expect(upToDate.freshness).toMatchObject({ dataThrough: '2026-08', status: 'up_to_date', outOfDate: false, monthsLagged: 0 })
    expect(upToDate.freshness.computedAt).toBe(upToDate.current?.computedAt)

    // September ended on 1 Oct but nothing was imported: pending, never covered.
    const pending = await refresh.status(NOW_OCT)
    expect(pending.freshness).toMatchObject({ dataThrough: '2026-08', status: 'up_to_date', outOfDate: false })
    expect(pending.freshness.pendingImport).toEqual([expect.objectContaining({ month: '2026-09', importedStores: 0, activeStores: 2 })])

    imported.add('2026-09')
    app.get(FreshnessService).clearCache() // a probe is remembered for a minute; the import just changed the answer
    const lagging = (await refresh.status(NOW_OCT)).freshness
    expect(lagging).toMatchObject({ dataThrough: '2026-08', status: 'out_of_date', outOfDate: true, monthsLagged: 1, latestAvailableMonth: '2026-09', pendingImport: [] })
  })

  it('a refresh that fails leaves the previous current set in place and records why', async () => {
    const august = await refresh.currentSet()
    const set = started(await refresh.evaluate({ trigger: 'event', now: NOW_OCT }))
    expect(set.targetMonth).toBe('2026-09')

    const result = await finish(set.id, 'failed')

    expect(result).toMatchObject({ status: 'failed', reschedule: false })
    expect((await refresh.currentSet())?.id).toBe(august?.id)
    const status = await refresh.status(NOW_OCT)
    expect(status.current?.dataThrough).toBe('2026-08')
    expect(status.lastFailure).toMatchObject({ id: set.id, status: 'failed', dataThrough: null })
    expect(status.lastFailure?.error).toMatch(/backtest/)
    expect(status.freshness).toMatchObject({ outOfDate: true, monthsLagged: 1 })
  })

  it('a backtest that cannot start fails the set instead of completing it without a backtest', async () => {
    backtest.failStart = true
    const set = started(await refresh.evaluate({ trigger: 'manual', month: '2026-09', now: NOW_OCT }))
    await drainEngine()
    await refresh.advance(set.id)
    backtest.failStart = false

    const failed = (await refresh.sets()).find(row => row.id === set.id)
    expect(failed).toMatchObject({ status: 'failed' })
    expect(failed?.error).toMatch(/could not start the backtest/)
    expect((await refresh.currentSet())?.data_through).toBe('2026-08')
  })

  it('September is added as a new set and August is neither altered nor deleted', async () => {
    const august = (await refresh.currentSet()) as NonNullable<Awaited<ReturnType<RefreshService['currentSet']>>>
    const augustSet = JSON.stringify(await prisma.refreshSet.findUnique({ where: { id: august.id } }))
    const augustResults = JSON.stringify(await prisma.recommendation.findMany({ where: { run_id: august.engine_run_id as string }, orderBy: [{ store_id: 'asc' }, { sku: 'asc' }] }))
    const augustRun = JSON.stringify(await prisma.engineRun.findUnique({ where: { id: august.engine_run_id as string } }))

    // A failed set for September exists; it does not block a new attempt.
    const set = started(await refresh.evaluate({ trigger: 'event', now: NOW_OCT }))
    const result = await finish(set.id, 'completed')

    expect(result).toMatchObject({ status: 'completed' })
    const september = await refresh.currentSet()
    expect(september).toMatchObject({ id: set.id, data_through: '2026-09' })
    expect(september?.id).not.toBe(august.id)

    expect(JSON.stringify(await prisma.refreshSet.findUnique({ where: { id: august.id } }))).toBe(augustSet)
    expect(JSON.stringify(await prisma.recommendation.findMany({ where: { run_id: august.engine_run_id as string }, orderBy: [{ store_id: 'asc' }, { sku: 'asc' }] }))).toBe(augustResults)
    expect(JSON.stringify(await prisma.engineRun.findUnique({ where: { id: august.engine_run_id as string } }))).toBe(augustRun)
  })

  it('reads one Product x Store across the sets, oldest first, each stating the period it covers and its versions', async () => {
    const history = await refresh.history(STORE_A, '5012')

    expect(history.sets.map(entry => entry.dataThrough)).toEqual(['2026-08', '2026-09'])
    expect(history.sets.map(entry => entry.isCurrent)).toEqual([false, true])
    for (const entry of history.sets) {
      expect(entry).toMatchObject({ status: 'completed', engineVersion: '1.0.0' })
      expect(entry.parameterVersionId).toBeGreaterThan(0)
      expect(entry.computedAt).not.toBeNull()
      expect((entry.result as { sku: string }).sku).toBe('5012')
    }
    // A failed set is not part of the evolution.
    expect(history.sets).toHaveLength(2)
  })

  it('a pair that is absent from a set says so instead of being left out', async () => {
    const history = await refresh.history(STORE_A, 'no-such-sku')

    expect(history.sets).toHaveLength(2)
    expect(history.sets.every(entry => entry.result === null)).toBe(true)
  })

  it('freshness of the new current set: up to date through September', async () => {
    const status = await refresh.status(NOW_OCT)

    expect(status.freshness).toMatchObject({ dataThrough: '2026-09', status: 'up_to_date', outOfDate: false, monthsLagged: 0 })
    expect(status.current?.computedAt).not.toBeNull()
  })

  it('two events racing for the same new month start only one set', async () => {
    imported.add('2026-10')
    const outcomes = await Promise.all([refresh.evaluate({ trigger: 'event', now: NOW_NOV }), refresh.evaluate({ trigger: 'event', now: NOW_NOV })])

    expect(outcomes.map(outcome => outcome.action).sort()).toEqual(['already_running', 'started'])
    expect(await prisma.refreshSet.count({ where: { target_month: '2026-10' } })).toBe(1)
    expect(await prisma.engineRun.count({ where: { range_to: '2026-10' } })).toBe(1)
  })

  it('a month that is still open cannot be refreshed by hand', async () => {
    await expect(refresh.evaluate({ trigger: 'manual', month: '2026-11', now: NOW_NOV })).rejects.toThrow(/has not ended/)
    await expect(refresh.evaluate({ trigger: 'manual', month: 'nope', now: NOW_NOV })).rejects.toThrow(/YYYY-MM/)
  })
})
