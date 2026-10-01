import type { Parameters } from '../parameters/parameters.types'
import type { Interval } from './intervals'

export type Pattern = 'stable' | 'growing' | 'declining' | 'volatile' | 'new' | 'insufficient'

/** Kendall's tau of a series against time: +1 steadily up, −1 steadily down, near 0 no trend. Ties count zero. */
export function kendallTau(series: number[]): number {
  const n = series.length
  if (n < 2) return 0

  let score = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (series[j] > series[i]) score++
      else if (series[j] < series[i]) score--
    }
  }

  return score / ((n * (n - 1)) / 2)
}

export function coefficientOfVariation(series: number[]): number {
  if (series.length === 0) return 0

  const mean = series.reduce((a, b) => a + b, 0) / series.length
  if (mean === 0) return 0

  const variance = series.reduce((sum, value) => sum + (value - mean) ** 2, 0) / series.length
  return Math.sqrt(variance) / mean
}

/**
 * Classifies a series of rates, oldest first. Order matters: too few points is
 * `insufficient`; a clear trend (|tau| at or above the threshold) is `growing`
 * or `declining`; otherwise high dispersion is `volatile`; else `stable`. A
 * decline of 20 to 4 is a decline, not volatility, because the trend is checked
 * first.
 *
 * The pattern is EVIDENCE: no decision reads it alone.
 */
export function classifySeries(series: number[], p: Parameters['pattern']): Pattern {
  if (series.length < p.minObservations) return 'insufficient'

  const tau = kendallTau(series)
  if (tau >= p.tauThreshold) return 'growing'
  if (tau <= -p.tauThreshold) return 'declining'

  return coefficientOfVariation(series) > p.volatileCv ? 'volatile' : 'stable'
}

/**
 * The pattern of a Product x Store: `new` while it has been restocked no more
 * than `newCycles` times (first appearance is only a proxy for "being tested",
 * since no test flag exists), otherwise the classification of its last
 * `recentIntervals` uncensored interval rates.
 */
export function classifyPattern(intervals: Interval[], restockCount: number, p: Parameters['pattern'], recentIntervals: number): Pattern {
  if (restockCount <= p.newCycles) return 'new'

  const rates = intervals
    .filter(interval => !interval.noStock && !interval.rise && !interval.censored && interval.days > 0)
    .map(interval => interval.consumption / interval.days)
    .slice(-recentIntervals)

  return classifySeries(rates, p)
}
