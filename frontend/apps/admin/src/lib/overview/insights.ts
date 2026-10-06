import { moneyCompact, period as fmtPeriod } from "../format";
import { signedPct } from "./compare";
import { BEHAVIOR_LABELS, distributionText } from "./product-behavior";
import { reasonLabel } from "../removal-reasons";
import type { CapexSummary, CashSummary, CashUses, Insight, KpiResult, LossSummary, ProductsSummary, StoreSummary } from "./types";
import type { ValueDelta } from "./compare";

export const MAX_INSIGHTS = 6;

export interface InsightInput {
  period: string;
  previousPeriod: string;
  kpis: KpiResult[];
  stores: StoreSummary | null;
  products: ProductsSummary | null;
  loss: LossSummary | null;
  cash: CashSummary;
  cashUses: CashUses | null;
  capex: CapexSummary | null;
  /** Receita líquida do mês anterior (base de representatividade). */
  revenueCents: number | null;
  /** Receita líquida da rede na competência (DRE). */
  revenueCurrentCents: number | null;
}

const kpi = (kpis: KpiResult[], key: KpiResult["key"]) => kpis.find((k) => k.key === key)!;
const pctWord = (pct: number) => `${Math.abs(pct * 100).toFixed(1).replace(".", ",")}%`;
const verb = (pct: number, up: string, down: string) => (pct >= 0 ? up : down);
const share = (abs: number | null, base: number | null) => (abs === null || !base ? 0 : Math.abs(abs) / base);

/**
 * Cada insight diz o que mudou, quanto, vs. o quê, onde e o impacto — e só
 * entra se for material. Sem frase genérica: tudo é fato já calculado.
 */
export function buildInsights(i: InsightInput): Insight[] {
  const out: Insight[] = [];
  const prevLabel = fmtPeriod(i.previousPeriod);
  const base = i.revenueCents;

  const rev = kpi(i.kpis, "revenue");
  const revD = rev.vsPrevious as ValueDelta;
  if (revD.pct !== null && revD.abs !== null && Math.abs(revD.pct) >= 0.02) {
    const movers = revD.pct >= 0 ? i.stores?.topGrowth : i.stores?.topDecline;
    const where = movers?.length ? `, com ${revD.pct >= 0 ? "maior contribuição de" : "maiores quedas em"} ${movers.map((s) => s.name).join(", ")}` : "";
    out.push({
      id: "revenue",
      tone: revD.pct >= 0 ? "positive" : "negative",
      title: `Faturamento ${verb(revD.pct, "cresceu", "caiu")} ${pctWord(revD.pct)}`,
      detail: `${moneyCompact(Math.abs(revD.abs))} ${verb(revD.pct, "acima", "abaixo")} de ${prevLabel}${where}.`,
      score: 1,
    });
  }

  const loss = kpi(i.kpis, "loss");
  const lossD = loss.vsPrevious as ValueDelta;
  if (lossD.pct !== null && lossD.abs !== null && share(lossD.abs, base) >= 0.002 && Math.abs(lossD.pct) >= 0.1) {
    const driver = i.loss?.byReason.filter((r) => r.deltaCents !== null).sort((a, b) => Math.abs(b.deltaCents ?? 0) - Math.abs(a.deltaCents ?? 0))[0];
    const driverTxt = driver && driver.deltaCents !== null && Math.sign(driver.deltaCents) === Math.sign(lossD.abs) ? `, com variação concentrada em “${reasonLabel(driver.reason)}” (${driver.deltaCents > 0 ? "+" : "−"}${moneyCompact(Math.abs(driver.deltaCents))})` : "";
    out.push({
      id: "loss",
      tone: lossD.pct <= 0 ? "positive" : "negative",
      title: `Perdas ${verb(lossD.pct, "subiram", "caíram")} ${pctWord(lossD.pct)}`,
      detail: `${moneyCompact(loss.value ?? 0)} no mês vs. ${prevLabel}${driverTxt}.`,
      score: share(lossD.abs, base) * 2,
    });
  }

  // Venda das lojas (sales-service) × receita líquida da rede (DRE): quando divergem, o leitor precisa ver as duas.
  const st = i.stores;
  if (st && st.basis === "vendas" && st.storesRevenuePreviousCents > 0 && i.revenueCurrentCents !== null && i.revenueCents !== null && i.revenueCents > 0) {
    const salesPct = (st.storesRevenueCents - st.storesRevenuePreviousCents) / st.storesRevenuePreviousCents;
    const networkPct = (i.revenueCurrentCents - i.revenueCents) / i.revenueCents;
    if (Math.abs(salesPct - networkPct) >= 0.05 && Math.abs(salesPct) >= 0.02) {
      out.push({
        id: "stores-vs-network",
        tone: salesPct < 0 ? "negative" : "positive",
        title: `Vendas das lojas ${verb(salesPct, "cresceram", "caíram")} ${pctWord(salesPct)}, contra ${signedPct(networkPct)} da receita líquida da rede`,
        detail: `${st.compared} lojas venderam ${moneyCompact(st.storesRevenueCents)} (${prevLabel}: ${moneyCompact(st.storesRevenuePreviousCents)}); ${st.up} cresceram, ${st.down} recuaram e ${st.stable} ficaram estáveis. A receita líquida da rede (DRE) foi de ${moneyCompact(i.revenueCents)} para ${moneyCompact(i.revenueCurrentCents)}.`,
        score: Math.abs(salesPct - networkPct) * 3,
      });
    }
  }

  const revPct = revD.pct;
  const contrib = kpi(i.kpis, "contribution");
  const contribPct = (contrib.vsPrevious as ValueDelta).pct;
  if (revPct !== null && contribPct !== null && Math.abs(contribPct - revPct) >= 0.03) {
    out.push({
      id: "margin-gap",
      tone: contribPct < revPct ? "negative" : "positive",
      title: `Margem de contribuição ${contribPct < revPct ? "cresceu menos" : "cresceu mais"} que a receita`,
      detail: `Receita ${signedPct(revPct)} e margem de contribuição ${signedPct(contribPct)} vs. ${prevLabel}.`,
      score: Math.abs(contribPct - revPct),
    });
  }

  const stock = i.cashUses?.stock;
  if (stock && stock.material && stock.deltaPct !== null && stock.deltaCents !== null) {
    const rvr = i.cashUses?.stockVsRevenue?.revenueDeltaPct ?? null;
    out.push({
      id: "stock",
      tone: "neutral",
      title: `Compras de estoque ${verb(stock.deltaPct, "aumentaram", "caíram")} ${pctWord(stock.deltaPct)}`,
      detail: `${moneyCompact(Math.abs(stock.deltaCents))} ${verb(stock.deltaPct, "acima", "abaixo")} de ${prevLabel}${rvr !== null ? `, com faturamento ${signedPct(rvr)} no mesmo intervalo` : ""}.`,
      score: share(stock.deltaCents, base),
    });
  }

  const capex = i.cashUses?.capex;
  if (capex && capex.material && capex.deltaPct !== null && capex.deltaCents !== null) {
    out.push({
      id: "capex",
      tone: "neutral",
      title: `CAPEX ${verb(capex.deltaPct, "subiu", "caiu")} ${pctWord(capex.deltaPct)}`,
      detail: `${moneyCompact(capex.currentCents)} no mês, ${moneyCompact(Math.abs(capex.deltaCents))} ${verb(capex.deltaPct, "acima", "abaixo")} de ${prevLabel}${i.capex?.investment?.top.length ? `; maiores origens: ${i.capex.investment.top.slice(0, 2).map((t) => t.category).join(", ")}` : ""}.`,
      score: share(capex.deltaCents, base),
    });
  }

  for (const e of i.cashUses?.expenses.slice(0, 2) ?? []) {
    if (e.deltaPct === null || e.deltaCents === null) continue;
    out.push({
      id: e.key,
      tone: "neutral",
      title: `Despesa com ${e.label} ${signedPct(e.deltaPct)}`,
      detail: `${moneyCompact(e.currentCents)} no mês vs. ${moneyCompact(e.previousCents ?? 0)} em ${prevLabel}.`,
      score: share(e.deltaCents, base),
    });
  }

  const lead = i.products?.rising[0] ?? null;
  const drop = i.products?.falling[0] ?? null;
  for (const [p, up] of [[lead, true], [drop, false]] as const) {
    if (!p || p.deltaRevenuePct === null || p.deltaRevenueCents === null) continue;
    const distTxt = distributionText(p.distribution);
    const dist = distTxt ? ` ${distTxt[0].toUpperCase()}${distTxt.slice(1)}.` : "";
    const consistent = p.behavior === "crescimento_consistente" || p.behavior === "queda_consistente" ? ` ${BEHAVIOR_LABELS[p.behavior]} nos últimos 4 meses.` : "";
    out.push({
      id: `product:${p.sku}`,
      tone: up ? "positive" : "negative",
      title: `${p.name} ${signedPct(p.deltaRevenuePct)} em faturamento`,
      detail: `${moneyCompact(Math.abs(p.deltaRevenueCents))} ${up ? "acima" : "abaixo"} de ${prevLabel}${p.shareOfRevenue !== null ? ` (${(p.shareOfRevenue * 100).toFixed(1).replace(".", ",")}% da receita de produtos)` : ""}.${dist}${consistent}`,
      score: share(p.deltaRevenueCents, base),
    });
  }

  if (i.cash.operatingPositiveCashFell && i.cash.cashDeltaCents !== null) {
    out.push({
      id: "cash-vs-result",
      tone: "negative",
      title: "Resultado operacional positivo, mas o caixa caiu",
      detail: `O caixa recuou ${moneyCompact(Math.abs(i.cash.cashDeltaCents))} no mês, apesar do resultado operacional positivo.`,
      score: share(i.cash.cashDeltaCents, base) * 1.5,
    });
  }

  // Receita sempre primeiro (é a pergunta nº 1); o resto pela representatividade.
  const [first, ...rest] = [...out].sort((a, b) => (a.id === "revenue" ? -1 : b.id === "revenue" ? 1 : b.score - a.score));
  return first ? [first, ...rest].slice(0, MAX_INSIGHTS) : [];
}
