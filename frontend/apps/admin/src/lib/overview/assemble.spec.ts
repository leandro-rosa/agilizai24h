import type { InvestmentItem, InvestorContribution } from "../api/capex";
import type { Reconciliation } from "../api/finance";
import { capexMonth, financeMonth, investorMonth, treasuryMonth } from "./assemble";
import type { BankTransaction } from "../api/treasury";
import type { TransactionSummary } from "../api/treasury";

// Fixtures sintéticas, só neste spec.
const item = (over: Partial<InvestmentItem>): InvestmentItem => ({
  id: 1, store_investment_id: 1, category: "fridge", description: "", supplier_id: null, quantity: 1,
  cash_amount_cents: 1000, financed_amount_cents: 0, installments: 1, installment_amount_cents: 0,
  purchased_on: "2026-10-05", funding_source: "", investment_kind: "fixed", ...over,
});

describe("capexMonth", () => {
  it("keeps operating_expense items out of CAPEX and honours financed cost", () => {
    const r = capexMonth([item({}), item({ financed_amount_cents: 5000, cash_amount_cents: 0 }), item({ investment_kind: "operating_expense", cash_amount_cents: 9999 }), item({ purchased_on: "2026-09-30" })], "2026-10")!;
    expect(r.totalCents).toBe(6000);
  });
  it("separates items not tied to a store", () => {
    const r = capexMonth([item({ store_investment_id: null, cash_amount_cents: 700 })], "2026-10")!;
    expect(r.unassignedCents).toBe(700);
  });
  it("undefined input is unavailable (null), not zero", () => expect(capexMonth(undefined, "2026-10")).toBeNull());
});

describe("investorMonth", () => {
  it("sums contributions by month and kind, with real kind names", () => {
    const cs = [
      { id: 1, investor_id: 1, contributed_on: "2026-10-02", amount_cents: 100, kind: "equipment", note: null },
      { id: 2, investor_id: 1, contributed_on: "2026-10-20", amount_cents: 50, kind: "stock", note: null },
      { id: 3, investor_id: 2, contributed_on: "2026-09-20", amount_cents: 999, kind: "loan", note: null },
    ] as InvestorContribution[];
    const r = investorMonth(cs, "2026-10")!;
    expect(r.totalCents).toBe(150);
    expect(r.byKind.map((k) => k.kind).sort()).toEqual(["equipment", "stock"]);
  });
});

describe("financeMonth", () => {
  const rec = (store: number, loss: number, complete = true): Reconciliation =>
    ({ store_id: store, period: "2026-10", restocked_value_cents: 1000, cogs_cents: 0, loss_value_cents: loss, complete, loss_by_reason: [{ reason: "expired", quantity: 1, value_cents: loss }], loss_by_sku: [{ sku: "A", quantity: 1, value_cents: loss }] }) as unknown as Reconciliation;
  it("sums stores and counts incomplete ones", () => {
    const r = financeMonth([{ storeId: 1, series: [rec(1, 100)] }, { storeId: 2, series: [rec(2, 50, false)] }], "2026-10")!;
    expect(r.lossValueCents).toBe(150);
    expect(r.incompleteStores).toBe(1);
    expect(r.lossByReason).toEqual([{ reason: "expired", valueCents: 150 }]);
  });
  it("no store reconciled in the month is null, not a zero loss", () => {
    expect(financeMonth([{ storeId: 1, series: [] }], "2026-10")).toBeNull();
  });
});

describe("treasuryMonth investment (CAPEX as the cash flow classifies it)", () => {
  const summary = (investmentOut: number) =>
    ({ by_category: [], by_nature: [{ nature: "investment", inflow_cents: 0, outflow_cents: investmentOut, net_cents: -investmentOut }], unresolved_count: 0, pending_count: 0 }) as unknown as TransactionSummary;
  const tx = (category: string, amount: number, over: Partial<BankTransaction> = {}) => ({ category, amount_cents: amount, direction: "outflow", neutralized_with_id: null, ...over }) as BankTransaction;

  it("total comes from the summary by nature; breakdown from the listed transactions, biggest first", () => {
    const m = treasuryMonth(summary(2_670_335), [tx("Equipamento", 124_200), tx("Investimento (cartão sócio)", 2_486_700), tx("Equipamento", 1_000)])!;
    expect(m.investmentCents).toBe(2_670_335);
    expect(m.investmentByCategory).toEqual([{ category: "Investimento (cartão sócio)", cents: 2_486_700 }, { category: "Equipamento", cents: 125_200 }]);
  });
  it("ignores neutralized and inflow transactions in the breakdown", () => {
    const m = treasuryMonth(summary(100), [tx("Equipamento", 100), tx("Equipamento", 999, { neutralized_with_id: 7 }), tx("Equipamento", 555, { direction: "inflow" })])!;
    expect(m.investmentByCategory).toEqual([{ category: "Equipamento", cents: 100 }]);
  });
  it("no investment nature in the month is zero, and no summary is unavailable (null)", () => {
    expect(treasuryMonth({ by_category: [], by_nature: [], unresolved_count: 0, pending_count: 0 } as unknown as TransactionSummary, [])!.investmentCents).toBe(0);
    expect(treasuryMonth(null)).toBeNull();
  });
});
