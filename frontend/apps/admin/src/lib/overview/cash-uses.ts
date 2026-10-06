import { avgOfAll, valueDelta } from "./compare";
import { isMaterial } from "./materiality";
import type { CapexSummary, CashSummary, CashUseLine, CashUses, InvestorsSummary, MonthInput } from "./types";

/** Categoria do de-para que representa compra de estoque (`Estoque`, nature cogs). */
const STOCK_CATEGORY = "Estoque";

function line(key: string, label: string, vals: (number | null)[], revenue: number | null): CashUseLine {
  const [cur, prev] = vals;
  const last3 = vals.slice(1, 4);
  const d = valueDelta(cur, prev);
  return {
    key,
    label,
    currentCents: cur ?? 0,
    previousCents: prev,
    avg3Cents: avgOfAll(last3),
    deltaCents: d.abs,
    deltaPct: d.pct,
    material: isMaterial({ deltaAbs: d.abs, deltaPct: d.pct, base: revenue }),
  };
}

const cat = (m: MonthInput, name: string): number | null =>
  m.treasury ? m.treasury.byCategory.filter((c) => c.category === name).reduce((s, c) => s + c.outflowCents, 0) : null;

export function buildCashUses(months: MonthInput[]): CashUses | null {
  const [cur, prev] = months;
  if (!cur.treasury && !cur.capex) return null;
  const revenue = cur.pnl?.netRevenueCents ?? null;

  const stock = cur.treasury ? line("stock", "Compras de estoque", months.map((m) => cat(m, STOCK_CATEGORY)), revenue) : null;
  const capex = cur.capex ? line("capex", "CAPEX", months.map((m) => m.capex?.totalCents ?? null), revenue) : null;

  const names = new Set(cur.treasury?.byCategory.map((c) => c.category) ?? []);
  const expenses: CashUseLine[] = [];
  for (const name of names) {
    if (name === STOCK_CATEGORY) continue;
    const l = line(`cat:${name}`, name, months.map((m) => cat(m, name)), revenue);
    // Só o que saiu do comportamento: relevante vs. mês anterior E vs. a média, quando há média.
    const d3 = valueDelta(l.currentCents, l.avg3Cents);
    const vsAvg = l.avg3Cents === null ? true : isMaterial({ deltaAbs: d3.abs, deltaPct: d3.pct, base: revenue });
    if (l.material && vsAvg) expenses.push(l);
  }
  expenses.sort((a, b) => Math.abs(b.deltaCents ?? 0) - Math.abs(a.deltaCents ?? 0));

  const revenueDelta = valueDelta(cur.pnl?.netRevenueCents ?? null, prev.pnl?.netRevenueCents ?? null);
  return {
    stock,
    capex,
    expenses: expenses.slice(0, 5),
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
  if (!cur.capex) return null;
  const d = valueDelta(cur.capex.totalCents, prev.capex?.totalCents ?? null);
  return {
    current: cur.capex,
    previousCents: prev.capex?.totalCents ?? null,
    deltaPct: d.pct,
    top: [...cur.capex.byCategory].filter((c) => c.cents > 0).sort((a, b) => b.cents - a.cents).slice(0, 3),
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

