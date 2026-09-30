import type { Distribution } from './audit-types'

const ABSOLUTE_EDGES = [0, 1, 2, 5, 10]
const RELATIVE_EDGES = [0, 0.05, 0.1, 0.25, 0.5]

/** Bin labels for the absolute difference in units: exactly 0, then up to each edge, then beyond the last. */
export const ABSOLUTE_BIN_LABELS = ['0', '≤1', '≤2', '≤5', '≤10', '>10']
export const RELATIVE_BIN_LABELS = ['0', '≤5%', '≤10%', '≤25%', '≤50%', '>50%']

function binIndex(value: number, edges: number[]): number {
  if (value === 0) return 0
  for (let i = 1; i < edges.length; i++) if (value <= edges[i]) return i
  return edges.length
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

export interface Observation {
  /** Signed difference in units; only its magnitude is distributed. */
  difference: number
  /** What the difference is relative to (the system balance, or the registered sales). */
  base: number
}

/**
 * Turns observations into a distribution. Descriptive only: the bins are fixed
 * presentation cut points, not a tolerance, and nothing here says whether a
 * number is good or bad.
 */
export function distributionOf(observations: Observation[]): Distribution {
  const absolute = observations.map(o => Math.abs(o.difference))
  const sorted = [...absolute].sort((a, b) => a - b)

  const absoluteCounts = new Array(ABSOLUTE_BIN_LABELS.length).fill(0)
  const relativeCounts = new Array(RELATIVE_BIN_LABELS.length).fill(0)
  let relativeUndefined = 0

  for (const observation of observations) {
    const magnitude = Math.abs(observation.difference)
    absoluteCounts[binIndex(magnitude, ABSOLUTE_EDGES)]++

    if (observation.base > 0) relativeCounts[binIndex(magnitude / observation.base, RELATIVE_EDGES)]++
    else if (magnitude === 0) relativeCounts[0]++
    else relativeUndefined++
  }

  return {
    lines: observations.length,
    share_zero: observations.length === 0 ? null : absoluteCounts[0] / observations.length,
    absolute_bins: ABSOLUTE_BIN_LABELS.map((label, i) => ({ label, lines: absoluteCounts[i] })),
    relative_bins: RELATIVE_BIN_LABELS.map((label, i) => ({ label, lines: relativeCounts[i] })),
    relative_undefined: relativeUndefined,
    quantiles:
      sorted.length === 0
        ? null
        : {
            p50: quantile(sorted, 0.5),
            p90: quantile(sorted, 0.9),
            p95: quantile(sorted, 0.95),
            p99: quantile(sorted, 0.99),
            max: sorted[sorted.length - 1],
          },
  }
}
