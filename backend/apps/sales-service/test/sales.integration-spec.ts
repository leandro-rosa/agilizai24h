import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { SalesModule } from '../src/modules/sales/sales.module'
import { SalesService } from '../src/modules/sales/services/sales.service'

/**
 * Imports only the database and sales modules, not AppModule: the ingestion
 * contract is what matters here, and pulling in HoldItModule would make these
 * tests need Redis for no added coverage. The worker's own translation of a job
 * into this call is covered by its unit spec.
 */
describe('sales integration', () => {
  let app: TestingModule
  let sales: SalesService
  let prisma: PrismaClientService

  const storeIds: number[] = []
  let nextStoreId = 900_000
  const newStore = () => {
    const id = nextStoreId++
    storeIds.push(id)
    return id
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule, SalesModule],
    }).compile()

    app = await moduleRef.init()
    sales = app.get(SalesService)
    prisma = app.get(PrismaClientService)
  }, 60000)

  afterAll(async () => {
    if (prisma) {
      await prisma.salesRecord.deleteMany({ where: { store_id: { in: storeIds } } })
      await prisma.ingestedPeriod.deleteMany({ where: { store_id: { in: storeIds } } })
    }
    await app?.close()
  }, 30000)

  const rows = (spec: [string, number, number][]) =>
    spec.map(([sku, quantitySold, revenueCents]) => ({ sku, quantitySold, revenueCents }))

  describe('record grain', () => {
    it('stores one row per SKU per store per period', async () => {
      const store = newStore()
      await sales.ingestPeriod({
        storeId: store,
        period: '2026-03',
        ingestionId: 'ing-1',
        rows: rows([
          ['A', 2, 500],
          ['B', 3, 900],
        ]),
      })

      const found = await sales.findPeriod(store, '2026-03')
      expect(found).toHaveLength(2)
      expect(found.map(r => r.sku)).toEqual(['A', 'B'])
    })
  })

  describe('idempotent ingestion', () => {
    it('does not double figures when the same report is ingested twice', async () => {
      const store = newStore()
      const batch = { storeId: store, period: '2026-03', ingestionId: 'ing-1', rows: rows([['A', 2, 500]]) }

      await sales.ingestPeriod(batch)
      await sales.ingestPeriod(batch)

      const totals = await sales.totals(store, '2026-03')
      expect(totals.total_quantity_sold).toBe(2)
      expect(totals.total_revenue_cents).toBe(500)
    })

    it('replaces the period when a corrected report arrives', async () => {
      const store = newStore()
      await sales.ingestPeriod({ storeId: store, period: '2026-03', ingestionId: 'ing-1', rows: rows([['A', 2, 500]]) })
      await sales.ingestPeriod({ storeId: store, period: '2026-03', ingestionId: 'ing-2', rows: rows([['A', 5, 1250]]) })

      const totals = await sales.totals(store, '2026-03')
      expect(totals.total_quantity_sold).toBe(5)
      expect(totals.total_revenue_cents).toBe(1250)
    })

    it('removes a SKU the corrected report no longer contains', async () => {
      // The reason replacement is used instead of row-by-row upsert: an upsert
      // would leave B behind and the period's totals would stay too high.
      const store = newStore()
      await sales.ingestPeriod({
        storeId: store,
        period: '2026-03',
        ingestionId: 'ing-1',
        rows: rows([
          ['A', 2, 500],
          ['B', 3, 900],
        ]),
      })
      await sales.ingestPeriod({ storeId: store, period: '2026-03', ingestionId: 'ing-2', rows: rows([['A', 2, 500]]) })

      const found = await sales.findPeriod(store, '2026-03')
      expect(found.map(r => r.sku)).toEqual(['A'])
    })

    it('leaves other periods of the same store untouched', async () => {
      const store = newStore()
      await sales.ingestPeriod({ storeId: store, period: '2026-02', ingestionId: 'ing-1', rows: rows([['A', 1, 100]]) })
      await sales.ingestPeriod({ storeId: store, period: '2026-03', ingestionId: 'ing-2', rows: rows([['A', 9, 900]]) })

      expect((await sales.totals(store, '2026-02')).total_quantity_sold).toBe(1)
    })

    it('leaves other stores untouched', async () => {
      const a = newStore()
      const b = newStore()
      await sales.ingestPeriod({ storeId: a, period: '2026-03', ingestionId: 'ing-1', rows: rows([['A', 1, 100]]) })
      await sales.ingestPeriod({ storeId: b, period: '2026-03', ingestionId: 'ing-2', rows: rows([['A', 9, 900]]) })

      expect((await sales.totals(a, '2026-03')).total_quantity_sold).toBe(1)
    })
  })

  describe('provenance', () => {
    it('records which ingestion produced each row', async () => {
      const store = newStore()
      await sales.ingestPeriod({ storeId: store, period: '2026-03', ingestionId: 'ing-1', rows: rows([['A', 2, 500]]) })

      expect((await sales.findPeriod(store, '2026-03'))[0].ingestion_id).toBe('ing-1')
    })

    it('updates provenance to the most recent ingestion on replacement', async () => {
      const store = newStore()
      await sales.ingestPeriod({ storeId: store, period: '2026-03', ingestionId: 'ing-1', rows: rows([['A', 2, 500]]) })
      await sales.ingestPeriod({ storeId: store, period: '2026-03', ingestionId: 'ing-2', rows: rows([['A', 2, 500]]) })

      expect((await sales.findPeriod(store, '2026-03'))[0].ingestion_id).toBe('ing-2')
    })
  })

  describe('reads', () => {
    it('totals equal the sum of the individual rows', async () => {
      const store = newStore()
      await sales.ingestPeriod({
        storeId: store,
        period: '2026-03',
        ingestionId: 'ing-1',
        rows: rows([
          ['A', 2, 500],
          ['B', 3, 901],
          ['C', 4, 7],
        ]),
      })

      const totals = await sales.totals(store, '2026-03')
      expect(totals.total_quantity_sold).toBe(9)
      expect(totals.total_revenue_cents).toBe(1408)
      expect(totals.sku_count).toBe(3)
    })

    it('sums revenue exactly across many rows, with no drift', async () => {
      // Integer centavos: the same arithmetic in floating point accumulates
      // error, and the mismatch against the operator's spreadsheet would be
      // small, real, and very expensive to diagnose.
      const store = newStore()
      const many = Array.from({ length: 1000 }, (_, i) => ({ sku: `S${i}`, quantitySold: 1, revenueCents: 1 }))
      await sales.ingestPeriod({ storeId: store, period: '2026-03', ingestionId: 'ing-1', rows: many })

      expect((await sales.totals(store, '2026-03')).total_revenue_cents).toBe(1000)
    })

    it('returns a deterministic order', async () => {
      const store = newStore()
      await sales.ingestPeriod({
        storeId: store,
        period: '2026-03',
        ingestionId: 'ing-1',
        rows: rows([
          ['C', 1, 1],
          ['A', 1, 1],
          ['B', 1, 1],
        ]),
      })

      expect((await sales.findPeriod(store, '2026-03')).map(r => r.sku)).toEqual(['A', 'B', 'C'])
    })

    it('reports a never-ingested period as not found, never as zeroes', async () => {
      // Zeroes would be indistinguishable from a month that genuinely had no
      // sales, so a caller could not tell a missing upload from a quiet month.
      const store = newStore()

      await expect(sales.totals(store, '2026-03')).rejects.toThrow(/No sales data ingested/)
      await expect(sales.findPeriod(store, '2026-03')).rejects.toThrow(/No sales data ingested/)
    })

    it('distinguishes an ingested-but-empty period from a never-ingested one', async () => {
      const store = newStore()
      await sales.ingestPeriod({ storeId: store, period: '2026-03', ingestionId: 'ing-1', rows: [] })

      const totals = await sales.totals(store, '2026-03')
      expect(totals.total_quantity_sold).toBe(0)
      expect(totals.sku_count).toBe(0)
    })
  })
})
