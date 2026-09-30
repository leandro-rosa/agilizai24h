import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import type { SupplyVisit } from '@app/ingestion-contracts'
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
      await prisma.adjustmentRecord.deleteMany({ where: { store_id: { in: storeIds } } })
      await prisma.recordedClosingBalance.deleteMany({ where: { store_id: { in: storeIds } } })
      await prisma.supplyVisit.deleteMany({ where: { store_id: { in: storeIds } } })
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
      adjustments?: { sku: string; quantity: number }[]
      recordedClosingBalances?: { sku: string; quantity: number }[]
      visits?: SupplyVisit[]
    } = {},
  ) =>
    supply.ingestPeriod({
      storeId,
      period: opts.period ?? '2026-03',
      ingestionId: opts.ingestionId ?? 'ing-1',
      restocks: opts.restocks ?? [],
      removals: opts.removals ?? [],
      adjustments: opts.adjustments ?? [],
      recordedClosingBalances: opts.recordedClosingBalances ?? [],
      visits: opts.visits,
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

  describe('the inventory adjustment', () => {
    // design D4/D6: a third movement kind, never a restock, never a removal.
    it('stores an inbound adjustment separately, contributing no restocked value', async () => {
      const store = newStore()
      await ingest(store, { adjustments: [{ sku: 'A', quantity: 12 }] })

      const period = await supply.findPeriod(store, '2026-03')

      expect(period.adjustments).toEqual([{ sku: 'A', quantity: 12 }])
      expect(period.restocks).toEqual([])
    })

    it('stores an outbound adjustment as a negative quantity, contributing no loss', async () => {
      const store = newStore()
      await ingest(store, { adjustments: [{ sku: 'A', quantity: -5 }] })

      const period = await supply.findPeriod(store, '2026-03')
      const loss = await supply.findLoss(store, '2026-03')

      expect(period.adjustments).toEqual([{ sku: 'A', quantity: -5 }])
      expect(loss.total).toBe(0)
    })

    it('never nets an adjustment into a restock or a removal for the same SKU', async () => {
      const store = newStore()
      await ingest(store, {
        restocks: [{ sku: 'A', quantityRestocked: 100 }],
        removals: [{ sku: 'A', reason: 'return', quantityRemoved: 6 }],
        adjustments: [{ sku: 'A', quantity: -4 }],
      })

      const period = await supply.findPeriod(store, '2026-03')

      expect(period.restocks).toEqual([{ sku: 'A', quantity_restocked: 100 }])
      expect(period.adjustments).toEqual([{ sku: 'A', quantity: -4 }])
    })

    it('replaces the period wholesale, same as restocks and removals', async () => {
      const store = newStore()
      await ingest(store, { adjustments: [{ sku: 'A', quantity: 3 }] })
      await ingest(store, { adjustments: [{ sku: 'B', quantity: 7 }] })

      const period = await supply.findPeriod(store, '2026-03')

      expect(period.adjustments).toEqual([{ sku: 'B', quantity: 7 }])
    })
  })

  describe('the recorded closing balance', () => {
    // design D5: a cross-check inventory-service consumes, never a second
    // source of truth for this service's own reads.
    it('stores the operators own recorded closing balance, separate from every movement', async () => {
      const store = newStore()
      await ingest(store, {
        restocks: [{ sku: 'A', quantityRestocked: 10 }],
        recordedClosingBalances: [{ sku: 'A', quantity: 10 }],
      })

      const period = await supply.findPeriod(store, '2026-03')

      expect(period.recorded_closing_balances).toEqual([{ sku: 'A', quantity: 10 }])
    })

    it('is absent when the ingestion carried none, rather than defaulting to zero', async () => {
      const store = newStore()
      await ingest(store, { restocks: [{ sku: 'A', quantityRestocked: 10 }] })

      const period = await supply.findPeriod(store, '2026-03')

      expect(period.recorded_closing_balances).toEqual([])
    })
  })

  describe('visits (add-stock-quality-phase0)', () => {
    const visit = (over: Partial<SupplyVisit> = {}): SupplyVisit => ({
      kind: 'combined',
      startedAt: '2026-03-02T08:32:00.000Z',
      endedAt: '2026-03-02T08:45:00.000Z',
      previousEndedAt: '2026-02-25T05:18:00.000Z',
      sourceReference: 'Operação 1',
      lines: [
        {
          sku: '5010',
          balanceBefore: 8,
          confirmedCount: 8,
          quantityToRestock: 21,
          restocked: 21,
          removedTotal: 0,
          adjustment: 0,
          balanceAfter: 29,
          capacity: null,
        },
      ],
      ...over,
    })

    it('records a combined visit with its count and instants', async () => {
      const store = newStore()
      await ingest(store, { restocks: [{ sku: '5010', quantityRestocked: 21 }], visits: [visit()] })

      const result = await supply.findVisits(store, '2026-03', '2026-03')

      expect(result.visits).toHaveLength(1)
      expect(result.visits[0]).toMatchObject({
        kind: 'combined',
        started_at: '2026-03-02T08:32:00.000Z',
        ended_at: '2026-03-02T08:45:00.000Z',
        previous_ended_at: '2026-02-25T05:18:00.000Z',
        source_reference: 'Operação 1',
      })
      expect(result.visits[0].lines).toEqual([
        {
          sku: '5010',
          balance_before: 8,
          confirmed_count: 8,
          quantity_to_restock: 21,
          restocked: 21,
          removed_total: 0,
          adjustment: 0,
          balance_after: 29,
          capacity: null,
        },
      ])
    })

    it('keeps a missing count null, distinguishable from a count of zero', async () => {
      const store = newStore()
      const base = visit().lines[0]
      await ingest(store, {
        visits: [
          visit({
            lines: [
              { ...base, sku: 'UNCOUNTED', confirmedCount: null, quantityToRestock: null },
              { ...base, sku: 'ZERO', confirmedCount: 0 },
            ],
          }),
        ],
      })

      const lines = (await supply.findVisits(store, '2026-03', '2026-03')).visits[0].lines
      expect(lines.find(line => line.sku === 'UNCOUNTED')!.confirmed_count).toBeNull()
      expect(lines.find(line => line.sku === 'UNCOUNTED')!.quantity_to_restock).toBeNull()
      expect(lines.find(line => line.sku === 'ZERO')!.confirmed_count).toBe(0)
    })

    it('re-ingesting the identical report does not duplicate visits or lines', async () => {
      const store = newStore()
      await ingest(store, { visits: [visit()] })
      await ingest(store, { visits: [visit()], ingestionId: 'ing-2' })

      const result = await supply.findVisits(store, '2026-03', '2026-03')
      expect(result.visits).toHaveLength(1)
      expect(result.visits[0].lines).toHaveLength(1)
    })

    it('a corrected report leaves no visit from the superseded ingestion', async () => {
      const store = newStore()
      await ingest(store, { visits: [visit({ sourceReference: 'old' })] })
      await ingest(store, { visits: [visit({ sourceReference: 'corrected' })], ingestionId: 'ing-2' })

      const result = await supply.findVisits(store, '2026-03', '2026-03')
      expect(result.visits.map(v => v.source_reference)).toEqual(['corrected'])
    })

    it('leaves the other periods of the same store unchanged', async () => {
      const store = newStore()
      await ingest(store, { period: '2026-03', visits: [visit({ sourceReference: 'march' })] })
      await ingest(store, {
        period: '2026-04',
        visits: [visit({ sourceReference: 'april', endedAt: '2026-04-02T08:45:00.000Z' })],
      })
      await ingest(store, { period: '2026-04', visits: [], ingestionId: 'ing-2' })

      const result = await supply.findVisits(store, '2026-03', '2026-04')
      expect(result.visits.map(v => v.source_reference)).toEqual(['march'])
    })

    it('a job without visits leaves the stored visits untouched', async () => {
      const store = newStore()
      await ingest(store, { visits: [visit()] })
      await ingest(store, { ingestionId: 'ing-2', restocks: [{ sku: '5010', quantityRestocked: 21 }] })

      expect((await supply.findVisits(store, '2026-03', '2026-03')).visits).toHaveLength(1)
    })

    it('monthly records are identical with and without visits', async () => {
      const withVisits = newStore()
      const without = newStore()
      const input = {
        restocks: [{ sku: '5010', quantityRestocked: 21 }],
        removals: [{ sku: '5010', reason: 'expired', quantityRemoved: 2 }],
        adjustments: [{ sku: '5010', quantity: -1 }],
        recordedClosingBalances: [{ sku: '5010', quantity: 29 }],
      }
      await ingest(withVisits, { ...input, visits: [visit()] })
      await ingest(without, input)

      const a = await supply.findPeriod(withVisits, '2026-03')
      const b = await supply.findPeriod(without, '2026-03')
      expect({ ...a, store_id: 0 }).toEqual({ ...b, store_id: 0 })
    })

    it('reads a range ordered by end instant, across periods', async () => {
      const store = newStore()
      await ingest(store, {
        period: '2026-04',
        visits: [visit({ sourceReference: 'april', endedAt: '2026-04-05T08:45:00.000Z' })],
      })
      await ingest(store, {
        period: '2026-03',
        visits: [
          visit({ sourceReference: 'march-late', endedAt: '2026-03-20T08:45:00.000Z' }),
          visit({ sourceReference: 'march-early', endedAt: '2026-03-02T08:45:00.000Z' }),
        ],
      })

      const result = await supply.findVisits(store, '2026-03', '2026-04')
      expect(result.visits.map(v => v.source_reference)).toEqual(['march-early', 'march-late', 'april'])
    })

    it('lists the stores that have visits in a range, and none outside it', async () => {
      const store = newStore()
      await ingest(store, { period: '2026-03', visits: [visit()] })

      expect(await supply.findVisitStoreIds('2026-03', '2026-03')).toContain(store)
      expect(await supply.findVisitStoreIds('2026-05', '2026-06')).not.toContain(store)
    })

    it('returns an empty list, not an error, for a range with no visits', async () => {
      expect((await supply.findVisits(newStore(), '2026-01', '2026-02')).visits).toEqual([])
    })
  })
})

