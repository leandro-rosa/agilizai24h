import type { Finding, StoreCoverage, StoreDays, ValidationThresholds } from '../types/validation.types'

/** A store needs a pattern to be verifiable: at least this many normal weekdays … */
const MIN_NORMAL_WEEKDAYS = 2
/** … and at least this many expected days, or a handful of days would "prove" full coverage. */
const MIN_EXPECTED_DAYS = 8
const MAX_MISSING_DATES = 10

export function daysInMonth(period: string): number {
  const [year, month] = period.split('-').map(Number)
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * The last day of the period that counts: the whole month once it is over, up to
 * `today` (the date in America/Sao_Paulo, as YYYY-MM-DD) while it is still
 * running, and nothing at all for a month that has not started.
 */
export function effectiveEndDay(period: string, today: string): number {
  const total = daysInMonth(period)
  const currentMonth = today.slice(0, 7)

  if (currentMonth < period) return 0
  if (currentMonth === period) return Math.min(total, Number(today.slice(8, 10)))
  return total
}

/** 0 = Sunday … 6 = Saturday, from the calendar date alone: no time zone can shift it. */
const weekdayOf = (period: string, day: number): number => {
  const [year, month] = period.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

const hasRow = (mask: number, day: number): boolean => (mask & (1 << (day - 1))) !== 0
const isoDay = (period: string, day: number): string => `${period}-${String(day).padStart(2, '0')}`

/**
 * One store's coverage on the days it is EXPECTED to operate, not on calendar
 * days: a store that never sells on weekends is not penalised for them.
 *
 * A weekday is normal for the store when it had at least one row (of any result)
 * on at least `weekdayOpenMinShare` of that weekday's occurrences in the window.
 * Its expected days are the days of the window on its normal weekdays; its
 * coverage is the share of those with at least one row. With fewer than two
 * normal weekdays or fewer than eight expected days there is no pattern to
 * measure against, so the coverage is reported as not verifiable rather than
 * guessed.
 */
export function storeCoverage(
  name: string,
  store: StoreDays,
  period: string,
  endDay: number,
  weekdayOpenMinShare: number,
): StoreCoverage {
  const occurrences: number[] = Array(7).fill(0)
  const hits: number[] = Array(7).fill(0)

  for (let day = 1; day <= endDay; day++) {
    const weekday = weekdayOf(period, day)
    occurrences[weekday]++
    if (hasRow(store.dayMask, day)) hits[weekday]++
  }

  const normalWeekdays = [0, 1, 2, 3, 4, 5, 6].filter(
    weekday => occurrences[weekday] > 0 && hits[weekday] / occurrences[weekday] >= weekdayOpenMinShare,
  )

  const expected: number[] = []
  for (let day = 1; day <= endDay; day++) {
    if (normalWeekdays.includes(weekdayOf(period, day))) expected.push(day)
  }

  const covered = expected.filter(day => hasRow(store.dayMask, day))
  const verifiable = normalWeekdays.length >= MIN_NORMAL_WEEKDAYS && expected.length >= MIN_EXPECTED_DAYS

  return {
    name,
    rows: store.rows,
    normalWeekdays,
    expectedDays: expected.length,
    coveredDays: covered.length,
    coverage: verifiable ? covered.length / expected.length : null,
    verifiable,
    missingDates: expected
      .filter(day => !hasRow(store.dayMask, day))
      .slice(0, MAX_MISSING_DATES)
      .map(day => isoDay(period, day)),
  }
}

export interface CoverageResult {
  stores: StoreCoverage[]
  /** Pooled over the verifiable stores: Σ covered ÷ Σ expected, not an average of percentages. */
  fileCoverage: number | null
  firstDay: string | null
  lastDay: string | null
  inconsistencies: Finding[]
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`

/**
 * Coverage of a whole sales file for one month: each store's coverage, the
 * pooled file coverage, and the two edges of the month. The edge check exists
 * because the per-store inference above reads the weekdays from the file itself
 * and so cannot see a file that was cut short — a truncated month makes every
 * weekday look sparse; only the first and last dated row give it away.
 */
export function evaluateCoverage(
  storeDays: Record<string, StoreDays>,
  period: string,
  today: string,
  thresholds: ValidationThresholds,
): CoverageResult {
  const endDay = effectiveEndDay(period, today)

  const stores = Object.entries(storeDays)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, days]) => storeCoverage(name, days, period, endDay, thresholds.weekdayOpenMinShare))

  const verifiable = stores.filter(store => store.verifiable)
  const expectedTotal = verifiable.reduce((sum, store) => sum + store.expectedDays, 0)
  const coveredTotal = verifiable.reduce((sum, store) => sum + store.coveredDays, 0)
  const fileCoverage = expectedTotal > 0 ? coveredTotal / expectedTotal : null

  const combinedMask = Object.values(storeDays).reduce((mask, days) => mask | days.dayMask, 0)
  const total = daysInMonth(period)
  const daysWithRows = Array.from({ length: total }, (_, i) => i + 1).filter(day => hasRow(combinedMask, day))
  const firstDay = daysWithRows.length > 0 ? daysWithRows[0] : null
  const lastDay = daysWithRows.length > 0 ? daysWithRows[daysWithRows.length - 1] : null

  const inconsistencies: Finding[] = []

  if (firstDay !== null && endDay > 0 && firstDay > 1 + thresholds.edgeToleranceDays) {
    inconsistencies.push({
      code: 'edge_start',
      message: `The first dated row is on day ${firstDay}, more than ${thresholds.edgeToleranceDays} days after the start of the month`,
      details: { firstDay: isoDay(period, firstDay), toleranceDays: thresholds.edgeToleranceDays },
    })
  }

  if (lastDay !== null && endDay > 0 && lastDay < endDay - thresholds.edgeToleranceDays) {
    inconsistencies.push({
      code: 'edge_end',
      message: `The last dated row is on day ${lastDay}, more than ${thresholds.edgeToleranceDays} days before the end of the period (day ${endDay})`,
      details: { lastDay: isoDay(period, lastDay), endDay: isoDay(period, endDay), toleranceDays: thresholds.edgeToleranceDays },
    })
  }

  if (fileCoverage !== null && fileCoverage < thresholds.coverageMinPooled) {
    inconsistencies.push({
      code: 'low_file_coverage',
      message: `File coverage on expected operating days is ${pct(fileCoverage)}, below the ${pct(thresholds.coverageMinPooled)} minimum`,
      details: { coverage: fileCoverage, minimum: thresholds.coverageMinPooled },
    })
  }

  for (const store of stores) {
    if (!store.verifiable) {
      inconsistencies.push({
        code: 'store_not_verifiable',
        message: `The coverage of ${store.name} cannot be established: too few operating days to find its pattern`,
        details: { store: store.name, normalWeekdays: store.normalWeekdays, expectedDays: store.expectedDays },
      })
    } else if (store.coverage !== null && store.coverage < thresholds.coverageMinStore) {
      inconsistencies.push({
        code: 'low_store_coverage',
        message: `${store.name} has rows on ${store.coveredDays} of ${store.expectedDays} expected operating days (${pct(store.coverage)}), below the ${pct(thresholds.coverageMinStore)} minimum`,
        details: {
          store: store.name,
          coverage: store.coverage,
          minimum: thresholds.coverageMinStore,
          expectedDays: store.expectedDays,
          coveredDays: store.coveredDays,
          missingDates: store.missingDates,
        },
      })
    }
  }

  return {
    stores,
    fileCoverage,
    firstDay: firstDay === null ? null : isoDay(period, firstDay),
    lastDay: lastDay === null ? null : isoDay(period, lastDay),
    inconsistencies,
  }
}
