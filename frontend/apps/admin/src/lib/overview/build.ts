import { addMonths } from "../period-range";
import { buildCapex, buildCashSummary, buildCashUses, buildInvestors } from "./cash-uses";
import { buildInsights } from "./insights";
import { buildKpis } from "./kpis";
import { buildLoss } from "./loss";
import { buildProducts } from "./products";
import { buildReading } from "./reading";
import { buildStoreSummary } from "./stores";
import type { Overview, OverviewInput } from "./types";

/** Limites declarados — viram texto da tela e do PDF, não rodapé escondido. */
export const PHASE1_LIMITATIONS = [
  "Produtos em teste: não há cadastro/flag de produto em teste nem data de lançamento de SKU no sistema — bloco indisponível.",
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
  const products = input.sales ? buildProducts(period, previousPeriod, input.sales, input.costBySku, input.productNames) : null;
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
    loss,
    cash,
    cashUses,
    capex,
    investors,
    reading: buildReading({ period, previousPeriod, kpis, stores, products, cashUses, cash, insights }),
    limitations: PHASE1_LIMITATIONS,
  };
}
