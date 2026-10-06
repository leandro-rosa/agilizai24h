import { valueDelta } from "./compare";
import { isMaterial } from "./materiality";
import { classifyBehavior, distribution } from "./product-behavior";
import type { ProductRow, ProductsSummary, SalesCell } from "./types";

const MARGIN_SHIFT_PP = 3;
const TOP_N = 10;

interface Agg {
  units: number;
  revenue: number;
  /** Receita/custo só dos SKUs com custo resolvido — margem nunca trata custo ausente como zero. */
  marginRevenue: number;
  marginCost: number;
}

function aggregate(cells: SalesCell[], costBySku: Record<string, number> | null): Agg {
  const a: Agg = { units: 0, revenue: 0, marginRevenue: 0, marginCost: 0 };
  for (const c of cells) {
    a.units += c.quantity;
    a.revenue += c.revenueCents;
    const cost = costBySku?.[c.sku];
    if (cost !== undefined) {
      a.marginRevenue += c.revenueCents;
      a.marginCost += cost * c.quantity;
    }
  }
  return a;
}

const marginPct = (a: Agg) => (a.marginRevenue > 0 ? (a.marginRevenue - a.marginCost) / a.marginRevenue : null);

export function buildProducts(
  period: string,
  previousPeriod: string,
  sales: { cells: SalesCell[]; ingestedPeriods: string[]; seriesPeriods: string[] },
  costBySku: Record<string, number> | null,
  names: Record<string, string>,
): ProductsSummary | null {
  if (!sales.ingestedPeriods.includes(period)) return null;
  const hasComparison = sales.ingestedPeriods.includes(previousPeriod);

  const bySku = new Map<string, SalesCell[]>();
  for (const c of sales.cells) {
    const list = bySku.get(c.sku) ?? [];
    list.push(c);
    bySku.set(c.sku, list);
  }

  const totalRevenue = sales.cells.filter((c) => c.period === period).reduce((s, c) => s + c.revenueCents, 0);
  const totalPrevRevenue = sales.cells.filter((c) => c.period === previousPeriod).reduce((s, c) => s + c.revenueCents, 0);

  const rows: ProductRow[] = [];
  for (const [sku, cells] of bySku) {
    const cur = cells.filter((c) => c.period === period);
    if (cur.length === 0) continue;
    const prev = cells.filter((c) => c.period === previousPeriod);
    const a = aggregate(cur, costBySku);
    const p = hasComparison ? aggregate(prev, costBySku) : null;

    // Mês ingerido sem venda do SKU = 0 real; mês não ingerido = null (buraco, não queda).
    const series = sales.seriesPeriods.map((per) =>
      sales.ingestedPeriods.includes(per) ? cells.filter((c) => c.period === per).reduce((s, c) => s + c.quantity, 0) : null,
    );

    const prevByStore = new Map<number, number>();
    for (const c of prev) prevByStore.set(c.storeId, (prevByStore.get(c.storeId) ?? 0) + c.quantity);
    const curByStore = new Map<number, number>();
    for (const c of cur) curByStore.set(c.storeId, (curByStore.get(c.storeId) ?? 0) + c.quantity);
    const storeIds = new Set([...prevByStore.keys(), ...curByStore.keys()]);
    const deltas = [...storeIds].map((id) => (curByStore.get(id) ?? 0) - (prevByStore.get(id) ?? 0));

    const du = p ? valueDelta(a.units, p.units) : { pct: null, abs: null };
    const dr = p ? valueDelta(a.revenue, p.revenue) : { pct: null, abs: null };
    const m0 = marginPct(a);
    const m1 = p ? marginPct(p) : null;

    rows.push({
      sku,
      name: names[sku] ?? sku,
      units: a.units,
      revenueCents: a.revenue,
      shareOfRevenue: totalRevenue > 0 ? a.revenue / totalRevenue : null,
      marginPct: m0,
      marginDeltaPp: m0 !== null && m1 !== null ? (m0 - m1) * 100 : null,
      marginUnresolved: a.marginRevenue < a.revenue,
      unitsPrevious: p ? p.units : null,
      deltaUnitsPct: du.pct,
      deltaRevenueCents: dr.abs,
      deltaRevenuePct: dr.pct,
      series,
      behavior: classifyBehavior(series),
      distribution: p ? distribution(deltas) : null,
      material: isMaterial({ deltaAbs: dr.abs, deltaPct: dr.pct, base: totalPrevRevenue }),
    });
  }

  const byRevenue = [...rows].sort((a, b) => b.revenueCents - a.revenueCents);
  const withDelta = rows.filter((r) => r.material && r.deltaRevenueCents !== null);
  const rising = withDelta.filter((r) => (r.deltaRevenueCents ?? 0) > 0).sort((a, b) => (b.deltaRevenueCents ?? 0) - (a.deltaRevenueCents ?? 0));
  const falling = withDelta.filter((r) => (r.deltaRevenueCents ?? 0) < 0).sort((a, b) => (a.deltaRevenueCents ?? 0) - (b.deltaRevenueCents ?? 0));
  const relevantChange = rows
    .filter((r) => {
      const relevantShare = (r.shareOfRevenue ?? 0) >= 0.01;
      return relevantShare && (r.behavior === "mudanca_recente" || (r.marginDeltaPp !== null && Math.abs(r.marginDeltaPp) >= MARGIN_SHIFT_PP));
    })
    .sort((a, b) => b.revenueCents - a.revenueCents);

  return {
    topSold: byRevenue.slice(0, TOP_N),
    rising: rising.slice(0, TOP_N),
    falling: falling.slice(0, TOP_N),
    relevantChange: relevantChange.slice(0, TOP_N),
    seriesPeriods: sales.seriesPeriods,
    hasComparison,
  };
}
