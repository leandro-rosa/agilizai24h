import { addDays } from './week'

/** Sao Paulo calendar days: `from` is included, `until` is the exclusive end (`YYYY-MM-DD`). */
export interface DayInterval {
  from: string
  until: string
}

/** Monday through Sunday of the week starting at `weekStart`. */
export function weekInterval(weekStart: string): DayInterval {
  return { from: weekStart, until: addDays(weekStart, 7) }
}

export function daysOverlap(a: DayInterval, b: DayInterval): boolean {
  return a.from < b.until && b.from < a.until
}

/** The id of the first already-covered interval that shares a day with `candidate`, or null. */
export function findOverlap(candidate: DayInterval, existing: Array<DayInterval & { id: number }>): number | null {
  return existing.find(interval => daysOverlap(candidate, interval))?.id ?? null
}

/** The last covered day, included (what the screen shows). */
export function lastDay(interval: DayInterval): string {
  return addDays(interval.until, -1)
}
