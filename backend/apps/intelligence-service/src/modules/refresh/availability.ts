import { monthEnded } from './months'

/** What the platform holds for one active store in one month. */
export interface StoreMonthPresence {
  supplyPresent: boolean
  salesPresent: boolean
}

/** The evidence for one calendar month across the active stores. */
export interface MonthEvidence {
  month: string
  /** Presence for every active store (a store with no data at all is `false`/`false`, never left out). */
  stores: StoreMonthPresence[]
}

export interface MonthAvailability {
  month: string
  ended: boolean
  activeStores: number
  /** Stores with supply AND sales both imported for the month. */
  importedStores: number
  /** `importedStores / activeStores`; 0 with no active store. */
  share: number
  requiredShare: number
  available: boolean
}

/**
 * Availability of ONE month: it must have ended before the reference instant AND
 * supply and sales must both be imported for at least `requiredShare` of the
 * active stores. A month with no active stores is never available.
 */
export function monthAvailability(evidence: MonthEvidence, requiredShare: number, asOf: Date): MonthAvailability {
  const activeStores = evidence.stores.length
  const importedStores = evidence.stores.filter(store => store.supplyPresent && store.salesPresent).length
  const share = activeStores === 0 ? 0 : importedStores / activeStores
  const ended = monthEnded(evidence.month, asOf)

  return { month: evidence.month, ended, activeStores, importedStores, share, requiredShare, available: ended && activeStores > 0 && share >= requiredShare }
}

export interface AvailabilitySummary {
  /** The latest available month; null when none is. */
  dataThrough: string | null
  /**
   * Months that have ended after `dataThrough` but are not available yet, with the
   * figures that say why. Never counted as covered by anything.
   */
  pendingImport: MonthAvailability[]
}

/**
 * The latest available month among `months`, and the ended-but-not-available
 * months after it. `months` may be given in any order.
 */
export function summarizeAvailability(months: MonthEvidence[], requiredShare: number, asOf: Date): AvailabilitySummary {
  const evaluated = months.map(evidence => monthAvailability(evidence, requiredShare, asOf)).sort((a, b) => a.month.localeCompare(b.month))
  const dataThrough = [...evaluated].reverse().find(month => month.available)?.month ?? null

  return {
    dataThrough,
    pendingImport: evaluated.filter(month => month.ended && !month.available && (dataThrough === null || month.month > dataThrough)),
  }
}
