import type { Product } from "@/lib/api/products";
import type { SalesTransaction } from "@/lib/api/sales";
import type { Store } from "@/lib/api/stores";

/**
 * Every computation here reads `SalesTransaction[]` — real per-transaction
 * rows, only present for stores/periods ingested from the network-wide
 * format (add-sales-transaction-detail). Nothing here is computed for a
 * month that only has the old per-SKU aggregate; the page this feeds is
 * responsible for showing an honest "sem detalhe transacional" instead of
 * calling any of this with an empty array standing in for "no data".
 *
 * `result` (verbatim from the source report) decides eligibility: only
 * `'OK'` transactions count toward revenue/quantity/ticket/margin/mix —
 * everything a "how much did we sell" question means. The full set
 * (including declined/cancelled) is read only by the "Resultado das
 * transações" section, which is explicitly about that distinction.
 */

export function isOk(t: SalesTransaction): boolean {
  return t.result.trim().toUpperCase() === "OK";
}

export function onlyOk(transactions: SalesTransaction[]): SalesTransaction[] {
  return transactions.filter(isOk);
}

/**
 * One checkout — several transaction rows (one per SKU) sharing the same
 * `Cupom` within a store. A row with no coupon becomes its own one-line
 * basket (degraded but honest: the file gave no way to group it).
 */
export interface Basket {
  key: string;
  storeId: number;
  coupon: string | null;
  lines: SalesTransaction[];
  totalCents: number;
  itemCount: number;
  buyerNumber: string | null;
  occurredAt: string | null;
}

export function groupBaskets(transactions: SalesTransaction[]): Basket[] {
  const map = new Map<string, Basket>();
  let fallbackIndex = 0;

  for (const t of transactions) {
    const key = t.coupon ? `${t.store_id}:${t.coupon}` : `${t.store_id}:__row_${fallbackIndex++}`;
    const existing = map.get(key);
    if (existing) {
      existing.lines.push(t);
      existing.totalCents += t.amount_paid_cents;
      existing.itemCount += t.quantity;
      if (!existing.buyerNumber && t.buyer_number) existing.buyerNumber = t.buyer_number;
      if (!existing.occurredAt && t.occurred_at) existing.occurredAt = t.occurred_at;
    } else {
      map.set(key, {
        key,
        storeId: t.store_id,
        coupon: t.coupon,
        lines: [t],
        totalCents: t.amount_paid_cents,
        itemCount: t.quantity,
        buyerNumber: t.buyer_number,
        occurredAt: t.occurred_at,
      });
    }
  }

  return [...map.values()];
}

/** A SKU → unit cost (cents) map, built from `getCostsAsOf`'s resolved list — `undefined` for an unresolved SKU, never coerced to 0. */
export type CostBySku = Map<string, number>;

export interface MarginResult {
  marginCents: number | null;
  marginPct: number | null;
  /** SKUs sold in this scope with no resolved cost — margin above is computed excluding them, never as if they cost zero. */
  unresolvedSkuCount: number;
}

export function computeMargin(revenueCents: number, transactions: SalesTransaction[], costBySku: CostBySku | null): MarginResult {
  if (!costBySku) return { marginCents: null, marginPct: null, unresolvedSkuCount: 0 };

  let cogsCents = 0;
  const unresolved = new Set<string>();
  for (const t of transactions) {
    const unitCost = costBySku.get(t.sku);
    if (unitCost === undefined) {
      unresolved.add(t.sku);
      continue;
    }
    cogsCents += unitCost * t.quantity;
  }

  const marginCents = revenueCents - cogsCents;
  return {
    marginCents,
    marginPct: revenueCents > 0 ? marginCents / revenueCents : null,
    unresolvedSkuCount: unresolved.size,
  };
}

export interface PeriodStats {
  revenueCents: number;
  netRevenueCents: number | null;
  quantitySold: number;
  basketCount: number;
  itemsPerBasket: number | null;
  avgItemPriceCents: number | null;
  ticketAvgCents: number | null;
  margin: MarginResult;
}

export function computePeriodStats(okTransactions: SalesTransaction[], costBySku: CostBySku | null): PeriodStats {
  const revenueCents = okTransactions.reduce((sum, t) => sum + t.amount_paid_cents, 0);
  const withNet = okTransactions.filter((t) => t.net_amount_cents !== null);
  const netRevenueCents = withNet.length > 0 ? withNet.reduce((sum, t) => sum + (t.net_amount_cents ?? 0), 0) : null;
  const quantitySold = okTransactions.reduce((sum, t) => sum + t.quantity, 0);
  const baskets = groupBaskets(okTransactions);
  const basketCount = baskets.length;

  return {
    revenueCents,
    netRevenueCents,
    quantitySold,
    basketCount,
    itemsPerBasket: basketCount > 0 ? quantitySold / basketCount : null,
    avgItemPriceCents: quantitySold > 0 ? revenueCents / quantitySold : null,
    ticketAvgCents: basketCount > 0 ? revenueCents / basketCount : null,
    margin: computeMargin(revenueCents, okTransactions, costBySku),
  };
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

export interface SalesKpi {
  key: string;
  label: string;
  valueCents?: number;
  displayValue?: string;
  secondaryLabel?: string;
  deltaPct: number | null;
  deltaIsBad: boolean | null;
  hint?: string;
}

/** The 8 KPIs from spec section 1, each with its delta vs. `previous` (null when there's no comparison period). */
export function computeSalesKpis(current: PeriodStats, previous: PeriodStats | null): SalesKpi[] {
  const kpis: SalesKpi[] = [
    {
      key: "revenue",
      label: "Receita",
      valueCents: current.revenueCents,
      deltaPct: previous ? pctDelta(current.revenueCents, previous.revenueCents) : null,
      deltaIsBad: previous ? current.revenueCents < previous.revenueCents : null,
    },
    {
      key: "net-revenue",
      label: "Valor líquido",
      valueCents: current.netRevenueCents ?? undefined,
      displayValue: current.netRevenueCents === null ? "—" : undefined,
      hint: current.netRevenueCents === null ? "Nenhuma transação do período trouxe o valor líquido (após taxas)." : undefined,
      deltaPct:
        previous && current.netRevenueCents !== null && previous.netRevenueCents !== null
          ? pctDelta(current.netRevenueCents, previous.netRevenueCents)
          : null,
      deltaIsBad:
        previous && current.netRevenueCents !== null && previous.netRevenueCents !== null
          ? current.netRevenueCents < previous.netRevenueCents
          : null,
    },
    {
      key: "quantity",
      label: "Quantidade vendida",
      valueCents: 0,
      displayValue: `${current.quantitySold} un.`,
      deltaPct: previous ? pctDelta(current.quantitySold, previous.quantitySold) : null,
      deltaIsBad: previous ? current.quantitySold < previous.quantitySold : null,
    },
    {
      key: "baskets",
      label: "Transações (compras)",
      valueCents: 0,
      displayValue: `${current.basketCount}`,
      deltaPct: previous ? pctDelta(current.basketCount, previous.basketCount) : null,
      deltaIsBad: previous ? current.basketCount < previous.basketCount : null,
    },
    {
      key: "ticket",
      label: "Ticket médio",
      valueCents: current.ticketAvgCents ?? undefined,
      displayValue: current.ticketAvgCents === null ? "—" : undefined,
      hint: "Valor Pago ÷ número de compras",
      deltaPct:
        previous && current.ticketAvgCents !== null && previous.ticketAvgCents !== null
          ? pctDelta(current.ticketAvgCents, previous.ticketAvgCents)
          : null,
      deltaIsBad:
        previous && current.ticketAvgCents !== null && previous.ticketAvgCents !== null
          ? current.ticketAvgCents < previous.ticketAvgCents
          : null,
    },
    {
      key: "items-per-basket",
      label: "Itens por compra",
      valueCents: 0,
      displayValue: current.itemsPerBasket === null ? "—" : current.itemsPerBasket.toFixed(2),
      hint: "Quantidade vendida ÷ número de compras",
      deltaPct:
        previous && current.itemsPerBasket !== null && previous.itemsPerBasket !== null
          ? pctDelta(current.itemsPerBasket, previous.itemsPerBasket)
          : null,
      deltaIsBad:
        previous && current.itemsPerBasket !== null && previous.itemsPerBasket !== null
          ? current.itemsPerBasket < previous.itemsPerBasket
          : null,
    },
    {
      key: "margin",
      label: "Margem R$",
      valueCents: current.margin.marginCents ?? undefined,
      displayValue: current.margin.marginCents === null ? "—" : undefined,
      hint:
        current.margin.unresolvedSkuCount > 0
          ? `${current.margin.unresolvedSkuCount} SKU(s) vendido(s) sem custo resolvido — margem calculada só com o que tem custo.`
          : undefined,
      deltaPct:
        previous && current.margin.marginCents !== null && previous.margin.marginCents !== null
          ? pctDelta(current.margin.marginCents, previous.margin.marginCents)
          : null,
      deltaIsBad:
        previous && current.margin.marginCents !== null && previous.margin.marginCents !== null
          ? current.margin.marginCents < previous.margin.marginCents
          : null,
    },
    {
      key: "margin-pct",
      label: "Margem %",
      valueCents: 0,
      displayValue: current.margin.marginPct === null ? "—" : `${(current.margin.marginPct * 100).toFixed(1)}%`,
      deltaPct:
        previous && current.margin.marginPct !== null && previous.margin.marginPct !== null
          ? current.margin.marginPct - previous.margin.marginPct
          : null,
      deltaIsBad:
        previous && current.margin.marginPct !== null && previous.margin.marginPct !== null
          ? current.margin.marginPct < previous.margin.marginPct
          : null,
      hint: previous ? "Variação em pontos percentuais, não %." : undefined,
    },
  ];

  return kpis;
}

export type EvolutionMetric = "revenue" | "baskets" | "quantity" | "margin";

export interface DailyPoint {
  /** Day of month, 1-31 — the two series (current/previous period) align by day-of-month, not calendar date. */
  dayOfMonth: number;
  value: number;
}

export function dailySeries(okTransactions: SalesTransaction[], metric: EvolutionMetric, costBySku: CostBySku | null): DailyPoint[] {
  const byDay = new Map<number, SalesTransaction[]>();
  for (const t of okTransactions) {
    if (!t.occurred_at) continue;
    const day = Number(t.occurred_at.slice(8, 10));
    if (!Number.isFinite(day)) continue;
    const list = byDay.get(day) ?? [];
    list.push(t);
    byDay.set(day, list);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dayOfMonth, txs]) => {
      let value = 0;
      if (metric === "revenue") value = txs.reduce((sum, t) => sum + t.amount_paid_cents, 0) / 100;
      else if (metric === "quantity") value = txs.reduce((sum, t) => sum + t.quantity, 0);
      else if (metric === "baskets") value = groupBaskets(txs).length;
      else if (metric === "margin") {
        const revenue = txs.reduce((sum, t) => sum + t.amount_paid_cents, 0);
        value = computeMargin(revenue, txs, costBySku).marginCents ?? 0;
        value /= 100;
      }
      return { dayOfMonth, value };
    });
}

export interface StorePerformanceRow {
  storeId: number;
  storeName: string;
  revenueCents: number;
  basketCount: number;
  quantitySold: number;
  ticketAvgCents: number | null;
  itemsPerBasket: number | null;
  avgItemPriceCents: number | null;
  margin: MarginResult;
  hasTransactionDetail: boolean;
}

export function storePerformanceRows(
  byStore: { store: Store; transactions: SalesTransaction[] | null }[],
  costBySku: CostBySku | null,
): StorePerformanceRow[] {
  return byStore.map(({ store, transactions }) => {
    if (transactions === null) {
      return {
        storeId: store.id,
        storeName: store.name,
        revenueCents: 0,
        basketCount: 0,
        quantitySold: 0,
        ticketAvgCents: null,
        itemsPerBasket: null,
        avgItemPriceCents: null,
        margin: { marginCents: null, marginPct: null, unresolvedSkuCount: 0 },
        hasTransactionDetail: false,
      };
    }
    const ok = onlyOk(transactions);
    const stats = computePeriodStats(ok, costBySku);
    return {
      storeId: store.id,
      storeName: store.name,
      revenueCents: stats.revenueCents,
      basketCount: stats.basketCount,
      quantitySold: stats.quantitySold,
      ticketAvgCents: stats.ticketAvgCents,
      itemsPerBasket: stats.itemsPerBasket,
      avgItemPriceCents: stats.avgItemPriceCents,
      margin: stats.margin,
      hasTransactionDetail: true,
    };
  });
}

export type HeatmapMetric = "revenue" | "baskets" | "quantity";

export interface HeatmapCell {
  weekday: number;
  hour: number;
  value: number;
}

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export { WEEKDAY_LABELS };

export function heatmapData(okTransactions: SalesTransaction[], metric: HeatmapMetric): HeatmapCell[] {
  const buckets = new Map<string, SalesTransaction[]>();
  for (const t of okTransactions) {
    if (!t.occurred_at) continue;
    const date = new Date(t.occurred_at);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getDay()}:${date.getHours()}`;
    const list = buckets.get(key) ?? [];
    list.push(t);
    buckets.set(key, list);
  }

  const cells: HeatmapCell[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      const txs = buckets.get(`${weekday}:${hour}`) ?? [];
      let value = 0;
      if (metric === "revenue") value = txs.reduce((sum, t) => sum + t.amount_paid_cents, 0);
      else if (metric === "quantity") value = txs.reduce((sum, t) => sum + t.quantity, 0);
      else if (metric === "baskets") value = groupBaskets(txs).length;
      cells.push({ weekday, hour, value });
    }
  }
  return cells;
}

export interface HeatmapSummary {
  peakHour: number | null;
  peakHourShare: number | null;
  strongestDay: number | null;
  strongestDayShare: number | null;
  weakestDay: number | null;
  weakestDayShare: number | null;
}

export function summarizeHeatmap(cells: HeatmapCell[]): HeatmapSummary {
  const total = cells.reduce((sum, c) => sum + c.value, 0);
  if (total === 0) return { peakHour: null, peakHourShare: null, strongestDay: null, strongestDayShare: null, weakestDay: null, weakestDayShare: null };

  const byHour = new Map<number, number>();
  const byDay = new Map<number, number>();
  for (const cell of cells) {
    byHour.set(cell.hour, (byHour.get(cell.hour) ?? 0) + cell.value);
    byDay.set(cell.weekday, (byDay.get(cell.weekday) ?? 0) + cell.value);
  }

  const peak = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0];
  const days = [...byDay.entries()].sort((a, b) => b[1] - a[1]);
  const strongest = days[0];
  const weakest = days[days.length - 1];

  return {
    peakHour: peak?.[0] ?? null,
    peakHourShare: peak ? peak[1] / total : null,
    strongestDay: strongest?.[0] ?? null,
    strongestDayShare: strongest ? strongest[1] / total : null,
    weakestDay: weakest?.[0] ?? null,
    weakestDayShare: weakest ? weakest[1] / total : null,
  };
}

export interface CategoryMixRow {
  category: string;
  label: string;
  revenueCents: number;
  shareOfRevenue: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  meal: "Refeições",
  snack: "Snacks",
  beverage: "Bebidas",
  essential: "Essenciais",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function categoryMix(okTransactions: SalesTransaction[], productBySku: Map<string, Product>): CategoryMixRow[] {
  const byCategory = new Map<string, number>();
  let total = 0;
  for (const t of okTransactions) {
    const category = productBySku.get(t.sku)?.category ?? "outros";
    byCategory.set(category, (byCategory.get(category) ?? 0) + t.amount_paid_cents);
    total += t.amount_paid_cents;
  }
  return [...byCategory.entries()]
    .map(([category, revenueCents]) => ({
      category,
      label: categoryLabel(category),
      revenueCents,
      shareOfRevenue: total > 0 ? revenueCents / total : 0,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents);
}

export interface MixComparisonRow {
  category: string;
  label: string;
  storeShare: number;
  networkShare: number;
  diffPp: number;
}

export function compareMix(storeMix: CategoryMixRow[], networkMix: CategoryMixRow[]): MixComparisonRow[] {
  const networkByCategory = new Map(networkMix.map((r) => [r.category, r.shareOfRevenue]));
  const allCategories = new Set([...storeMix.map((r) => r.category), ...networkMix.map((r) => r.category)]);

  return [...allCategories]
    .map((category) => {
      const storeShare = storeMix.find((r) => r.category === category)?.shareOfRevenue ?? 0;
      const networkShare = networkByCategory.get(category) ?? 0;
      return { category, label: categoryLabel(category), storeShare, networkShare, diffPp: storeShare - networkShare };
    })
    .sort((a, b) => b.storeShare - a.storeShare);
}

export type ProductSortKey = "quantity" | "revenue" | "marginCents" | "marginPct" | "lowestMargin";

export interface ProductSalesRow {
  sku: string;
  name: string;
  category: string;
  quantity: number;
  revenueCents: number;
  margin: MarginResult;
  shareOfRevenue: number | null;
}

export function productSalesRows(
  okTransactions: SalesTransaction[],
  productBySku: Map<string, Product>,
  costBySku: CostBySku | null,
): ProductSalesRow[] {
  const bySku = new Map<string, { quantity: number; revenueCents: number; lines: SalesTransaction[] }>();
  let totalRevenue = 0;
  for (const t of okTransactions) {
    const existing = bySku.get(t.sku) ?? { quantity: 0, revenueCents: 0, lines: [] };
    existing.quantity += t.quantity;
    existing.revenueCents += t.amount_paid_cents;
    existing.lines.push(t);
    bySku.set(t.sku, existing);
    totalRevenue += t.amount_paid_cents;
  }

  return [...bySku.entries()].map(([sku, agg]) => {
    const product = productBySku.get(sku);
    return {
      sku,
      name: product?.name ?? sku,
      category: product?.category ?? "outros",
      quantity: agg.quantity,
      revenueCents: agg.revenueCents,
      margin: computeMargin(agg.revenueCents, agg.lines, costBySku),
      shareOfRevenue: totalRevenue > 0 ? agg.revenueCents / totalRevenue : null,
    };
  });
}

export function sortProducts(rows: ProductSalesRow[], key: ProductSortKey): ProductSalesRow[] {
  const sorted = [...rows];
  switch (key) {
    case "quantity":
      return sorted.sort((a, b) => b.quantity - a.quantity);
    case "revenue":
      return sorted.sort((a, b) => b.revenueCents - a.revenueCents);
    case "marginCents":
      return sorted.sort((a, b) => (b.margin.marginCents ?? -Infinity) - (a.margin.marginCents ?? -Infinity));
    case "marginPct":
      return sorted.sort((a, b) => (b.margin.marginPct ?? -Infinity) - (a.margin.marginPct ?? -Infinity));
    case "lowestMargin":
      return sorted.sort((a, b) => (a.margin.marginPct ?? Infinity) - (b.margin.marginPct ?? Infinity));
  }
}

export type ProductQuadrant = "star" | "traffic" | "potential" | "reevaluate";

export interface ProductMatrixRow extends ProductSalesRow {
  quadrant: ProductQuadrant | null;
}

/**
 * Splits products into 4 quadrants by their position relative to the
 * MEDIAN of this scope's own products — "alta venda"/"baixa margem" are
 * relative to what this network or store actually sells, never an
 * absolute, arbitrary cutoff. Only products with a resolved margin get a
 * quadrant; the rest are `null` (shown separately, never guessed into one).
 */
export function classifyProductMatrix(rows: ProductSalesRow[]): ProductMatrixRow[] {
  const withMargin = rows.filter((r) => r.margin.marginPct !== null);
  if (withMargin.length === 0) return rows.map((r) => ({ ...r, quadrant: null }));

  const sortedByVolume = [...withMargin].sort((a, b) => a.quantity - b.quantity);
  const sortedByMargin = [...withMargin].sort((a, b) => (a.margin.marginPct ?? 0) - (b.margin.marginPct ?? 0));
  const medianVolume = sortedByVolume[Math.floor(sortedByVolume.length / 2)].quantity;
  const medianMarginPct = sortedByMargin[Math.floor(sortedByMargin.length / 2)].margin.marginPct ?? 0;

  return rows.map((row) => {
    if (row.margin.marginPct === null) return { ...row, quadrant: null };
    const highVolume = row.quantity >= medianVolume;
    const highMargin = row.margin.marginPct >= medianMarginPct;
    const quadrant: ProductQuadrant = highVolume && highMargin ? "star" : highVolume && !highMargin ? "traffic" : !highVolume && highMargin ? "potential" : "reevaluate";
    return { ...row, quadrant };
  });
}

export interface ProductAffinityRow {
  sku: string;
  name: string;
  storeShareOfRevenue: number;
  networkShareOfRevenue: number;
  affinity: number;
  storeRank: number;
  networkRank: number;
}

/**
 * Affinity = a SKU's share of THIS store's revenue ÷ its share of the
 * network's revenue — never absolute quantity, which would just reward
 * big stores for being big. >1 means the product is proportionally more
 * important here than in the network as a whole.
 */
export function productAffinity(storeRows: ProductSalesRow[], networkRows: ProductSalesRow[]): ProductAffinityRow[] {
  const networkBySku = new Map(networkRows.map((r) => [r.sku, r]));
  const networkRanked = [...networkRows].sort((a, b) => b.revenueCents - a.revenueCents);
  const storeRanked = [...storeRows].sort((a, b) => b.revenueCents - a.revenueCents);
  const networkRankBySku = new Map(networkRanked.map((r, i) => [r.sku, i + 1]));
  const storeRankBySku = new Map(storeRanked.map((r, i) => [r.sku, i + 1]));

  return storeRows
    .map((row) => {
      const networkRow = networkBySku.get(row.sku);
      const storeShare = row.shareOfRevenue ?? 0;
      const networkShare = networkRow?.shareOfRevenue ?? 0;
      return {
        sku: row.sku,
        name: row.name,
        storeShareOfRevenue: storeShare,
        networkShareOfRevenue: networkShare,
        affinity: networkShare > 0 ? storeShare / networkShare : storeShare > 0 ? Infinity : 0,
        storeRank: storeRankBySku.get(row.sku) ?? 0,
        networkRank: networkRankBySku.get(row.sku) ?? 0,
      };
    })
    .filter((row) => Number.isFinite(row.affinity))
    .sort((a, b) => b.affinity - a.affinity);
}

export interface PaymentMethodRow {
  method: string;
  basketCount: number;
  pctOfBaskets: number;
  revenueCents: number;
  pctOfRevenue: number;
  ticketAvgCents: number | null;
}

export function paymentMethodBreakdown(okTransactions: SalesTransaction[], dimension: "method" | "acquirer" | "card_brand"): PaymentMethodRow[] {
  const baskets = groupBaskets(okTransactions);
  const byDimension = new Map<string, Basket[]>();
  let totalRevenue = 0;

  for (const basket of baskets) {
    const value = basket.lines[0]?.[dimension] ?? null;
    const key = value ?? "Não informado";
    const list = byDimension.get(key) ?? [];
    list.push(basket);
    byDimension.set(key, list);
    totalRevenue += basket.totalCents;
  }

  return [...byDimension.entries()]
    .map(([method, list]) => {
      const revenueCents = list.reduce((sum, b) => sum + b.totalCents, 0);
      return {
        method,
        basketCount: list.length,
        pctOfBaskets: baskets.length > 0 ? list.length / baskets.length : 0,
        revenueCents,
        pctOfRevenue: totalRevenue > 0 ? revenueCents / totalRevenue : 0,
        ticketAvgCents: list.length > 0 ? revenueCents / list.length : null,
      };
    })
    .sort((a, b) => b.revenueCents - a.revenueCents);
}

export interface ResultBreakdownRow {
  result: string;
  count: number;
  pctOfTotal: number;
  potentialValueCents: number;
}

/** Uses EVERY transaction, not just OK — the whole point is the split between completed and not. */
export function resultBreakdown(allTransactions: SalesTransaction[]): ResultBreakdownRow[] {
  const byResult = new Map<string, SalesTransaction[]>();
  for (const t of allTransactions) {
    const list = byResult.get(t.result) ?? [];
    list.push(t);
    byResult.set(t.result, list);
  }
  const total = allTransactions.length;
  return [...byResult.entries()]
    .map(([result, list]) => ({
      result,
      count: list.length,
      pctOfTotal: total > 0 ? list.length / total : 0,
      potentialValueCents: list.reduce((sum, t) => sum + t.amount_paid_cents, 0),
    }))
    .sort((a, b) => b.count - a.count);
}

export function approvalRate(allTransactions: SalesTransaction[]): number | null {
  if (allTransactions.length === 0) return null;
  const ok = allTransactions.filter(isOk).length;
  return ok / allTransactions.length;
}

export type FailureDimension = "storeName" | "pos_id" | "machine_model" | "method" | "acquirer";

export interface FailureBreakdownRow {
  key: string;
  count: number;
  pctOfFailures: number;
}

export function failureBreakdown(
  allTransactions: (SalesTransaction & { storeName?: string })[],
  dimension: FailureDimension,
): FailureBreakdownRow[] {
  const failed = allTransactions.filter((t) => !isOk(t));
  const byKey = new Map<string, number>();
  for (const t of failed) {
    const value = t[dimension];
    const key = typeof value === "string" && value.trim() !== "" ? value : "Não informado";
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }
  return [...byKey.entries()]
    .map(([key, count]) => ({ key, count, pctOfFailures: failed.length > 0 ? count / failed.length : 0 }))
    .sort((a, b) => b.count - a.count);
}

export interface DiscountStats {
  totalDiscountCents: number;
  totalOriginalCents: number;
  pctOfOriginal: number | null;
  basketsWithDiscount: number;
  pctOfBasketsWithDiscount: number;
}

export function discountStats(okTransactions: SalesTransaction[]): DiscountStats {
  const baskets = groupBaskets(okTransactions);
  let totalDiscountCents = 0;
  let totalOriginalCents = 0;
  let basketsWithDiscount = 0;

  for (const basket of baskets) {
    const basketDiscount = basket.lines.reduce((sum, t) => sum + (t.discount_cents ?? 0), 0);
    const basketOriginal = basket.lines.reduce((sum, t) => sum + (t.original_amount_cents ?? t.amount_paid_cents), 0);
    totalDiscountCents += basketDiscount;
    totalOriginalCents += basketOriginal;
    if (basketDiscount > 0) basketsWithDiscount += 1;
  }

  return {
    totalDiscountCents,
    totalOriginalCents,
    pctOfOriginal: totalOriginalCents > 0 ? totalDiscountCents / totalOriginalCents : null,
    basketsWithDiscount,
    pctOfBasketsWithDiscount: baskets.length > 0 ? basketsWithDiscount / baskets.length : 0,
  };
}

export type InsightSeverity = "critical" | "warning" | "info";

export interface SalesInsight {
  key: string;
  severity: InsightSeverity;
  evidence: string;
  recommendation?: string;
}

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;

/**
 * Evidence first, recommendation only when the evidence points at something
 * specific and checkable — same rule the Perdas tab's insights follow.
 */
export function generateSalesInsights(ctx: {
  current: PeriodStats;
  previous: PeriodStats | null;
  storeRows: StorePerformanceRow[];
  categoryMixByStore: { storeId: number; storeName: string; comparison: MixComparisonRow[] }[];
  affinityByStore: { storeId: number; storeName: string; top: ProductAffinityRow | null }[];
  isNetworkScope: boolean;
}): SalesInsight[] {
  const { current, previous, storeRows, categoryMixByStore, affinityByStore, isNetworkScope } = ctx;
  const insights: SalesInsight[] = [];
  const MATERIALITY_CENTS = 5_000;

  if (previous && Math.abs(current.revenueCents - previous.revenueCents) >= MATERIALITY_CENTS) {
    const delta = pctDelta(current.revenueCents, previous.revenueCents);
    if (delta !== null) {
      insights.push({
        key: "revenue-trend",
        severity: delta < -0.05 ? "critical" : "info",
        evidence:
          delta >= 0
            ? `A receita cresceu ${pct(delta)} em relação ao período de comparação: de ${money(previous.revenueCents)} para ${money(current.revenueCents)}.`
            : `A receita caiu ${pct(Math.abs(delta))} em relação ao período de comparação: de ${money(previous.revenueCents)} para ${money(current.revenueCents)}.`,
      });
    }
  }

  if (previous && current.basketCount > 0 && previous.basketCount > 0) {
    const basketDelta = pctDelta(current.basketCount, previous.basketCount);
    const ticketDelta =
      current.ticketAvgCents !== null && previous.ticketAvgCents !== null ? pctDelta(current.ticketAvgCents, previous.ticketAvgCents) : null;
    if (basketDelta !== null && Math.abs(basketDelta) >= 0.05) {
      insights.push({
        key: "basket-count-trend",
        severity: basketDelta < -0.1 ? "warning" : "info",
        evidence: `O número de compras ${basketDelta >= 0 ? "subiu" : "caiu"} ${pct(Math.abs(basketDelta))} (${previous.basketCount} → ${current.basketCount})${
          ticketDelta !== null ? `, enquanto o ticket médio ${ticketDelta >= 0 ? "subiu" : "caiu"} ${pct(Math.abs(ticketDelta))}` : ""
        } — a receita mudou porque ${Math.abs(basketDelta) > Math.abs(ticketDelta ?? 0) ? "o número de compradores mudou" : "o valor por compra mudou"}, não os dois igualmente.`,
      });
    }
  }

  // Store ticket vs network average — only meaningful with several stores in scope.
  if (isNetworkScope && storeRows.length >= 3) {
    const withTicket = storeRows.filter((r) => r.ticketAvgCents !== null && r.hasTransactionDetail);
    if (withTicket.length >= 3) {
      const avgTicket = withTicket.reduce((sum, r) => sum + (r.ticketAvgCents ?? 0), 0) / withTicket.length;
      for (const row of withTicket) {
        const delta = avgTicket > 0 ? ((row.ticketAvgCents ?? 0) - avgTicket) / avgTicket : 0;
        if (Math.abs(delta) >= 0.2 && avgTicket >= 100) {
          insights.push({
            key: `ticket-outlier-${row.storeId}`,
            severity: "info",
            evidence: `Ticket médio de ${row.storeName} está ${pct(Math.abs(delta))} ${delta >= 0 ? "acima" : "abaixo"} da média da rede (${money(row.ticketAvgCents ?? 0)} vs. ${money(avgTicket)}).`,
          });
          break; // one outlier is enough context, not a wall of per-store deltas
        }
      }
    }
  }

  // Category over-index (mix da loja × mix da rede).
  for (const entry of categoryMixByStore) {
    const top = entry.comparison[0];
    if (top && Math.abs(top.diffPp) >= 0.1 && top.storeShare >= 0.15) {
      insights.push({
        key: `mix-outlier-${entry.storeId}`,
        severity: "info",
        evidence: `${categoryLabel(top.category)} representa ${pct(top.storeShare)} das vendas de ${entry.storeName}, contra ${pct(top.networkShare)} na rede (${top.diffPp >= 0 ? "+" : ""}${(top.diffPp * 100).toFixed(1)} p.p.).`,
      });
      break;
    }
  }

  // Product affinity outlier.
  for (const entry of affinityByStore) {
    if (entry.top && entry.top.affinity >= 1.5 && entry.top.storeShareOfRevenue >= 0.03) {
      insights.push({
        key: `affinity-${entry.storeId}`,
        severity: "info",
        evidence: `${entry.top.name} é ${entry.top.affinity.toFixed(1)}× mais relevante em ${entry.storeName} do que na média da rede (${pct(entry.top.storeShareOfRevenue)} das vendas da loja vs. ${pct(entry.top.networkShareOfRevenue)} da rede).`,
      });
      break;
    }
  }

  if (current.margin.marginPct !== null && previous?.margin.marginPct != null) {
    const deltaPp = current.margin.marginPct - previous.margin.marginPct;
    if (Math.abs(deltaPp) >= 0.02) {
      insights.push({
        key: "margin-trend",
        severity: deltaPp < -0.03 ? "warning" : "info",
        evidence: `A margem ${deltaPp >= 0 ? "subiu" : "caiu"} ${Math.abs(deltaPp * 100).toFixed(1)} p.p. em relação ao período de comparação (${pct(previous.margin.marginPct)} → ${pct(current.margin.marginPct)}).`,
      });
    }
  }

  const order: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return insights.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 8);
}
