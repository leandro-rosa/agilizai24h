/**
 * Adaptadores puros: respostas de API → `MonthInput`/`OverviewInput`. Fora
 * do hook para serem testáveis sem React. Um serviço que não respondeu entra
 * como `null` (indisponível), nunca como zero.
 */
import type { BankTransaction, CashFlowSummary, TransactionSummary } from "../api/treasury";
import type { InvestmentItem, InvestorContribution } from "../api/capex";
import type { PnlSnapshot, StorePnlSummary } from "../api/accounting";
import type { Reconciliation } from "../api/finance";
import type { CapexMonth, CashMonth, FinanceMonth, InvestorMonth, NetworkPnlMonth, StoreMonthPnl, TreasuryMonth } from "./types";

export function pnlMonth(series: PnlSnapshot[] | undefined, period: string): NetworkPnlMonth | null {
  const s = series?.find((x) => x.period === period && x.store_id === null);
  return s
    ? {
        netRevenueCents: s.net_revenue_cents,
        grossRevenueCents: s.gross_revenue_cents,
        contributionMarginCents: s.contribution_margin_cents,
        operatingProfitCents: s.operating_profit_cents,
        computedAt: s.computed_at ?? null,
      }
    : null;
}

export function cashMonth(c: CashFlowSummary | null | undefined): CashMonth | null {
  return c ? { openingCents: c.opening_balance_cents, inflowCents: c.inflow_cents, outflowCents: c.outflow_cents, closingCents: c.closing_balance_cents } : null;
}

/**
 * `investments` = lançamentos de natureza investimento do mês (lista), usados só para o detalhe por categoria;
 * o TOTAL vem do resumo (`by_nature`), a mesma conta do Fluxo de caixa. Lançamento neutralizado fica de fora.
 */
export function treasuryMonth(s: TransactionSummary | null | undefined, investments: BankTransaction[] | null | undefined = null): TreasuryMonth | null {
  if (!s) return null;
  const byCat = new Map<string, number>();
  for (const t of investments ?? []) {
    if (t.direction !== "outflow" || t.neutralized_with_id !== null) continue;
    byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount_cents);
  }
  return {
    byCategory: s.by_category.map((c) => ({ category: c.category, outflowCents: c.outflow_cents })),
    unresolvedCount: s.unresolved_count,
    pendingCount: s.pending_count,
    investmentCents: s.by_nature.find((n) => n.nature === "investment")?.outflow_cents ?? 0,
    investmentByCategory: [...byCat].map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents),
  };
}

/** Soma o mês de cada loja. `null` quando nenhuma loja tem reconciliação do mês (não é "perda zero"). */
export function financeMonth(all: { storeId: number; series: Reconciliation[] }[] | undefined, period: string): FinanceMonth | null {
  if (!all) return null;
  const rows = all.map((s) => s.series.find((r) => r.period === period)).filter((r): r is Reconciliation => !!r);
  if (rows.length === 0) return null;
  const reasons = new Map<string, number>();
  const skus = new Map<string, number>();
  let restocked = 0;
  let cogs = 0;
  let loss = 0;
  for (const r of rows) {
    restocked += r.restocked_value_cents;
    cogs += r.cogs_cents;
    loss += r.loss_value_cents;
    for (const x of r.loss_by_reason) reasons.set(x.reason, (reasons.get(x.reason) ?? 0) + x.value_cents);
    for (const x of r.loss_by_sku) skus.set(x.sku, (skus.get(x.sku) ?? 0) + x.value_cents);
  }
  return {
    restockedValueCents: restocked,
    cogsCents: cogs,
    lossValueCents: loss,
    lossByReason: [...reasons].map(([reason, valueCents]) => ({ reason, valueCents })),
    lossBySku: [...skus].map(([sku, valueCents]) => ({ sku, valueCents })),
    incompleteStores: rows.filter((r) => !r.complete).length,
  };
}

/** Custo efetivo do item: financiado quando houve parcelamento, senão à vista (regra do capex-service). */
const itemCost = (i: InvestmentItem) => (i.financed_amount_cents > 0 ? i.financed_amount_cents : i.cash_amount_cents);

/** CAPEX = itens fixos/iniciais datados no mês. `operating_expense` é despesa, não CAPEX — nunca se mistura. */
export function capexMonth(items: InvestmentItem[] | undefined, period: string): CapexMonth | null {
  if (!items) return null;
  const inMonth = items.filter((i) => i.purchased_on.slice(0, 7) === period && i.investment_kind !== "operating_expense");
  const byCat = new Map<string, number>();
  let total = 0;
  let unassigned = 0;
  for (const i of inMonth) {
    const c = itemCost(i);
    total += c;
    if (i.store_investment_id === null) unassigned += c;
    byCat.set(i.category, (byCat.get(i.category) ?? 0) + c);
  }
  return { totalCents: total, byCategory: [...byCat].map(([category, cents]) => ({ category, cents })), unassignedCents: unassigned };
}

/** Aportes (único tipo de movimento que existe) por mês de `contributed_on`. */
export function investorMonth(contributions: InvestorContribution[] | undefined, period: string): InvestorMonth | null {
  if (!contributions) return null;
  const inMonth = contributions.filter((c) => c.contributed_on.slice(0, 7) === period);
  const byKind = new Map<string, number>();
  for (const c of inMonth) byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + c.amount_cents);
  return { totalCents: inMonth.reduce((s, c) => s + c.amount_cents, 0), byKind: [...byKind].map(([kind, cents]) => ({ kind, cents })), contributionCount: inMonth.length };
}

export function storePnl(rows: StorePnlSummary[] | undefined, names: Map<number, string>): StoreMonthPnl[] | null {
  if (!rows) return null;
  return rows.map((r) => ({
    storeId: r.store_id,
    name: names.get(r.store_id) ?? `Loja ${r.store_id}`,
    netRevenueCents: r.net_revenue_cents,
    contributionMarginCents: r.contribution_margin_cents,
    operatingProfitCents: r.operating_profit_cents,
    lossCents: r.perdas_cents,
  }));
}
