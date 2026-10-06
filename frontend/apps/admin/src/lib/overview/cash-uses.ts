import { avgOfAll, valueDelta } from "./compare";
import { isMaterial } from "./materiality";
import { rankScore, recurrenceOf } from "./ranking";
import type { CapexSummary, CashSummary, CashUseLine, CashUses, InvestorsSummary, MonthInput } from "./types";

/** Categoria do de-para para o que os sócios pagam no cartão pessoal (cai como investimento no Fluxo de caixa). */
const PARTNER_CARD = /s[óo]cio/i;

/** Categoria do de-para que representa compra de estoque (`Estoque`, nature cogs). */
const STOCK_CATEGORY = "Estoque";

/** Uma saída pesa se for pelo menos esta fatia do total de despesas do mês. PREMISSA inicial. */
export const CASH_USES = { WEIGHT_MIN: 0.15, MAX_LINES: 5 } as const;

const labelOf = (category: string) => (category === STOCK_CATEGORY ? "Compras de estoque" : category);

const cat = (m: MonthInput, name: string): number | null =>
  m.treasury ? m.treasury.byCategory.filter((c) => c.category === name).reduce((s, c) => s + c.outflowCents, 0) : null;

/**
 * Seleciona os movimentos financeiros materialmente relevantes do mês — sem categoria
 * fixa. Toda categoria de despesa da tesouraria concorre; entra quem (a) variou de forma
 * material vs. o mês anterior (e vs. a média 3m, quando existe) e/ou (b) pesa no total
 * de despesas. A ordem é por relevância (impacto em R$, peso e recorrência), não por %.
 */
export function buildCashUses(months: MonthInput[]): CashUses | null {
  const [cur, prev] = months;
  if (!cur.treasury) return null;
  const revenue = cur.pnl?.netRevenueCents ?? null;
  const revenueBase = prev.pnl?.netRevenueCents ?? revenue;
  const total = cur.treasury.byCategory.reduce((acc, c) => acc + c.outflowCents, 0);

  const lines: CashUseLine[] = [];
  for (const name of new Set(cur.treasury.byCategory.map((c) => c.category))) {
    const vals = months.map((m) => cat(m, name));
    const [now, before] = vals;
    const last3 = vals.slice(1, 4);
    const d = valueDelta(now, before);
    const d3 = valueDelta(now, avgOfAll(last3));
    const materialVsPrev = isMaterial({ deltaAbs: d.abs, deltaPct: d.pct, base: revenue });
    // Vs. a média só desqualifica quando há média: oscilação normal do próprio item não é notícia.
    const materialVsAvg = avgOfAll(last3) === null ? true : isMaterial({ deltaAbs: d3.abs, deltaPct: d3.pct, base: revenue });
    const share = total > 0 && now !== null ? now / total : null;
    const reasons: CashUseLine["reasons"] = [];
    if (materialVsPrev && materialVsAvg) reasons.push("variacao");
    if (share !== null && share >= CASH_USES.WEIGHT_MIN) reasons.push("peso");
    if (reasons.length === 0) continue;
    lines.push({
      key: `cat:${name}`,
      label: labelOf(name),
      currentCents: now ?? 0,
      previousCents: before,
      avg3Cents: avgOfAll(last3),
      deltaCents: d.abs,
      deltaPct: d.pct,
      material: materialVsPrev && materialVsAvg,
      shareOfOutflow: share,
      reasons,
      score: rankScore({ impactCents: d.abs, baseCents: revenueBase, share, recurrence: recurrenceOf([...vals].reverse()) }),
    });
  }
  lines.sort((a, b) => b.score - a.score);
  const selected = lines.slice(0, CASH_USES.MAX_LINES);

  const stock = selected.find((l) => l.key === `cat:${STOCK_CATEGORY}`);
  const revenueDelta = valueDelta(cur.pnl?.netRevenueCents ?? null, prev.pnl?.netRevenueCents ?? null);
  return {
    lines: selected,
    totalOutflowCents: total,
    stockVsRevenue: stock ? { stockDeltaPct: stock.deltaPct, revenueDeltaPct: revenueDelta.pct } : null,
  };
}

export function buildCashSummary(
  cur: MonthInput,
  prev: MonthInput,
  aging: { referenceDate: string; overdueCents: number; notDueCents: number } | null,
): CashSummary {
  const cashDelta = cur.cash && prev.cash ? cur.cash.closingCents - prev.cash.closingCents : null;
  return {
    opening: cur.cash?.openingCents ?? null,
    inflow: cur.cash?.inflowCents ?? null,
    outflow: cur.cash?.outflowCents ?? null,
    closing: cur.cash?.closingCents ?? null,
    overdueCents: aging?.overdueCents ?? null,
    notDueCents: aging?.notDueCents ?? null,
    agingReference: aging?.referenceDate ?? null,
    // Em vez de o saldo final subtrair do saldo inicial do mesmo mês — o inicial do mês já é o final do anterior.
    cashDeltaCents: cur.cash ? cur.cash.closingCents - cur.cash.openingCents : cashDelta,
    operatingPositiveCashFell: (cur.pnl?.operatingProfitCents ?? 0) > 0 && !!cur.cash && cur.cash.closingCents < cur.cash.openingCents,
  };
}

export function buildCapex(months: MonthInput[]): CapexSummary | null {
  const [cur, prev] = months;
  if (!cur.capex && !cur.treasury) return null;
  const investment = cur.treasury
    ? {
        totalCents: cur.treasury.investmentCents,
        previousCents: prev.treasury?.investmentCents ?? null,
        deltaPct: valueDelta(cur.treasury.investmentCents, prev.treasury?.investmentCents ?? null).pct,
        top: cur.treasury.investmentByCategory.filter((c) => c.cents > 0).slice(0, 3),
        partnerCardCents: cur.treasury.investmentByCategory.filter((c) => PARTNER_CARD.test(c.category)).reduce((s, c) => s + c.cents, 0),
      }
    : null;
  const d = valueDelta(cur.capex?.totalCents ?? null, prev.capex?.totalCents ?? null);
  return {
    investment,
    current: cur.capex,
    previousCents: prev.capex?.totalCents ?? null,
    deltaPct: d.pct,
    top: cur.capex ? [...cur.capex.byCategory].filter((c) => c.cents > 0).sort((a, b) => b.cents - a.cents).slice(0, 3) : [],
  };
}

export function buildInvestors(months: MonthInput[]): InvestorsSummary | null {
  const [cur, prev] = months;
  if (!cur.investors) return null;
  return {
    current: cur.investors,
    previousCents: prev.investors?.totalCents ?? null,
    deltaPct: valueDelta(cur.investors.totalCents, prev.investors?.totalCents ?? null).pct,
  };
}

