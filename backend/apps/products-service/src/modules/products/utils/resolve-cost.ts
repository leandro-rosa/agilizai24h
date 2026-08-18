export interface DatedCost {
  effective_from: Date
  cost_cents: number
}

/**
 * Picks the cost in effect on `asOf`: the latest version whose effective date
 * is on or before it.
 *
 * Returns null when `asOf` precedes every known version. It deliberately does
 * NOT fall back to the earliest cost — inventing a price for a period that has
 * none understates nothing visibly, it just produces a wrong number.
 *
 * Pure, so the boundary conditions (exactly on an effective date, one day
 * before, one day after) are unit-testable without a database.
 */
export function resolveCostAsOf(versions: DatedCost[], asOf: Date): DatedCost | null {
  let chosen: DatedCost | null = null

  for (const version of versions) {
    if (version.effective_from.getTime() <= asOf.getTime()) {
      if (!chosen || version.effective_from.getTime() > chosen.effective_from.getTime()) {
        chosen = version
      }
    }
  }

  return chosen
}
