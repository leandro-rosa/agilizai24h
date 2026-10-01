import type { Parameters } from '../parameters/parameters.types'

/**
 * Contracts of the Product x Store engine. Everything the engine receives and
 * returns is a plain value: it reads no database and no clock (the reference
 * date is an input), so the same input + engine version + parameter version
 * always yields the same result.
 */

/** One SKU's reading at one supply visit of one store, as the report stated it. */
export interface VisitPoint {
  endedAt: Date
  balanceBefore: number
  /** The count made BEFORE restocking; null = not counted (never zero). */
  confirmedCount: number | null
  restocked: number
  /** Signed, zero or negative (the report's `Remoções`). */
  removedTotal: number
  adjustment: number
  balanceAfter: number
}

export type LossReason = 'expired' | 'damaged_product' | 'other_reason'
export type NonLossReason = 'return' | 'transfer' | 'internal_use'
export type NonLossReasonKey = NonLossReason

/** Monthly facts of one Product x Store (sales and removals are only known per month). */
export interface MonthlyFacts {
  month: string
  /** True when sales were imported for the store and month; false = a gap, never "zero sold". */
  salesPresent: boolean
  sold: number
  revenueCents: number
  /** Units removed per reason (positive numbers). */
  removals: Partial<Record<LossReason | NonLossReason, number>>
  restocked: number
}

export interface NetworkEvidence {
  /** Stores where the SKU was exposed for at least the minimum cycles. */
  exposedStores: number
  /** Of those, how many show the store-level removal pattern. */
  storesWithRemovalPattern: number
  /** Stores with damaged-product loss for the SKU in the recent months. */
  storesWithDamage: number
}

export interface PairInput {
  storeId: number
  sku: string
  /** Chronological; the engine sorts defensively but never reads past `asOf`. */
  visits: VisitPoint[]
  monthly: MonthlyFacts[]
  /** The baseline quantity in force, or null when none is recorded. */
  baseline: number | null
  /** True when the baseline is the baseline of record because no history reaches the origin. */
  baselineIsOfRecord: boolean
  /** Unit cost in cents (one current version), or null when unresolved — never zero. */
  costCents: number | null
  /** Units per package when known; mostly unknown today. */
  unitsPerPackage: number | null
  /** Months of the audited range in which the store has no imported sales. */
  salesMonthsMissing: string[]
  /** The SKU was rejected at ingestion for this store's reports. */
  rejectedAtIngestion: boolean
  /** Conflicting baseline values were found for this SKU at import. */
  baselineConflict: boolean
  /** Owner override of the replenishment interval, in days. */
  plannedRefillIntervalDays: number | null
  network: NetworkEvidence | null
  asOf: Date
  parameters: Parameters
}

export const DAY_MS = 86_400_000
