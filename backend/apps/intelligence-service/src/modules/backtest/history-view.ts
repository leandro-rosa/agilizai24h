import type { PairInput } from '../engine/engine.types'

/** First instant after the month `YYYY-MM`. */
export function monthEnd(month: string): number {
  const [year, number] = month.split('-').map(Number)
  return Date.UTC(year, number, 1)
}

export const monthOf = (date: Date): string => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`

/** A month whose every day lies before the origin. */
export const monthEndedBefore = (month: string, origin: Date): boolean => monthEnd(month) <= origin.getTime()

export interface BaselineAtOrigin {
  quantity: number | null
  /** True when no stored history reaches the origin, so the baseline of record stands in for the quantity of the time. */
  ofRecord: boolean
}

/**
 * The data a Product x Store had at an origin: only records that ended BEFORE it
 * (visits that ended earlier, months that were entirely over), never anything
 * after. Wraps the full history once, so a store is loaded one time and every
 * origin is a cut of it.
 *
 * Every date handed out is logged (`latestDateRead`) so a test can prove nothing
 * at or after an origin was ever read for that origin.
 */
export class HistoryView {
  private latest = Number.NEGATIVE_INFINITY

  constructor(private readonly full: PairInput) {}

  /** The latest datum (visit end or month end) handed out so far, or null when none. */
  get latestDateRead(): Date | null {
    return Number.isFinite(this.latest) ? new Date(this.latest) : null
  }

  at(origin: Date, baseline: BaselineAtOrigin): PairInput {
    const cutoff = origin.getTime()
    const visits = this.full.visits.filter(visit => visit.endedAt.getTime() < cutoff)
    const monthly = this.full.monthly.filter(month => monthEndedBefore(month.month, origin))
    const keptMonths = new Set(monthly.map(month => month.month))

    for (const visit of visits) this.latest = Math.max(this.latest, visit.endedAt.getTime())
    for (const month of monthly) this.latest = Math.max(this.latest, monthEnd(month.month) - 1)

    const cut: PairInput = {
      ...this.full,
      visits,
      monthly,
      salesMonthsMissing: this.full.salesMonthsMissing.filter(month => keptMonths.has(month)),
      baseline: baseline.quantity,
      baselineIsOfRecord: baseline.ofRecord,
      // The cross-store view needs every store at the same origin; the backtest judges the pair alone, and says so.
      network: null,
      asOf: origin,
    }

    assertNoLookAhead(cut, origin)
    return cut
  }
}

/** Latest datum an input carries (visit end or last instant of a month), or null when it has none. */
export function latestDatum(input: PairInput): Date | null {
  let latest = Number.NEGATIVE_INFINITY
  for (const visit of input.visits) latest = Math.max(latest, visit.endedAt.getTime())
  for (const month of input.monthly) latest = Math.max(latest, monthEnd(month.month) - 1)
  return Number.isFinite(latest) ? new Date(latest) : null
}

/** Throws when an input carries a datum at or after the origin or a reference date past it. */
export function assertNoLookAhead(input: PairInput, origin: Date): void {
  const latest = latestDatum(input)
  if (latest !== null && latest.getTime() >= origin.getTime()) throw new Error(`Look-ahead: a record dated ${latest.toISOString()} reached an engine input for origin ${origin.toISOString()}`)
  if (input.asOf.getTime() > origin.getTime()) throw new Error(`Look-ahead: asOf ${input.asOf.toISOString()} is after origin ${origin.toISOString()}`)
}

/**
 * Origins: every month start from the first with at least `minWeeks` weeks of
 * history (counted from the first visit anywhere) through the month `dataThrough`.
 */
export function originsFor(firstVisit: Date, dataThrough: string, minWeeks = 8): Date[] {
  const earliest = firstVisit.getTime() + minWeeks * 7 * 86_400_000
  const [endYear, endMonth] = dataThrough.split('-').map(Number)
  const origins: Date[] = []

  let year = firstVisit.getUTCFullYear()
  let month = firstVisit.getUTCMonth() + 1

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const start = Date.UTC(year, month - 1, 1)
    if (start >= earliest) origins.push(new Date(start))
    month++
    if (month > 12) {
      month = 1
      year++
    }
  }

  return origins
}
