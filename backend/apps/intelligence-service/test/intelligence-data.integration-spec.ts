import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { BaselineRepository } from '../src/modules/baseline/baseline.repository'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { ProductStoreFlagRepository } from '../src/modules/flags/product-store-flag.repository'
import { ParametersService } from '../src/modules/parameters/parameters.service'
import { ParametersInvalidError } from '../src/modules/parameters/parameters.validation'
import { ScheduleService } from '../src/modules/schedule/schedule.service'
import { resetDisposableDb } from './support/reset-db'

/**
 * Against a DISPOSABLE Postgres (DATABASE_URL points at it, migrated from
 * scratch) — never the operator's database. Covers the append-only guarantees
 * the specs rely on: history is never overwritten, and the "current" value is
 * always resolved from it.
 */
describe('intelligence data layer', () => {
  let app: TestingModule
  let prisma: PrismaClientService
  let parameters: ParametersService
  let baselines: BaselineRepository
  let schedules: ScheduleService
  let flags: ProductStoreFlagRepository

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule],
      providers: [ParametersService, BaselineRepository, ScheduleService, ProductStoreFlagRepository],
    }).compile()

    app = await moduleRef.init()
    prisma = app.get(PrismaClientService)
    await resetDisposableDb(prisma)
    parameters = app.get(ParametersService)
    baselines = app.get(BaselineRepository)
    schedules = app.get(ScheduleService)
    flags = app.get(ProductStoreFlagRepository)
  }, 60000)

  afterAll(async () => {
    await app?.close()
  }, 30000)

  describe('parameter versions', () => {
    it('creates the initial version on first start, once, with the owner tolerance', async () => {
      await parameters.ensureInitial()
      await parameters.ensureInitial()

      expect(await prisma.parameterVersion.count()).toBe(1)
      const current = await parameters.current()
      expect(current.values.tolerance).toMatchObject({ pct: 0.1, units: 3, windowCounts: 3, minCounts: 1, maxAgeDays: 45 })
      expect(current.values.schedule.visitWeekdays).toEqual([1, 2, 4, 5])
    })

    it('a new version leaves the old one readable and becomes the current one', async () => {
      const first = await parameters.current()
      const second = await parameters.createVersion({ tolerance: { pct: 0.15, units: 2 } }, 'owner recalibration')

      expect(second.id).toBeGreaterThan(first.id)
      expect((await parameters.current()).id).toBe(second.id)
      expect((await parameters.byId(first.id)).values.tolerance).toMatchObject({ pct: 0.1, units: 3 })
      expect((await parameters.byId(second.id)).values.tolerance).toMatchObject({ pct: 0.15, units: 2 })
      // the unchanged groups carried over
      expect(second.values.demand).toEqual(first.values.demand)
    })

    it('rejects an invalid document without creating a version', async () => {
      const before = await prisma.parameterVersion.count()

      await expect(parameters.createVersion({ tolerance: { windowCounts: 1, minCounts: 5 } })).rejects.toBeInstanceOf(ParametersInvalidError)
      expect(await prisma.parameterVersion.count()).toBe(before)
    })

    it('lists every version, newest first', async () => {
      const list = await parameters.list()

      expect(list.length).toBeGreaterThanOrEqual(2)
      expect(list[0].id).toBeGreaterThan(list[1].id)
    })
  })

  describe('baseline quantity history', () => {
    const sku = 'TEST-SKU-1'

    it('keeps both values when a re-import changes it, and the latest is current', async () => {
      await baselines.add(sku, 21, 'precificacao.xlsx', new Date('2026-09-30T00:00:00Z'))
      await baselines.add(sku, 12, 'precificacao-v2.xlsx', new Date('2026-10-05T00:00:00Z'))

      expect((await baselines.history(sku)).map(row => row.quantity)).toEqual([21, 12])
      expect((await baselines.current(sku, new Date('2026-10-10T00:00:00Z')))?.quantity).toBe(12)
    })

    it('resolves the value in force at an earlier date, not the latest', async () => {
      expect((await baselines.current(sku, new Date('2026-10-01T00:00:00Z')))?.quantity).toBe(21)
    })

    it('answers null for a date before any baseline took effect', async () => {
      expect(await baselines.current(sku, new Date('2026-01-01T00:00:00Z'))).toBeNull()
    })

    it('breaks a tie on the same effective date by taking the later row', async () => {
      const tied = 'TEST-SKU-TIE'
      const day = new Date('2026-09-30T00:00:00Z')
      await baselines.add(tied, 5, 'a.xlsx', day)
      await baselines.add(tied, 6, 'b.xlsx', day)

      expect((await baselines.current(tied, day))?.quantity).toBe(6)
    })

    it('is one value per SKU, for every store — there is no store in the key', async () => {
      const all = await baselines.currentForAll(new Date('2026-10-10T00:00:00Z'))

      expect(all.filter(row => row.sku === sku)).toHaveLength(1)
    })
  })

  describe('store schedules', () => {
    it('defaults to Monday, Tuesday, Thursday and Friday', async () => {
      expect(await schedules.weekdaysFor(910001)).toEqual({ storeId: 910001, weekdays: [1, 2, 4, 5], source: 'default' })
    })

    it('an override changes that store only and keeps its history', async () => {
      await schedules.setOverride(910002, [5, 3], 'Wednesday and Friday')
      await schedules.setOverride(910002, [3, 5, 6])

      expect(await schedules.weekdaysFor(910002)).toEqual({ storeId: 910002, weekdays: [3, 5, 6], source: 'override' })
      expect((await schedules.weekdaysFor(910003)).source).toBe('default')
      expect(await prisma.storeSchedule.count({ where: { store_id: 910002 } })).toBe(2)
    })

    it('rejects invalid weekdays', async () => {
      await expect(schedules.setOverride(910004, [0, 9])).rejects.toThrow(/weekdays/)
    })
  })

  describe('closed pack preference', () => {
    it('is null until set, and the latest value of a pair wins, with history kept', async () => {
      expect(await flags.preferClosedPack(910005, 'TEST-SKU-1')).toBeNull()

      await flags.setPreferClosedPack(910005, 'TEST-SKU-1', true)
      await flags.setPreferClosedPack(910005, 'TEST-SKU-1', false)

      expect(await flags.preferClosedPack(910005, 'TEST-SKU-1')).toBe(false)
      expect(await prisma.productStoreFlag.count({ where: { store_id: 910005, sku: 'TEST-SKU-1' } })).toBe(2)
    })
  })

  describe('results', () => {
    it('records the engine and parameter versions it was produced under', async () => {
      const version = await parameters.current()
      await prisma.engineRun.create({
        data: {
          id: 'run-test-1',
          status: 'completed',
          engine_version: '0.0.0-test',
          parameter_version_id: version.id,
          as_of: new Date('2026-08-31T00:00:00Z'),
          range_from: '2026-01',
          range_to: '2026-08',
          data_through: '2026-08',
        },
      })

      const run = await prisma.engineRun.findUniqueOrThrow({ where: { id: 'run-test-1' } })
      expect(run.parameter_version_id).toBe(version.id)
      expect(run.engine_version).toBe('0.0.0-test')
    })

    it('one result per Product x Store in a run', async () => {
      const data = {
        run_id: 'run-test-1',
        store_id: 1,
        sku: 'A',
        mix: 'keep',
        quantity_action: 'keep',
        tolerance_status: 'not_verifiable',
        coverage_category: 'analysable_not_enough_counts',
        releases_balance_use: false,
        result: {},
      }
      await prisma.recommendation.create({ data })

      await expect(prisma.recommendation.create({ data })).rejects.toThrow()
    })
  })
})
