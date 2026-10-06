import { isMaterial, MATERIALITY } from "./materiality";
import { valueDelta } from "./compare";
import type { StoreAttention, StoreContribution, StoreMonthPnl, StoreSummary } from "./types";

const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(cents / 100);

export function buildStoreSummary(
  current: StoreMonthPnl[] | null,
  previous: StoreMonthPnl[] | null,
  activeCount: number | null,
  networkRevenuePreviousCents: number | null,
): StoreSummary | null {
  if (!current || !previous) return null;
  const prevById = new Map(previous.map((s) => [s.storeId, s]));
  let up = 0;
  let down = 0;
  let stable = 0;
  const contributions: StoreContribution[] = [];
  const attention: StoreAttention[] = [];

  for (const s of current) {
    const p = prevById.get(s.storeId);
    // Loja sem mês anterior (nova) não entra em "cresceu/recuou": sem base não há comparação.
    if (!p) continue;
    const d = valueDelta(s.netRevenueCents, p.netRevenueCents);
    const moved = d.pct === null ? (s.netRevenueCents > 0 ? 1 : 0) : d.pct;
    if (moved > MATERIALITY.STORE_STABLE_BAND) up += 1;
    else if (moved < -MATERIALITY.STORE_STABLE_BAND) down += 1;
    else stable += 1;
    contributions.push({ storeId: s.storeId, name: s.name, deltaCents: d.abs ?? 0, deltaPct: d.pct });

    const reasons: string[] = [];
    if (isMaterial({ deltaAbs: d.abs, deltaPct: d.pct, base: networkRevenuePreviousCents }) && (d.abs ?? 0) < 0) {
      reasons.push(`receita ${money(d.abs ?? 0)} vs. mês anterior`);
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
    compared: up + down + stable,
    up,
    down,
    stable,
    topGrowth: contributions.filter((c) => c.deltaCents > 0).sort((a, b) => b.deltaCents - a.deltaCents).slice(0, 3),
    attention: attention.sort((a, b) => b.reasons.length - a.reasons.length || (a.deltaCents ?? 0) - (b.deltaCents ?? 0)).slice(0, 5),
  };
}
