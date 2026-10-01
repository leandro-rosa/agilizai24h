import type { MonthlyFacts, PairInput } from '../engine/engine.types'
import { buildCycles, buildIntervals, type Cycle, type Interval } from '../engine/intervals'
import { computeEconomics, type Economics } from '../engine/mix'
import { LOSS_REASON_KEYS, type LossReasonKey } from './backtest.types'
import { monthEndedBefore, monthOf } from './history-view'

export interface FollowCycle {
  days: number
  consumption: number
  /** The shelf emptied during the cycle: consumption is a lower bound. */
  censored: boolean
  startBalance: number
  /** Loss units attributed to the cycle — an ESTIMATE (monthly loss spread by the removals recorded at visits). */
  loss: number
}

/** What actually happened to one Product x Store in the period that followed an origin. */
export interface FollowFacts {
  periodStart: string
  periodEnd: string
  months: string[]
  salesMonthsMissing: string[]
  unitsSold: number
  revenueCents: number
  lostByReason: Record<LossReasonKey, number>
  lostUnits: number
  restockedUnits: number
  /** Margin minus the cost of units lost — loss counted once, never netted against sold units. One current cost version. */
  economics: Economics
  /** Intervals between visits that ended in the period (including the one that straddles the origin). */
  intervals: Interval[]
  cycles: FollowCycle[]
  /** Censored intervals: shelf emptied before a visit. */
  stockouts: number
  /** Consumption over days of intervals that carry information about demand (censored ones are lower bounds). */
  observedRate: number | null
  /** How the monthly loss was placed in cycles. */
  lossAllocation: 'proportional_to_visit_removals' | 'monthly_total_in_first_cycle' | 'none'
}

/** Months of the following period: from the origin's month up to, not including, the next origin's month (or through `lastMonth`). */
export function followingMonths(origin: Date, nextOrigin: Date | null, lastMonth: string): string[] {
  const months: string[] = []
  let [year, month] = monthOf(origin).split('-').map(Number)

  for (;;) {
    const label = `${year}-${String(month).padStart(2, '0')}`
    const reached = nextOrigin ? monthEndedBefore(label, nextOrigin) === false : label > lastMonth
    if (reached) break
    months.push(label)
    month++
    if (month > 12) {
      month = 1
      year++
    }
  }

  return months
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

/**
 * Spreads the period's loss over the cycles in proportion to the removals the
 * visits recorded in each (the monthly figures are the only source split by
 * reason, the visits the only source with dates). When the visits recorded no
 * removal the monthly total is put in the first cycle, and says so.
 */
export function allocateLoss(removedByCycle: number[], lostUnits: number): { loss: number[]; how: FollowFacts['lossAllocation'] } {
  if (removedByCycle.length === 0 || lostUnits <= 0) return { loss: removedByCycle.map(() => 0), how: 'none' }

  const weights = removedByCycle.map(removed => Math.abs(removed))
  const total = sum(weights)

  if (total === 0) return { loss: removedByCycle.map((_, i) => (i === 0 ? lostUnits : 0)), how: 'monthly_total_in_first_cycle' }

  return { loss: weights.map(weight => (lostUnits * weight) / total), how: 'proportional_to_visit_removals' }
}

/**
 * What followed an origin for one Product x Store. Reads the FULL history on
 * purpose (it is the future of the origin) and is only ever used to evaluate —
 * never to feed the engine. `periodEnd` is the last instant of the period.
 */
export function followingFacts(full: PairInput, origin: Date, periodEnd: Date, months: string[]): FollowFacts {
  const monthly: MonthlyFacts[] = full.monthly.filter(month => months.includes(month.month))
  const economics = computeEconomics(monthly, full.costCents)

  const lostByReason = Object.fromEntries(LOSS_REASON_KEYS.map(reason => [reason, sum(monthly.map(month => month.removals[reason] ?? 0))])) as Record<LossReasonKey, number>
  const lostUnits = sum(Object.values(lostByReason))

  const visits = full.visits.filter(visit => visit.endedAt.getTime() <= periodEnd.getTime())
  const intervals = buildIntervals(visits, full.parameters.demand.minIntervalDays).filter(interval => interval.to.getTime() >= origin.getTime())
  const cycles: Cycle[] = buildCycles(intervals)

  const allocated = allocateLoss(
    cycles.map(cycle => cycle.removed),
    lostUnits,
  )

  const informative = intervals.filter(interval => !interval.noStock && !interval.rise && interval.days > 0)
  const informativeDays = sum(informative.map(interval => interval.days))

  return {
    periodStart: origin.toISOString(),
    periodEnd: periodEnd.toISOString(),
    months,
    salesMonthsMissing: monthly.filter(month => !month.salesPresent).map(month => month.month),
    unitsSold: economics.unitsSold,
    revenueCents: economics.revenueCents,
    lostByReason,
    lostUnits,
    restockedUnits: sum(monthly.map(month => month.restocked)),
    economics,
    intervals,
    cycles: cycles.map((cycle, i) => ({ days: cycle.days, consumption: cycle.consumption, censored: cycle.censored, startBalance: cycle.startBalance, loss: allocated.loss[i] })),
    stockouts: intervals.filter(interval => interval.censored).length,
    observedRate: informativeDays > 0 ? sum(informative.map(interval => interval.consumption)) / informativeDays : null,
    lossAllocation: allocated.how,
  }
}
