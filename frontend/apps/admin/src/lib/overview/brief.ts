import { reasonLabel } from "../removal-reasons";
import { friendlyMoney, KPI_PLAIN, moreOrLess, plainify, PLAIN, trafficLight, type TrafficLight } from "./plain";
import { priceImpactReading, type PriceChanges } from "./price-volume";
import { monthName } from "./reading";
import type { RateDelta, ValueDelta } from "./compare";
import type { KpiResult, Overview } from "./types";

/** "agosto" a partir de "2026-08". */
export const monthOnly = (period: string) => monthName(period).split("/")[0];

/** Primeira frase de um texto, sem cortar em abreviações como "vs." (só termina em ponto seguido de maiúscula). */
export function firstSentence(text: string): string {
  const cut = text.search(/\.\s+[A-ZÀ-Ý]/);
  const out = cut === -1 ? text : text.slice(0, cut + 1);
  return out.endsWith(".") ? out : `${out}.`;
}

export interface BriefCard {
  key: KpiResult["key"];
  question: string;
  title: string;
  /** Valor para ler rápido ("R$ 120 mil", "R$ 31"). */
  value: string;
  light: TrafficLight;
  /** Uma frase com a comparação. */
  sentence: string;
}

export interface BriefThing {
  title: string;
  detail: string;
}

export interface Brief {
  /** 1 a 3 frases curtas: como foi o mês, em palavras do dia a dia. */
  headline: string;
  cards: BriefCard[];
  /** Os 3 achados mais relevantes (mesma ordem de relevância dos insights), reescritos sem jargão. */
  threeThings: BriefThing[];
}

const pctOfDelta = (k: KpiResult) => (k.kind === "rate" ? (k.vsPrevious as RateDelta).pp : (k.vsPrevious as ValueDelta).pct);
const pctOfAvg = (k: KpiResult) => (k.kind === "rate" ? (k.vsAvg3 as RateDelta).pp : (k.vsAvg3 as ValueDelta).pct);

function card(k: KpiResult, prevMonth: string): BriefCard {
  const meta = KPI_PLAIN[k.key];
  const light = trafficLight(pctOfDelta(k), pctOfAvg(k), k.goodWhenUp, k.kind === "rate" ? PLAIN.SAME_BAND_PP : PLAIN.SAME_BAND);
  const rate = k.kind === "rate";
  const fmt = (v: number | null) => (v === null ? "sem dados" : rate ? `R$ ${Math.round(v * 100)}` : friendlyMoney(v));
  let sentence: string;
  if (k.value === null) sentence = "Sem dados deste mês.";
  else if (k.previous === null) sentence = `Sem dados de ${prevMonth} para comparar.`;
  else if (rate) sentence = `Em ${prevMonth} eram ${fmt(k.previous)}.`;
  else sentence = `${friendlyMoney(Math.abs(k.value - k.previous)) === "R$ 0" ? "Igual" : `${moreOrLess(k.value - k.previous)} que`}${friendlyMoney(Math.abs(k.value - k.previous)) === "R$ 0" ? " a" : " em"} ${prevMonth} (${fmt(k.previous)}).`;
  return { key: k.key, question: meta.question, title: meta.title, value: k.value === null ? "Sem dados" : fmt(k.value), light, sentence };
}

/** Detalhe curto do reajuste de preço, sem jargão ("vendeu 14% menos, entrou R$ 3,6 mil a menos, sobrou R$ 1,4 mil a mais"). */
export function priceBrief(pc: PriceChanges): BriefThing {
  const v = priceImpactReading(pc, friendlyMoney).verdict;
  const units = pc.unitsBefore > 0 ? Math.round(((pc.unitsAfter - pc.unitsBefore) / pc.unitsBefore) * 100) : null;
  const dRev = pc.impact.revenueAfterCents - pc.impact.revenueBeforeCents;
  const m = pc.impact.margin;
  const parts = [
    units === null ? null : `vendeu ${Math.abs(units)}% ${units < 0 ? "menos" : "mais"}`,
    `entrou ${moreOrLess(dRev)} de faturamento`,
    m ? `sobrou ${moreOrLess(m.afterCents - m.beforeCents)} de lucro bruto` : null,
  ].filter(Boolean);
  return { title: v.title, detail: `Nos ${pc.count} produtos que subiram ou baixaram de preço: ${parts.join(", ")}.` };
}

export function buildBrief(o: Overview): Brief {
  const prev = monthOnly(o.previousPeriod);
  const cards = o.kpis.map((k) => card(k, prev));
  const tone = (key: KpiResult["key"]) => cards.find((c) => c.key === key)?.light.tone ?? "nodata";

  const rev = tone("revenue");
  const prof = tone("contribution") !== "nodata" ? tone("contribution") : tone("operating");
  let headline: string;
  if (rev === "nodata" || prof === "nodata") {
    headline = `Faltam dados para comparar ${monthOnly(o.period)} com ${prev}. Veja os indicadores abaixo.`;
  } else {
    const a = rev === "better" ? "Vendemos mais que" : rev === "worse" ? "Vendemos menos que" : "Vendemos quase o mesmo que";
    const b = prof === "better" ? "sobrou mais dinheiro" : prof === "worse" ? "sobrou menos dinheiro" : "a sobra foi parecida";
    const contrast = (rev === "worse" && prof === "better") || (rev === "better" && prof === "worse");
    headline = `${a} em ${prev}, ${contrast ? "mas" : "e"} ${b} depois de pagar os produtos.`;
  }
  const loss = tone("loss");
  if (loss === "worse") headline += " Perdemos mais produtos.";
  else if (loss === "better") headline += " Perdemos menos produtos.";
  const cash = tone("cash");
  if (cash === "worse") headline += " O dinheiro no banco ficou menor.";
  else if (cash === "better") headline += " O dinheiro no banco ficou maior.";

  const things: BriefThing[] = [];
  for (const i of o.insights) {
    if (things.length === 3) break;
    if (i.id === "price-volume" && o.priceChanges) things.push(priceBrief(o.priceChanges));
    else if (i.id !== "price-volume") things.push({ title: plainify(i.title), detail: plainify(firstSentence(i.detail)) });
  }
  return { headline, cards, threeThings: things };
}

export type PageKey = "detalhe" | "comercial" | "testes" | "precos" | "perdas" | "financeiro";

export interface PageIntro {
  /** Pergunta que a página responde. */
  question: string;
  /** Resposta em uma ou duas frases curtas. */
  answer: string;
  /** Quem costuma olhar esta página (ninguém fica sem acesso; é só um guia). */
  audience: ("Sócios" | "Operação" | "Financeiro")[];
}

/** Abertura de cada página do detalhe: pergunta + resposta em palavras do dia a dia. */
export function buildPageIntros(o: Overview): Record<PageKey, PageIntro> {
  const prev = monthOnly(o.previousPeriod);
  const st = o.stores;
  const dn = st?.declineExplainers;
  const comercial =
    st === null
      ? "Sem dados por loja neste mês."
      : `${st.up} ${st.up === 1 ? "loja vendeu mais" : "lojas venderam mais"} e ${st.down} ${st.down === 1 ? "vendeu menos" : "venderam menos"} que em ${prev}.${dn && dn.stores.length ? ` ${dn.stores.length} ${dn.stores.length === 1 ? "loja explica" : "lojas explicam"} ${Math.round(dn.coveredShare * 100)}% da queda.` : ""}`;

  const tests = o.tests?.rows ?? [];
  const attentionTests = tests.filter((t) => t.signal === "atencao").length;
  const testes =
    o.tests === null
      ? "Sem dados de abastecimento para saber quais produtos são novos."
      : tests.length === 0
        ? "Nenhum produto novo entrou em teste nos últimos 3 meses."
        : `${tests.length} ${tests.length === 1 ? "produto está" : "produtos estão"} em teste. ${attentionTests > 0 ? `${attentionTests} ${attentionTests === 1 ? "pede" : "pedem"} atenção.` : "Nenhum pede atenção."} Os demais ainda precisam de mais tempo de venda.`;

  const precos = o.priceChanges ? `${priceImpactReading(o.priceChanges, friendlyMoney).verdict.title}.` : "Nenhum produto teve reajuste relevante de preço, ou faltam vendas dos dois meses.";

  const l = o.loss;
  const lossDelta = l?.changes ? l.changes.totalCurrentCents - l.changes.totalPreviousCents : null;
  const top = l?.byReason[0];
  const perdas =
    !l || l.lossCents === null
      ? "Sem dados de perdas neste mês."
      : `Perdemos ${friendlyMoney(l.lossCents)} em produtos${lossDelta === null ? "" : `, ${moreOrLess(lossDelta)} que em ${prev}`}.${top && top.valueCents > 0 ? ` O maior motivo foi ${reasonLabel(top.reason).toLowerCase()}.` : ""}`;

  const c = o.cash;
  const use = o.cashUses?.lines[0];
  const financeiro =
    c.closing === null || c.opening === null
      ? "Sem dados de caixa neste mês."
      : `O dinheiro no banco ${c.closing >= c.opening ? "subiu" : "caiu"} ${friendlyMoney(Math.abs(c.closing - c.opening))}.${use ? ` A maior saída foi ${plainify(use.label).toLowerCase()}: ${friendlyMoney(use.currentCents)}.` : ""}`;

  return {
    detalhe: { question: "Onde está cada número do resumo?", answer: "Os seis indicadores com a comparação, os destaques do mês e o que mais mudou.", audience: ["Sócios", "Financeiro"] },
    comercial: { question: "Onde as vendas mudaram?", answer: comercial, audience: ["Sócios", "Operação"] },
    testes: { question: "Os produtos novos estão indo bem?", answer: testes, audience: ["Operação", "Sócios"] },
    precos: { question: "O reajuste de preços valeu a pena?", answer: precos, audience: ["Sócios", "Financeiro"] },
    perdas: { question: "Perdemos mais ou menos produtos?", answer: perdas, audience: ["Operação"] },
    financeiro: { question: "Para onde foi o dinheiro e quanto sobrou?", answer: financeiro, audience: ["Financeiro", "Sócios"] },
  };
}
