import { moneyCompact, period as fmtPeriod } from "../format";
import { signedPct, signedPp, type RateDelta, type ValueDelta } from "./compare";
import { isMaterial } from "./materiality";
import { BEHAVIOR_LABELS, distributionText } from "./product-behavior";
import { hasRepricing, type PriceVolume } from "./price-volume";
import { baseText, needsBase, rankScore, recurrenceOf } from "./ranking";
import type { CapexSummary, CashSummary, CashUses, Insight, KpiResult, LossSummary, ProductRow, ProductsSummary, StoreSummary } from "./types";

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
  /** Séries mensais, do mais antigo ao mais novo (competência por último), para medir recorrência. */
  series: { revenue: (number | null)[]; loss: (number | null)[] };
  /** Efeito preço × volume nas vendas de produtos; null quando falta venda de um dos meses. */
  priceVolume?: PriceVolume | null;
}

const kpi = (kpis: KpiResult[], key: KpiResult["key"]) => kpis.find((k) => k.key === key)!;
const pctWord = (pct: number) => `${Math.abs(pct * 100).toFixed(1).replace(".", ",")}%`;
const verb = (pct: number, up: string, down: string) => (pct >= 0 ? up : down);
const un = (n: number) => new Intl.NumberFormat("pt-BR").format(n);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const HREF = { stores: "/finance/stores", products: "/commercial-intelligence", loss: "/supply", cash: "/finance/cash-flow", treasury: "/treasury", capex: "/capex" } as const;

/** Mostra "A → B" em R$ compacto. */
const fromTo = (a: number | null, b: number | null) => (a === null || b === null ? "" : `${moneyCompact(a)} → ${moneyCompact(b)}`);

function productInsight(p: ProductRow, input: InsightInput, previousLabel: string): Insight | null {
  if (p.deltaRevenuePct === null || p.deltaRevenueCents === null || p.revenuePreviousCents === null) return null;
  const up = p.deltaRevenueCents > 0;
  const storesTotal = p.byStore.length || 1;
  const affected = p.distribution?.storesAffected ?? 0;
  // Base de unidades sempre que o % puder enganar (salto > 100% ou base pequena).
  const withBase = p.unitsPrevious !== null && needsBase(p.unitsPrevious, p.units, p.deltaUnitsPct);
  const dist = distributionText(p.distribution);
  const consistent = p.behavior === "crescimento_consistente" || p.behavior === "queda_consistente" ? ` ${BEHAVIOR_LABELS[p.behavior]} nos últimos 4 meses.` : "";
  return {
    id: `product:${p.sku}`,
    tone: up ? "positive" : "negative",
    title: `${p.name} ${signedPct(p.deltaRevenuePct)} em faturamento${withBase && p.unitsPrevious !== null ? ` (${baseText(p.unitsPrevious, p.units, un, "un.")})` : ""}`,
    detail: `${fromTo(p.revenuePreviousCents, p.revenueCents)} vs. ${previousLabel}${p.shareOfRevenue !== null ? `, ${(p.shareOfRevenue * 100).toFixed(1).replace(".", ",")}% da receita de produtos` : ""}.${dist ? ` ${dist[0].toUpperCase()}${dist.slice(1)}.` : ""}${consistent}`,
    href: HREF.products,
    score: rankScore({
      impactCents: p.deltaRevenueCents,
      baseCents: input.revenueCents,
      share: p.shareOfRevenue,
      recurrence: recurrenceOf(p.series),
      breadth: affected / storesTotal,
    }),
  };
}

/**
 * O que mudou no mês, ordenado por RELEVÂNCIA (impacto em R$, representatividade,
 * recorrência e lojas afetadas) — não pelo tamanho do %. Cada item traz a base
 * (anterior → atual) e só descreve fatos e correlações; nenhuma causa é afirmada.
 */
const signedMoney = (cents: number) => `${cents < 0 ? "−" : "+"}${moneyCompact(Math.abs(cents))}`;

/**
 * Reajuste de preço × unidades: decomposição aritmética da receita de produtos. Sempre
 * observação — o texto nunca diz que o reajuste CAUSOU a variação das unidades.
 */
function priceVolumeInsight(i: InsightInput): Insight | null {
  const pv = i.priceVolume;
  if (!hasRepricing(pv)) return null;
  const r = pv.repriced;
  const pctOf = (a: number, b: number) => (a > 0 ? (b - a) / a : null);
  const repUnits = pctOf(r.unitsBefore, r.unitsAfter);
  const othUnits = pctOf(pv.others.unitsBefore, pv.others.unitsAfter);
  const margin = (kpi(i.kpis, "operatingMargin").vsPrevious as RateDelta).pp;
  const revPct = (kpi(i.kpis, "revenue").vsPrevious as ValueDelta).pct;
  const prev = fmtPeriod(pv.previousPeriod);
  const others = pv.others.count > 0 ? ` Nos demais ${pv.others.count} produtos: ${baseText(pv.others.unitsBefore, pv.others.unitsAfter, un, "un")}.` : "";
  const cmp =
    repUnits !== null && othUnits !== null
      ? repUnits < othUnits - 0.02
        ? `as unidades variaram ${signedPct(repUnits, 0)} nos reajustados e ${signedPct(othUnits, 0)} nos demais — os dois movimentos coincidem nos mesmos produtos, o que não prova causa. `
        : `as unidades variaram ${signedPct(repUnits, 0)} nos reajustados e ${signedPct(othUnits, 0)} nos demais — a queda não é maior onde o preço subiu. `
      : "";
  const mgn =
    margin !== null && revPct !== null && revPct < 0 && margin > 0
      ? `o faturamento caiu e a margem operacional subiu ${signedPp(margin).replace(/^\+/, "")}; o sistema não separa quanto da margem veio de preço e quanto de custo. `
      : "";
  return {
    id: "price-volume",
    tone: "neutral",
    title: `Reajuste de preço em ${plural(r.count, "produto", "produtos")} (${r.raised} subiram, ${r.lowered} baixaram): preço ${signedMoney(r.priceEffectCents)}, unidades ${signedMoney(r.volumeEffectCents)}`,
    detail:
      `Nos reajustados (preço realizado variou ≥ 3%): ${baseText(r.unitsBefore, r.unitsAfter, un, "un")} vs. ${prev}.${others} ` +
      `Observação: ${cmp}${mgn}calendário de ${pv.days.after} dias contra ${pv.days.before}. (Estimativa: preço realizado = receita ÷ unidades do mês.)`,
    href: HREF.products,
    score: rankScore({
      impactCents: Math.max(Math.abs(r.priceEffectCents), Math.abs(r.volumeEffectCents)),
      baseCents: pv.revenueBeforeCents,
      share: pv.revenueAfterCents > 0 ? Math.min(1, r.skus.reduce((s, x) => s + x.priceAfterCents * x.unitsAfter, 0) / pv.revenueAfterCents) : 0,
      breadth: r.count / (r.count + pv.others.count),
    }),
  };
}

export function buildInsights(i: InsightInput): Insight[] {
  const out: Insight[] = [];
  const prevLabel = fmtPeriod(i.previousPeriod);
  const base = i.revenueCents;
  const compared = i.stores?.compared ?? 0;

  const rev = kpi(i.kpis, "revenue");
  const revD = rev.vsPrevious as ValueDelta;
  if (revD.pct !== null && revD.abs !== null && Math.abs(revD.pct) >= 0.02) {
    const up = revD.pct >= 0;
    const ex = up ? i.stores?.growthExplainers : i.stores?.declineExplainers;
    const where = ex && ex.stores.length ? ` Nas lojas (vendas), ${plural(ex.stores.length, "loja explica", "lojas explicam")} ${Math.round(ex.coveredShare * 100)}% d${up ? "o aumento" : "a queda"}: ${ex.stores.map((s) => s.name).join(", ")}.` : "";
    out.push({
      id: "revenue",
      tone: up ? "positive" : "negative",
      title: `Faturamento ${verb(revD.pct, "cresceu", "caiu")} ${pctWord(revD.pct)}`,
      detail: `${fromTo(rev.previous, rev.value)} (receita líquida, ${prevLabel} → ${fmtPeriod(i.period)}).${where}`,
      href: HREF.stores,
      score: rankScore({ impactCents: revD.abs, baseCents: base, share: 1, recurrence: recurrenceOf(i.series.revenue), breadth: compared ? (ex?.storeCount ?? 0) / compared : 0 }),
    });
  }

  const pvIns = priceVolumeInsight(i);
  if (pvIns) out.push(pvIns);

  // Venda das lojas × receita líquida da rede (DRE): quando divergem, o leitor precisa ver as duas.
  const st = i.stores;
  if (st && st.basis === "vendas" && st.storesRevenuePreviousCents > 0 && i.revenueCurrentCents !== null && i.revenueCents !== null && i.revenueCents > 0) {
    const salesPct = (st.storesRevenueCents - st.storesRevenuePreviousCents) / st.storesRevenuePreviousCents;
    const networkPct = (i.revenueCurrentCents - i.revenueCents) / i.revenueCents;
    if (Math.abs(salesPct - networkPct) >= 0.05 && Math.abs(salesPct) >= 0.02) {
      out.push({
        id: "stores-vs-network",
        tone: salesPct < 0 ? "negative" : "positive",
        title: `Vendas das lojas ${verb(salesPct, "cresceram", "caíram")} ${pctWord(salesPct)}, contra ${signedPct(networkPct)} da receita líquida da rede`,
        detail: `Lojas: ${fromTo(st.storesRevenuePreviousCents, st.storesRevenueCents)}; ${st.up} cresceram, ${st.down} recuaram, ${st.stable} estáveis. Rede (DRE): ${fromTo(i.revenueCents, i.revenueCurrentCents)}. Observação: as duas medidas não coincidem.`,
        href: HREF.stores,
        score: rankScore({ impactCents: st.storesRevenueCents - st.storesRevenuePreviousCents, baseCents: base, share: 0.8, breadth: compared ? Math.max(st.up, st.down) / compared : 0 }),
      });
    }
  }

  const contrib = kpi(i.kpis, "contribution");
  const contribPct = (contrib.vsPrevious as ValueDelta).pct;
  if (revD.pct !== null && contribPct !== null && Math.abs(contribPct - revD.pct) >= 0.03) {
    out.push({
      id: "margin-gap",
      tone: contribPct < revD.pct ? "negative" : "positive",
      title: `Margem de contribuição ${contribPct < revD.pct ? "cresceu menos" : "cresceu mais"} que a receita`,
      detail: `Receita ${signedPct(revD.pct)} (${fromTo(rev.previous, rev.value)}) e margem de contribuição ${signedPct(contribPct)} (${fromTo(contrib.previous, contrib.value)}) vs. ${prevLabel}.`,
      href: "/finance/pnl",
      score: rankScore({ impactCents: (contrib.vsPrevious as ValueDelta).abs, baseCents: base, share: 0.6, recurrence: 0 }),
    });
  }

  const loss = kpi(i.kpis, "loss");
  const lossD = loss.vsPrevious as ValueDelta;
  if (lossD.pct !== null && lossD.abs !== null && Math.abs(lossD.pct) >= 0.1 && base && Math.abs(lossD.abs) / base >= 0.002) {
    const ch = i.loss?.changes;
    const r0 = ch?.byReason[0];
    const reasonTxt = r0 ? ` Maior mudança por motivo: ${r0.label} (${fromTo(r0.previousCents, r0.currentCents)}).` : "";
    const skuTxt = ch?.skusExplainingShare ? ` ${plural(ch.skusExplainingShare.count, "produto explica", "produtos explicam")} ${Math.round(ch.skusExplainingShare.share * 100)}% da variação.` : "";
    out.push({
      id: "loss",
      tone: lossD.pct <= 0 ? "positive" : "negative",
      title: `Perdas ${verb(lossD.pct, "subiram", "caíram")} ${pctWord(lossD.pct)}`,
      detail: `${fromTo(loss.previous, loss.value)} vs. ${prevLabel}.${reasonTxt}${skuTxt}`,
      href: HREF.loss,
      score: rankScore({ impactCents: lossD.abs, baseCents: base, share: 0.5, recurrence: recurrenceOf(i.series.loss), breadth: ch?.skusExplainingShare ? 0.3 : 0 }),
    });
  }

  // Movimentos financeiros selecionados (variação material): os 2 de maior relevância.
  for (const l of (i.cashUses?.lines ?? []).filter((x) => x.reasons.includes("variacao")).slice(0, 2)) {
    if (l.deltaPct === null || l.deltaCents === null || l.previousCents === null) continue;
    const stock = l.key === "cat:Estoque";
    const obs = stock && i.cashUses?.stockVsRevenue?.revenueDeltaPct != null ? ` Observação: o faturamento variou ${signedPct(i.cashUses.stockVsRevenue.revenueDeltaPct)} no mesmo intervalo (sem conclusão de causa).` : "";
    out.push({
      id: l.key,
      tone: "neutral",
      title: stock ? `Compras de estoque ${verb(l.deltaPct, "aumentaram", "caíram")} ${pctWord(l.deltaPct)}` : `Despesa com ${l.label} ${signedPct(l.deltaPct)}`,
      detail: `${fromTo(l.previousCents, l.currentCents)} vs. ${prevLabel}${l.shareOfOutflow !== null ? ` (${Math.round(l.shareOfOutflow * 100)}% das despesas do mês)` : ""}.${obs}`,
      href: HREF.treasury,
      score: l.score,
    });
  }

  const inv = i.capex?.investment;
  if (inv && inv.previousCents !== null && inv.deltaPct !== null) {
    const abs = inv.totalCents - inv.previousCents;
    if (isMaterial({ deltaAbs: abs, deltaPct: inv.deltaPct, base })) {
      out.push({
        id: "capex",
        tone: "neutral",
        title: `CAPEX ${verb(inv.deltaPct, "subiu", "caiu")} ${pctWord(inv.deltaPct)}`,
        detail: `${fromTo(inv.previousCents, inv.totalCents)} vs. ${prevLabel} (saídas de investimento, como no Fluxo de caixa)${inv.top.length ? `; maiores origens: ${inv.top.slice(0, 2).map((t) => t.category).join(", ")}` : ""}.`,
        href: HREF.capex,
        score: rankScore({ impactCents: abs, baseCents: base, share: 0.5 }),
      });
    }
  }

  // Produtos: os 2 de maior relevância (alta ou queda), nunca os de maior %.
  const productPool = [...(i.products?.rising ?? []), ...(i.products?.falling ?? [])];
  const products = productPool.map((p) => productInsight(p, i, prevLabel)).filter((x): x is Insight => !!x).sort((a, b) => b.score - a.score).slice(0, 2);
  out.push(...products);

  if (i.cash.operatingPositiveCashFell && i.cash.cashDeltaCents !== null && i.cash.closing !== null && i.cash.opening !== null) {
    out.push({
      id: "cash-vs-result",
      tone: "negative",
      title: "Resultado operacional positivo, mas o caixa caiu",
      detail: `Caixa ${fromTo(i.cash.opening, i.cash.closing)} no mês, com resultado operacional positivo no DRE. Observação: os dois números não são a mesma medida.`,
      href: HREF.cash,
      score: rankScore({ impactCents: i.cash.cashDeltaCents, baseCents: base, share: 0.6 }),
    });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, MAX_INSIGHTS);
}
