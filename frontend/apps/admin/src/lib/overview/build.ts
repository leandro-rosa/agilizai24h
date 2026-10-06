import { addMonths } from "../period-range";
import { buildCapex, buildCashSummary, buildCashUses, buildInvestors } from "./cash-uses";
import { buildHighlights } from "./highlights";
import { buildInsights } from "./insights";
import { buildKpis } from "./kpis";
import { buildLoss } from "./loss";
import { buildPriceChanges, buildPriceVolume } from "./price-volume";
import { buildProducts } from "./products";
import { buildAliasMap, suggestPredecessors, type SalesInfo } from "./sku-match";
import { buildTests } from "./tests";
import { buildReading } from "./reading";
import { checkSalesCoverage } from "./sales-coverage";
import { buildStoreSummary } from "./stores";
import { buildWatchlist } from "./watchlist";
import type { Overview, OverviewInput } from "./types";

/** Limites declarados — viram texto da tela e do PDF, não rodapé escondido. */
export const PHASE1_LIMITATIONS = [
  "Produtos em teste: não há cadastro. A lista é derivada do abastecimento (mês do primeiro abastecimento do SKU na rede, nos últimos 3 meses) com regras provisórias; o sistema guarda só o mês, não a data da visita.",
  "Troca de código de barras: o sistema só sugere pares por nome parecido; o vínculo exige confirmação do operador.",
  "Investidores: só existem aportes (o campo de tipo descreve o que foi aportado). Devolução, distribuição e remuneração não existem no sistema.",
  "Notas fiscais pendentes (a emitir): o conceito não existe; só há notas emitidas a receber.",
  "A vencer: total de notas ainda não vencidas, sem corte em 30 dias.",
  "Categorias de despesa vêm do de-para da tesouraria (rótulo livre) e podem incluir categorias de natureza investimento.",
  "Margem por produto usa custo unitário datado do 1º dia da competência; SKU sem custo resolvido fica fora da margem.",
];

export function buildOverview(input: OverviewInput): Overview {
  const { period, months } = input;
  const previousPeriod = addMonths(period, -1);
  const [cur, prev] = months;

  const kpis = buildKpis(months);
  const salesByStore = (per: string) => {
    const m = new Map<number, number>();
    for (const c of input.sales?.cells ?? []) if (c.period === per) m.set(c.storeId, (m.get(c.storeId) ?? 0) + c.revenueCents);
    return m;
  };
  const bothSalesMonths = !!input.sales && input.sales.ingestedPeriods.includes(period) && input.sales.ingestedPeriods.includes(previousPeriod);
  const stores = buildStoreSummary(
    input.stores.current,
    input.stores.previous,
    input.stores.activeCount,
    prev.pnl?.netRevenueCents ?? null,
    bothSalesMonths ? { current: salesByStore(period), previous: salesByStore(previousPeriod) } : null,
  );
  const coverageFor = (per: string) =>
    input.sales && input.storeList ? checkSalesCoverage(per, input.sales.cells, input.sales.ingestedPeriods, input.storeList) : null;
  const alias = buildAliasMap(input.skuLinks);
  const products = input.sales ? buildProducts(period, previousPeriod, input.sales, input.costBySku, input.productNames, input.storeList, alias) : null;
  const tests = input.supply
    ? buildTests({
        period,
        supply: input.supply,
        sales: input.sales?.cells ?? [],
        costBySku: input.costBySku,
        names: input.productNames,
        alias,
        lossBySkuByPeriod: Object.fromEntries(months.map((m) => [m.period, m.finance?.lossBySku ?? null])),
      })
    : null;

  // Pergunta "é o mesmo produto de um código antigo?" para o que parece novo: SKU sem histórico e SKU em teste.
  const byMonth = new Map<string, Map<string, number>>();
  const lastSold = new Map<string, string>();
  for (const c of input.sales?.cells ?? []) {
    const m = byMonth.get(c.sku) ?? new Map<string, number>();
    m.set(c.period, (m.get(c.period) ?? 0) + c.quantity);
    byMonth.set(c.sku, m);
    if (c.quantity > 0 && (lastSold.get(c.sku) ?? "") < c.period) lastSold.set(c.sku, c.period);
  }
  const salesInfo = new Map<string, SalesInfo>();
  for (const [sku, m] of byMonth) {
    const prior = [...m].filter(([per]) => per < period).map(([, u]) => u);
    salesInfo.set(sku, { lastSoldPeriod: lastSold.get(sku) ?? null, unitsInPeriod: m.get(period) ?? 0, peakBefore: prior.length ? Math.max(...prior) : 0 });
  }
  const looksNew = new Set<string>([
    ...(products?.topSold ?? []).concat(products?.rising ?? [], products?.falling ?? [], products?.relevantChange ?? []).filter((r) => r.behavior === "novo").map((r) => r.sku),
    ...(tests?.rows ?? []).map((r) => r.sku),
  ]);
  const skuSuggestions = suggestPredecessors({ newSkus: [...looksNew], catalogue: input.catalogue, links: input.skuLinks, salesInfo });
  const loss = buildLoss(cur, prev, input.productNames);
  const cash = buildCashSummary(cur, prev, input.aging);
  const cashUses = buildCashUses(months);
  const capex = buildCapex(months);
  const investors = buildInvestors(months);

  const priceVolume = input.sales ? buildPriceVolume(period, previousPeriod, input.sales.cells, input.sales.ingestedPeriods) : null;
  const insights = buildInsights({
    priceVolume,
    period,
    previousPeriod,
    kpis,
    stores,
    products,
    loss,
    cash,
    cashUses,
    capex,
    revenueCents: prev.pnl?.netRevenueCents ?? null,
    revenueCurrentCents: cur.pnl?.netRevenueCents ?? null,
    // Séries do mais antigo ao mais novo (months vem competência primeiro).
    series: { revenue: [...months].reverse().map((m) => m.pnl?.netRevenueCents ?? null), loss: [...months].reverse().map((m) => m.finance?.lossValueCents ?? null) },
  });
  const highlights = buildHighlights({ products, stores, insights, revenueBase: prev.pnl?.netRevenueCents ?? null });
  const coverage = { current: coverageFor(period), previous: coverageFor(previousPeriod) };
  const watchlist = buildWatchlist({
    period,
    previousPeriod,
    previousClosed: input.previousClosed,
    revenueBase: prev.pnl?.netRevenueCents ?? null,
    insights,
    products,
    stores,
    tests,
    loss,
    cash,
    coverage,
    pendingSkuSuggestions: skuSuggestions.length,
    revenueFell: ((kpis.find((k) => k.key === "revenue")?.vsPrevious as { pct: number | null } | undefined)?.pct ?? 0) < 0,
  });

  return {
    period,
    previousPeriod,
    avg3Periods: [addMonths(period, -1), addMonths(period, -2), addMonths(period, -3)],
    closed: input.closed,
    previousClosed: input.previousClosed,
    closedAt: cur.pnl?.computedAt ?? null,
    kpis,
    insights,
    highlights,
    watchlist,
    stores,
    products,
    priceChanges: buildPriceChanges(priceVolume, input.productNames, input.costBySku),
    salesCoverage: coverage,
    tests,
    skuSuggestions,
    loss,
    cash,
    cashUses,
    capex,
    investors,
    reading: buildReading({ period, previousPeriod, kpis, stores, products, cashUses, cash, insights }),
    limitations: PHASE1_LIMITATIONS,
  };
}
