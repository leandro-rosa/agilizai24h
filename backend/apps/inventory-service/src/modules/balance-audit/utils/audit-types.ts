/**
 * The audit's inputs and outputs. Everything here is a plain value: the audit
 * is a set of pure functions over visits and registered sales, so it can be
 * tested without a database or a network and recomputed whenever new data
 * arrives (September's reports land after this is written).
 *
 * Nothing in the OUTPUT types is a verdict. There is no tolerance, no
 * pass/fail, no "acceptable": the business has not decided what divergence is
 * acceptable and will only do so after seeing these distributions
 * (add-stock-quality-phase0, "The audit sets no tolerance"). A test walks the
 * whole response and fails on any key that reads like one.
 */

export interface AuditVisitLine {
  sku: string
  balanceBefore: number
  /** The count made BEFORE restocking; null = not counted — never zero. */
  confirmedCount: number | null
  restocked: number
  balanceAfter: number
  /** The report's capacity cell; null when empty. Zero means "not set" in the real export. */
  capacity: number | null
}

export interface AuditVisit {
  storeId: number
  /** Naive instants from the report, read as UTC throughout so months are stable. */
  endedAt: Date
  lines: AuditVisitLine[]
}

/** Registered sales for one store, one month. `present` is false when the month was never imported. */
export interface StoreMonthSales {
  storeId: number
  month: string
  present: boolean
  bySku: Map<string, number>
}

/**
 * Bands are PRESENTATION parameters: they slice the distributions so a reader
 * can see whether the divergence depends on how fast a SKU turns, and they are
 * returned in the response so the browser never owns them. They are
 * provisional and carry no meaning as a threshold.
 */
export interface AuditBands {
  /** Monthly units sold at the store, lower bound of each named band. */
  turnover: { highMin: number; mediumMin: number }
  /** Upper bounds (inclusive) of the balance bands; anything above the last is the open band. */
  balanceUpperBounds: number[]
}

/** 'unknown' = the store has no imported sales month in the audited range, so turnover cannot be stated. */
export type TurnoverBand = 'high' | 'medium' | 'low' | 'no_sales' | 'unknown'

export interface Distribution {
  /** How many observations this distribution covers — shown next to every figure. */
  lines: number
  share_zero: number | null
  /** Bins of the absolute difference in units. */
  absolute_bins: { label: string; lines: number }[]
  /** Bins of the difference relative to its base; observations with a zero base are counted apart. */
  relative_bins: { label: string; lines: number }[]
  relative_undefined: number
  quantiles: { p50: number; p90: number; p95: number; p99: number; max: number } | null
}
