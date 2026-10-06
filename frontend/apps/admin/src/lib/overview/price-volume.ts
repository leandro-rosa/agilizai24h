import type { SalesCell } from "./types";

/**
 * Efeito preço × volume na receita de produtos, mês contra mês anterior, na rede.
 * Preço = preço REALIZADO (receita ÷ unidades do SKU no mês, já com descontos) —
 * vem das próprias vendas, porque o catálogo só tem preço datado para parte dos produtos.
 *
 * Decomposição exata por SKU vendido nos dois meses (q = unidades, p = preço realizado):
 *   Δreceita = q1·p1 − q0·p0 = (p1 − p0)·q1  [preço]  +  (q1 − q0)·p0  [volume]
 * SKU que só vendeu em um dos meses entra como "entrada/saída de produto" (mix), não como preço.
 * É aritmética sobre fatos; NÃO diz que o preço causou a variação das unidades.
 * Limiares são PREMISSA inicial a validar com a distribuição real.
 */
export const PRICE_VOLUME = {
  /** Variação mínima do preço realizado para o SKU contar como reajustado. */
  MIN_PRICE_MOVE: 0.03,
  /** Unidades mínimas em CADA mês para confiar no preço realizado do SKU. */
  MIN_UNITS: 10,
  /** Reajustados mínimos para o achado existir. */
  MIN_REPRICED: 3,
} as const;

export interface RepricedSku {
  sku: string;
  priceBeforeCents: number;
  priceAfterCents: number;
  unitsBefore: number;
  unitsAfter: number;
}

export interface PriceVolume {
  period: string;
  previousPeriod: string;
  /** Δ receita de produtos (soma das vendas por SKU) entre os dois meses. */
  deltaCents: number;
  revenueBeforeCents: number;
  revenueAfterCents: number;
  repriced: {
    count: number;
    raised: number;
    lowered: number;
    /** Efeito do preço (mesmas unidades do mês atual) e do volume (ao preço antigo), só nos reajustados. */
    priceEffectCents: number;
    volumeEffectCents: number;
    unitsBefore: number;
    unitsAfter: number;
    skus: RepricedSku[];
  };
  /** Demais SKUs que venderam nos dois meses (preço estável ou pouco volume): efeito total na receita. */
  others: { count: number; unitsBefore: number; unitsAfter: number; deltaCents: number };
  /** Produtos que só venderam em um dos meses. */
  entriesExits: { deltaCents: number };
  /** Dias de cada mês: o calendário também explica parte da variação de unidades. */
  days: { before: number; after: number };
}

const daysIn = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** `null` quando falta venda de um dos meses (não há base para separar preço de volume). */
export function buildPriceVolume(period: string, previousPeriod: string, cells: SalesCell[], ingested: string[]): PriceVolume | null {
  if (!ingested.includes(period) || !ingested.includes(previousPeriod)) return null;
  const agg = new Map<string, { q0: number; v0: number; q1: number; v1: number }>();
  for (const c of cells) {
    if (c.period !== period && c.period !== previousPeriod) continue;
    const a = agg.get(c.sku) ?? { q0: 0, v0: 0, q1: 0, v1: 0 };
    if (c.period === period) {
      a.q1 += c.quantity;
      a.v1 += c.revenueCents;
    } else {
      a.q0 += c.quantity;
      a.v0 += c.revenueCents;
    }
    agg.set(c.sku, a);
  }

  const rep = { count: 0, raised: 0, lowered: 0, priceEffectCents: 0, volumeEffectCents: 0, unitsBefore: 0, unitsAfter: 0, skus: [] as RepricedSku[] };
  const others = { count: 0, unitsBefore: 0, unitsAfter: 0, deltaCents: 0 };
  let entriesExits = 0;
  let before = 0;
  let after = 0;
  for (const [sku, a] of agg) {
    before += a.v0;
    after += a.v1;
    if (a.q0 <= 0 || a.q1 <= 0) {
      entriesExits += a.v1 - a.v0;
      continue;
    }
    const p0 = a.v0 / a.q0;
    const p1 = a.v1 / a.q1;
    const move = p0 > 0 ? (p1 - p0) / p0 : 0;
    if (a.q0 >= PRICE_VOLUME.MIN_UNITS && a.q1 >= PRICE_VOLUME.MIN_UNITS && Math.abs(move) >= PRICE_VOLUME.MIN_PRICE_MOVE) {
      rep.count += 1;
      if (move > 0) rep.raised += 1;
      else rep.lowered += 1;
      rep.priceEffectCents += (p1 - p0) * a.q1;
      rep.volumeEffectCents += (a.q1 - a.q0) * p0;
      rep.unitsBefore += a.q0;
      rep.unitsAfter += a.q1;
      rep.skus.push({ sku, priceBeforeCents: Math.round(p0), priceAfterCents: Math.round(p1), unitsBefore: a.q0, unitsAfter: a.q1 });
    } else {
      others.count += 1;
      others.unitsBefore += a.q0;
      others.unitsAfter += a.q1;
      others.deltaCents += a.v1 - a.v0;
    }
  }
  rep.priceEffectCents = Math.round(rep.priceEffectCents);
  rep.volumeEffectCents = Math.round(rep.volumeEffectCents);
  rep.skus.sort((x, y) => y.unitsAfter - x.unitsAfter);

  return {
    period,
    previousPeriod,
    deltaCents: after - before,
    revenueBeforeCents: before,
    revenueAfterCents: after,
    repriced: rep,
    others,
    entriesExits: { deltaCents: entriesExits },
    days: { before: daysIn(previousPeriod), after: daysIn(period) },
  };
}

/** Existe achado a mostrar? Poucos reajustes não formam padrão. */
export const hasRepricing = (pv: PriceVolume | null | undefined): pv is PriceVolume => !!pv && pv.repriced.count >= PRICE_VOLUME.MIN_REPRICED;

export interface PriceChangeRow {
  sku: string;
  name: string;
  priceBeforeCents: number;
  priceAfterCents: number;
  /** Variação do preço realizado (0.2 = +20%). */
  pricePct: number;
  unitsBefore: number;
  unitsAfter: number;
  unitsPct: number;
  /** Receita do mês atual − anterior, no produto (preço e volume juntos). */
  revenueDeltaCents: number;
  /** Margem sobre o preço realizado com o custo datado do SKU; null = custo não resolvido. */
  marginBefore: number | null;
  marginAfter: number | null;
}

/**
 * Saldo do reajuste nos produtos reajustados: faturamento, margem de contribuição em R$ e %, e unidades, antes e depois.
 * Margem = (preço realizado − custo datado) × unidades, só nos SKUs com custo resolvido (`marginCoveredCount` de `count`).
 * Os efeitos fecham exatamente: Δ = preço + volume (+ custo, que aqui é 0: o custo usado é um só por SKU).
 */
export interface PriceImpact {
  revenueBeforeCents: number;
  revenueAfterCents: number;
  /** Só SKUs com custo resolvido. */
  margin: {
    coveredCount: number;
    beforeCents: number;
    afterCents: number;
    /** Margem ÷ receita, nos mesmos SKUs. */
    pctBefore: number | null;
    pctAfter: number | null;
    priceEffectCents: number;
    volumeEffectCents: number;
  } | null;
}

export interface PriceChanges {
  period: string;
  previousPeriod: string;
  count: number;
  raised: number;
  lowered: number;
  priceEffectCents: number;
  volumeEffectCents: number;
  unitsBefore: number;
  unitsAfter: number;
  /** Demais produtos vendidos nos dois meses (sem reajuste relevante). */
  others: { count: number; unitsBefore: number; unitsAfter: number };
  days: { before: number; after: number };
  impact: PriceImpact;
  /** Os mais relevantes (por receita do mês atual). */
  rows: PriceChangeRow[];
}

export const PRICE_CHANGES_ROWS = 10;

/** Bloco "Reajustes de preço no mês": cada produto reajustado, com preço, unidades e margem antes e depois. */
export function buildPriceChanges(pv: PriceVolume | null, names: Record<string, string>, costBySku: Record<string, number> | null): PriceChanges | null {
  if (!hasRepricing(pv)) return null;
  const r = pv.repriced;
  const rows = [...r.skus]
    .sort((a, b) => b.priceAfterCents * b.unitsAfter - a.priceAfterCents * a.unitsAfter)
    .slice(0, PRICE_CHANGES_ROWS)
    .map<PriceChangeRow>((x) => {
      const cost = costBySku?.[x.sku];
      return {
        sku: x.sku,
        name: names[x.sku] ?? x.sku,
        priceBeforeCents: x.priceBeforeCents,
        priceAfterCents: x.priceAfterCents,
        pricePct: x.priceBeforeCents > 0 ? (x.priceAfterCents - x.priceBeforeCents) / x.priceBeforeCents : 0,
        unitsBefore: x.unitsBefore,
        unitsAfter: x.unitsAfter,
        unitsPct: x.unitsBefore > 0 ? (x.unitsAfter - x.unitsBefore) / x.unitsBefore : 0,
        revenueDeltaCents: x.priceAfterCents * x.unitsAfter - x.priceBeforeCents * x.unitsBefore,
        marginBefore: cost !== undefined && x.priceBeforeCents > 0 ? 1 - cost / x.priceBeforeCents : null,
        marginAfter: cost !== undefined && x.priceAfterCents > 0 ? 1 - cost / x.priceAfterCents : null,
      };
    });
  let revBefore = 0;
  let revAfter = 0;
  const m = { covered: 0, before: 0, after: 0, revBefore: 0, revAfter: 0, price: 0, volume: 0 };
  for (const x of r.skus) {
    const rev0 = x.priceBeforeCents * x.unitsBefore;
    const rev1 = x.priceAfterCents * x.unitsAfter;
    revBefore += rev0;
    revAfter += rev1;
    const cost = costBySku?.[x.sku];
    if (cost === undefined) continue;
    m.covered += 1;
    m.before += (x.priceBeforeCents - cost) * x.unitsBefore;
    m.after += (x.priceAfterCents - cost) * x.unitsAfter;
    m.revBefore += rev0;
    m.revAfter += rev1;
    m.price += (x.priceAfterCents - x.priceBeforeCents) * x.unitsAfter;
    m.volume += (x.unitsAfter - x.unitsBefore) * (x.priceBeforeCents - cost);
  }
  const impact: PriceImpact = {
    revenueBeforeCents: Math.round(revBefore),
    revenueAfterCents: Math.round(revAfter),
    margin:
      m.covered === 0
        ? null
        : {
            coveredCount: m.covered,
            beforeCents: Math.round(m.before),
            afterCents: Math.round(m.after),
            pctBefore: m.revBefore > 0 ? m.before / m.revBefore : null,
            pctAfter: m.revAfter > 0 ? m.after / m.revAfter : null,
            priceEffectCents: Math.round(m.price),
            volumeEffectCents: Math.round(m.volume),
          },
  };
  return {
    period: pv.period,
    previousPeriod: pv.previousPeriod,
    count: r.count,
    raised: r.raised,
    lowered: r.lowered,
    priceEffectCents: r.priceEffectCents,
    volumeEffectCents: r.volumeEffectCents,
    unitsBefore: r.unitsBefore,
    unitsAfter: r.unitsAfter,
    others: { count: pv.others.count, unitsBefore: pv.others.unitsBefore, unitsAfter: pv.others.unitsAfter },
    days: pv.days,
    impact,
    rows,
  };
}

/** Frase de observação (nunca causa): unidades dos reajustados × demais e calendário. */
export function priceChangesObservation(pc: PriceChanges): string {
  const pctOf = (a: number, b: number) => (a > 0 ? Math.round(((b - a) / a) * 100) : null);
  const rep = pctOf(pc.unitsBefore, pc.unitsAfter);
  const oth = pctOf(pc.others.unitsBefore, pc.others.unitsAfter);
  const sg = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;
  const cmp =
    rep !== null && oth !== null
      ? `Unidades: ${sg(rep)} nos ${pc.count} reajustados e ${sg(oth)} nos ${pc.others.count} demais produtos${rep < oth - 2 ? " — os dois movimentos coincidem nos mesmos produtos, o que não prova causa" : ""}. `
      : "";
  return `${cmp}Calendário: ${pc.days.after} dias contra ${pc.days.before}. Preço = preço realizado (receita ÷ unidades), já com descontos.`;
}

export interface PriceImpactReading {
  /** Uma frase: o que aconteceu com faturamento e margem nos reajustados. */
  headline: string;
  lines: string[];
}

const updown = (d: number, up: string, down: string) => (d >= 0 ? up : down);

/**
 * Leitura do saldo do reajuste. Só aritmética: compara o ganho de preço com a perda de unidades
 * (em faturamento e em margem) e diz se o saldo foi positivo ou negativo. NÃO afirma que o preço causou a queda de unidades.
 */
export function priceImpactReading(pc: PriceChanges, money: (cents: number) => string): PriceImpactReading {
  const i = pc.impact;
  const dRev = i.revenueAfterCents - i.revenueBeforeCents;
  const abs = (c: number) => money(Math.abs(c));
  const revPct = i.revenueBeforeCents > 0 ? dRev / i.revenueBeforeCents : null;
  const pctTxt = (v: number | null) => (v === null ? "" : ` (${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1).replace(".", ",")}%)`);
  const lines: string[] = [`Faturamento dos ${pc.count} reajustados: ${money(i.revenueBeforeCents)} → ${money(i.revenueAfterCents)}${pctTxt(revPct)}.`];
  const m = i.margin;
  let headline = `Faturamento dos reajustados ${updown(dRev, "subiu", "caiu")} ${abs(dRev)}.`;
  if (m) {
    const dM = m.afterCents - m.beforeCents;
    headline = `Nos reajustados, o faturamento ${updown(dRev, "subiu", "caiu")} ${abs(dRev)} e a margem de contribuição em R$ ${updown(dM, "subiu", "caiu")} ${abs(dM)}.`;
    const pp = m.pctBefore !== null && m.pctAfter !== null ? ` (${Math.round(m.pctBefore * 100)}% → ${Math.round(m.pctAfter * 100)}% da receita)` : "";
    lines.push(`Margem de contribuição: ${money(m.beforeCents)} → ${money(m.afterCents)}${pp}.`);
    const bigger = m.priceEffectCents >= Math.abs(m.volumeEffectCents);
    lines.push(
      `O ganho de preço (${updown(m.priceEffectCents, "+", "−")}${abs(m.priceEffectCents)}) foi ${bigger ? "maior" : "menor"} que o efeito das unidades (${updown(m.volumeEffectCents, "+", "−")}${abs(m.volumeEffectCents)}) na margem: saldo ${updown(dM, "+", "−")}${abs(dM)}.`,
    );
    if (m.coveredCount < pc.count) lines.push(`Margem calculada em ${m.coveredCount} de ${pc.count} produtos (os demais sem custo resolvido).`);
  } else {
    lines.push("Margem não calculada: nenhum dos reajustados tem custo resolvido.");
  }
  const pctOf = (a: number, b: number) => (a > 0 ? (b - a) / a : null);
  const rep = pctOf(pc.unitsBefore, pc.unitsAfter);
  const oth = pctOf(pc.others.unitsBefore, pc.others.unitsAfter);
  if (rep !== null) {
    const fmt = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(0)}%`;
    lines.push(
      `Vendas: unidades ${fmt(rep)} (${pc.unitsBefore.toLocaleString("pt-BR")} → ${pc.unitsAfter.toLocaleString("pt-BR")}) nos reajustados${oth !== null ? ` contra ${fmt(oth)} nos ${pc.others.count} demais produtos` : ""}${oth !== null && rep < oth - 0.02 ? " — a queda se concentra onde o preço subiu, o que não prova causa" : ""}.`,
    );
  }
  lines.push(`Calendário: ${pc.days.after} dias contra ${pc.days.before}. Custo = o do catálogo na data; preço = preço realizado (receita ÷ unidades).`);
  return { headline, lines };
}
