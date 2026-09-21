import type { PerStoreMonthlyTotal } from "../api/finance";
import type { SupplyRangeResult } from "../api/supply";
import type { StoreLossFigure } from "./kpis";

export interface LossAmount {
  quantity: number;
  valueCents: number;
}

/** One store's reconciliation for the period, reduced to what the analyses join on. */
export interface StoreLoss {
  storeId: number;
  /** 0 when no reconciliation exists for the period: the loss is unknown, never zero. */
  monthsWithData: number;
  /** False when a SKU could not be priced or its stock was inconsistent. */
  complete: boolean;
  lossValueCents: number;
  lossQuantity: number;
  lossBySku: Map<string, LossAmount>;
  /** SKU → reason → amount. */
  lossByReasonSku: Map<string, Map<string, LossAmount>>;
  inconsistentSkus: Set<string>;
  unvaluedSkus: Set<string>;
  /** Stock that does not match any recorded removal. Kept out of loss and out of the margin after losses. */
  unclassifiedAdjustmentCents: number;
}

export type LossIndex = Map<number, StoreLoss>;

/**
 * How far a store's loss figure for a SKU can be trusted:
 *  - `clean`: reconciled, and this SKU is not flagged;
 *  - `inconsistent`: reconciled, but this SKU's stock does not add up;
 *  - `unvalued`: the loss could not be priced for lack of a cost;
 *  - `no_reconciliation`: the store has no reconciliation for the period.
 */
export type SkuLossQuality = "clean" | "inconsistent" | "unvalued" | "no_reconciliation";

/** The period's slice of the network reconciliation, by store. Stores with no month for the period are absent. */
export function buildLossIndex(perStoreMonthly: PerStoreMonthlyTotal[], period: string): LossIndex {
  const index: LossIndex = new Map();

  for (const { storeId, period: month, totals } of perStoreMonthly) {
    if (month !== period || totals.monthsWithData < 1) continue;

    const lossByReasonSku = new Map<string, Map<string, LossAmount>>();
    for (const entry of totals.loss_by_reason_sku) {
      const byReason = lossByReasonSku.get(entry.sku) ?? new Map<string, LossAmount>();
      byReason.set(entry.reason, { quantity: entry.quantity, valueCents: entry.value_cents });
      lossByReasonSku.set(entry.sku, byReason);
    }

    index.set(storeId, {
      storeId,
      monthsWithData: totals.monthsWithData,
      complete: totals.complete,
      lossValueCents: totals.loss_value_cents,
      lossQuantity: totals.loss_quantity,
      lossBySku: new Map(totals.loss_by_sku.map((entry) => [entry.sku, { quantity: entry.quantity, valueCents: entry.value_cents }])),
      lossByReasonSku,
      inconsistentSkus: new Set(totals.inconsistent_stock),
      unvaluedSkus: new Set(totals.unvalued.map((entry) => entry.sku)),
      unclassifiedAdjustmentCents: totals.unclassified_stock_adjustment_value_cents,
    });
  }

  return index;
}

export function skuLossQuality(index: LossIndex, storeId: number, sku: string): SkuLossQuality {
  const store = index.get(storeId);
  if (!store) return "no_reconciliation";
  if (store.inconsistentSkus.has(sku)) return "inconsistent";
  if (store.unvaluedSkus.has(sku)) return "unvalued";
  return "clean";
}

/** Share of the SKUs a store sold that its reconciliation flags (inconsistent stock or unpriced). Null without a reconciliation. */
export function storeFlaggedShare(index: LossIndex, storeId: number, soldSkus: ReadonlySet<string>): number | null {
  const store = index.get(storeId);
  if (!store || soldSkus.size === 0) return null;

  let flagged = 0;
  for (const sku of soldSkus) if (store.inconsistentSkus.has(sku) || store.unvaluedSkus.has(sku)) flagged += 1;
  return flagged / soldSkus.size;
}

/** The per-store loss figures that the margin after losses reads. */
export function lossFigures(index: LossIndex): Map<number, StoreLossFigure> {
  const figures = new Map<number, StoreLossFigure>();
  for (const [storeId, store] of index) {
    figures.set(storeId, { lossValueCents: store.lossValueCents, monthsWithData: store.monthsWithData, complete: store.complete });
  }
  return figures;
}

/** Store → SKU → units restocked in the period. */
export type SupplyIndex = Map<number, Map<string, number>>;

export function buildSupplyIndex(results: SupplyRangeResult[]): SupplyIndex {
  const index: SupplyIndex = new Map();
  for (const { storeId, restocks } of results) {
    const bySku = new Map<string, number>();
    for (const row of restocks) bySku.set(row.sku, (bySku.get(row.sku) ?? 0) + row.quantity_restocked);
    index.set(storeId, bySku);
  }
  return index;
}

/** Sold ÷ restocked, in units. Null when nothing was restocked or the store has no supply data: never infinity, never zero. */
export function sellThrough(index: SupplyIndex, storeId: number, sku: string, soldUnits: number): number | null {
  const restocked = index.get(storeId)?.get(sku);
  return restocked !== undefined && restocked > 0 ? soldUnits / restocked : null;
}
