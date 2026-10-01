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
import { EngineStoreWorker } from '../src/modules/runs/engine-store.worker'
import { RunFinalizer } from '../src/modules/runs/run-finalizer'
import { RunInputBuilder } from '../src/modules/runs/run-input.builder'
import type { EngineStoreJob } from '../src/modules/runs/runs.constants'
import { RunsService } from '../src/modules/runs/runs.service'
import { ProductsClient } from '../src/modules/sources/products.client'
import { SalesClient } from '../src/modules/sources/sales.client'
import { StoresClient } from '../src/modules/sources/stores.client'
import { SupplyClient, type SupplyVisitDto } from '../src/modules/sources/supply.client'
import { resetDisposableDb } from './support/reset-db'

/**
 * A run end to end on a DISPOSABLE Postgres. The sibling services are stubbed from
 * compact fixtures of REAL history (two real stores, three real SKUs), the broker
 * only records the jobs, and the test drives the worker the way the queue would.
 */
const STORE_A = 1
const STORE_B = 5
const FAILING = 9
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

describe('engine runs', () => {
  let app: TestingModule
  let prisma: PrismaClientService
  let runs: RunsService
  let worker: EngineStoreWorker
  const jobs: EngineStoreJob[] = []
  let supplyFails = new Set<number>([FAILING])

  const supplyStub = {
    visitStoreIds: async () => [STORE_A, STORE_B, FAILING, SYNTHETIC],
    visits: async (storeId: number) => {
      if (supplyFails.has(storeId)) throw new Error('supply-service timed out')
      return visitsFor(storeId)
    },
    period: async (storeId: number, month: string) => ({
      store_id: storeId,
      period: month,
      restocks: forStore(storeId).flatMap(pair => pair.monthly.filter(m => m[0] === month && m[5] > 0).map(m => ({ sku: pair.sku, quantity_restocked: m[5] }))),
      removals: forStore(storeId).flatMap(pair =>
        pair.monthly.filter(m => m[0] === month).flatMap(m => Object.entries(m[4]).map(([reason, quantity_removed]) => ({ sku: pair.sku, reason, counts_as_loss: true, quantity_removed }))),
      ),
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
      { id: FAILING, name: 'Plena Saude - Itaqua' },
      { id: SYNTHETIC, name: 'Loja [TESTE]' },
    ],
  }
  const brokerStub = { holdIt: async (call: { message: EngineStoreJob }) => void jobs.push(call.message) }

  const drain = async () => {
    for (const job of jobs.splice(0)) await worker.process({ id: 'j', data: job } as never)
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule, ParametersModule],
      providers: [
        BaselineRepository,
        RunsService,
        RunInputBuilder,
        RunFinalizer,
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
    for (const [sku, quantity] of [['5012', 21], ['1070', 12], ['1071', 12], ['1071', 12]] as [string, number][]) await baselines.add(sku, quantity, 'test', new Date('2026-09-30T00:00:00Z'))

    runs = app.get(RunsService)
    worker = new EngineStoreWorker(prisma, app.get(RunInputBuilder), app.get(ParametersService), app.get(RunFinalizer))
  }, 60000)

  afterAll(async () => {
    await app?.close()
  }, 30000)

  beforeEach(() => {
    jobs.length = 0
  })

  it('queues one job per store, listing a synthetic store instead of silently dropping it', async () => {
    const run = await runs.create({ rangeFrom: '2026-01', rangeTo: '2026-08', asOf: '2026-08-31T23:59:59Z' })

    expect(jobs.map(j => j.storeId).sort()).toEqual([STORE_A, STORE_B, FAILING])
    expect(run).toMatchObject({ status: 'queued', storesTotal: 3, dataThrough: null })
    expect(run.stores).toEqual([{ storeId: SYNTHETIC, status: 'excluded', reason: 'synthetic', pairs: 0 }])
    await drain()
  })

  it('persists one result per Product x Store and records the engine and parameter versions', async () => {
    const run = await runs.create({ rangeFrom: '2026-01', rangeTo: '2026-08', asOf: '2026-08-31T23:59:59Z' })
    await drain()

    const done = await runs.get(run.id)
    const results = await runs.results(run.id, {})

    expect(done.status).toBe('completed')
    expect(done.engineVersion).toBe('1.0.0')
    expect(done.parameters.values.tolerance).toMatchObject({ pct: 0.1, units: 3 })
    expect(results.total).toBe(forStore(STORE_A).length + forStore(STORE_B).length)
    expect(done.summary.pairs).toBe(results.total)
    expect((results.results[0] as { engineVersion: string }).engineVersion).toBe('1.0.0')
  })

  it('survives a store whose data cannot be read: skipped with the reason, never counted as zero recommendations', async () => {
    const run = await runs.create({ rangeFrom: '2026-01', rangeTo: '2026-08', asOf: '2026-08-31T23:59:59Z' })
    await drain()

    const done = await runs.get(run.id)
    const failing = done.stores.find(store => store.storeId === FAILING)

    expect(done.status).toBe('completed')
    expect(failing).toMatchObject({ status: 'skipped', reason: 'supply-service timed out', pairs: 0 })
    expect(done.stores.filter(store => store.status === 'done').map(store => store.storeId).sort()).toEqual([STORE_A, STORE_B])
  })

  it('states the month the data really covers, computed from what the stores had', async () => {
    const run = await runs.create({ rangeFrom: '2026-01', rangeTo: '2026-08', asOf: '2026-08-31T23:59:59Z' })
    await drain()

    const done = await runs.get(run.id)

    // August has not fully ended before the as-of instant, so the run does not claim it.
    expect(done.dataThrough).toBe('2026-07')
  })

  it('applies the baseline of record and marks results that rest on it, before the baseline existed', async () => {
    const run = await runs.create({ rangeFrom: '2026-01', rangeTo: '2026-08', asOf: '2026-08-31T23:59:59Z' })
    await drain()

    const { results } = await runs.results(run.id, { storeId: STORE_A, sku: '5012' })
    const r = results[0] as { quantity: { from: number; baselineIsOfRecord: boolean } }

    expect(r.quantity).toMatchObject({ from: 21, baselineIsOfRecord: true })
  })

  it('is idempotent for the same inputs: a second run gives identical results', async () => {
    const a = await runs.create({ rangeFrom: '2026-01', rangeTo: '2026-08', asOf: '2026-08-31T23:59:59Z' })
    await drain()
    const b = await runs.create({ rangeFrom: '2026-01', rangeTo: '2026-08', asOf: '2026-08-31T23:59:59Z' })
    await drain()

    expect(a.id).not.toBe(b.id)
    expect((await runs.results(b.id, {})).results).toEqual((await runs.results(a.id, {})).results)
  })

  it('a redelivered store job neither duplicates rows nor finalises twice', async () => {
    const run = await runs.create({ rangeFrom: '2026-01', rangeTo: '2026-08', asOf: '2026-08-31T23:59:59Z' })
    const queued = [...jobs]
    await drain()
    const before = await prisma.recommendation.count({ where: { run_id: run.id } })

    for (const job of queued) await worker.process({ id: 'again', data: job } as never)

    expect(await prisma.recommendation.count({ where: { run_id: run.id } })).toBe(before)
    expect((await runs.get(run.id)).status).toBe('completed')
  })

  it('concurrent last jobs finalise exactly once', async () => {
    const run = await runs.create({ rangeFrom: '2026-01', rangeTo: '2026-08', asOf: '2026-08-31T23:59:59Z' })
    const queued = jobs.splice(0)

    await Promise.all(queued.map(job => worker.process({ id: 'c', data: job } as never)))

    expect((await runs.get(run.id)).status).toBe('completed')
    expect(await prisma.engineRunStore.count({ where: { run_id: run.id, status: { in: ['done', 'skipped'] } } })).toBe(3)
  })

  it('filters the results by store, SKU and coverage category', async () => {
    const run = await runs.create({ rangeFrom: '2026-01', rangeTo: '2026-08', asOf: '2026-08-31T23:59:59Z' })
    await drain()

    expect((await runs.results(run.id, { storeId: STORE_B })).total).toBe(forStore(STORE_B).length)
    expect((await runs.results(run.id, { sku: '5012' })).total).toBe(1)
    const covered = await runs.results(run.id, { coverage: 'nonexistent_category' })
    expect(covered.total).toBe(0)
  })

  it('a run is immutable: a later run never touches an earlier one', async () => {
    const a = await runs.create({ rangeFrom: '2026-01', rangeTo: '2026-08', asOf: '2026-08-31T23:59:59Z' })
    await drain()
    const snapshot = JSON.stringify((await runs.results(a.id, {})).results)

    await runs.create({ rangeFrom: '2026-01', rangeTo: '2026-08', asOf: '2026-08-31T23:59:59Z' })
    await drain()

    expect(JSON.stringify((await runs.results(a.id, {})).results)).toBe(snapshot)
  })

  it('rejects a malformed range before queueing anything', async () => {
    await expect(runs.create({ rangeFrom: 'x', rangeTo: '2026-08' })).rejects.toThrow(/YYYY-MM/)
    await expect(runs.create({ rangeFrom: '2026-09', rangeTo: '2026-08' })).rejects.toThrow(/YYYY-MM/)
    expect(jobs).toEqual([])
  })

  it('a worker never reads past the run: an unknown run is left alone', async () => {
    const out = (await worker.process({ id: 'j', data: { schemaVersion: 1, runId: 'nope', storeId: STORE_A } } as never)) as { skipped: string }

    expect(out.skipped).toMatch(/unknown/)
    supplyFails = new Set([FAILING])
  })
})
