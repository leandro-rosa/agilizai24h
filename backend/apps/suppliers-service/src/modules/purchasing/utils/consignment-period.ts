import { addDays, isDay } from './week'

const HOUR_MS = 3_600_000
/** America/Sao_Paulo has been UTC-3 all year since 2019 (no daylight saving), so a fixed offset keeps this pure. */
const SP_OFFSET_HOURS = 3

/** Half-open: `start` is inside, `end` belongs to the next period. */
export interface Period {
  start: Date
  end: Date
}

export function spDayStart(day: string): Date {
  if (!isDay(day)) throw new RangeError(`not a calendar day: ${day}`)

  return new Date(`${day}T00:00:00-03:00`)
}

export function spDayOf(instant: Date): string {
  return new Date(instant.getTime() - SP_OFFSET_HOURS * HOUR_MS).toISOString().slice(0, 10)
}

/** The selected days, both included entirely. */
export function periodFromDays(firstDay: string, lastDay: string): Period {
  const start = spDayStart(firstDay)
  const end = spDayStart(addDays(lastDay, 1))
  if (end.getTime() <= start.getTime()) throw new RangeError('the last day is before the first day')

  return { start, end }
}

export function contains(period: Period, instant: Date): boolean {
  return instant.getTime() >= period.start.getTime() && instant.getTime() < period.end.getTime()
}

export function overlaps(a: Period, b: Period): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime()
}

/** Uncovered stretches between the periods, by start time; a period inside another one hides nothing. */
export function findGaps(periods: Period[]): Period[] {
  const sorted = [...periods].sort((a, b) => a.start.getTime() - b.start.getTime())
  const gaps: Period[] = []
  let reach = sorted[0]?.end

  for (const period of sorted.slice(1)) {
    if (reach && period.start.getTime() > reach.getTime()) gaps.push({ start: reach, end: period.start })
    if (!reach || period.end.getTime() > reach.getTime()) reach = period.end
  }

  return gaps
}

/** The first period starts exactly at the cutoff; the next ones at the previous end. The end is always a Sao Paulo day boundary. */
export function suggestNext(lastEnd: Date | null, cutoff: Date, lengthDays: number): Period {
  const start = lastEnd ?? cutoff

  return { start, end: spDayStart(addDays(spDayOf(start), lengthDays)) }
}
