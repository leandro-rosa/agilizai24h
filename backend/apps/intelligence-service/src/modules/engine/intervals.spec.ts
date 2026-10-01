import { buildCycles, buildIntervals, restockEvents } from './intervals'
import type { VisitPoint } from './engine.types'

const at = (iso: string) => new Date(`${iso}T10:00:00Z`)
const visit = (day: string, before: number, restocked: number, after: number, over: Partial<VisitPoint> = {}): VisitPoint => ({
  endedAt: at(day),
  balanceBefore: before,
  confirmedCount: null,
  restocked,
  removedTotal: 0,
  adjustment: 0,
  balanceAfter: after,
  ...over,
})

describe('buildIntervals', () => {
  it('consumption is the balance after a visit minus the balance before the next', () => {
    const [interval] = buildIntervals([visit('2026-03-02', 5, 16, 21), visit('2026-03-09', 9, 12, 21)], 1)

    expect(interval).toMatchObject({ consumption: 12, days: 7, censored: false, rise: false, restockedAtStart: 16 })
  })

  it('orders visits by end instant whatever order they arrive in', () => {
    const intervals = buildIntervals([visit('2026-03-09', 9, 12, 21), visit('2026-03-02', 5, 16, 21)], 1)

    expect(intervals[0].consumption).toBe(12)
  })

  it('marks an interval that ended in a stock-out as censored: consumption is a lower bound', () => {
    const [interval] = buildIntervals([visit('2026-03-02', 5, 16, 21), visit('2026-03-12', 0, 21, 21)], 1)

    expect(interval).toMatchObject({ consumption: 21, censored: true, noStock: false })
  })

  it('does not treat an empty shelf throughout as censored demand — it says nothing', () => {
    const [interval] = buildIntervals([visit('2026-03-02', 0, 0, 0), visit('2026-03-09', 0, 0, 0)], 1)

    expect(interval).toMatchObject({ noStock: true, censored: false, consumption: 0 })
  })

  it('marks a balance that rose with no event as a rise and never as negative consumption', () => {
    const [interval] = buildIntervals([visit('2026-03-02', 5, 5, 10), visit('2026-03-09', 12, 0, 12)], 1)

    expect(interval).toMatchObject({ rise: true, consumption: 0, censored: false })
  })

  it('folds an interval shorter than the minimum into its neighbour', () => {
    const visits = [visit('2026-03-02', 0, 10, 10), { ...visit('2026-03-02', 10, 0, 10), endedAt: new Date('2026-03-02T12:00:00Z') }, visit('2026-03-09', 3, 7, 10)]

    const intervals = buildIntervals(visits, 1)

    expect(intervals).toHaveLength(1)
    expect(intervals[0].consumption).toBe(7)
    expect(intervals[0].days).toBeCloseTo(7, 1)
  })

  it('folds a short trailing interval into the previous one', () => {
    const visits = [visit('2026-03-02', 0, 10, 10), visit('2026-03-09', 3, 7, 10), { ...visit('2026-03-09', 10, 0, 10), endedAt: new Date('2026-03-09T14:00:00Z') }]

    const intervals = buildIntervals(visits, 1)

    expect(intervals).toHaveLength(1)
    expect(intervals[0].to.toISOString()).toBe('2026-03-09T14:00:00.000Z')
  })

  it('needs at least two visits to make an interval', () => {
    expect(buildIntervals([visit('2026-03-02', 0, 10, 10)], 1)).toEqual([])
    expect(buildIntervals([], 1)).toEqual([])
  })
})

describe('buildCycles', () => {
  it('opens a cycle at each restock and sums consumption, removals and days within it', () => {
    const visits = [
      visit('2026-03-02', 5, 16, 21),
      visit('2026-03-05', 14, 0, 14, { removedTotal: -2 }),
      visit('2026-03-09', 9, 12, 21),
      visit('2026-03-16', 8, 13, 21),
    ]

    const cycles = buildCycles(buildIntervals(visits, 1))

    expect(cycles).toHaveLength(2)
    expect(cycles[0]).toMatchObject({ restocked: 16, startBalance: 21, consumption: 7 + 5, intervals: 2, censored: false })
    expect(cycles[0].days).toBeCloseTo(7, 5)
    expect(cycles[1]).toMatchObject({ restocked: 12, consumption: 13 })
  })

  it('a removal of any reason reduces the balance of the cycle', () => {
    // a return, a transfer and an expired removal all appear in the visit's removed total
    const cycles = buildCycles(buildIntervals([visit('2026-03-02', 0, 20, 14, { removedTotal: -6 }), visit('2026-03-09', 8, 0, 8)], 1))

    expect(cycles[0].removed).toBe(-6)
    expect(cycles[0].consumption).toBe(6)
  })

  it('marks a cycle censored when any of its intervals ended in a stock-out', () => {
    const visits = [visit('2026-03-02', 5, 16, 21), visit('2026-03-09', 9, 0, 9), visit('2026-03-12', 0, 21, 21)]

    expect(buildCycles(buildIntervals(visits, 1))[0].censored).toBe(true)
  })
})

describe('restockEvents', () => {
  it('lists only the visits that restocked', () => {
    expect(restockEvents([visit('2026-03-02', 5, 16, 21), visit('2026-03-05', 14, 0, 14), visit('2026-03-09', 9, 12, 21)])).toEqual([
      at('2026-03-02'),
      at('2026-03-09'),
    ])
  })
})
