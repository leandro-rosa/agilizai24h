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
