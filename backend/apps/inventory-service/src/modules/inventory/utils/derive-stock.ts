/**
 * Movements for one store, one SKU, one period.
 *
 * `removed` is the TOTAL removed, regardless of reason. Every removed unit is
 * off the shelf whether or not it counted as a loss — a returned bottle and an
 * expired one are equally gone. Letting the loss classification leak into the
 * quantity would make stock disagree with reality for every non-loss removal.
 */
export interface PeriodMovements {
  period: string
  restocked: number
  sold: number
  removed: number
}

export interface PeriodStock {
  period: string
  restocked: number
  sold: number
  removed: number
  /** Cumulative through this period: what should be on the shelf at its end. */
  closingStock: number
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
    running += movement.restocked - movement.sold - movement.removed

    return {
      period: movement.period,
      restocked: movement.restocked,
      sold: movement.sold,
      removed: movement.removed,
      // Deliberately NOT clamped at zero. A negative balance means the movement
      // data is wrong — sales or removals were recorded without the matching
      // restock — and clamping hides exactly the inconsistency that needs
      // fixing, while making the figure look plausible.
      closingStock: running,
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
