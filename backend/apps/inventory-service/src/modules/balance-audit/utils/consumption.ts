import type { AuditVisit } from './audit-types'
import { monthKey, monthStart, nextMonth } from './months'

/** One SKU's reading at one visit, ordered along the store's chain. */
interface Reading {
  endedAt: Date
  balanceBefore: number
  balanceAfter: number
}

/** Consumption between two consecutive readings of the same SKU at the same store. */
export interface ConsumptionPair {
  storeId: number
  sku: string
  from: Date
  to: Date
  /** `balanceAfter(k) − balanceBefore(k+1)`. Negative means the balance ROSE without a recorded event. */
  consumption: number
}

export interface SkuChain {
  storeId: number
  sku: string
  firstEnd: Date
  lastEnd: Date
  pairs: ConsumptionPair[]
}

/**
 * Follows each SKU along a store's visits and pairs consecutive readings.
 *
 * Consecutive means consecutive APPEARANCES of the SKU, not consecutive visits:
 * a visit that did not list the SKU recorded no restock, removal or count for
 * it, so the stretch across it is still one interval of sales only.
 *
 * `consumption` keeps its sign. A negative value is a balance that rose with no
 * event (0.14% of the real pairs); the caller reports those apart and never
 * feeds them into a distribution as negative consumption.
 */
export function buildChains(visits: AuditVisit[]): SkuChain[] {
  const readings = new Map<string, { storeId: number; sku: string; list: Reading[] }>()

  for (const visit of [...visits].sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime())) {
    for (const line of visit.lines) {
      const key = `${visit.storeId}|${line.sku}`
      if (!readings.has(key)) readings.set(key, { storeId: visit.storeId, sku: line.sku, list: [] })
      readings.get(key)!.list.push({ endedAt: visit.endedAt, balanceBefore: line.balanceBefore, balanceAfter: line.balanceAfter })
    }
  }

  return [...readings.values()]
    .filter(entry => entry.list.length >= 2)
    .map(entry => {
      const pairs: ConsumptionPair[] = []

      for (let i = 0; i + 1 < entry.list.length; i++) {
        const current = entry.list[i]
        const next = entry.list[i + 1]
        pairs.push({
          storeId: entry.storeId,
          sku: entry.sku,
          from: current.endedAt,
          to: next.endedAt,
          consumption: current.balanceAfter - next.balanceBefore,
        })
      }

      return {
        storeId: entry.storeId,
        sku: entry.sku,
        firstEnd: entry.list[0].endedAt,
        lastEnd: entry.list[entry.list.length - 1].endedAt,
        pairs,
      }
    })
}

/**
 * Splits a pair's consumption over the calendar months its interval touches, in
 * proportion to the time the interval spends in each — a fractional-day
 * allocation, so a 10-unit interval running 3 days in March and 7 in April gives
 * March 3 and April 7.
 *
 * A zero-length interval (two visits ending at the same instant) cannot be
 * apportioned, so it lands entirely in the month of that instant.
 */
export function prorateByMonth(pair: Pick<ConsumptionPair, 'from' | 'to' | 'consumption'>): Map<string, number> {
  const result = new Map<string, number>()
  const start = pair.from.getTime()
  const end = pair.to.getTime()

  if (end <= start) {
    result.set(monthKey(pair.from), pair.consumption)
    return result
  }

  let month = monthKey(pair.from)
  const lastMonth = monthKey(pair.to)

  for (;;) {
    const overlapStart = Math.max(start, monthStart(month).getTime())
    const overlapEnd = Math.min(end, monthStart(nextMonth(month)).getTime())
    const overlap = Math.max(0, overlapEnd - overlapStart)

    if (overlap > 0) result.set(month, (pair.consumption * overlap) / (end - start))
    if (month === lastMonth) break
    month = nextMonth(month)
  }

  return result
}

/**
 * Months wholly inside a chain's span — the first reading is at or before the
 * month's start and the last at or after the next month's start. A month the
 * chain only partly covers is left out: comparing a part of the month's
 * consumption with the whole month's sales would manufacture a difference.
 */
export function fullyCoveredMonths(chain: Pick<SkuChain, 'firstEnd' | 'lastEnd'>, from: string, to: string): string[] {
  const months: string[] = []

  for (let month = from; month <= to; month = nextMonth(month)) {
    if (chain.firstEnd.getTime() <= monthStart(month).getTime() && chain.lastEnd.getTime() >= monthStart(nextMonth(month)).getTime()) {
      months.push(month)
    }
  }

  return months
}
