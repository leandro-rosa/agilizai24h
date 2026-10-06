const DAY_MS = 86_400_000
const ms = (day: string) => new Date(`${day}T00:00:00Z`).getTime()
const iso = (time: number) => new Date(time).toISOString().slice(0, 10)

export function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && iso(ms(value)) === value
}

/** The Monday of the ISO week that contains `day`. */
export function weekStartOf(day: string): string {
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0

  return iso(ms(day) - weekday * DAY_MS)
}

/** Monday through Sunday of the week starting at `weekStart`. */
export function weekRange(weekStart: string): { from: string; to: string } {
  return { from: weekStart, to: iso(ms(weekStart) + 6 * DAY_MS) }
}

export function addDays(day: string, delta: number): string {
  return iso(ms(day) + delta * DAY_MS)
}
