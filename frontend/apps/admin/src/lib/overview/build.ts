import { addMonths } from "../period-range";
import { buildCapex, buildCashSummary, buildCashUses, buildInvestors } from "./cash-uses";
import { buildInsights } from "./insights";
import { buildKpis } from "./kpis";
import { buildLoss } from "./loss";
import { buildProducts } from "./products";
import { buildAliasMap, suggestPredecessors } from "./sku-match";
import { buildTests } from "./tests";
import { buildReading } from "./reading";
import { buildStoreSummary } from "./stores";
import type { Overview, OverviewInput } from "./types";

/** Limites declarados — viram texto da tela e do PDF, não rodapé escondido. */
export const PHASE1_LIMITATIONS = [
  "Produtos em teste: não há cadastro. A lista é derivada do abastecimento (mês do primeiro abastecimento do SKU na rede, em poucas lojas) com regras provisórias; o sistema guarda só o mês, não a data da visita.",
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
  const stores = buildStoreSummary(input.stores.current, input.stores.previous, input.stores.activeCount, prev.pnl?.netRevenueCents ?? null);
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
  const salesInfo = new Map<string, { lastSoldPeriod: string | null; unitsInPeriod: number }>();
  for (const c of input.sales?.cells ?? []) {
    const cur = salesInfo.get(c.sku) ?? { lastSoldPeriod: null, unitsInPeriod: 0 };
    if (c.quantity > 0 && (cur.lastSoldPeriod === null || c.period > cur.lastSoldPeriod)) cur.lastSoldPeriod = c.period;
    if (c.period === period) cur.unitsInPeriod += c.quantity;
    salesInfo.set(c.sku, cur);
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

  const insights = buildInsights({
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
  });

  return {
    period,
    previousPeriod,
    avg3Periods: [addMonths(period, -1), addMonths(period, -2), addMonths(period, -3)],
    closed: input.closed,
    closedAt: cur.pnl?.computedAt ?? null,
    kpis,
    insights,
    stores,
    products,
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
