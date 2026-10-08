import { SupplyService } from './supply.service'

type Visit = { store_id: number; period: string; kind: string; ended_at: Date; lines: { id: number }[] }
const visit = (store_id: number, period: string, kind: string, ended: string, restocked = true): Visit => ({ store_id, period, kind, ended_at: new Date(ended), lines: restocked ? [{ id: 1 }] : [] })

const make = (visits: Visit[]) => new SupplyService({ supplyVisit: { findMany: jest.fn(async () => visits) } } as never)

describe('SupplyService.findVisitCounts', () => {
  it('counts a restocking or combined visit that restocked something, per store and month', async () => {
    const result = await make([visit(1, '2026-09', 'combined', '2026-09-02T10:00:00Z'), visit(1, '2026-09', 'restocking', '2026-09-09T10:00:00Z'), visit(2, '2026-09', 'combined', '2026-09-02T11:00:00Z')]).findVisitCounts('2026-09', '2026-09')

    expect(result.rows).toEqual([
      { store_id: 1, period: '2026-09', restocking_visits: 2, count_only_visits: 0 },
      { store_id: 2, period: '2026-09', restocking_visits: 1, count_only_visits: 0 },
    ])
    expect(result.unit).toContain('one store served in one restocking operation')
  })

  it('keeps a count-only visit apart: an inventory sheet, or a restocking one that restocked nothing, is not a restocking', async () => {
    const result = await make([visit(1, '2026-09', 'inventory', '2026-09-03T10:00:00Z', false), visit(1, '2026-09', 'combined', '2026-09-04T10:00:00Z', false), visit(1, '2026-09', 'combined', '2026-09-05T10:00:00Z')]).findVisitCounts('2026-09', '2026-09')

    expect(result.rows).toEqual([{ store_id: 1, period: '2026-09', restocking_visits: 1, count_only_visits: 2 }])
  })

  it('never counts the same store and end instant twice (a re-ingested sheet)', async () => {
    const result = await make([visit(1, '2026-09', 'combined', '2026-09-02T10:00:00Z'), visit(1, '2026-09', 'combined', '2026-09-02T10:00:00Z')]).findVisitCounts('2026-09', '2026-09')

    expect(result.rows[0].restocking_visits).toBe(1)
  })

  it('a month with no visit has no row: unknown, not zero', async () => {
    const result = await make([visit(1, '2026-08', 'combined', '2026-08-02T10:00:00Z')]).findVisitCounts('2026-08', '2026-09')

    expect(result.rows.map(row => row.period)).toEqual(['2026-08'])
    expect((await make([]).findVisitCounts('2026-08', '2026-09')).rows).toEqual([])
  })
})
