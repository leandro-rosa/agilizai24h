import type { StoreDays, ValidationThresholds } from '../types/validation.types'
import { daysInMonth, effectiveEndDay, evaluateCoverage, storeCoverage } from './coverage'

const thresholds: ValidationThresholds = {
  periodMatchMinShare: 0.9,
  weekdayOpenMinShare: 0.5,
  coverageMinPooled: 0.9,
  coverageMinStore: 0.7,
  edgeToleranceDays: 3,
}

const AUGUST = '2026-08' // 31 days; 1 August 2026 is a Saturday, so Sat, Sun and Mon occur five times.

const weekdayOf = (period: string, day: number) => {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).getUTCDay()
}

const maskOf = (days: number[]) => days.reduce((mask, day) => mask | (1 << (day - 1)), 0)

/** Every day of the month on the given weekdays (0 = Sunday), minus the excluded ones. */
const daysOn = (period: string, weekdays: number[], excluded: number[] = []) =>
  Array.from({ length: daysInMonth(period) }, (_, i) => i + 1).filter(
    day => weekdays.includes(weekdayOf(period, day)) && !excluded.includes(day),
  )

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const store = (days: number[], rows = days.length * 10): StoreDays => ({ rows, dayMask: maskOf(days) })

const MON_TO_FRI = [1, 2, 3, 4, 5]

describe('daysInMonth and effectiveEndDay', () => {
  it('counts the days of a month, leap years included', () => {
    expect(daysInMonth('2026-08')).toBe(31)
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2028-02')).toBe(29)
  })

  it('counts the whole month once it is over, up to today while it is running, and nothing before it starts', () => {
    expect(effectiveEndDay('2026-08', '2026-09-19')).toBe(31)
    expect(effectiveEndDay('2026-09', '2026-09-19')).toBe(19)
    expect(effectiveEndDay('2026-10', '2026-09-19')).toBe(0)
  })
})

describe('storeCoverage — expected operating days, not calendar days', () => {
  const coverage = (days: number[], period = AUGUST, endDay = daysInMonth(period)) =>
    storeCoverage('Loja A', store(days), period, endDay, thresholds.weekdayOpenMinShare)

  it('a store that sells Monday to Friday and never on weekends is expected on 21 days and has full coverage', () => {
    const result = coverage(daysOn(AUGUST, MON_TO_FRI))

    expect(result.normalWeekdays).toEqual([1, 2, 3, 4, 5])
    expect(result.expectedDays).toBe(21)
    expect(result.coveredDays).toBe(21)
    expect(result.coverage).toBe(1)
    expect(result.verifiable).toBe(true)
    expect(result.missingDates).toEqual([])
  })

  it('a store that sells every day is expected on all 31 days', () => {
    const result = coverage(range(1, 31))

    expect(result.normalWeekdays).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(result.expectedDays).toBe(31)
    expect(result.coverage).toBe(1)
  })

  it('missing two weeks (10 to 21 August) leaves every weekday normal and coverage at 11 of 21', () => {
    const result = coverage(daysOn(AUGUST, MON_TO_FRI, range(10, 21)))

    // Monday sold on 3, 24 and 31 = 3 of 5; Tuesday to Friday on 2 of 4 = exactly the share, so all stay normal.
    expect(result.normalWeekdays).toEqual([1, 2, 3, 4, 5])
    expect(result.expectedDays).toBe(21)
    expect(result.coveredDays).toBe(11)
    expect(result.coverage).toBeCloseTo(11 / 21, 10)
    expect(result.missingDates).toEqual([
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
      '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21',
    ])
  })

  it('caps the list of missing dates at ten', () => {
    // A store that sells every day, missing 10 to 19 and the 21st: every weekday stays normal, 11 dates are missing.
    const result = coverage(range(1, 31).filter(day => !(day >= 10 && day <= 19) && day !== 21))

    expect(result.normalWeekdays).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(result.expectedDays - result.coveredDays).toBe(11)
    expect(result.missingDates).toHaveLength(10)
    expect(result.missingDates[0]).toBe('2026-08-10')
  })

  it('an unusually long gap turns weekdays "sparse" and shrinks what is expected: the reason the edge check exists', () => {
    // Missing 10 to 24 drops Monday to 2 of 5, so Mondays stop being expected at all.
    const result = coverage(daysOn(AUGUST, MON_TO_FRI, range(10, 24)))

    expect(result.normalWeekdays).toEqual([2, 3, 4, 5])
    expect(result.missingDates).toHaveLength(8)
  })

  it('missing three weeks (10 to 28 August) leaves no normal weekday: coverage cannot be established', () => {
    const result = coverage(daysOn(AUGUST, MON_TO_FRI, range(10, 28)))

    // Monday sold on 3 and 31 = 2 of 5 = 40%; Tuesday to Friday on 1 of 4 = 25%.
    expect(result.normalWeekdays).toEqual([])
    expect(result.verifiable).toBe(false)
    expect(result.coverage).toBeNull()
  })

  it('a store with too few days cannot be verified either, even if all of them are "normal"', () => {
    const result = coverage([3, 4])

    expect(result.verifiable).toBe(false)
    expect(result.coverage).toBeNull()
  })

  it('a store that sells on only one weekday cannot be verified: one weekday is not a pattern', () => {
    const result = coverage(daysOn(AUGUST, [6]))

    expect(result.normalWeekdays).toEqual([6])
    expect(result.verifiable).toBe(false)
  })

  it('counts only up to today while the month is running: September 1 to 18 on weekdays is complete on the 19th', () => {
    // 1 September 2026 is a Tuesday; the 19th is a Saturday.
    const days = daysOn('2026-09', MON_TO_FRI).filter(day => day <= 18)
    const result = coverage(days, '2026-09', 19)

    expect(result.normalWeekdays).toEqual([1, 2, 3, 4, 5])
    expect(result.expectedDays).toBe(14)
    expect(result.coveredDays).toBe(14)
    expect(result.coverage).toBe(1)
  })

  it('uses the share it is given: a lower bar makes a sparser weekday normal', () => {
    const days = daysOn(AUGUST, MON_TO_FRI, range(10, 28))

    expect(storeCoverage('A', store(days), AUGUST, 31, 0.4).normalWeekdays).toEqual([1])
  })
})

describe('evaluateCoverage', () => {
  const evaluate = (stores: Record<string, StoreDays>, today = '2026-09-19', custom = thresholds) =>
    evaluateCoverage(stores, AUGUST, today, custom)

  const codes = (result: ReturnType<typeof evaluate>) => result.inconsistencies.map(i => i.code)

  it('a complete file has no inconsistency', () => {
    const result = evaluate({ 'Loja A': store(daysOn(AUGUST, MON_TO_FRI)), 'Loja B': store(range(1, 31)) })

    expect(result.inconsistencies).toEqual([])
    expect(result.fileCoverage).toBe(1)
    expect(result.firstDay).toBe('2026-08-01')
    expect(result.lastDay).toBe('2026-08-31')
  })

  it('pools coverage across stores instead of averaging percentages: a store missing two weeks pulls the file down', () => {
    const result = evaluate({
      'Loja A': store(daysOn(AUGUST, MON_TO_FRI)),
      'Loja B': store(daysOn(AUGUST, MON_TO_FRI, range(10, 21))),
    })

    expect(result.fileCoverage).toBeCloseTo(32 / 42, 10)
    expect(codes(result)).toEqual(['low_file_coverage', 'low_store_coverage'])
    expect(result.inconsistencies.find(i => i.code === 'low_store_coverage')?.details).toMatchObject({
      store: 'Loja B',
      expectedDays: 21,
      coveredDays: 11,
    })
  })

  it('a store just above the bar is fine: 5 of 21 days missing is 76%, above 70%', () => {
    const result = evaluate({ 'Loja A': store(daysOn(AUGUST, MON_TO_FRI, range(10, 14))) })

    expect(codes(result)).not.toContain('low_store_coverage')
  })

  it('reports a store whose coverage cannot be established, and leaves it out of the pooled figure', () => {
    const result = evaluate({
      'Loja A': store(daysOn(AUGUST, MON_TO_FRI)),
      'Loja B': store(daysOn(AUGUST, MON_TO_FRI, range(10, 28))),
    })

    expect(codes(result)).toContain('store_not_verifiable')
    expect(result.fileCoverage).toBe(1)
    expect(result.stores.find(s => s.name === 'Loja B')?.verifiable).toBe(false)
  })

  it('flags a file that stops early: the last row on the 15th of a 31-day month', () => {
    const early = [...daysOn(AUGUST, MON_TO_FRI).filter(day => day <= 14), 15]
    const result = evaluate({ 'Loja A': store(early) })

    expect(codes(result)).toContain('edge_end')
    expect(codes(result)).not.toContain('edge_start')
    expect(result.lastDay).toBe('2026-08-15')
  })

  it('flags a file that starts late: the first row on the 5th', () => {
    const late = range(5, 31)
    const result = evaluate({ 'Loja A': store(late) })

    expect(codes(result)).toContain('edge_start')
    expect(result.firstDay).toBe('2026-08-05')
  })

  it('tolerates the edges by the configured number of days: a first row on the 4th and a last row on the 28th pass', () => {
    const result = evaluate({ 'Loja A': store(range(4, 28)) })

    expect(codes(result)).not.toContain('edge_start')
    expect(codes(result)).not.toContain('edge_end')
  })

  it('measures the end edge against today while the month is running', () => {
    const result = evaluateCoverage({ 'Loja A': store(daysOn('2026-09', MON_TO_FRI).filter(d => d <= 18)) }, '2026-09', '2026-09-19', thresholds)

    expect(result.inconsistencies).toEqual([])
  })

  it('takes the thresholds it is given', () => {
    const strict = { ...thresholds, coverageMinStore: 0.9, edgeToleranceDays: 0 }
    const result = evaluate({ 'Loja A': store(daysOn(AUGUST, MON_TO_FRI, range(10, 14))) }, '2026-09-19', strict)

    expect(codes(result)).toContain('low_store_coverage')
  })

  it('has nothing to say about a file with no rows in the month', () => {
    const result = evaluate({})

    expect(result.stores).toEqual([])
    expect(result.fileCoverage).toBeNull()
    expect(result.firstDay).toBeNull()
    expect(result.inconsistencies).toEqual([])
  })

  it('lists stores by name, so the same file always gives the same report', () => {
    const result = evaluate({ 'Loja B': store(range(1, 31)), 'Loja A': store(range(1, 31)) })

    expect(result.stores.map(s => s.name)).toEqual(['Loja A', 'Loja B'])
  })
})
