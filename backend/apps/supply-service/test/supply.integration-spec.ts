import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { SupplyService } from '../src/modules/supply/services/supply.service'

/**
 * Imports Db + a locally-constructed SupplyService rather than AppModule, so
 * these run without Redis. The event publishing decision is covered by the
 * worker's unit spec; what matters here is the classification and the
 * replacement contract against real rows.
 */
describe('supply integration', () => {
  let app: TestingModule
  let supply: SupplyService
  let prisma: PrismaClientService

  const storeIds: number[] = []
  let nextStoreId = 800_000
  const newStore = () => {
    const id = nextStoreId++
    storeIds.push(id)
    return id
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule],
      providers: [SupplyService],
    }).compile()

    app = await moduleRef.init()
    supply = app.get(SupplyService)
    prisma = app.get(PrismaClientService)
  }, 60000)

  afterAll(async () => {
    if (prisma) {
      await prisma.restockRecord.deleteMany({ where: { store_id: { in: storeIds } } })
      await prisma.removalRecord.deleteMany({ where: { store_id: { in: storeIds } } })
      await prisma.ingestedPeriod.deleteMany({ where: { store_id: { in: storeIds } } })
    }
    await app?.close()
  }, 30000)

  const ingest = (
    storeId: number,
    opts: {
      period?: string
      ingestionId?: string
      restocks?: { sku: string; quantityRestocked: number }[]
      removals?: { sku: string; reason: string; quantityRemoved: number; sourceText?: string }[]
    } = {},
  ) =>
    supply.ingestPeriod({
      storeId,
      period: opts.period ?? '2026-03',
      ingestionId: opts.ingestionId ?? 'ing-1',
      restocks: opts.restocks ?? [],
      removals: opts.removals ?? [],
    })

  describe('the loss rule', () => {
    it('counts only the loss portion of a mixed-reason removal', async () => {
      // The defining case, end to end against the real reason table:
      // "-6 Devolução, -3 Outro motivo" is 9 units removed, 3 units of loss.
      const store = newStore()
      await ingest(store, {
        removals: [
          { sku: 'A', reason: 'return', quantityRemoved: 6, sourceText: '-6 Devolução, -3 Outro motivo' },
          { sku: 'A', reason: 'other_reason', quantityRemoved: 3, sourceText: '-6 Devolução, -3 Outro motivo' },
        ],
      })

      const loss = await supply.findLoss(store, '2026-03')
      expect(loss.total).toBe(3)
    })

    it('stores a mixed-reason removal split, with no combined row anywhere', async () => {
      const store = newStore()
      await ingest(store, {
        removals: [
          { sku: 'A', reason: 'return', quantityRemoved: 6 },
          { sku: 'A', reason: 'other_reason', quantityRemoved: 3 },
        ],
      })

      const period = await supply.findPeriod(store, '2026-03')
      expect(period.removals.map(r => r.quantity_removed).sort()).toEqual([3, 6])
      expect(period.removals.some(r => r.quantity_removed === 9)).toBe(false)
    })

    it('counts each loss-counting reason', async () => {
      const store = newStore()
      await ingest(store, {
        removals: [
          { sku: 'A', reason: 'expired', quantityRemoved: 4 },
          { sku: 'A', reason: 'damaged_product', quantityRemoved: 2 },
          { sku: 'B', reason: 'other_reason', quantityRemoved: 1 },
        ],
      })

      expect((await supply.findLoss(store, '2026-03')).total).toBe(7)
    })

    it('yields zero loss for a period of only non-loss removals, while still recording them', async () => {
      const store = newStore()
      await ingest(store, {
        removals: [
          { sku: 'A', reason: 'return', quantityRemoved: 6 },
          { sku: 'A', reason: 'transfer', quantityRemoved: 5 },
          { sku: 'B', reason: 'internal_use', quantityRemoved: 4 },
        ],
      })

      expect((await supply.findLoss(store, '2026-03')).total).toBe(0)
      expect((await supply.findPeriod(store, '2026-03')).removals).toHaveLength(3)
    })

    it('marks every removal with the classification that produced the figure', async () => {
      const store = newStore()
      await ingest(store, {
        removals: [
          { sku: 'A', reason: 'expired', quantityRemoved: 1 },
          { sku: 'A', reason: 'return', quantityRemoved: 1 },
        ],
      })

      const removals = (await supply.findPeriod(store, '2026-03')).removals
      expect(removals.find(r => r.reason === 'expired')!.counts_as_loss).toBe(true)
      expect(removals.find(r => r.reason === 'return')!.counts_as_loss).toBe(false)
    })

    it('rejects an unrecognised reason instead of bucketing it either way', async () => {
      // Defaulting to loss inflates the number the business is reducing;
      // defaulting to non-loss quietly deletes real loss.
      const store = newStore()

      await expect(
        ingest(store, { removals: [{ sku: 'A', reason: 'roubo', quantityRemoved: 3 }] }),
      ).rejects.toThrow(/Unrecognised removal reason/)
    })

    it('names the unrecognised reason so it can be resolved quickly', async () => {
      const store = newStore()

      await expect(
        ingest(store, { removals: [{ sku: 'A', reason: 'motivo-novo', quantityRemoved: 1 }] }),
      ).rejects.toThrow(/motivo-novo/)
    })

    it('writes nothing when a batch contains an unrecognised reason', async () => {
      const store = newStore()

      await expect(
        ingest(store, {
          restocks: [{ sku: 'A', quantityRestocked: 10 }],
          removals: [{ sku: 'A', reason: 'desconhecido', quantityRemoved: 1 }],
        }),
      ).rejects.toThrow()

      await expect(supply.findPeriod(store, '2026-03')).rejects.toThrow(/No supply data ingested/)
    })
  })

  describe('breakdowns', () => {
    it('breaks loss down by reason, excluding non-loss reasons', async () => {
      const store = newStore()
      await ingest(store, {
        removals: [
          { sku: 'A', reason: 'expired', quantityRemoved: 4 },
          { sku: 'A', reason: 'return', quantityRemoved: 6 },
        ],
      })

      expect((await supply.findLoss(store, '2026-03')).byReason).toEqual([{ reason: 'expired', quantity: 4 }])
    })

    it('makes by-reason and by-SKU each sum to the total', async () => {
      const store = newStore()
      await ingest(store, {
        removals: [
          { sku: 'A', reason: 'expired', quantityRemoved: 4 },
          { sku: 'A', reason: 'other_reason', quantityRemoved: 3 },
          { sku: 'B', reason: 'damaged_product', quantityRemoved: 2 },
          { sku: 'B', reason: 'return', quantityRemoved: 9 },
        ],
      })

      const loss = await supply.findLoss(store, '2026-03')
      expect(loss.total).toBe(9)
      expect(loss.byReason.reduce((s, r) => s + r.quantity, 0)).toBe(9)
      expect(loss.bySku.reduce((s, r) => s + r.quantity, 0)).toBe(9)
    })
  })

  describe('restocks', () => {
    it('reports restocks and removals separately, never netted', async () => {
      const store = newStore()
      await ingest(store, {
        restocks: [{ sku: 'A', quantityRestocked: 20 }],
        removals: [{ sku: 'A', reason: 'expired', quantityRemoved: 3 }],
      })

      const period = await supply.findPeriod(store, '2026-03')
      expect(period.restocks).toEqual([{ sku: 'A', quantity_restocked: 20 }])
      expect(period.removals[0].quantity_removed).toBe(3)
    })
  })

  describe('idempotent ingestion', () => {
    it('does not double quantities when the same data is ingested twice', async () => {
      const store = newStore()
      const batch = {
        restocks: [{ sku: 'A', quantityRestocked: 10 }],
        removals: [{ sku: 'A', reason: 'expired', quantityRemoved: 2 }],
      }

      await ingest(store, batch)
      await ingest(store, batch)

      const period = await supply.findPeriod(store, '2026-03')
      expect(period.restocks).toEqual([{ sku: 'A', quantity_restocked: 10 }])
      expect(period.loss.total).toBe(2)
    })

    it('reports no change on an identical re-ingestion, so the event is suppressed', async () => {
      // Re-uploading an identical file is a normal operator action; publishing
      // unconditionally would trigger a downstream recomputation storm.
      const store = newStore()
      const batch = { removals: [{ sku: 'A', reason: 'expired', quantityRemoved: 2 }] }

      expect((await ingest(store, batch)).changed).toBe(true)
      expect((await ingest(store, batch)).changed).toBe(false)
    })

    it('reports a change when the corrected data differs', async () => {
      const store = newStore()
      await ingest(store, { removals: [{ sku: 'A', reason: 'expired', quantityRemoved: 2 }] })

      const result = await ingest(store, {
        ingestionId: 'ing-2',
        removals: [{ sku: 'A', reason: 'expired', quantityRemoved: 5 }],
      })

      expect(result.changed).toBe(true)
      expect((await supply.findLoss(store, '2026-03')).total).toBe(5)
    })

    it('removes rows the corrected batch no longer contains', async () => {
      const store = newStore()
      await ingest(store, {
        removals: [
          { sku: 'A', reason: 'expired', quantityRemoved: 2 },
          { sku: 'B', reason: 'expired', quantityRemoved: 3 },
        ],
      })
      await ingest(store, { ingestionId: 'ing-2', removals: [{ sku: 'A', reason: 'expired', quantityRemoved: 2 }] })

      const period = await supply.findPeriod(store, '2026-03')
      expect(period.removals.map(r => r.sku)).toEqual(['A'])
    })

    it('leaves other periods untouched', async () => {
      const store = newStore()
      await ingest(store, { period: '2026-02', removals: [{ sku: 'A', reason: 'expired', quantityRemoved: 1 }] })
      await ingest(store, { period: '2026-03', removals: [{ sku: 'A', reason: 'expired', quantityRemoved: 9 }] })

      expect((await supply.findLoss(store, '2026-02')).total).toBe(1)
    })
  })

  describe('reads', () => {
    it('reports a never-ingested period as not found, never as zeroes', async () => {
      const store = newStore()

      await expect(supply.findPeriod(store, '2026-03')).rejects.toThrow(/No supply data ingested/)
      await expect(supply.findLoss(store, '2026-03')).rejects.toThrow(/No supply data ingested/)
    })

    it('distinguishes an ingested-but-empty period from a never-ingested one', async () => {
      const store = newStore()
      await ingest(store, {})

      const period = await supply.findPeriod(store, '2026-03')
      expect(period.restocks).toEqual([])
      expect(period.loss.total).toBe(0)
    })

    it('exposes the reason set with its classification', async () => {
      const reasons = await supply.listReasons()

      expect(reasons).toHaveLength(6)
      expect(reasons.filter(r => r.counts_as_loss).map(r => r.key).sort()).toEqual([
        'damaged_product',
        'expired',
        'other_reason',
      ])
    })

    it('keeps the original line text as audit only', async () => {
      const store = newStore()
      await ingest(store, {
        removals: [{ sku: 'A', reason: 'return', quantityRemoved: 6, sourceText: '-6 Devolução, -3 Outro motivo' }],
      })

      const row = await prisma.removalRecord.findFirst({ where: { store_id: store } })
      expect(row!.source_text).toBe('-6 Devolução, -3 Outro motivo')
      // Audit only: the 9 in that text is not a quantity anything computes from.
      expect(row!.quantity_removed).toBe(6)
    })
  })
})
