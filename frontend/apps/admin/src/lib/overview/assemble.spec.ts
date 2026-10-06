import type { InvestmentItem, InvestorContribution } from "../api/capex";
import type { Reconciliation } from "../api/finance";
import { capexMonth, financeMonth, investorMonth } from "./assemble";

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
