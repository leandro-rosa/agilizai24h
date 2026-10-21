import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import type { SupplyVisit } from '@app/ingestion-contracts'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { SupplyService } from '../src/modules/supply/services/supply.service'

/**
 * The client divergence report against real rows, in a THROWAWAY database (test/support/with-test-db.sh) — the data
 * below is fictitious and must never reach the operator's database.
 */
describe('client divergences (throwaway database, fictitious data)', () => {
  let app: TestingModule
  let supply: SupplyService
  let prisma: PrismaClientService

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule], providers: [SupplyService] }).compile()
    app = await moduleRef.init()
    supply = app.get(SupplyService)
    prisma = app.get(PrismaClientService)
    // The six reasons are seeded by the migrations; fail loudly if this is not a migrated database.
    expect(await prisma.removalReason.count()).toBeGreaterThanOrEqual(6)
  }, 60000)

  afterAll(async () => {
    await app?.close()
  })

  const line = (sku: string, over: Partial<SupplyVisit['lines'][number]> = {}): SupplyVisit['lines'][number] => ({
    sku,
    balanceBefore: 10,
    confirmedCount: null,
    quantityToRestock: null,
    restocked: 0,
    removedTotal: 0,
    adjustment: 0,
    balanceAfter: 10,
    capacity: null,
    removalsByReason: [],
    ...over,
  })

  const visit = (endedAt: string, kind: SupplyVisit['kind'], sheet: string, lines: SupplyVisit['lines']): SupplyVisit => ({ kind, startedAt: null, endedAt, previousEndedAt: null, sourceReference: sheet, lines })

  const ingest = (storeId: number, period: string, visits: SupplyVisit[], ingestionId = 'ing-1') =>
    supply.ingestPeriod({ storeId, period, ingestionId, restocks: [], removals: [], adjustments: [], recordedClosingBalances: [], visits })

  it('dates the reason split to its visit, finds the previous count across periods, and excludes other reasons', async () => {
    await ingest(1, '2026-04', [visit('2026-04-28T09:00:00.000Z', 'combined', 'Operação 1', [line('COLA', { confirmedCount: 9 }), line('ENERGY', { restocked: 4 })])])
    await ingest(1, '2026-05', [
      visit('2026-05-07T10:00:00.000Z', 'inventory', 'Operação 7', [
        line('COLA', { removedTotal: -9, removalsByReason: [{ reason: 'return', quantity: 6 }, { reason: 'other_reason', quantity: 3 }] }),
        line('ENERGY', { removedTotal: -2, removalsByReason: [{ reason: 'other_reason', quantity: 2 }] }),
        line('WATER', { removedTotal: -4, removalsByReason: [{ reason: 'expired', quantity: 4 }] }),
      ]),
    ])

    const view = await supply.findDivergences([1], '2026-05-01', '2026-05-11')

    expect(view.divergences.map(d => [d.sku, d.quantity, d.identified_at, d.previous_conference_at])).toEqual([
      ['COLA', 3, '2026-05-07T10:00:00.000Z', '2026-04-28T09:00:00.000Z'], // previous count is OUTSIDE the range and still shown
      ['ENERGY', 2, '2026-05-07T10:00:00.000Z', null], // restocked without a count: not a conference
    ])
    expect(view.unsplit_visits).toBe(0)
  })

  it('does not duplicate occurrences after a re-import, and the replacement wins', async () => {
    const visits = [visit('2026-05-08T10:00:00.000Z', 'inventory', 'Operação 8', [line('REIMP', { removedTotal: -2, removalsByReason: [{ reason: 'other_reason', quantity: 2 }] })])]
    await ingest(2, '2026-05', visits, 'first')
    await ingest(2, '2026-05', visits, 'second')
    await ingest(2, '2026-05', [visit('2026-05-08T10:00:00.000Z', 'inventory', 'Operação 8', [line('REIMP', { removedTotal: -5, removalsByReason: [{ reason: 'other_reason', quantity: 5 }] })])], 'third')

    const view = await supply.findDivergences([2], '2026-05-01', '2026-05-31')

    expect(view.divergences).toHaveLength(1)
    expect(view.divergences[0].quantity).toBe(5)
  })

  it('an operation stored under two periods is one occurrence', async () => {
    const same = visit('2026-05-09T10:00:00.000Z', 'inventory', 'Operação 9', [line('TWICE', { removedTotal: -1, removalsByReason: [{ reason: 'other_reason', quantity: 1 }] })])
    await ingest(3, '2026-05', [same])
    await ingest(3, '2026-06', [same])

    const view = await supply.findDivergences([3], '2026-05-01', '2026-06-30')

    expect(view.divergences).toHaveLength(1)
  })

  it('a line ingested without the split is unknown — reported as unsplit, never as zero loss', async () => {
    await ingest(4, '2026-05', [visit('2026-05-10T10:00:00.000Z', 'inventory', 'Operação 10', [{ ...line('OLD', { removedTotal: -3 }), removalsByReason: undefined }])])

    const view = await supply.findDivergences([4], '2026-05-01', '2026-05-31')

    expect(view.divergences).toEqual([])
    expect(view.unsplit_visits).toBe(1)
  })

  it('reads only the stores asked for, and both end days are inclusive', async () => {
    await ingest(5, '2026-05', [
      visit('2026-05-01T00:00:00.000Z', 'inventory', 'Operação A', [line('EDGE1', { removedTotal: -1, removalsByReason: [{ reason: 'other_reason', quantity: 1 }] })]),
      visit('2026-05-11T23:59:59.000Z', 'inventory', 'Operação B', [line('EDGE2', { removedTotal: -1, removalsByReason: [{ reason: 'other_reason', quantity: 1 }] })]),
      visit('2026-05-12T00:00:00.000Z', 'inventory', 'Operação C', [line('OUT', { removedTotal: -1, removalsByReason: [{ reason: 'other_reason', quantity: 1 }] })]),
    ])
    await ingest(6, '2026-05', [visit('2026-05-05T10:00:00.000Z', 'inventory', 'Operação D', [line('OTHERSTORE', { removedTotal: -1, removalsByReason: [{ reason: 'other_reason', quantity: 1 }] })])])

    const view = await supply.findDivergences([5], '2026-05-01', '2026-05-11')

    expect(view.divergences.map(d => d.sku)).toEqual(['EDGE1', 'EDGE2'])
  })

  it('reading the report changes nothing', async () => {
    const before = await prisma.supplyVisitLine.count()
    await supply.findDivergences([1, 2, 3, 4, 5, 6], '2026-01-01', '2026-12-31')

    expect(await prisma.supplyVisitLine.count()).toBe(before)
  })
})
