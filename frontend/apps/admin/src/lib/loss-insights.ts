import type { LossByReason, LossByReasonSku, NetworkReconciliationRangeRow } from "@/lib/api/finance";
import type { SalesRangeResult } from "@/lib/api/sales";
import type { SupplyRangeResult } from "@/lib/api/supply";
import { aggregateAcrossStores } from "@/lib/reconciliation-aggregate";
import { LOSS_COUNTING_REASONS, reasonLabel } from "@/lib/removal-reasons";

/**
 * Everything below reduces data the page already fetches for the
 * Reconciliação/Reposição tabs (`NetworkReconciliationRangeRow[]`,
 * `SalesRangeResult[]`, `SupplyRangeResult[]`) into the "Perdas" tab's view
 * models — no new backend calls, and nothing here invents a number the
 * source data doesn't carry. A single store scoped to "Perdas" is just a
 * `rows`/`salesRows`/`supplyRows` array of length 1 — every function here
 * is scope-agnostic on purpose, so the network and single-store views share
 * one implementation.
 */

const EXPIRED = "expired";
const DAMAGED = "damaged_product";
const OTHER = "other_reason";

export type AggregateLossSlice = ReturnType<typeof aggregateAcrossStores>;

export function aggregateSalesBySku(salesRows: SalesRangeResult[]): Map<string, { quantity: number; revenueCents: number }> {
  const map = new Map<string, { quantity: number; revenueCents: number }>();
  for (const store of salesRows) {
    for (const row of store.bySku) {
      const existing = map.get(row.sku);
      if (existing) {
        existing.quantity += row.quantity_sold;
        existing.revenueCents += row.revenue_cents;
      } else {
        map.set(row.sku, { quantity: row.quantity_sold, revenueCents: row.revenue_cents });
      }
    }
  }
  return map;
}

/** Count of distinct stores where a SKU shows up with loss > 0 in the period. */
export function storesAffectedBySku(rows: NetworkReconciliationRangeRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    for (const entry of row.totals.loss_by_sku) {
      if (entry.quantity <= 0) continue;
      map.set(entry.sku, (map.get(entry.sku) ?? 0) + 1);
    }
  }
  return map;
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

export interface LossKpi {
  key: string;
  label: string;
  /** Rendered as currency unless `displayValue` overrides it (the one unit-count KPI isn't money). */
  valueCents: number;
  displayValue?: string;
  secondaryLabel?: string;
  /** null when a previous-period figure isn't available to compare against. */
  deltaPct: number | null;
  /** true = the change is bad news (more loss), matching the KPI's own direction. */
  deltaIsBad: boolean | null;
  hint?: string;
}

/**
 * `loss_value_cents`/`loss_by_reason` only ever carry the three
 * loss-counting reasons (expired, damaged_product, other_reason) —
 * devolução/transferência/uso-e-consumo never reach here, finance-service
 * already excludes them. `unclassified_stock_adjustment_value_cents` is
 * kept as its own, separately-labeled card rather than folded into "perda
 * total": it's an unexplained stock-count gap, not a removal with a known
 * cause, and the rest of this codebase already keeps the two figures apart
 * (see `Figure` cards in the Reconciliação tab).
 */
export function computeLossKpis(
  current: AggregateLossSlice,
  previous: AggregateLossSlice | null,
  currentRevenueCents: number,
  currentAdjustmentCents: number,
  previousAdjustmentCents: number | null,
): LossKpi[] {
  const reasonValue = (slice: AggregateLossSlice, reason: string) =>
    slice.loss_by_reason.find((r) => r.reason === reason)?.value_cents ?? 0;

  const kpis: LossKpi[] = [
    {
      key: "total",
      label: "Perda total",
      valueCents: current.loss_value_cents,
      secondaryLabel:
        currentRevenueCents > 0 ? `${((current.loss_value_cents / currentRevenueCents) * 100).toFixed(1)}% das vendas` : undefined,
      deltaPct: previous ? pctDelta(current.loss_value_cents, previous.loss_value_cents) : null,
      deltaIsBad: previous ? current.loss_value_cents > previous.loss_value_cents : null,
    },
    {
      key: "units",
      label: "Unidades perdidas",
      valueCents: 0,
      displayValue: `${current.loss_quantity} un.`,
      deltaPct: previous ? pctDelta(current.loss_quantity, previous.loss_quantity) : null,
      deltaIsBad: previous ? current.loss_quantity > previous.loss_quantity : null,
    },
    {
      key: "expired",
      label: "Perda por validade",
      valueCents: reasonValue(current, EXPIRED),
      deltaPct: previous ? pctDelta(reasonValue(current, EXPIRED), reasonValue(previous, EXPIRED)) : null,
      deltaIsBad: previous ? reasonValue(current, EXPIRED) > reasonValue(previous, EXPIRED) : null,
    },
    {
      key: "damaged",
      label: "Perda por avaria",
      valueCents: reasonValue(current, DAMAGED),
      deltaPct: previous ? pctDelta(reasonValue(current, DAMAGED), reasonValue(previous, DAMAGED)) : null,
      deltaIsBad: previous ? reasonValue(current, DAMAGED) > reasonValue(previous, DAMAGED) : null,
    },
    {
      key: "other",
      label: "Outros motivos",
      valueCents: reasonValue(current, OTHER),
      deltaPct: previous ? pctDelta(reasonValue(current, OTHER), reasonValue(previous, OTHER)) : null,
      deltaIsBad: previous ? reasonValue(current, OTHER) > reasonValue(previous, OTHER) : null,
    },
    {
      key: "adjustment",
      label: "Divergência de estoque não explicada",
      valueCents: currentAdjustmentCents,
      hint: "Falta de contagem sem remoção registrada que explique — pode ser furto, contagem errada ou movimento não lançado. Não somado à perda total.",
      deltaPct: previousAdjustmentCents !== null ? pctDelta(currentAdjustmentCents, previousAdjustmentCents) : null,
      deltaIsBad: previousAdjustmentCents !== null ? currentAdjustmentCents > previousAdjustmentCents : null,
    },
  ];

  return kpis;
}

export interface StoreLossRow {
  storeId: number;
  storeName: string;
  lossCents: number;
  lossQuantity: number;
  revenueCents: number;
  lossPctOfRevenue: number | null;
}

export function storeLossRows(rows: NetworkReconciliationRangeRow[], revenueByStore: Map<number, number>): StoreLossRow[] {
  return rows
    .filter((row) => row.totals.monthsWithData > 0)
    .map((row) => {
      const revenueCents = revenueByStore.get(row.store.id) ?? 0;
      return {
        storeId: row.store.id,
        storeName: row.store.name,
        lossCents: row.totals.loss_value_cents,
        lossQuantity: row.totals.loss_quantity,
        revenueCents,
        lossPctOfRevenue: revenueCents > 0 ? row.totals.loss_value_cents / revenueCents : null,
      };
    })
    .sort((a, b) => b.lossCents - a.lossCents);
}

export interface ReasonSlice {
  reason: string;
  label: string;
  valueCents: number;
  quantity: number;
}

export function reasonDonutData(reasons: LossByReason[]): ReasonSlice[] {
  return reasons
    .filter((r) => LOSS_COUNTING_REASONS.has(r.reason) && r.value_cents > 0)
    .map((r) => ({ reason: r.reason, label: reasonLabel(r.reason), valueCents: r.value_cents, quantity: r.quantity }))
    .sort((a, b) => b.valueCents - a.valueCents);
}

export interface SkuLossRow {
  sku: string;
  name: string;
  quantity: number;
  valueCents: number;
  salesRevenueCents: number;
  salesQuantity: number;
  pctOfSkuSales: number | null;
  storesAffected: number;
  topReason: string | null;
}

/**
 * `reason: "all"` reads `loss_by_sku` (every loss-counting reason summed);
 * a specific reason reads `loss_by_reason_sku` filtered to it — same
 * source, just a narrower slice, so switching tabs never re-fetches.
 */
export function skuLossRows(
  totals: AggregateLossSlice,
  reason: string | "all",
  salesBySku: Map<string, { quantity: number; revenueCents: number }>,
  storesAffected: Map<string, number>,
  nameBySku: Map<string, string>,
): SkuLossRow[] {
  const base: { sku: string; quantity: number; value_cents: number }[] =
    reason === "all"
      ? totals.loss_by_sku
      : totals.loss_by_reason_sku
          .filter((e) => e.reason === reason)
          .map((e) => ({ sku: e.sku, quantity: e.quantity, value_cents: e.value_cents }));

  const topReasonBySku = new Map<string, string>();
  const bySkuReasons = new Map<string, LossByReasonSku[]>();
  for (const entry of totals.loss_by_reason_sku) {
    const list = bySkuReasons.get(entry.sku) ?? [];
    list.push(entry);
    bySkuReasons.set(entry.sku, list);
  }
  for (const [sku, entries] of bySkuReasons) {
    const top = [...entries].sort((a, b) => b.value_cents - a.value_cents)[0];
    if (top) topReasonBySku.set(sku, top.reason);
  }

  return base
    .filter((row) => row.value_cents > 0 || row.quantity > 0)
    .map((row) => {
      const sales = salesBySku.get(row.sku);
      return {
        sku: row.sku,
        name: nameBySku.get(row.sku) ?? row.sku,
        quantity: row.quantity,
        valueCents: row.value_cents,
        salesRevenueCents: sales?.revenueCents ?? 0,
        salesQuantity: sales?.quantity ?? 0,
        pctOfSkuSales: sales && sales.revenueCents > 0 ? row.value_cents / sales.revenueCents : null,
        storesAffected: storesAffected.get(row.sku) ?? 0,
        topReason: topReasonBySku.get(row.sku) ?? null,
      };
    })
    .sort((a, b) => b.valueCents - a.valueCents);
}

export interface ProductStoreCell {
  storeId: number;
  storeName: string;
  quantity: number;
  valueCents: number;
}

export interface ProductStoreMatrixRow {
  sku: string;
  name: string;
  totalQuantity: number;
  cells: ProductStoreCell[];
}

/**
 * Top-N SKUs by loss, each broken down across every store that shows loss
 * for it — the "produto ruim ou loja errada?" view. `reason: "all"` reads
 * `loss_by_sku` (every loss-counting reason); a specific reason reads
 * `loss_by_reason_sku` filtered to it, so switching to the "Outros" tab
 * (where an operator's "outro motivo" often records what they believe is
 * furto) narrows the matrix to just that reason's per-store pattern —
 * a product that loses roughly the same everywhere is a product-level
 * issue, one that loses only in a single store points at that store.
 */
export function productStoreMatrix(
  rows: NetworkReconciliationRangeRow[],
  topSkus: string[],
  nameBySku: Map<string, string>,
  reason: string | "all" = "all",
): ProductStoreMatrixRow[] {
  return topSkus.map((sku) => {
    const cells: ProductStoreCell[] = [];
    for (const row of rows) {
      const entry =
        reason === "all"
          ? row.totals.loss_by_sku.find((e) => e.sku === sku)
          : row.totals.loss_by_reason_sku
              .filter((e) => e.sku === sku && e.reason === reason)
              .reduce<{ sku: string; quantity: number; value_cents: number } | null>(
                (acc, e) => ({ sku, quantity: (acc?.quantity ?? 0) + e.quantity, value_cents: (acc?.value_cents ?? 0) + e.value_cents }),
                null,
              );
      if (entry && (entry.quantity > 0 || entry.value_cents > 0)) {
        cells.push({ storeId: row.store.id, storeName: row.store.name, quantity: entry.quantity, valueCents: entry.value_cents });
      }
    }
    cells.sort((a, b) => b.quantity - a.quantity);
    return {
      sku,
      name: nameBySku.get(sku) ?? sku,
      totalQuantity: cells.reduce((sum, c) => sum + c.quantity, 0),
      cells,
    };
  });
}

export interface SkuStoreReasonBreakdown {
  reason: string;
  quantity: number;
  valueCents: number;
}

export interface SkuStoreBreakdownRow {
  storeId: number;
  storeName: string;
  reasons: SkuStoreReasonBreakdown[];
  totalQuantity: number;
  totalValueCents: number;
  salesQuantity: number;
  salesRevenueCents: number;
  pctOfSales: number | null;
}

/**
 * Every store that lost a specific SKU, with its full reason breakdown side
 * by side with that store's own sales of the same SKU — the "clique pra ver
 * em quais lojas teve perda e os motivos x venda daquele produto na loja"
 * drill-down. Always reads every reason (never pre-filtered by the ranked
 * table's motivo tab): the point of opening one product is comparing its
 * reasons across stores, not narrowing to one.
 */
export function skuStoreBreakdown(
  sku: string,
  rows: NetworkReconciliationRangeRow[],
  salesRows: SalesRangeResult[],
): SkuStoreBreakdownRow[] {
  const salesByStore = new Map(salesRows.map((s) => [s.storeId, s]));

  const out: SkuStoreBreakdownRow[] = [];
  for (const row of rows) {
    const reasons = row.totals.loss_by_reason_sku.filter((e) => e.sku === sku && (e.quantity > 0 || e.value_cents > 0));
    if (reasons.length === 0) continue;

    const totalQuantity = reasons.reduce((sum, e) => sum + e.quantity, 0);
    const totalValueCents = reasons.reduce((sum, e) => sum + e.value_cents, 0);
    const sales = salesByStore.get(row.store.id)?.bySku.find((r) => r.sku === sku);

    out.push({
      storeId: row.store.id,
      storeName: row.store.name,
      reasons: reasons
        .map((e) => ({ reason: e.reason, quantity: e.quantity, valueCents: e.value_cents }))
        .sort((a, b) => b.valueCents - a.valueCents),
      totalQuantity,
      totalValueCents,
      salesQuantity: sales?.quantity_sold ?? 0,
      salesRevenueCents: sales?.revenue_cents ?? 0,
      pctOfSales: sales && sales.revenue_cents > 0 ? totalValueCents / sales.revenue_cents : null,
    });
  }

  return out.sort((a, b) => b.totalValueCents - a.totalValueCents);
}

export interface RestockSoldLostRow {
  sku: string;
  name: string;
  storeId: number;
  storeName: string;
  restocked: number;
  sold: number;
  expiredLoss: number;
  pctExpiredOfRestocked: number | null;
}

/** Per store × SKU: abastecido, vendido e perdido por validade — the exact "abasteci 40 → vendi 14 → 9 venceram" breakdown. */
export function restockSoldLostRows(
  rows: NetworkReconciliationRangeRow[],
  supplyRows: SupplyRangeResult[],
  salesRows: SalesRangeResult[],
  nameBySku: Map<string, string>,
): RestockSoldLostRow[] {
  const supplyByStore = new Map(supplyRows.map((s) => [s.storeId, s]));
  const salesByStore = new Map(salesRows.map((s) => [s.storeId, s]));

  const out: RestockSoldLostRow[] = [];
  for (const row of rows) {
    const supply = supplyByStore.get(row.store.id);
    const sales = salesByStore.get(row.store.id);
    if (!supply) continue;

    const expiredBySku = new Map<string, number>();
    for (const entry of row.totals.loss_by_reason_sku) {
      if (entry.reason !== EXPIRED) continue;
      expiredBySku.set(entry.sku, (expiredBySku.get(entry.sku) ?? 0) + entry.quantity);
    }
    if (expiredBySku.size === 0) continue;

    const soldBySku = new Map((sales?.bySku ?? []).map((r) => [r.sku, r.quantity_sold]));
    for (const restock of supply.restocks) {
      const expiredLoss = expiredBySku.get(restock.sku);
      if (!expiredLoss) continue;
      out.push({
        sku: restock.sku,
        name: nameBySku.get(restock.sku) ?? restock.sku,
        storeId: row.store.id,
        storeName: row.store.name,
        restocked: restock.quantity_restocked,
        sold: soldBySku.get(restock.sku) ?? 0,
        expiredLoss,
        pctExpiredOfRestocked: restock.quantity_restocked > 0 ? expiredLoss / restock.quantity_restocked : null,
      });
    }
  }

  return out.sort((a, b) => b.expiredLoss - a.expiredLoss);
}

export type InsightSeverity = "critical" | "warning" | "info";

export interface LossInsight {
  key: string;
  severity: InsightSeverity;
  evidence: string;
  recommendation?: string;
}

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;

/**
 * Every insight here is evidence first — a plain statement of what the
 * numbers show — with a `recommendation` only where the evidence actually
 * points at a specific, checkable action. Nothing here says "reduza
 * abastecimento" outright; over-supply insights point at the SKU/loja and
 * the ratio that shows it, and label the suggested next step separately.
 */
export function generateLossInsights(ctx: {
  current: AggregateLossSlice;
  previous: AggregateLossSlice | null;
  storeRows: StoreLossRow[];
  skuRows: SkuLossRow[];
  restockSoldLost: RestockSoldLostRow[];
  matrix: ProductStoreMatrixRow[];
  currentAdjustmentCents: number;
  isNetworkScope: boolean;
}): LossInsight[] {
  const { current, previous, storeRows, skuRows, restockSoldLost, matrix, currentAdjustmentCents, isNetworkScope } = ctx;
  const insights: LossInsight[] = [];
  const MATERIALITY_CENTS = 5_000;

  if (current.loss_value_cents < MATERIALITY_CENTS && storeRows.every((s) => s.lossCents < MATERIALITY_CENTS)) {
    return [{ key: "clean", severity: "info", evidence: "Sem perda relevante registrada no período selecionado." }];
  }

  // Trend vs previous period.
  if (previous && previous.loss_value_cents >= MATERIALITY_CENTS) {
    const delta = current.loss_value_cents - previous.loss_value_cents;
    const deltaPct = pctDelta(current.loss_value_cents, previous.loss_value_cents);
    if (Math.abs(delta) >= MATERIALITY_CENTS && deltaPct !== null) {
      insights.push({
        key: "trend",
        severity: delta > 0 ? "critical" : "info",
        evidence:
          delta > 0
            ? `A perda total subiu ${pct(deltaPct)} em relação ao período de comparação: de ${money(previous.loss_value_cents)} para ${money(current.loss_value_cents)}.`
            : `A perda total caiu ${pct(Math.abs(deltaPct))} em relação ao período de comparação: de ${money(previous.loss_value_cents)} para ${money(current.loss_value_cents)}.`,
      });
    }
  }

  // Reason concentration.
  const topReason = [...current.loss_by_reason].filter((r) => LOSS_COUNTING_REASONS.has(r.reason)).sort((a, b) => b.value_cents - a.value_cents)[0];
  if (topReason && current.loss_value_cents > 0 && topReason.value_cents >= MATERIALITY_CENTS) {
    const share = topReason.value_cents / current.loss_value_cents;
    if (share >= 0.4) {
      insights.push({
        key: "reason-concentration",
        severity: share >= 0.6 ? "warning" : "info",
        evidence: `${reasonLabel(topReason.reason)} responde por ${pct(share)} da perda total (${money(topReason.value_cents)} de ${money(current.loss_value_cents)}).`,
      });
    }
  }

  // SKU concentration.
  if (skuRows.length >= 3) {
    const top3 = skuRows.slice(0, 3);
    const top3Value = top3.reduce((sum, r) => sum + r.valueCents, 0);
    const share = current.loss_value_cents > 0 ? top3Value / current.loss_value_cents : 0;
    if (top3Value >= MATERIALITY_CENTS && share >= 0.4) {
      insights.push({
        key: "sku-concentration",
        severity: "info",
        evidence: `Os 3 produtos com maior perda (${top3.map((r) => r.name).join(", ")}) respondem por ${pct(share)} da perda total — ${money(top3Value)}.`,
      });
    }
  }

  // Store concentration (network scope only — meaningless for a single store).
  if (isNetworkScope && storeRows.length >= 3) {
    const totalLoss = storeRows.reduce((sum, r) => sum + r.lossCents, 0);
    const worst = storeRows[0];
    const avgOthers = (totalLoss - worst.lossCents) / (storeRows.length - 1);
    if (worst.lossCents >= MATERIALITY_CENTS && avgOthers > 0 && worst.lossCents >= avgOthers * 2) {
      insights.push({
        key: "store-concentration",
        severity: "critical",
        evidence: `${worst.storeName} concentra ${money(worst.lossCents)} de perda no período — ${(worst.lossCents / avgOthers).toFixed(1)}x a média das demais lojas (${money(avgOthers)}).`,
        recommendation: `Investigar a operação de ${worst.storeName}: reposição, prazos de validade e divergências de estoque dessa loja específica.`,
      });
    }
  }

  // Location-specific vs product-wide: one store holding most of a SKU's network-wide loss
  // while the SKU is sold in several stores points at that store's operation, not the product.
  if (isNetworkScope) {
    const locationSpecific = matrix.find((row) => {
      if (row.totalQuantity < 5 || row.cells.length < 3) return false;
      const worstCell = row.cells[0];
      return worstCell.quantity / row.totalQuantity >= 0.6;
    });
    if (locationSpecific) {
      const worstCell = locationSpecific.cells[0];
      const share = worstCell.quantity / locationSpecific.totalQuantity;
      insights.push({
        key: "location-specific",
        severity: "warning",
        evidence: `${locationSpecific.name} perde em ${locationSpecific.cells.length} lojas, mas ${pct(share)} da perda (${worstCell.quantity} de ${locationSpecific.totalQuantity} un.) está concentrada em ${worstCell.storeName} — nas demais lojas o produto não mostra o mesmo padrão.`,
        recommendation: `Investigar a operação de ${worstCell.storeName} para esse produto (reposição, validade, contagem) em vez de tratar como um problema do produto.`,
      });
    }
  }

  // Over-supply vs expiry, per store × SKU.
  const overSupplied = restockSoldLost.find(
    (r) => r.pctExpiredOfRestocked !== null && r.pctExpiredOfRestocked >= 0.15 && r.restocked >= 10,
  );
  if (overSupplied) {
    insights.push({
      key: "over-supply",
      severity: "warning",
      evidence: `Em ${overSupplied.storeName}, ${overSupplied.name}: de ${overSupplied.restocked} un. abastecidas, ${overSupplied.sold} foram vendidas e ${overSupplied.expiredLoss} venceram (${pct(overSupplied.pctExpiredOfRestocked ?? 0)} do abastecido).`,
      recommendation: `Revisar a quantidade ou a frequência de abastecimento de ${overSupplied.name} em ${overSupplied.storeName} antes de considerar o produto ruim — o padrão de venda não sustenta o volume reposto.`,
    });
  }

  // Unexplained stock-count divergence bigger than every tracked loss reason combined.
  if (currentAdjustmentCents >= MATERIALITY_CENTS && currentAdjustmentCents > current.loss_value_cents) {
    insights.push({
      key: "unexplained-adjustment",
      severity: "warning",
      evidence: `A divergência de estoque não explicada (${money(currentAdjustmentCents)}) é maior que toda a perda rastreada por motivo (${money(current.loss_value_cents)}) — parte do que sumiu não tem uma remoção registrada que explique.`,
      recommendation: "Reforçar o registro de remoções (validade, avaria, outro motivo) no abastecimento para que menos perda fique sem causa identificada.",
    });
  }

  const order: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return insights.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 6);
}
