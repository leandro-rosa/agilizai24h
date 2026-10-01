import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { HoldItBullMQBroker } from '@app/hold-it'
import { BacktestController } from '../src/modules/backtest/backtest.controller'
import type { BacktestJob } from '../src/modules/backtest/backtest.constants'
import { BacktestRunner } from '../src/modules/backtest/backtest.runner'
import { BacktestService } from '../src/modules/backtest/backtest.service'
import { BacktestWorker } from '../src/modules/backtest/backtest.worker'
import { BaselineRepository } from '../src/modules/baseline/baseline.repository'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { REAL_PAIRS } from '../src/modules/engine/real-pairs.fixture'
import { ParametersModule } from '../src/modules/parameters/parameters.module'
import { ParametersService } from '../src/modules/parameters/parameters.service'
import { BACKTEST_PORT, type BacktestPort } from '../src/modules/refresh/refresh.ports'
import { RunInputBuilder } from '../src/modules/runs/run-input.builder'
import { ProductsClient } from '../src/modules/sources/products.client'
import { SalesClient } from '../src/modules/sources/sales.client'
import { StoresClient } from '../src/modules/sources/stores.client'
import { SupplyClient, type SupplyVisitDto } from '../src/modules/sources/supply.client'
import { resetDisposableDb } from './support/reset-db'

/**
 * The backtest end to end on a DISPOSABLE Postgres. The sibling services are stubbed
 * from compact fixtures of REAL history (two real stores, real SKUs), the broker only
 * records the job, and the test drives the worker the way the queue would.
 */
const STORE_A = 1
const STORE_B = 5
const SYNTHETIC = 99
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

describe('backtest', () => {
  let app: TestingModule
  let prisma: PrismaClientService
  let service: BacktestService
  let worker: BacktestWorker
  let failSupply = false
  const jobs: BacktestJob[] = []
  const jobOptions: { attempts?: number }[] = []

  const supplyStub = {
    visitStoreIds: async () => [STORE_A, STORE_B, SYNTHETIC],
    visits: async (storeId: number) => {
      if (failSupply) throw new Error('supply-service timed out')
      return visitsFor(storeId)
    },
    period: async (storeId: number, month: string) => ({
      store_id: storeId,
      period: month,
      restocks: forStore(storeId).flatMap(pair => pair.monthly.filter(m => m[0] === month && m[5] > 0).map(m => ({ sku: pair.sku, quantity_restocked: m[5] }))),
      removals: forStore(storeId).flatMap(pair => pair.monthly.filter(m => m[0] === month).flatMap(m => Object.entries(m[4]).map(([reason, quantity_removed]) => ({ sku: pair.sku, reason, counts_as_loss: true, quantity_removed })))),
      adjustments: [],
    }),
  }
  const salesStub = {
    period: async (storeId: number, month: string) => {
      const rows = forStore(storeId).flatMap(pair => pair.monthly.filter(m => m[0] === month && m[1]).map(m => ({ sku: pair.sku, quantity_sold: m[2], revenue_cents: m[3] })))
      const present = forStore(storeId).some(pair => pair.monthly.some(m => m[0] === month && m[1]))
      return present ? rows : null
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
      { id: SYNTHETIC, name: 'Loja [TESTE]' },
    ],
  }
  const brokerStub = {
    holdIt: async (call: { message: BacktestJob; options?: { attempts?: number } }) => {
      jobs.push(call.message)
      jobOptions.push(call.options ?? {})
    },
  }

  const input = (over: Partial<Parameters<BacktestService['start']>[0]> = {}) => ({
    rangeFrom: '2026-01',
    rangeTo: '2026-08',
    dataThrough: '2026-08',
    asOf: new Date('2026-09-01T00:00:00Z'),
    parameterVersionId: 1,
    ...over,
  })

  const run = (job: BacktestJob, over: { attemptsMade?: number; attempts?: number } = {}) =>
    worker.process({ id: 'j', data: job, attemptsMade: over.attemptsMade ?? 0, opts: { attempts: over.attempts ?? 3 } } as never)

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule, ParametersModule],
      controllers: [BacktestController],
      providers: [
        BaselineRepository,
        RunInputBuilder,
        BacktestRunner,
        BacktestService,
        { provide: BACKTEST_PORT, useExisting: BacktestService },
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

    // the baseline of record only: imported after every origin, as in real life
    const baselines = app.get(BaselineRepository)
    for (const pair of PAIRS) await baselines.add(pair.sku, 12, 'test', new Date('2026-09-30T00:00:00Z'))

    service = app.get(BacktestService)
    worker = new BacktestWorker(service, app.get(BacktestRunner), app.get(ParametersService))
  }, 60000)

  afterAll(async () => {
    await app?.close()
  }, 30000)

  beforeEach(() => {
    jobs.length = 0
    jobOptions.length = 0
    failSupply = false
  })

  it('is provided under the BACKTEST_PORT the monthly refresh depends on', () => {
    const port: BacktestPort = app.get(BACKTEST_PORT)

    expect(port).toBe(service)
  })

  it('start queues ONE job and returns at once: running, and no report until it is final', async () => {
    const { id } = await service.start(input())

    expect(jobs).toEqual([{ schemaVersion: 1, backtestId: id, correlationId: undefined }])
    expect(jobOptions[0].attempts).toBeGreaterThan(1)
    expect(await service.status(id)).toBe('running')
    expect(await service.summary(id)).toMatch(/Status: running/)
    expect(await prisma.backtestResult.count({ where: { run_id: id } })).toBe(0)
    await run(jobs[0])
  })

  it('runs through the queue to a stored report: origins April to August, results per pair, completed only when final', async () => {
    const { id } = await service.start(input())
    await run(jobs[0])

    const stored = await service.get(id)
    const report = stored.report as unknown as { status: string; origins: string[]; coverage: { overall: { total: number; categories: Record<string, number> } } }
    const rows = await prisma.backtestResult.count({ where: { run_id: id } })
    const c = report.coverage.overall

    expect(await service.status(id)).toBe('completed')
    expect(stored.origins).toEqual(report.origins)
    expect(report.origins.map(o => o.slice(0, 10))).toEqual(['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'])
    expect(Object.values(c.categories).reduce((a, b) => a + b, 0)).toBe(c.total)
    expect(rows).toBe(c.total - c.categories.insufficient_history)
    expect(stored.parameters.values.tolerance).toMatchObject({ pct: 0.1, units: 3 })
  })

  it('leaves the synthetic store out and never reads past data-through', async () => {
    const { id } = await service.start(input({ dataThrough: '2026-06', rangeTo: '2026-08' }))
    await run(jobs[0])

    const report = (await service.get(id)).report as unknown as { origins: string[]; limitations: string[] }
    expect(report.origins.map(o => o.slice(0, 7))).toEqual(['2026-04', '2026-05', '2026-06'])
    expect(report.limitations.join(' ')).toMatch(/1 synthetic store/)
    expect((await prisma.backtestResult.findMany({ where: { run_id: id }, select: { store_id: true } })).every(row => row.store_id !== SYNTHETIC)).toBe(true)
  })

  it('stores the action and coherence class on each row and reads them back filtered', async () => {
    const { id } = await service.start(input())
    await run(jobs[0])

    const all = await service.results(id, { limit: 1000 })
    const reduce = await service.results(id, { action: 'reduce', limit: 1000 })
    const one = await service.results(id, { storeId: STORE_A, sku: '5012', origin: '2026-06-01T00:00:00.000Z' })

    expect(all.total).toBeGreaterThan(0)
    expect(reduce.results.every(outcome => (outcome as { action: string }).action === 'reduce')).toBe(true)
    expect(one.total).toBe(1)
    expect(one.results[0]).toMatchObject({ storeId: STORE_A, sku: '5012', baseline: { quantity: 12, ofRecordQuantityOfTheTimeUnknown: true } })
    const coherences = await prisma.backtestResult.findMany({ where: { run_id: id }, select: { coherence: true } })
    expect(coherences.every(row => row.coherence === null || ['coherent', 'incoherent', 'inconclusive'].includes(row.coherence))).toBe(true)
  })

  it('uses the baseline in force from the stored history when it exists, and the baseline of record before it', async () => {
    await prisma.baselineQuantity.create({ data: { sku: '5012', quantity: 18, source: 'test', effective_from: new Date('2026-05-15T00:00:00Z') } })

    const { id } = await service.start(input())
    await run(jobs[0])

    const baselineAt = async (origin: string) =>
      ((await service.results(id, { storeId: STORE_A, sku: '5012', origin })).results[0] as { baseline: { quantity: number; ofRecordQuantityOfTheTimeUnknown: boolean } }).baseline

    // before 15 May the history does not reach the origin: the baseline of record (latest row = 12, from September) stands in
    expect(await baselineAt('2026-05-01T00:00:00.000Z')).toEqual({ quantity: 12, ofRecordQuantityOfTheTimeUnknown: true })
    expect(await baselineAt('2026-06-01T00:00:00.000Z')).toEqual({ quantity: 18, ofRecordQuantityOfTheTimeUnknown: false })
  })

  it('a redelivered job neither duplicates rows nor rewrites a finished report', async () => {
    const { id } = await service.start(input())
    const job = jobs[0]
    await run(job)
    const rows = await prisma.backtestResult.count({ where: { run_id: id } })
    const before = JSON.stringify((await service.get(id)).report)

    const again = (await run(job)) as { skipped: string }

    expect(again.skipped).toMatch(/already completed/)
    expect(await prisma.backtestResult.count({ where: { run_id: id } })).toBe(rows)
    expect(JSON.stringify((await service.get(id)).report)).toBe(before)
  })

  it('concurrent deliveries of the same job store one set of rows', async () => {
    const { id } = await service.start(input())
    const job = jobs[0]

    await Promise.all([run(job), run(job)])

    const report = (await service.get(id)).report as unknown as { coverage: { overall: { total: number; categories: Record<string, number> } } }
    expect(await prisma.backtestResult.count({ where: { run_id: id } })).toBe(report.coverage.overall.total - report.coverage.overall.categories.insufficient_history)
    expect(await service.status(id)).toBe('completed')
  })

  it('a store whose supply read fails is listed as skipped with the reason, never counted as zero recommendations', async () => {
    const { id } = await service.start(input())
    failSupply = true

    // the supply read of a store fails -> the store is listed as skipped, the backtest still completes without it
    await run(jobs[0])
    const report = (await service.get(id)).report as unknown as { limitations: string[]; origins: string[] }
    expect(report.limitations.join(' ')).toMatch(/Store 1 was skipped: supply-service timed out/)
    expect(report.origins).toEqual([])
  })

  it('a computation that throws stays running until the last attempt, then fails with the reason', async () => {
    const { id } = await service.start(input())
    const original = app.get(BacktestRunner).run
    app.get(BacktestRunner).run = async () => {
      throw new Error('boom')
    }

    await expect(run(jobs[0], { attemptsMade: 0, attempts: 3 })).rejects.toThrow('boom')
    expect(await service.status(id)).toBe('running')

    await expect(run(jobs[0], { attemptsMade: 2, attempts: 3 })).rejects.toThrow('boom')
    expect(await service.status(id)).toBe('failed')
    expect(await service.summary(id)).toMatch(/failed[\s\S]*boom/)

    app.get(BacktestRunner).run = original
  })

  it('rejects a malformed request before queueing anything', async () => {
    await expect(service.start(input({ rangeFrom: 'x' }))).rejects.toThrow(/YYYY-MM/)
    await expect(service.start(input({ dataThrough: '2026-09' }))).rejects.toThrow(/dataThrough/)
    await expect(service.start(input({ parameterVersionId: 9999 }))).rejects.toThrow(/not found/)
    expect(jobs).toEqual([])
  })

  it('the HTTP start fills in the defaults and the summary reads as plain text', async () => {
    const controller = app.get(BacktestController)
    const { id } = await controller.start({ rangeFrom: '2026-01', rangeTo: '2026-08' })
    await run(jobs[0])

    const text = await controller.summary(id)
    const list = await controller.list()

    expect(text).toMatch(/^BACKTEST /)
    expect(text).toMatch(/QUANTITY OF THE TIME IS UNKNOWN/)
    expect(text).toMatch(/decides nothing/)
    expect(list.find(item => item.id === id)).toMatchObject({ status: 'completed', dataThrough: '2026-08' })
  })

  it('an unknown backtest is a 404 and an unknown job is left alone', async () => {
    await expect(service.get('nope')).rejects.toThrow(/not found/)
    expect(await run({ schemaVersion: 1, backtestId: 'nope' })).toEqual({ skipped: 'unknown backtest' })
  })
})
