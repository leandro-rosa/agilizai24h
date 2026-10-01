/**
 * Every number that shapes a recommendation. Backend-owned and versioned
 * (design D11): nothing here is fixed in the browser, and every default is a
 * PROVISIONAL starting value for the backtest to question — except the two the
 * owner specified himself (tolerance percentage and units).
 */
export interface Parameters {
  tolerance: {
    /** Fraction of the system balance (0.10 = 10%). */
    pct: number
    /** Units. A difference is acceptable when within the LARGER of the two limits. */
    units: number
    /** How many of the most recent counts of a Product x Store are considered. */
    windowCounts: number
    /** Counts needed before the balance can be verified at all. */
    minCounts: number
    /** Oldest acceptable last count, in days, relative to the run's as-of date. */
    maxAgeDays: number
  }
  demand: {
    halfLifeDays: number
    minIntervalDays: number
    censoredShareFlag: number
    recentIntervals: number
  }
  pattern: {
    newCycles: number
    minObservations: number
    tauThreshold: number
    volatileCv: number
  }
  quantity: {
    leadDays: number
    safetyZ: number
    recentRestocks: number
    censoredShareIncrease: number
    lossLowShare: number
  }
  mix: {
    minExposureCycles: number
    lowDemandPerWeek: number
    lowRecurrenceShare: number
    noRecentRestockFactor: number
    networkMajorityShare: number
  }
  alerts: {
    expiredMonthsOfThree: number
    damagedMonthsOfThree: number
    otherReasonShareOfRestocked: number
  }
  confidence: {
    highIntervals: number
    mediumIntervals: number
  }
  backtest: {
    minFollowingCycles: number
    salesAtRiskShare: number
  }
  refresh: {
    /** Share of active stores that must have supply AND sales imported for a month to count as available. */
    availableStoreShare: number
  }
  schedule: {
    /** ISO weekdays, 1 = Monday … 7 = Sunday. Default: Monday, Tuesday, Thursday, Friday. */
    visitWeekdays: number[]
  }
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends number[] ? number[] : T[K] extends object ? DeepPartial<T[K]> : T[K] }
