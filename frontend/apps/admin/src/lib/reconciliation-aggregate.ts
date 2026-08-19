import type { AdjustmentFlag, LossByReason, LossBySku, Reconciliation, UnvaluedSku } from "@/lib/api/finance";
import { monthsInRange, type PeriodRange } from "@/lib/period-range";

/**
 * The summable subset of a reconciliation — a range spans several months,
 * and `valuation_date`/`computed_at`/`inputs_changed_at` don't have a
 * meaningful sum. `complete` here means "every month in the range was both
 * present and complete" — a range is never presented as trustworthy just
 * because the months it *does* have are clean.
 */
export interface ReconciliationTotals {
  restocked_value_cents: number;
  cogs_cents: number;
  remaining_value_cents: number;
  loss_value_cents: number;
  loss_quantity: number;
  unclassified_stock_adjustment_value_cents: number;
  complete: boolean;
  inconsistent_stock: string[];
  unvalued: UnvaluedSku[];
  loss_by_reason: LossByReason[];
  loss_by_sku: LossBySku[];
  adjustment_flags: AdjustmentFlag[];
  monthsWithData: number;
  monthsMissing: string[];
}

/**
 * Sums whatever reconciliations exist within `range` — `series` is a
 * store's *entire* history (finance-service's series endpoint has no
 * period filter), so this both filters to the range and aggregates in one
 * pass, rather than requiring a second network round-trip per range.
 */
export function sumReconciliations(series: Reconciliation[], range: PeriodRange): ReconciliationTotals {
  const months = monthsInRange(range);
  const inRange = series.filter((r) => months.includes(r.period));
  const present = new Set(inRange.map((r) => r.period));
  const monthsMissing = months.filter((m) => !present.has(m));

  const lossByReason = new Map<string, LossByReason>();
  const lossBySku = new Map<string, LossBySku>();
  const adjustmentBySku = new Map<string, AdjustmentFlag>();
  const inconsistentStock = new Set<string>();
  const unvalued: UnvaluedSku[] = [];

  let restocked = 0;
  let cogs = 0;
  let remaining = 0;
  let loss = 0;
  let lossQty = 0;
  let adjustment = 0;
  let allComplete = monthsMissing.length === 0;

  for (const r of inRange) {
    restocked += r.restocked_value_cents;
    cogs += r.cogs_cents;
    remaining += r.remaining_value_cents;
    loss += r.loss_value_cents;
    lossQty += r.loss_quantity;
    adjustment += r.unclassified_stock_adjustment_value_cents;
    allComplete = allComplete && r.complete;

    for (const sku of r.inconsistent_stock) inconsistentStock.add(sku);
    unvalued.push(...r.unvalued);

    for (const entry of r.loss_by_reason) {
      const existing = lossByReason.get(entry.reason);
      if (existing) {
        existing.quantity += entry.quantity;
        existing.value_cents += entry.value_cents;
      } else {
        lossByReason.set(entry.reason, { ...entry });
      }
    }
    for (const entry of r.loss_by_sku) {
      const existing = lossBySku.get(entry.sku);
      if (existing) {
        existing.quantity += entry.quantity;
        existing.value_cents += entry.value_cents;
      } else {
        lossBySku.set(entry.sku, { ...entry });
      }
    }
    for (const entry of r.adjustment_flags) {
      const existing = adjustmentBySku.get(entry.sku);
      if (existing) {
        existing.quantity += entry.quantity;
        existing.value_cents += entry.value_cents;
      } else {
        adjustmentBySku.set(entry.sku, { ...entry });
      }
    }
  }

  return {
    restocked_value_cents: restocked,
    cogs_cents: cogs,
    remaining_value_cents: remaining,
    loss_value_cents: loss,
    loss_quantity: lossQty,
    unclassified_stock_adjustment_value_cents: adjustment,
    complete: allComplete,
    inconsistent_stock: [...inconsistentStock].sort(),
    unvalued,
    loss_by_reason: [...lossByReason.values()].sort((a, b) => a.reason.localeCompare(b.reason)),
    loss_by_sku: [...lossBySku.values()].sort((a, b) => b.value_cents - a.value_cents),
    adjustment_flags: [...adjustmentBySku.values()].sort((a, b) => Math.abs(b.quantity) - Math.abs(a.quantity)),
    monthsWithData: inRange.length,
    monthsMissing,
  };
}
