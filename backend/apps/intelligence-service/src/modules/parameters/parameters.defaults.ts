import type { Parameters } from './parameters.types'

export const DEFAULT_PARAMETERS: Parameters = {
  tolerance: { pct: 0.1, units: 3, windowCounts: 3, minCounts: 1, maxAgeDays: 45 },
  demand: { halfLifeDays: 56, minIntervalDays: 1, censoredShareFlag: 0.3, recentIntervals: 6 },
  pattern: { newCycles: 2, minObservations: 3, tauThreshold: 0.6, volatileCv: 0.5 },
  quantity: { leadDays: 2, safetyZ: 1, recentRestocks: 8, censoredShareIncrease: 0.25, lossLowShare: 0.1 },
  mix: { minExposureCycles: 4, lowDemandPerWeek: 1, lowRecurrenceShare: 0.7, noRecentRestockFactor: 3, networkMajorityShare: 0.5, lowContributionShare: 0.05 },
  alerts: { expiredMonthsOfThree: 2, damagedMonthsOfThree: 2, otherReasonShareOfRestocked: 0.15 },
  confidence: { highIntervals: 8, mediumIntervals: 4 },
  priority: { highCents: 30000, mediumCents: 10000 },
  backtest: { minFollowingCycles: 2, salesAtRiskShare: 0.1 },
  refresh: { availableStoreShare: 0.9 },
  analysis: {
    goodSellThrough: 0.6,
    criticalSellThrough: 0.2,
    attentionLossShare: 0.15,
    lossAboveNetworkFactor: 1.25,
    minRestockedForSituation: 10,
    stableVariationShare: 0.05,
    concentrationShare: 0.4,
  },
  schedule: { visitWeekdays: [1, 2, 4, 5] },
}

/**
 * Which parameters are provisional. Everything is, EXCEPT the tolerance
 * percentage and units, which the owner specified (2026-09-30). The count rules
 * (windowCounts, minCounts, maxAgeDays) stay provisional until the owner has
 * read the sensitivity report on real coverage; no combination is chosen
 * before that.
 */
const NOT_PROVISIONAL = new Set(['tolerance.pct', 'tolerance.units', 'schedule.visitWeekdays'])

export function isProvisional(path: string): boolean {
  return !NOT_PROVISIONAL.has(path)
}

/** Flat list of every parameter path with its provisional label, for the read endpoint. */
export function parameterMeta(parameters: Parameters): { path: string; value: unknown; provisional: boolean }[] {
  const rows: { path: string; value: unknown; provisional: boolean }[] = []

  for (const [group, entries] of Object.entries(parameters)) {
    for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
      const path = `${group}.${key}`
      rows.push({ path, value, provisional: isProvisional(path) })
    }
  }

  return rows
}
