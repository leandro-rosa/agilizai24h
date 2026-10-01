import type { Parameters } from '../parameters/parameters.types'
import { DAY_MS, type VisitPoint } from './engine.types'

/**
 * The stretch between two consecutive appearances of a SKU at a store.
 * `consumption = balanceAfter(k) − balanceBefore(k+1)` — sales plus whatever
 * went unrecorded; removals are recorded AT visits and are not part of it.
 */
export interface Interval {
  from: Date
  to: Date
  days: number
  consumption: number
  /** The shelf was emptied before the next visit: consumption is a LOWER BOUND of demand. */
  censored: boolean
  /** The shelf held nothing for the whole stretch: it says nothing about demand either way. */
  noStock: boolean
  /** The balance ROSE with no recorded event: a data conflict, never consumption. */
  rise: boolean
  /** Units restocked at the visit that opened the interval. */
  restockedAtStart: number
  /** Removed total recorded at the visit that opened the interval (signed). */
  removedAtStart: number
  startBalance: number
}

export interface Cycle {
  from: Date
  to: Date
  days: number
  startBalance: number
  restocked: number
  /** Sum of the removed totals recorded in the cycle, every reason, signed. */
  removed: number
  consumption: number
  censored: boolean
  intervals: number
}

export function sortVisits(visits: VisitPoint[]): VisitPoint[] {
  return [...visits].sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime())
}

function build(current: VisitPoint, next: VisitPoint): Interval {
  const consumption = current.balanceAfter - next.balanceBefore
  const days = (next.endedAt.getTime() - current.endedAt.getTime()) / DAY_MS
  const rise = consumption < 0
  const noStock = current.balanceAfter === 0 && next.balanceBefore === 0

  return {
    from: current.endedAt,
    to: next.endedAt,
    days,
    consumption: rise ? 0 : consumption,
    censored: !rise && !noStock && next.balanceBefore === 0,
    noStock,
    rise,
    restockedAtStart: current.restocked,
    removedAtStart: current.removedTotal,
    startBalance: current.balanceAfter,
  }
}

/**
 * Pairs consecutive visits of the SKU into intervals. Intervals shorter than
 * `minIntervalDays` are folded into the next one (or, at the end, into the
 * previous one) so a visit two hours after another cannot create a rate of
 * hundreds of units a day out of rounding.
 *
 * A negative consumption is marked `rise` and carries zero consumption: it is
 * reported as a conflict, never fed in as negative demand.
 */
export function buildIntervals(visits: VisitPoint[], minIntervalDays: number): Interval[] {
  const sorted = sortVisits(visits)
  const raw: Interval[] = []

  for (let k = 0; k + 1 < sorted.length; k++) raw.push(build(sorted[k], sorted[k + 1]))

  const merged: Interval[] = []
  let carry: Interval | null = null

  for (const interval of raw) {
    const base: Interval = carry ? combine(carry, interval) : interval
    if (base.days < minIntervalDays) {
      carry = base
      continue
    }
    merged.push(base)
    carry = null
  }

  if (carry) {
    if (merged.length > 0) merged[merged.length - 1] = combine(merged[merged.length - 1], carry)
    else merged.push(carry)
  }

  return merged
}

function combine(first: Interval, second: Interval): Interval {
  return {
    from: first.from,
    to: second.to,
    days: first.days + second.days,
    consumption: first.consumption + second.consumption,
    censored: first.censored || second.censored,
    noStock: first.noStock && second.noStock,
    rise: first.rise || second.rise,
    restockedAtStart: first.restockedAtStart + second.restockedAtStart,
    removedAtStart: first.removedAtStart + second.removedAtStart,
    startBalance: first.startBalance,
  }
}

/**
 * Groups intervals into restock cycles: a cycle opens at an interval whose
 * opening visit restocked the SKU and runs until the next such interval. The
 * leading intervals before the first restock (if any) form an opening cycle
 * with no restock of their own.
 */
export function buildCycles(intervals: Interval[]): Cycle[] {
  const cycles: Cycle[] = []
  let current: Cycle | null = null

  for (const interval of intervals) {
    if (current === null || interval.restockedAtStart > 0) {
      if (current) cycles.push(current)
      current = {
        from: interval.from,
        to: interval.to,
        days: 0,
        startBalance: interval.startBalance,
        restocked: 0,
        removed: 0,
        consumption: 0,
        censored: false,
        intervals: 0,
      }
    }

    current.to = interval.to
    current.days += interval.days
    current.restocked += interval.restockedAtStart
    current.removed += interval.removedAtStart
    current.consumption += interval.consumption
    current.censored = current.censored || interval.censored
    current.intervals++
  }

  if (current) cycles.push(current)
  return cycles
}

/** Restock events: the visits at which the SKU was actually restocked. */
export function restockEvents(visits: VisitPoint[]): Date[] {
  return sortVisits(visits)
    .filter(visit => visit.restocked > 0)
    .map(visit => visit.endedAt)
}

export type { Parameters }
