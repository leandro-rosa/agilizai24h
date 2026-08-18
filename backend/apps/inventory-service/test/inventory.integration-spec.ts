import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { InventoryService } from '../src/modules/inventory/services/inventory.service'
import { MovementsClient } from '../src/modules/inventory/services/movements.client'
import type { PeriodMovements } from '../src/modules/inventory/utils/derive-stock'

/**
 * Drives the real service against a real Postgres, with the movement sources
 * stubbed so each scenario's inputs are exact.
 *
 * Stubbing sales and supply is deliberate: what is under test is the derivation
 * and the materialised read model, not HTTP. Those two services' own suites
 * cover what they return.
 */
describe('inventory integration', () => {
  let app: TestingModule
  let inventory: InventoryService
  let prisma: PrismaClientService

  /** period -> sku -> movements, driven per test. */
  const movementsByPeriod = new Map<string, Map<string, PeriodMovements>>()

  const storeIds: number[] = []
  let nextStoreId = 500_000
  const newStore = () => {
    const id = nextStoreId++
    storeIds.push(id)
    return id
  }

  const given = (period: string, rows: { sku: string; restocked?: number; sold?: number; removed?: number }[]) => {
    const map = new Map<string, PeriodMovements>()
    for (const row of rows) {
      map.set(row.sku, {
        period,
        restocked: row.restocked ?? 0,
        sold: row.sold ?? 0,
        removed: row.removed ?? 0,
      })
    }
    movementsByPeriod.set(period, map)
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule],
      providers: [
        InventoryService,
        {
          provide: MovementsClient,
          useValue: {
            movementsFor: async (_storeId: number, period: string) =>
              movementsByPeriod.get(period) ?? new Map<string, PeriodMovements>(),
          },
        },
      ],
    }).compile()

    app = await moduleRef.init()
    inventory = app.get(InventoryService)
    prisma = app.get(PrismaClientService)
  }, 60000)

  afterAll(async () => {
    if (prisma) {
      await prisma.stockSnapshot.deleteMany({ where: { store_id: { in: storeIds } } })
      await prisma.minimumLevel.deleteMany({ where: { store_id: { in: storeIds } } })
      await prisma.derivedStore.deleteMany({ where: { store_id: { in: storeIds } } })
    }
    await app?.close()
  }, 30000)

  beforeEach(() => movementsByPeriod.clear())

  describe('derivation', () => {
    it('derives stock as restocked minus sold minus removed', async () => {
      const store = newStore()
      given('2026-03', [{ sku: 'A', restocked: 100, sold: 60, removed: 5 }])

      await inventory.recomputeStore(store, '2026-03')

      const stock = await inventory.stockForSku(store, 'A', '2026-03')
      expect(stock.closing_stock).toBe(35)
    })

    it('counts every removal, whatever its loss classification', async () => {
      // The loss rule belongs to supply; a returned unit is off the shelf just
      // like an expired one, and letting the classification affect the quantity
      // would make stock disagree with reality.
      const store = newStore()
      given('2026-03', [{ sku: 'A', restocked: 100, removed: 9 }])

      await inventory.recomputeStore(store, '2026-03')

      expect((await inventory.stockForSku(store, 'A')).closing_stock).toBe(91)
    })

    it('refuses a direct stock change', () => {
      expect(() => inventory.setStock()).toThrow(/derived from recorded movements/)
    })
  })

  describe('point in time', () => {
    it('reports the closing balance of a past period', async () => {
      const store = newStore()
      given('2026-03', [{ sku: 'A', restocked: 100, sold: 60 }])
      given('2026-04', [{ sku: 'A', restocked: 20, sold: 10 }])

      await inventory.recomputeStore(store, '2026-03')

      expect((await inventory.stockForSku(store, 'A', '2026-03')).closing_stock).toBe(40)
      expect((await inventory.stockForSku(store, 'A', '2026-04')).closing_stock).toBe(50)
    })

    it('does not change a past closing figure when a later period gains movements', async () => {
      const store = newStore()
      given('2026-03', [{ sku: 'A', restocked: 100, sold: 60 }])
      await inventory.recomputeStore(store, '2026-03')

      const before = (await inventory.stockForSku(store, 'A', '2026-03')).closing_stock

      given('2026-04', [{ sku: 'A', restocked: 500 }])
      await inventory.recomputeStore(store, '2026-04')

      expect((await inventory.stockForSku(store, 'A', '2026-03')).closing_stock).toBe(before)
    })

    it('carries a SKU balance forward into a month it did not move in', async () => {
      // Each period's ingestion fires its own event, so March is derived first.
      const store = newStore()
      given('2026-03', [{ sku: 'A', restocked: 100, sold: 60 }])
      await inventory.recomputeStore(store, '2026-03')

      movementsByPeriod.clear()
      given('2026-04', [{ sku: 'B', restocked: 5 }])
      await inventory.recomputeStore(store, '2026-04')

      // A did not move in April but is still on the shelf — the opening balance
      // is carried, so it does not vanish from the listing.
      expect((await inventory.stockForSku(store, 'A', '2026-04')).closing_stock).toBe(40)
      expect((await inventory.stockForSku(store, 'B', '2026-04')).closing_stock).toBe(5)
    })
  })

  describe('negative stock', () => {
    it('reports a negative balance rather than clamping it', async () => {
      const store = newStore()
      given('2026-03', [{ sku: 'A', restocked: 10, sold: 15 }])

      await inventory.recomputeStore(store, '2026-03')

      const stock = await inventory.stockForSku(store, 'A')
      expect(stock.closing_stock).toBe(-5)
      expect(stock.inconsistent).toBe(true)
    })

    it('flags a listing that contains a negative balance', async () => {
      const store = newStore()
      given('2026-03', [
        { sku: 'A', restocked: 10, sold: 15 },
        { sku: 'B', restocked: 10, sold: 1 },
      ])

      await inventory.recomputeStore(store, '2026-03')

      const listing = await inventory.stockForStore(store)
      // So a caller cannot mistake the total for a clean one.
      expect(listing.has_inconsistencies).toBe(true)
    })

    it('leaves a clean listing unflagged', async () => {
      const store = newStore()
      given('2026-03', [{ sku: 'A', restocked: 10, sold: 1 }])

      await inventory.recomputeStore(store, '2026-03')

      expect((await inventory.stockForStore(store)).has_inconsistencies).toBe(false)
    })
  })

  describe('recomputation', () => {
    it('produces identical values when run twice with no change', async () => {
      // The period event is delivered at least once, so this is the property
      // that matters.
      const store = newStore()
      given('2026-03', [{ sku: 'A', restocked: 100, sold: 60, removed: 5 }])

      await inventory.recomputeStore(store, '2026-03')
      const first = await inventory.stockForStore(store)

      await inventory.recomputeStore(store, '2026-03')
      const second = await inventory.stockForStore(store)

      expect(second.items).toEqual(first.items)
    })

    it('recomputes later periods when an earlier one changes', async () => {
      // Closing stock carries forward, so correcting March moves April too;
      // recomputing only the changed period would leave later balances wrong.
      const store = newStore()
      given('2026-03', [{ sku: 'A', restocked: 100, sold: 60 }])
      given('2026-04', [{ sku: 'A', sold: 10 }])
      await inventory.recomputeStore(store, '2026-03')

      expect((await inventory.stockForSku(store, 'A', '2026-04')).closing_stock).toBe(30)

      // March corrected upward.
      given('2026-03', [{ sku: 'A', restocked: 200, sold: 60 }])
      await inventory.recomputeStore(store, '2026-03')

      expect((await inventory.stockForSku(store, 'A', '2026-04')).closing_stock).toBe(130)
    })

    it('leaves other stores untouched', async () => {
      const a = newStore()
      const b = newStore()
      given('2026-03', [{ sku: 'A', restocked: 10 }])
      await inventory.recomputeStore(a, '2026-03')
      await inventory.recomputeStore(b, '2026-03')

      given('2026-03', [{ sku: 'A', restocked: 999 }])
      await inventory.recomputeStore(b, '2026-03')

      expect((await inventory.stockForSku(a, 'A')).closing_stock).toBe(10)
    })
  })

  describe('minimum levels', () => {
    it('flags a SKU at or below its minimum', async () => {
      const store = newStore()
      given('2026-03', [{ sku: 'A', restocked: 10, sold: 6 }])
      await inventory.recomputeStore(store, '2026-03')
      await inventory.setMinimum(store, 'A', 10)

      const stock = await inventory.stockForSku(store, 'A')
      expect(stock.below_minimum).toBe(true)
      expect(stock.minimum).toBe(10)
    })

    it('asserts nothing for a SKU with no configured minimum', async () => {
      // Defaulting would invent a threshold nobody set — the admin panel mock's
      // hardcoded 15-or-8 rule was never a real setting.
      const store = newStore()
      given('2026-03', [{ sku: 'A', restocked: 10, sold: 6 }])
      await inventory.recomputeStore(store, '2026-03')

      const stock = await inventory.stockForSku(store, 'A')
      expect(stock.below_minimum).toBeUndefined()
      expect(stock.minimum).toBeUndefined()
    })

    it('lists only SKUs that have a minimum and are at or below it', async () => {
      const store = newStore()
      given('2026-03', [
        { sku: 'LOW', restocked: 10, sold: 8 },
        { sku: 'OK', restocked: 100, sold: 1 },
        { sku: 'NOMIN', restocked: 1 },
      ])
      await inventory.recomputeStore(store, '2026-03')
      await inventory.setMinimum(store, 'LOW', 5)
      await inventory.setMinimum(store, 'OK', 5)

      const low = await inventory.belowMinimum(store)
      expect(low.map(item => item.sku)).toEqual(['LOW'])
    })
  })

  describe('announcing what it derived', () => {
    it('names every period it rebuilt, not just the one that changed', async () => {
      // finance-service revalues remaining stock per month from this list.
      // Closing stock carries forward, so correcting March moves April and
      // every month after it — returning only '2026-03' would leave those
      // months valued against a balance that no longer exists, while still
      // reporting themselves complete.
      const store = newStore()
      given('2026-03', [{ sku: 'A', restocked: 100, sold: 40 }])
      given('2026-04', [{ sku: 'A', sold: 10 }])

      const result = await inventory.recomputeStore(store, '2026-03')

      expect(result.periods).toEqual(expect.arrayContaining(['2026-03', '2026-04']))
      expect(result.periods[0]).toBe('2026-03')
    })

    it('reports the periods in order, so the announcement follows the balance', async () => {
      const store = newStore()
      given('2026-03', [{ sku: 'A', restocked: 50 }])

      const { periods } = await inventory.recomputeStore(store, '2026-03')

      expect([...periods].sort()).toEqual(periods)
    })
  })

  describe('absence', () => {
    it('reports a store with no derived stock as not found, never as empty', async () => {
      const store = newStore()

      await expect(inventory.stockForStore(store)).rejects.toThrow(/No stock has been derived/)
    })

    it('reports a SKU with no movements as not found, never as zero', async () => {
      // Zero would be indistinguishable from a SKU that sold out.
      const store = newStore()
      given('2026-03', [{ sku: 'A', restocked: 10 }])
      await inventory.recomputeStore(store, '2026-03')

      await expect(inventory.stockForSku(store, 'FANTASMA')).rejects.toThrow(/No movements known/)
    })
  })
})
