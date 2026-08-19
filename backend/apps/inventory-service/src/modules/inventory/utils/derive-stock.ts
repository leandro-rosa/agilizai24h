/**
 * Movements for one store, one SKU, one period.
 *
 * `removed` is the TOTAL removed, regardless of reason. Every removed unit is
 * off the shelf whether or not it counted as a loss — a returned bottle and an
 * expired one are equally gone. Letting the loss classification leak into the
 * quantity would make stock disagree with reality for every non-loss removal.
 *
 * `adjustment` is the net inventory adjustment — signed, inbound units minus
 * outbound. It moves stock exactly like a restock or a removal does; it is
 * only kept as its own term, rather than folded into `restocked`, because
 * `finance-service` needs to value it separately (design D4/D6).
 *
 * `recordedClosingBalance` is the operators' own reading for this period, when
 * supply-service has one — a cross-check, never a second source of truth
 * (design D5).
 */
export interface PeriodMovements {
  period: string
  restocked: number
  sold: number
  removed: number
  adjustment: number
  recordedClosingBalance: number | null
}

export interface PeriodStock {
  period: string
  restocked: number
  sold: number
  removed: number
  adjustment: number
  /** Cumulative through this period: what should be on the shelf at its end. */
  closingStock: number
  /**
   * The operators' own reading for this period, carried through unchanged —
   * stored for visibility, never compared against `closingStock`. It is a
   * reading taken at the moment of a specific restocking visit, not a
   * month-end figure, and the sales report carries no per-sale date to tell
   * what sold before or after that visit — comparing it to a whole month's
   * derived total flagged most SKUs in a real store-month as disagreeing
   * with nothing actually wrong behind any of them (design D5, reversed).
   */
  recordedClosingBalance: number | null
}

/**
 * Builds the closing stock for each period, carrying the balance forward.
 *
 * Pure, so the properties that matter — a past period never changing when a
 * later one gains movements, and a negative balance surviving rather than being
 * clamped — are testable without any I/O.
 *
 * Periods are sorted lexicographically, which is chronological for YYYY-MM.
 */
export function deriveStockSeries(movements: PeriodMovements[], opening = 0): PeriodStock[] {
  const ordered = [...movements].sort((a, b) => a.period.localeCompare(b.period))

  // `opening` is the balance carried in from before the first period here, so a
  // rebuild can start mid-history instead of re-deriving everything.
  let running = opening

  return ordered.map(movement => {
    running += movement.restocked - movement.sold - movement.removed + movement.adjustment

    return {
      period: movement.period,
      restocked: movement.restocked,
      sold: movement.sold,
      removed: movement.removed,
      adjustment: movement.adjustment,
      // Deliberately NOT clamped at zero. A negative balance means the movement
      // data is wrong — sales or removals were recorded without the matching
      // restock — and clamping hides exactly the inconsistency that needs
      // fixing, while making the figure look plausible.
      closingStock: running,
      recordedClosingBalance: movement.recordedClosingBalance,
    }
  })
}

/** The closing stock at or before `asOf`, or null when nothing is known by then. */
export function closingStockAsOf(series: PeriodStock[], asOf: string): PeriodStock | null {
  let chosen: PeriodStock | null = null

  for (const entry of series) {
    if (entry.period.localeCompare(asOf) <= 0) {
      if (!chosen || entry.period.localeCompare(chosen.period) > 0) chosen = entry
    }
  }

  return chosen
}
