import type { ResolvedCost, UnresolvedCost } from '@app/products-contracts'

/** Quantities for one SKU in one store-month, as the owning services report them. */
export interface SkuQuantities {
  sku: string
  restocked: number
  sold: number
  /** Remaining stock at period end, from inventory-service. */
  remaining: number
  /**
   * inventory-service's own verdict on this balance. It reports a negative
   * balance rather than zeroing it, precisely so the inconsistency stays
   * visible — dropping the flag here would put it back out of sight.
   */
  stockInconsistent?: boolean
  /**
   * Net inventory adjustment for the period — signed, inbound minus outbound.
   * Mixes deliberate transfers, self-checkout mismatches and data-entry
   * error, indistinguishable from the data alone (design D4/D6). Valued at
   * current cost, in this period only — never traced to an origin store or
   * month, and never folded into restocked value or loss.
   */
  adjustment: number
  /** Removals that count as loss, per reason. Non-loss reasons are absent. */
  lossByReason: { reason: string; quantity: number }[]
}

export interface ValuedLine {
  sku: string
  cost_cents: number
  restocked_value_cents: number
  cogs_cents: number
  remaining_value_cents: number
  loss_value_cents: number
  loss_quantity: number
  /** Net adjustment quantity — signed. */
  adjustment_quantity: number
  /** The adjustment valued at this line's cost — the unclassified stock adjustment figure's own contribution. */
  adjustment_value_cents: number
}

export interface UnvaluedLine {
  sku: string
  reason: string
  /** Kept so an operator can see what was left out, not just that something was. */
  restocked: number
  sold: number
  remaining: number
  loss_quantity: number
}

export interface Reconciliation {
  restocked_value_cents: number
  cogs_cents: number
  remaining_value_cents: number
  loss_value_cents: number
  loss_quantity: number
  /**
   * The unclassified stock adjustment, valued at current cost, in this period
   * only — never an origin-store trace (design D6). Separate from the four
   * core figures because two of the field's three real causes — a
   * self-checkout mismatch, a data-entry error — are not economically
   * neutral, and folding it into restocked value would restate money the
   * network did not spend a second time.
   */
  unclassified_stock_adjustment_value_cents: number
  loss_by_reason: { reason: string; quantity: number; value_cents: number }[]
  loss_by_sku: { sku: string; quantity: number; value_cents: number }[]
  lines: ValuedLine[]
  unvalued: UnvaluedLine[]
  /**
   * SKUs whose remaining balance inventory-service flagged as inconsistent —
   * a negative stock, meaning a sale or removal was recorded without its
   * restock. Valued anyway, because the figure is real evidence of the data
   * problem, but never presented as a clean month.
   */
  inconsistent_stock: string[]
  /**
   * Every SKU carrying a non-zero adjustment this period, sorted by the size
   * of the adjustment — largest magnitude first. Not a correction mechanism:
   * a growing pattern here is itself the finding worth a manual look (design
   * D6), so this is surfaced rather than silently netted away.
   */
  adjustment_flags: { sku: string; quantity: number; value_cents: number }[]
  /**
   * The one trust flag. False when anything could not be priced, or when a
   * valued balance was inconsistent.
   *
   * Deliberately one flag and not several: a consumer asks a single
   * question — "can I act on this?" — and a second flag is the one that gets
   * forgotten. `unvalued` and `inconsistent_stock` say WHY; this says
   * whether.
   */
  complete: boolean
}

/**
 * Values a store-month.
 *
 * Every arithmetic step is integer: quantity × cost in minor units. These
 * figures are reconciled by hand against the operators' spreadsheet, and a
 * drift of a few centavos across thousands of rows would be small, real, and
 * days of work to explain.
 *
 * An unpriced SKU is NEVER valued at zero. Treating a missing cost as zero
 * understates COGS and understates loss — it makes the numbers look *better*,
 * so nobody questions them. Such SKUs land in `unvalued` and force
 * `complete: false`.
 *
 * Loss comes in already classified by supply-service. This function never
 * decides what counts as loss: a second copy of that rule would diverge, and
 * the copy in the reporting path is the one people would trust.
 */
export function reconcile(
  quantities: SkuQuantities[],
  resolved: ResolvedCost[],
  unresolved: UnresolvedCost[],
): Reconciliation {
  const costBySku = new Map(resolved.map(cost => [cost.sku, cost.cost_cents]))
  const unresolvedBySku = new Map(unresolved.map(entry => [entry.sku, entry.reason]))

  const lines: ValuedLine[] = []
  const unvalued: UnvaluedLine[] = []
  const inconsistentStock: string[] = []
  const adjustmentFlags: { sku: string; quantity: number; value_cents: number }[] = []

  const lossByReason = new Map<string, { quantity: number; value_cents: number }>()
  const lossBySku = new Map<string, { quantity: number; value_cents: number }>()

  let restockedValue = 0
  let cogs = 0
  let remainingValue = 0
  let lossValue = 0
  let lossQuantity = 0
  let adjustmentValue = 0

  for (const item of quantities) {
    const lossUnits = item.lossByReason.reduce((sum, entry) => sum + entry.quantity, 0)
    const cost = costBySku.get(item.sku)

    if (cost === undefined) {
      unvalued.push({
        sku: item.sku,
        reason: unresolvedBySku.get(item.sku) ?? 'no_cost_for_date',
        restocked: item.restocked,
        sold: item.sold,
        remaining: item.remaining,
        loss_quantity: lossUnits,
      })
      continue
    }

    const lineLossValue = lossUnits * cost
    const lineAdjustmentValue = item.adjustment * cost

    lines.push({
      sku: item.sku,
      cost_cents: cost,
      restocked_value_cents: item.restocked * cost,
      cogs_cents: item.sold * cost,
      remaining_value_cents: item.remaining * cost,
      loss_value_cents: lineLossValue,
      loss_quantity: lossUnits,
      adjustment_quantity: item.adjustment,
      adjustment_value_cents: lineAdjustmentValue,
    })

    // Flagged, not corrected: a negative balance means a movement is missing
    // upstream, and the only fix is in the movement data. Valuing it silently
    // would produce a plausible-looking figure built on a known-bad input.
    if (item.stockInconsistent) inconsistentStock.push(item.sku)

    if (item.adjustment !== 0) {
      adjustmentFlags.push({ sku: item.sku, quantity: item.adjustment, value_cents: lineAdjustmentValue })
    }

    restockedValue += item.restocked * cost
    cogs += item.sold * cost
    remainingValue += item.remaining * cost
    lossValue += lineLossValue
    lossQuantity += lossUnits
    adjustmentValue += lineAdjustmentValue

    if (lossUnits > 0) {
      lossBySku.set(item.sku, { quantity: lossUnits, value_cents: lineLossValue })
    }

    for (const entry of item.lossByReason) {
      const current = lossByReason.get(entry.reason) ?? { quantity: 0, value_cents: 0 }
      lossByReason.set(entry.reason, {
        quantity: current.quantity + entry.quantity,
        value_cents: current.value_cents + entry.quantity * cost,
      })
    }
  }

  return {
    restocked_value_cents: restockedValue,
    cogs_cents: cogs,
    remaining_value_cents: remainingValue,
    loss_value_cents: lossValue,
    loss_quantity: lossQuantity,
    unclassified_stock_adjustment_value_cents: adjustmentValue,
    loss_by_reason: [...lossByReason.entries()]
      .map(([reason, totals]) => ({ reason, ...totals }))
      .sort((a, b) => a.reason.localeCompare(b.reason)),
    loss_by_sku: [...lossBySku.entries()]
      .map(([sku, totals]) => ({ sku, ...totals }))
      .sort((a, b) => a.sku.localeCompare(b.sku)),
    lines: lines.sort((a, b) => a.sku.localeCompare(b.sku)),
    unvalued: unvalued.sort((a, b) => a.sku.localeCompare(b.sku)),
    inconsistent_stock: inconsistentStock.sort(),
    adjustment_flags: adjustmentFlags.sort((a, b) => Math.abs(b.quantity) - Math.abs(a.quantity)),
    complete: unvalued.length === 0 && inconsistentStock.length === 0,
  }
}

/**
 * The date a month is valued at: its last day.
 *
 * Something has to choose, because products-service deliberately refuses to
 * answer "the current cost" — and leaving each caller to pick is how two
 * screens end up disagreeing. Month-end is chosen over month-start because a
 * cost taking effect mid-month applies to most of that month's activity.
 *
 * The approximation is real: a cost effective on the 20th values the whole
 * month. The input data is monthly, so there is no finer resolution to be had,
 * and the chosen date is recorded on the result rather than left implicit.
 */
export function valuationDateFor(period: string): string {
  const [year, month] = period.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()

  return `${period}-${String(lastDay).padStart(2, '0')}`
}
