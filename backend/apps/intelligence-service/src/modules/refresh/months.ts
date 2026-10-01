/** Calendar-month helpers shared by runs, availability and freshness. Months are `YYYY-MM`. */

export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = []
  let [year, month] = from.split('-').map(Number)
  const [endYear, endMonth] = to.split('-').map(Number)

  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`)
    month++
    if (month > 12) {
      month = 1
      year++
    }
  }

  return months
}

/** `month` shifted by `delta` calendar months (negative = earlier). */
export function shiftMonth(month: string, delta: number): string {
  const [year, number] = month.split('-').map(Number)
  const index = year * 12 + (number - 1) + delta

  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** Whole calendar months from `from` to `to` (`to` later = positive). */
export function monthDistance(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split('-').map(Number)
  const [toYear, toMonth] = to.split('-').map(Number)

  return (toYear - fromYear) * 12 + (toMonth - fromMonth)
}

/** A month that has fully ended before the reference instant. */
export function monthEnded(month: string, asOf: Date): boolean {
  const [year, number] = month.split('-').map(Number)

  return asOf.getTime() >= Date.UTC(year, number, 1)
}

/** The latest month that has fully ended before `asOf`. */
export function lastEndedMonth(asOf: Date): string {
  return shiftMonth(`${asOf.getUTCFullYear()}-${String(asOf.getUTCMonth() + 1).padStart(2, '0')}`, -1)
}

/** The first instant after `month` ends — the reference instant at which that month counts as ended. */
export function endOfMonth(month: string): Date {
  const [year, number] = month.split('-').map(Number)

  return new Date(Date.UTC(year, number, 1))
}
