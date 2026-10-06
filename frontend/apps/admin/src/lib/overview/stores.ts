import { isMaterial, MATERIALITY } from "./materiality";
import { valueDelta } from "./compare";
import type { StoreAttention, StoreContribution, StoreExplainers, StoreMonthPnl, StoreSummary } from "./types";

/** As lojas que juntas explicam ao menos esta parcela do movimento (no máximo MAX_EXPLAINERS). PREMISSA inicial. */
export const EXPLAINERS = { COVER: 0.6, MAX: 5 } as const;

export function explainers(moves: StoreContribution[]): StoreExplainers {
  const sorted = [...moves].sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents));
  const total = sorted.reduce((acc, m) => acc + Math.abs(m.deltaCents), 0);
  const picked: (StoreContribution & { share: number })[] = [];
  let covered = 0;
  for (const m of sorted) {
    if (total === 0 || picked.length >= EXPLAINERS.MAX || covered >= EXPLAINERS.COVER) break;
    const share = Math.abs(m.deltaCents) / total;
    picked.push({ ...m, share });
    covered += share;
  }
  return { totalCents: total, stores: picked, coveredShare: covered, storeCount: moves.length };
}

const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(cents / 100);

/** Venda registrada por loja (sales-service) no mês da competência e no anterior. */
export interface SalesBasis {
  current: Map<number, number>;
  previous: Map<number, number>;
}

/**
 * "Cresceu/recuou" é medido pela VENDA da loja (sales-service) quando os dois
 * meses estão importados: é o que o operador chama de faturamento da loja. A
 * receita líquida por loja do DRE mistura venda com receita de contrato
 * (mensalidade, coffee break, frutas), que entra por fontes diferentes de um mês
 * para o outro, e dava "ninguém cresceu" com 9 lojas vendendo mais. Sem as duas
 * bases de venda, cai para o DRE e a tela diz isso. Resultado, margem e perdas
 * continuam do DRE.
 */
export function buildStoreSummary(
  current: StoreMonthPnl[] | null,
  previous: StoreMonthPnl[] | null,
  activeCount: number | null,
  networkRevenuePreviousCents: number | null,
  salesBasis: SalesBasis | null = null,
): StoreSummary | null {
  if (!current || !previous) return null;
  const prevById = new Map(previous.map((s) => [s.storeId, s]));
  const salesPrevTotal = salesBasis ? [...salesBasis.previous.values()].reduce((a, b) => a + b, 0) : null;
  let basisCurrent = 0;
  let basisPrevious = 0;
  let up = 0;
  let down = 0;
  let stable = 0;
  const ups: StoreContribution[] = [];
  const downs: StoreContribution[] = [];
  const attention: StoreAttention[] = [];

  for (const s of current) {
    const p = prevById.get(s.storeId);
    // Loja sem mês anterior (nova) não entra em "cresceu/recuou": sem base não há comparação.
    if (!p) continue;
    const curRev = salesBasis ? (salesBasis.current.get(s.storeId) ?? 0) : s.netRevenueCents;
    const prevRev = salesBasis ? salesBasis.previous.get(s.storeId) : p.netRevenueCents;
    // Venda sem mês anterior (loja nova ou mês sem importação) não entra: sem base não há comparação.
    if (prevRev === undefined || (salesBasis && prevRev <= 0)) continue;
    basisCurrent += curRev;
    basisPrevious += prevRev;
    const d = valueDelta(curRev, prevRev);
    const moved = d.pct === null ? (curRev > 0 ? 1 : 0) : d.pct;
    const contribution = { storeId: s.storeId, name: s.name, deltaCents: d.abs ?? 0, deltaPct: d.pct, previousCents: prevRev, currentCents: curRev };
    // As listas de contribuição seguem a mesma classificação dos contadores: loja "estável" não é citada como crescimento nem queda.
    if (moved > MATERIALITY.STORE_STABLE_BAND) {
      up += 1;
      ups.push(contribution);
    } else if (moved < -MATERIALITY.STORE_STABLE_BAND) {
      down += 1;
      downs.push(contribution);
    } else stable += 1;

    const reasons: string[] = [];
    if (isMaterial({ deltaAbs: d.abs, deltaPct: d.pct, base: salesPrevTotal ?? networkRevenuePreviousCents }) && (d.abs ?? 0) < 0) {
      reasons.push(`${salesBasis ? "vendas" : "receita"} ${money(d.abs ?? 0)} vs. mês anterior`);
    }
    if (s.netRevenueCents > 0 && s.lossCents / s.netRevenueCents >= MATERIALITY.STORE_LOSS_TO_REVENUE_ATTENTION) {
      reasons.push(`perdas = ${((s.lossCents / s.netRevenueCents) * 100).toFixed(1).replace(".", ",")}% da receita`);
    }
    if (s.operatingProfitCents < 0) reasons.push(`resultado operacional ${money(s.operatingProfitCents)}`);
    const m0 = s.netRevenueCents > 0 ? s.contributionMarginCents / s.netRevenueCents : null;
    const m1 = p.netRevenueCents > 0 ? p.contributionMarginCents / p.netRevenueCents : null;
    if (m0 !== null && m1 !== null && (m0 - m1) * 100 <= -3) {
      reasons.push(`margem de contribuição ${((m0 - m1) * 100).toFixed(1).replace(".", ",").replace("-", "−")} p.p.`);
    }
    if (reasons.length) attention.push({ storeId: s.storeId, name: s.name, reasons, deltaCents: d.abs, deltaPct: d.pct });
  }

  return {
    activeCount,
    basis: salesBasis ? "vendas" : "dre",
    storesRevenueCents: basisCurrent,
    storesRevenuePreviousCents: basisPrevious,
    compared: up + down + stable,
    up,
    down,
    stable,
    topGrowth: [...ups].sort((a, b) => b.deltaCents - a.deltaCents).slice(0, 3),
    topDecline: [...downs].sort((a, b) => a.deltaCents - b.deltaCents).slice(0, 3),
    growthExplainers: explainers(ups),
    declineExplainers: explainers(downs),
    attention: attention.sort((a, b) => b.reasons.length - a.reasons.length || (a.deltaCents ?? 0) - (b.deltaCents ?? 0)).slice(0, 5),
  };
}
