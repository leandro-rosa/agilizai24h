import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import type { BulkCostResult } from '@app/products-contracts'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { FinanceService } from '../src/modules/finance/services/finance.service'
import { UpstreamClient, type SalesRow, type StockItem, type SupplyPeriod } from '../src/modules/finance/services/upstream.client'

/**
 * Drives the real service against a real Postgres, with the four upstreams
 * stubbed so each scenario's inputs are exact.
 *
 * Stubbing is deliberate: what is under test is the valuation and the stored
 * result, and the interesting cases — an unpriced SKU, a cost recorded after
 * the fact — are awkward to stage through four live services and trivial here.
 */
describe('finance integration', () => {
  let app: TestingModule
  let finance: FinanceService
  let prisma: PrismaClientService

  const upstream = {
    supply: { restocks: [], removals: [] } as SupplyPeriod,
    sales: [] as SalesRow[],
    stock: [] as StockItem[],
    costs: { as_of: '', resolved: [], unresolved: [], complete: true } as BulkCostResult,
    /** Every as-of date the service asked for, so the valuation date is assertable. */
    askedFor: [] as string[],
  }

  const storeIds: number[] = []
  let nextStoreId = 400_000
  const newStore = () => {
    const id = nextStoreId++
    storeIds.push(id)
    return id
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule],
      providers: [
        FinanceService,
        {
          provide: UpstreamClient,
          useValue: {
            supplyFor: async () => upstream.supply,
            salesFor: async () => upstream.sales,
            stockFor: async () => upstream.stock,
            costsAsOf: async (_skus: string[], asOf: string) => {
              upstream.askedFor.push(asOf)
              return { ...upstream.costs, as_of: asOf }
            },
          },
        },
      ],
    }).compile()

    app = await moduleRef.init()
    finance = app.get(FinanceService)
    prisma = app.get(PrismaClientService)
  }, 60000)

  afterAll(async () => {
    if (prisma) await prisma.reconciliation.deleteMany({ where: { store_id: { in: storeIds } } })
    await app?.close()
  }, 30000)

  beforeEach(() => {
    upstream.supply = { restocks: [], removals: [] }
    upstream.sales = []
    upstream.stock = []
    upstream.costs = { as_of: '', resolved: [], unresolved: [], complete: true }
    upstream.askedFor = []
  })

  const priced = (sku: string, cents: number, effectiveFrom = '2026-01-01') => ({
    sku,
    product_id: 1,
    cost_cents: cents,
    effective_from: effectiveFrom,
  })

  describe('the four figures', () => {
    it('values a month from its movements', async () => {
      const store = newStore()
      upstream.supply = {
        restocks: [{ sku: 'A', quantity_restocked: 100 }],
        removals: [{ sku: 'A', reason: 'expired', counts_as_loss: true, quantity_removed: 5 }],
      }
      upstream.sales = [{ sku: 'A', quantity_sold: 60 }]
      upstream.stock = [{ sku: 'A', closing_stock: 35 }]
      upstream.costs = { as_of: '', resolved: [priced('A', 250)], unresolved: [], complete: true }

      const result = await finance.recompute(store, '2026-03')

      expect(result.restocked_value_cents).toBe(25000)
      expect(result.cogs_cents).toBe(15000)
      expect(result.remaining_value_cents).toBe(8750)
      expect(result.loss_value_cents).toBe(1250)
    })

    it('values only loss-counting removals as loss', async () => {
      // The mixed-reason case, arriving already classified by supply: 9 units
      // removed, 3 of them loss.
      const store = newStore()
      upstream.supply = {
        restocks: [{ sku: 'A', quantity_restocked: 100 }],
        removals: [
          { sku: 'A', reason: 'return', counts_as_loss: false, quantity_removed: 6 },
          { sku: 'A', reason: 'other_reason', counts_as_loss: true, quantity_removed: 3 },
        ],
      }
      upstream.costs = { as_of: '', resolved: [priced('A', 250)], unresolved: [], complete: true }

      const result = await finance.recompute(store, '2026-03')

      expect(result.loss_quantity).toBe(3)
      expect(result.loss_value_cents).toBe(750)
    })
  })

  describe('valuation date', () => {
    it('resolves costs as of the last day of the month', async () => {
      const store = newStore()
      upstream.supply = { restocks: [{ sku: 'A', quantity_restocked: 1 }], removals: [] }
      upstream.costs = { as_of: '', resolved: [priced('A', 100)], unresolved: [], complete: true }

      const result = await finance.recompute(store, '2026-04')

      expect(upstream.askedFor).toEqual(['2026-04-30'])
      // Recorded on the result, so the valuation can be reproduced and the
      // month-end approximation is visible rather than implicit.
      expect(result.valuation_date).toBe('2026-04-30')
    })

    it('leaves a historical month unchanged when a later cost is recorded', async () => {
      // The regression the design named explicitly: a wrong as-of would still
      // produce plausible totals, so nothing else catches it.
      const store = newStore()
      upstream.supply = { restocks: [{ sku: 'A', quantity_restocked: 10 }], removals: [] }
      upstream.costs = { as_of: '', resolved: [priced('A', 250, '2026-01-01')], unresolved: [], complete: true }

      const before = await finance.recompute(store, '2026-03')

      // products-service keeps answering with the January cost for a March
      // valuation, however many later versions exist.
      const after = await finance.recompute(store, '2026-03')

      expect(after.restocked_value_cents).toBe(before.restocked_value_cents)
      expect(after.valuation_date).toBe(before.valuation_date)
    })
  })

  describe('completeness', () => {
    it('marks a month incomplete when a SKU cannot be priced', async () => {
      const store = newStore()
      upstream.supply = {
        restocks: [
          { sku: 'A', quantity_restocked: 10 },
          { sku: 'GHOST', quantity_restocked: 100 },
        ],
        removals: [],
      }
      upstream.costs = {
        as_of: '',
        resolved: [priced('A', 250)],
        unresolved: [{ sku: 'GHOST', reason: 'no_cost_for_date' }],
        complete: false,
      }

      const result = await finance.recompute(store, '2026-03')

      expect(result.complete).toBe(false)
      expect(result.unvalued).toEqual([
        { sku: 'GHOST', reason: 'no_cost_for_date', restocked: 100, sold: 0, remaining: 0, loss_quantity: 0 },
      ])
    })

    it('never lets an unpriced SKU contribute zero to a total', async () => {
      const store = newStore()
      upstream.supply = {
        restocks: [
          { sku: 'A', quantity_restocked: 10 },
          { sku: 'GHOST', quantity_restocked: 100 },
        ],
        removals: [],
      }
      upstream.costs = {
        as_of: '',
        resolved: [priced('A', 250)],
        unresolved: [{ sku: 'GHOST', reason: 'unknown_sku' }],
        complete: false,
      }

      const result = await finance.recompute(store, '2026-03')

      // 10 × 250 only. GHOST added nothing, rather than adding zero — which
      // would have understated the figure while looking perfectly plausible.
      expect(result.restocked_value_cents).toBe(2500)
    })

    it('marks a fully priced month complete', async () => {
      const store = newStore()
      upstream.supply = { restocks: [{ sku: 'A', quantity_restocked: 10 }], removals: [] }
      upstream.costs = { as_of: '', resolved: [priced('A', 250)], unresolved: [], complete: true }

      expect((await finance.recompute(store, '2026-03')).complete).toBe(true)
    })

    it('propagates incompleteness to the network rollup, naming the stores', async () => {
      const clean = newStore()
      const dirty = newStore()

      upstream.supply = { restocks: [{ sku: 'A', quantity_restocked: 10 }], removals: [] }
      upstream.costs = { as_of: '', resolved: [priced('A', 100)], unresolved: [], complete: true }
      await finance.recompute(clean, '2026-07')

      upstream.costs = { as_of: '', resolved: [], unresolved: [{ sku: 'A', reason: 'unknown_sku' }], complete: false }
      await finance.recompute(dirty, '2026-07')

      const rollup = await finance.rollup('2026-07')

      expect(rollup.complete).toBe(false)
      expect(rollup.incomplete_stores).toContain(dirty)
      expect(rollup.store_count).toBe(2)
    })
  })

  describe('inconsistent stock', () => {
    it('refuses to call a month clean when inventory flagged a balance', async () => {
      // Seen live during the end-to-end run: remaining stock of MINUS 37500
      // centavos, reported as a complete month. inventory-service raises this
      // flag rather than zeroing the balance; dropping it here put the problem
      // straight back out of sight.
      const store = newStore()
      upstream.supply = { restocks: [], removals: [] }
      upstream.sales = [{ sku: 'A', quantity_sold: 90 }]
      upstream.stock = [{ sku: 'A', closing_stock: -90, inconsistent: true }]
      upstream.costs = { as_of: '', resolved: [priced('A', 250)], unresolved: [], complete: true }

      const result = await finance.recompute(store, '2026-03')

      expect(result.complete).toBe(false)
      expect(result.inconsistent_stock).toEqual(['A'])
      // Still valued: the number is the evidence of how big the problem is.
      expect(result.remaining_value_cents).toBe(-22500)
    })

    it('propagates it to the rollup, like any other incompleteness', async () => {
      const store = newStore()
      upstream.supply = { restocks: [], removals: [] }
      upstream.sales = [{ sku: 'A', quantity_sold: 5 }]
      upstream.stock = [{ sku: 'A', closing_stock: -5, inconsistent: true }]
      upstream.costs = { as_of: '', resolved: [priced('A', 100)], unresolved: [], complete: true }

      await finance.recompute(store, '2026-08')

      const rollup = await finance.rollup('2026-08')

      expect(rollup.complete).toBe(false)
      expect(rollup.incomplete_stores).toContain(store)
    })
  })

  describe('breakdowns', () => {
    it('stores loss by reason and by SKU, both summing to the total', async () => {
      const store = newStore()
      upstream.supply = {
        restocks: [],
        removals: [
          { sku: 'A', reason: 'expired', counts_as_loss: true, quantity_removed: 3 },
          { sku: 'A', reason: 'damaged_product', counts_as_loss: true, quantity_removed: 1 },
          { sku: 'B', reason: 'expired', counts_as_loss: true, quantity_removed: 2 },
        ],
      }
      upstream.costs = { as_of: '', resolved: [priced('A', 100), priced('B', 500)], unresolved: [], complete: true }

      const result = await finance.recompute(store, '2026-03')

      expect(result.loss_value_cents).toBe(1400)
      expect(result.loss_by_reason.reduce((sum, entry) => sum + entry.value_cents, 0)).toBe(1400)
      expect(result.loss_by_sku.reduce((sum, entry) => sum + entry.value_cents, 0)).toBe(1400)
    })
  })

  describe('recomputation', () => {
    it('produces identical figures when run twice', async () => {
      // The period event is delivered at least once.
      const store = newStore()
      upstream.supply = { restocks: [{ sku: 'A', quantity_restocked: 10 }], removals: [] }
      upstream.costs = { as_of: '', resolved: [priced('A', 250)], unresolved: [], complete: true }

      const first = await finance.recompute(store, '2026-03')
      const second = await finance.recompute(store, '2026-03')

      expect(second.restocked_value_cents).toBe(first.restocked_value_cents)
      expect(await prisma.reconciliation.count({ where: { store_id: store, period: '2026-03' } })).toBe(1)
    })

    it('replaces the breakdowns rather than accumulating them', async () => {
      const store = newStore()
      upstream.supply = {
        restocks: [],
        removals: [{ sku: 'A', reason: 'expired', counts_as_loss: true, quantity_removed: 3 }],
      }
      upstream.costs = { as_of: '', resolved: [priced('A', 100)], unresolved: [], complete: true }

      await finance.recompute(store, '2026-03')
      const result = await finance.recompute(store, '2026-03')

      expect(result.loss_by_reason).toHaveLength(1)
      expect(result.loss_value_cents).toBe(300)
    })

    it('leaves other stores and months untouched', async () => {
      const a = newStore()
      const b = newStore()
      upstream.supply = { restocks: [{ sku: 'A', quantity_restocked: 10 }], removals: [] }
      upstream.costs = { as_of: '', resolved: [priced('A', 100)], unresolved: [], complete: true }

      await finance.recompute(a, '2026-03')
      upstream.supply = { restocks: [{ sku: 'A', quantity_restocked: 999 }], removals: [] }
      await finance.recompute(b, '2026-03')

      expect((await finance.findOne(a, '2026-03')).restocked_value_cents).toBe(1000)
    })
  })

  describe('absence', () => {
    it('reports a month that was never reconciled as not found, never as zeroes', async () => {
      const store = newStore()

      await expect(finance.findOne(store, '2026-03')).rejects.toThrow(/No reconciliation/)
    })

    it('reports a period with no reconciled store as not found', async () => {
      await expect(finance.rollup('1999-01')).rejects.toThrow(/No reconciliation/)
    })
  })
})
