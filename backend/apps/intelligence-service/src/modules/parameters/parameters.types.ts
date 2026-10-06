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
    /** Contribution after losses at or below this share of revenue counts as "low" (0.05 = 5%). */
    lowContributionShare: number
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
  priority: {
    /** Priority is in R$ (excess stock at cost + recurring loss cost), independent of both confidences. */
    highCents: number
    mediumCents: number
  }
  backtest: {
    minFollowingCycles: number
    salesAtRiskShare: number
  }
  refresh: {
    /** Share of active stores that must have supply AND sales imported for a month to count as available. */
    availableStoreShare: number
  }
  /** Supplier / product analysis (add-supplier-product-analysis). All provisional until calibrated on real distributions. */
  analysis: {
    /** Sold ÷ restocked at or above this is "Bom" (0.6 = 60%). */
    goodSellThrough: number
    /** Sold ÷ restocked below this is "Crítico". Between the two is "Atenção". */
    criticalSellThrough: number
    /** Lost ÷ restocked at or above this share lifts a store/product to at least "Atenção". */
    attentionLossShare: number
    /** A loss rate counts as above the network's when it exceeds the network rate times this factor (1.25 = 25% higher). */
    lossAboveNetworkFactor: number
    /** Units restocked below which a store/product gets no situation: too little evidence to rate. */
    minRestockedForSituation: number
    /** A variation within ± this share counts as stable, not a rise or fall (0.05 = 5%). */
    stableVariationShare: number
    /** One product weighing at least this share of a supplier's revenue is called out as concentration. */
    concentrationShare: number
  }
  schedule: {
    /** ISO weekdays, 1 = Monday … 7 = Sunday. Default: Monday, Tuesday, Thursday, Friday. */
    visitWeekdays: number[]
  }
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends number[] ? number[] : T[K] extends object ? DeepPartial<T[K]> : T[K] }
