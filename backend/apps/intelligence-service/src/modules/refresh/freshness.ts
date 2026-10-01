import type { MonthAvailability } from './availability'
import { monthDistance } from './months'

export type FreshnessStatus = 'up_to_date' | 'out_of_date' | 'not_computed' | 'unknown'

/**
 * The freshness block carried by every result and report: which month it covers,
 * when it was computed, and whether a later month is already available.
 */
export interface Freshness {
  /** The last closed month the analysis really covers; null when nothing was computed. */
  dataThrough: string | null
  /** When the analysis was computed (ISO); null when nothing was computed. */
  computedAt: string | null
  status: FreshnessStatus
  /** True when a later month is already available; false when up to date; null when nothing was computed to compare. */
  outOfDate: boolean | null
  /** How many months the analysis lags the latest available month; 0 when up to date. */
  monthsLagged: number
  /** The latest month already available in the platform's data (null when none is known after the analysis). */
  latestAvailableMonth: string | null
  /** Why the comparison could not be made (`status: 'unknown'`): the sources could not be read. Never read as "up to date". */
  reason?: string
  /**
   * Months that have ended but are not imported enough yet (with the figures). The analysis does
   * NOT cover them and never claims to; they are why a month may not appear in `latestAvailableMonth`.
   */
  pendingImport: { month: string; importedStores: number; activeStores: number; share: number; requiredShare: number }[]
}

/** The analysis is stated as computed, but whether it is current cannot be said right now. */
export function unknownFreshness(dataThrough: string | null, computedAt: Date | null, reason: string): Freshness {
  return { dataThrough, computedAt: computedAt ? computedAt.toISOString() : null, status: 'unknown', outOfDate: null, monthsLagged: 0, latestAvailableMonth: null, pendingImport: [], reason }
}

export function buildFreshness(input: {
  dataThrough: string | null
  computedAt: Date | null
  /** The latest available month known to the platform, or null when none is later than the analysis. */
  latestAvailable: string | null
  pendingImport: MonthAvailability[]
}): Freshness {
  const pendingImport = input.pendingImport.map(({ month, importedStores, activeStores, share, requiredShare }) => ({ month, importedStores, activeStores, share, requiredShare }))

  if (input.dataThrough === null) {
    return { dataThrough: null, computedAt: null, status: 'not_computed', outOfDate: null, monthsLagged: 0, latestAvailableMonth: input.latestAvailable, pendingImport }
  }

  const lag = input.latestAvailable !== null && input.latestAvailable > input.dataThrough ? monthDistance(input.dataThrough, input.latestAvailable) : 0

  return {
    dataThrough: input.dataThrough,
    computedAt: input.computedAt ? input.computedAt.toISOString() : null,
    status: lag > 0 ? 'out_of_date' : 'up_to_date',
    outOfDate: lag > 0,
    monthsLagged: lag,
    latestAvailableMonth: lag > 0 ? input.latestAvailable : input.dataThrough,
    pendingImport,
  }
}
