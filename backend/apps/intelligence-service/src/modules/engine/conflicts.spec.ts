import { detectConflicts } from './conflicts'
import type { Interval } from './intervals'

const interval = (over: Partial<Interval> = {}): Interval => ({
  from: new Date('2026-06-01T00:00:00Z'),
  to: new Date('2026-06-08T00:00:00Z'),
  days: 7,
  consumption: 5,
  censored: false,
  noStock: false,
  rise: false,
  restockedAtStart: 0,
  removedAtStart: 0,
  startBalance: 10,
  ...over,
})
const clean = { intervals: [interval()], consumptionMonthsWithoutSales: [], rejectedAtIngestion: false, baselineConflict: false }

describe('detectConflicts', () => {
  it('finds none in a clean Product x Store', () => {
    expect(detectConflicts(clean)).toEqual([])
  })

  it('a balance that rose with no event lists the interval', () => {
    const [c] = detectConflicts({ ...clean, intervals: [interval({ rise: true })] })

    expect(c.code).toBe('balance_rise_without_event')
    expect(c.detail.intervals).toHaveLength(1)
  })

  it('consumption in a month with no imported sales', () => {
    expect(detectConflicts({ ...clean, consumptionMonthsWithoutSales: ['2026-05'] })).toEqual([
      { code: 'consumption_without_imported_sales', detail: { months: ['2026-05'] } },
    ])
  })

  it('a SKU rejected at ingestion and a conflicting baseline', () => {
    expect(detectConflicts({ ...clean, rejectedAtIngestion: true, baselineConflict: true }).map(c => c.code)).toEqual(['rejected_at_ingestion', 'conflicting_baseline'])
  })

  it('reports every conflict at once', () => {
    const all = detectConflicts({ intervals: [interval({ rise: true })], consumptionMonthsWithoutSales: ['2026-05'], rejectedAtIngestion: true, baselineConflict: true })

    expect(all).toHaveLength(4)
  })
})
