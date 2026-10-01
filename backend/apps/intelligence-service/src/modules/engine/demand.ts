import type { Parameters } from '../parameters/parameters.types'
import { DAY_MS } from './engine.types'
import type { Interval } from './intervals'

export interface DemandEstimate {
  /** Daily rates, weighted by days and by recency. All null when there is no uncensored observation. */
  rateLow: number | null
  rateMid: number | null
  rateHigh: number | null
  /** Weighted standard deviation of the rates, for the safety term. */
  rateStd: number | null
  /** Uncensored observations used. */
  observations: number
  /** Share of the recent informative intervals that ended in a stock-out. */
  censoredShare: number
  /** True when that share exceeds the parameter: the demand is a lower bound of what it could have been. */
  demandCensored: boolean
  /** The highest rate seen in a censored interval (a lower bound), when any. */
  censoredLowerBoundRate: number | null
}

interface Observation {
  rate: number
  weight: number
}

/** Smallest rate whose cumulative weight reaches `q` of the total. Deterministic; no interpolation. */
export function weightedQuantile(observations: Observation[], q: number): number | null {
  if (observations.length === 0) return null

  const sorted = [...observations].sort((a, b) => a.rate - b.rate)
  const total = sorted.reduce((sum, item) => sum + item.weight, 0)
  let cumulative = 0

  for (const item of sorted) {
    cumulative += item.weight
    if (cumulative >= q * total - 1e-12) return item.rate
  }

  return sorted[sorted.length - 1].rate
}

export function weightedStd(observations: Observation[]): number | null {
  if (observations.length === 0) return null

  const total = observations.reduce((sum, item) => sum + item.weight, 0)
  const mean = observations.reduce((sum, item) => sum + item.rate * item.weight, 0) / total
  const variance = observations.reduce((sum, item) => sum + item.weight * (item.rate - mean) ** 2, 0) / total

  return Math.sqrt(variance)
}

/**
 * Daily demand from the UNCENSORED intervals only, each weighted by its length
 * and by how recent it is (exponential, half-life in days), so a SKU that fell
 * 70% in the latest cycles is estimated lower than one that stayed flat at the
 * same mean. Censored intervals are never demand: they raise `rateHigh` only,
 * through their lower bound, which is what lets a stock-out become evidence for
 * more quantity. A plain mean of monthly sales is never used.
 */
export function estimateDemand(intervals: Interval[], asOf: Date, p: Parameters['demand']): DemandEstimate {
  const informative = intervals.filter(interval => !interval.noStock && !interval.rise && interval.days > 0)

  const uncensored: Observation[] = informative
    .filter(interval => !interval.censored)
    .map(interval => {
      const ageDays = Math.max(0, (asOf.getTime() - interval.to.getTime()) / DAY_MS)
      return { rate: interval.consumption / interval.days, weight: interval.days * 0.5 ** (ageDays / p.halfLifeDays) }
    })

  const recent = informative.slice(-p.recentIntervals)
  const censoredShare = recent.length === 0 ? 0 : recent.filter(interval => interval.censored).length / recent.length
  const demandCensored = censoredShare > p.censoredShareFlag

  const lowerBounds = recent.filter(interval => interval.censored).map(interval => interval.consumption / interval.days)
  const censoredLowerBoundRate = lowerBounds.length > 0 ? Math.max(...lowerBounds) : null

  const rateHigh = weightedQuantile(uncensored, 0.8)

  return {
    rateLow: weightedQuantile(uncensored, 0.25),
    rateMid: weightedQuantile(uncensored, 0.5),
    // A stock-out proves demand AT LEAST the lower bound, so the upper rate never sits below it.
    rateHigh: rateHigh === null ? null : demandCensored && censoredLowerBoundRate !== null ? Math.max(rateHigh, censoredLowerBoundRate) : rateHigh,
    rateStd: weightedStd(uncensored),
    observations: uncensored.length,
    censoredShare,
    demandCensored,
    censoredLowerBoundRate,
  }
}
