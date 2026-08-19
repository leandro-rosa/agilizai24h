/**
 * KPIs computed on top of `finance-service`'s reconciliation figures —
 * never a substitute for them, and never re-deriving loss or cost
 * (`autonomous-retail-cfo` skill: read the ground truth, don't re-derive
 * it). Every formula here matches `.claude/skills/autonomous-retail-cfo/
 * references/retail-kpis.md`.
 *
 * `null` means "not computable" (typically because revenue is zero or
 * unknown for the period) — never coerced to 0, which would read as a real
 * 0% rather than "no basis to compute this."
 */

/** Gross Margin % = (Revenue − COGS) / Revenue. */
export function grossMarginPct(revenueCents: number, cogsCents: number): number | null {
  if (revenueCents <= 0) return null;
  return (revenueCents - cogsCents) / revenueCents;
}

/**
 * Shrinkage reported with both denominators (retail-kpis.md: "always both
 * denominators") — a store can look fine against revenue and alarming
 * against cost if its assortment skews toward cheap, high-volume items.
 */
export function shrinkagePctOfRevenue(lossCents: number, revenueCents: number): number | null {
  if (revenueCents <= 0) return null;
  return lossCents / revenueCents;
}

export function shrinkagePctOfCost(lossCents: number, restockedValueCents: number): number | null {
  if (restockedValueCents <= 0) return null;
  return lossCents / restockedValueCents;
}

export function formatPct(value: number | null, fractionDigits = 1): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(fractionDigits)}%`;
}
