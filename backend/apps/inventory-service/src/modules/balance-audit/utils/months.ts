/** Month arithmetic on `YYYY-MM` keys. Instants are read as UTC throughout so a month never shifts with the host's zone. */

export function monthKey(instant: Date): string {
  return `${instant.getUTCFullYear()}-${String(instant.getUTCMonth() + 1).padStart(2, '0')}`
}

export function monthStart(month: string): Date {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number - 1, 1))
}

export function nextMonth(month: string): string {
  const start = monthStart(month)
  return monthKey(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)))
}

/** Every month from `from` to `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = []
  for (let month = from; month <= to; month = nextMonth(month)) months.push(month)
  return months
}
