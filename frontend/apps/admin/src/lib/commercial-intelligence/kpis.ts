import type { SalesTransaction } from "../api/sales";
import { groupBaskets } from "../sales-insights";
import type { CostBySku } from "../sales-insights";

/**
 * Margin over the lines whose product cost resolved — and only those.
 *
 * `sales-insights.computeMargin` keeps the revenue of an unresolved-cost SKU in
 * the base and drops only its cost, which overstates the margin (a SKU with no
 * cost reads as 100% margin). Here the revenue and the cost of an unresolved
 * SKU are both left out, so the numerator and the base describe the same lines,
 * and the exclusion is counted and shown. With every cost resolved the result
 * is identical to `/sales`.
 */
export interface MarginBreakdown {
  /** Null while the costs are not loaded, or when no line has a resolved cost. Never a fabricated 0 or 100%. */
  marginCents: number | null;
  marginPct: number | null;
  /** Revenue of the resolved lines: the base the margin is a share of. */
  baseCents: number;
  unresolvedSkuCount: number;
  unresolvedSkus: string[];
  unresolvedRevenueCents: number;
  /** Of the scope's whole revenue; null when there is none. */
  unresolvedRevenueShare: number | null;
}

export function computeMarginBreakdown(ok: SalesTransaction[], costBySku: CostBySku | null): MarginBreakdown {
  if (!costBySku) {
    return { marginCents: null, marginPct: null, baseCents: 0, unresolvedSkuCount: 0, unresolvedSkus: [], unresolvedRevenueCents: 0, unresolvedRevenueShare: null };
  }

  let baseCents = 0;
  let cogsCents = 0;
  let unresolvedRevenueCents = 0;
  let totalRevenueCents = 0;
  const unresolved = new Set<string>();

  for (const t of ok) {
    totalRevenueCents += t.amount_paid_cents;
    const unitCost = costBySku.get(t.sku);
    if (unitCost === undefined) {
      unresolved.add(t.sku);
      unresolvedRevenueCents += t.amount_paid_cents;
      continue;
    }
    baseCents += t.amount_paid_cents;
    cogsCents += unitCost * t.quantity;
  }

  const hasBase = baseCents > 0;
  return {
    marginCents: hasBase ? baseCents - cogsCents : null,
    marginPct: hasBase ? (baseCents - cogsCents) / baseCents : null,
    baseCents,
    unresolvedSkuCount: unresolved.size,
    unresolvedSkus: [...unresolved].sort(),
    unresolvedRevenueCents,
    unresolvedRevenueShare: totalRevenueCents > 0 ? unresolvedRevenueCents / totalRevenueCents : null,
  };
}

/** The unit cost by SKU from a bulk cost lookup; null while it is not loaded, so "not loaded" is never read as "no costs". */
export function costBySkuFrom(resolved: { sku: string; cost_cents: number }[] | undefined): CostBySku | null {
  if (!resolved) return null;
  return new Map(resolved.map((row) => [row.sku, row.cost_cents]));
}

export interface ScopeKpis {
  revenueCents: number;
  basketCount: number;
  ticketCents: number | null;
  itemsPerBasket: number | null;
  margin: MarginBreakdown;
  /** Purchases with at least one resolved-cost line: the divisor of the margin per purchase. */
  marginBasketCount: number;
  marginPerBasketCents: number | null;
}

/**
 * The header numbers of a scope. Receita, ticket and items per purchase use the
 * exact definitions of `/sales` (`groupBaskets`, completed lines only), which
 * is what makes the two pages agree; the margin is the one place they may differ,
 * and only when a SKU has no cost.
 */
export function computeScopeKpis(ok: SalesTransaction[], costBySku: CostBySku | null): ScopeKpis {
  const revenueCents = ok.reduce((sum, t) => sum + t.amount_paid_cents, 0);
  const quantity = ok.reduce((sum, t) => sum + t.quantity, 0);
  const baskets = groupBaskets(ok);
  const basketCount = baskets.length;
  const margin = computeMarginBreakdown(ok, costBySku);

  const marginBasketCount = costBySku ? baskets.filter((basket) => basket.lines.some((line) => costBySku.has(line.sku))).length : 0;

  return {
    revenueCents,
    basketCount,
    ticketCents: basketCount > 0 ? revenueCents / basketCount : null,
    itemsPerBasket: basketCount > 0 ? quantity / basketCount : null,
    margin,
    marginBasketCount,
    marginPerBasketCents: margin.marginCents !== null && marginBasketCount > 0 ? margin.marginCents / marginBasketCount : null,
  };
}

/** Each store's margin over its resolved-cost lines, for the margin after losses. */
export function marginByStore(ok: SalesTransaction[], costBySku: CostBySku | null): Map<number, number | null> {
  const byStore = new Map<number, SalesTransaction[]>();
  for (const t of ok) {
    const group = byStore.get(t.store_id);
    if (group) group.push(t);
    else byStore.set(t.store_id, [t]);
  }

  const result = new Map<number, number | null>();
  for (const [storeId, lines] of byStore) result.set(storeId, computeMarginBreakdown(lines, costBySku).marginCents);
  return result;
}

export interface StoreLossFigure {
  lossValueCents: number;
  /** Months of reconciliation found for the period: 0 means the loss is unknown, not zero. */
  monthsWithData: number;
  complete: boolean;
}

export interface MarginAfterLoss {
  /** Null when no store has both a margin and a reconciled loss. */
  valueCents: number | null;
  coveredStores: number;
  /** Stores of the scope that have transaction detail. */
  totalStores: number;
  /** Covered stores whose reconciliation is not complete (inconsistent stock or unvalued products). */
  incompleteStores: number;
  lossCents: number;
  marginCents: number;
}

/**
 * Margin minus the loss valued at cost, over the stores where BOTH are known.
 * A store with no reconciliation for the period is left out and counted as not
 * covered; treating it as zero loss would flatter it.
 */
export function marginAfterLoss(storeIds: number[], margins: Map<number, number | null>, losses: Map<number, StoreLossFigure>): MarginAfterLoss {
  let coveredStores = 0;
  let incompleteStores = 0;
  let lossCents = 0;
  let marginCents = 0;

  for (const storeId of storeIds) {
    const margin = margins.get(storeId) ?? null;
    const loss = losses.get(storeId);
    if (margin === null || !loss || loss.monthsWithData < 1) continue;

    coveredStores += 1;
    if (!loss.complete) incompleteStores += 1;
    marginCents += margin;
    lossCents += loss.lossValueCents;
  }

  return {
    valueCents: coveredStores > 0 ? marginCents - lossCents : null,
    coveredStores,
    totalStores: storeIds.length,
    incompleteStores,
    lossCents,
    marginCents,
  };
}

/** Relative change, as `/sales` reads it: a zero base is "no change" against zero and "not comparable" otherwise. */
export function relativeDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}
