import { describe, it, expect } from "@jest/globals";
import { periodsWithLoss } from "./recurrence";
import type { LossByReasonSkuRow, Period, ReconciliationInput } from "./types";

const STORE_ID = 1;
const OTHER_STORE_ID = 2;
const SKU = "SKU-A";
const OTHER_SKU = "SKU-B";
const REASON = "expired";
const OTHER_REASON = "damaged_product";

function row(overrides: Partial<LossByReasonSkuRow> = {}): LossByReasonSkuRow {
  return { reason: REASON, sku: SKU, quantity: 1, value_cents: 100, ...overrides };
}

function reconciliation(period: Period, rows: LossByReasonSkuRow[], store_id = STORE_ID): ReconciliationInput {
  return { store_id, period, loss_by_reason_sku: rows };
}

describe("periodsWithLoss", () => {
  it("includes a period whose reconciliation has real quantity>0 for the exact sku+reason", () => {
    const reconciliations = [reconciliation("2026-06", [row({ quantity: 5 })])];
    expect(periodsWithLoss(reconciliations, SKU, REASON, ["2026-06"])).toEqual(["2026-06"]);
  });

  it("excludes a period whose only matching row is for a different SKU (reason matches, qty>0) — proves the sku filter is applied", () => {
    // The single row in this period has the right reason ("expired") and quantity>0, but
    // the wrong sku ("SKU-B" instead of "SKU-A"). If the sku filter were missing or broken
    // (e.g. accidentally always true), this row's qty would be summed in and the period
    // would incorrectly show as having loss.
    const reconciliations = [reconciliation("2026-06", [row({ sku: OTHER_SKU, reason: REASON, quantity: 5 })])];
    expect(periodsWithLoss(reconciliations, SKU, REASON, ["2026-06"])).toEqual([]);
  });

  it("excludes a period whose only matching row is for a different reason (sku matches, qty>0) — proves the reason filter is applied", () => {
    // The single row in this period has the right sku ("SKU-A") and quantity>0, but the
    // wrong reason ("damaged_product" instead of "expired"). If the reason filter were
    // missing or broken, this row's qty would be summed in and the period would incorrectly
    // show as having loss.
    const reconciliations = [reconciliation("2026-06", [row({ sku: SKU, reason: OTHER_REASON, quantity: 5 })])];
    expect(periodsWithLoss(reconciliations, SKU, REASON, ["2026-06"])).toEqual([]);
  });

  it("double-filter: excludes a period even with real-quantity rows for the wrong sku AND the wrong reason, alongside a zero-quantity row for the exact sku+reason", () => {
    // Single reconciliation, single period, three rows mixed together in the same
    // loss_by_reason_sku array:
    //  - reason matches ("expired") but sku is wrong ("SKU-B"), quantity=7 (real)
    //  - sku matches ("SKU-A") but reason is wrong ("damaged_product"), quantity=9 (real)
    //  - sku AND reason both match exactly ("SKU-A"/"expired"), but quantity=0 (no real loss)
    //
    // Hand trace: the correct implementation filters to rows where sku === "SKU-A" AND
    // reason === "expired" — only the third row qualifies, and its quantity is 0, so the
    // summed quantity for this period is 0. `0 > 0` is false → period excluded.
    //  - A broken sku filter (dropped, or always true) would let the first row's qty=7
    //    through the reason-only filter → summed qty 7 > 0 → period wrongly INCLUDED.
    //  - A broken reason filter (dropped, or always true) would let the second row's qty=9
    //    through the sku-only filter → summed qty 9 > 0 → period wrongly INCLUDED.
    // Asserting the period is excluded below catches either bug.
    const reconciliations = [
      reconciliation("2026-06", [
        row({ sku: OTHER_SKU, reason: REASON, quantity: 7 }),
        row({ sku: SKU, reason: OTHER_REASON, quantity: 9 }),
        row({ sku: SKU, reason: REASON, quantity: 0 }),
      ]),
    ];
    expect(periodsWithLoss(reconciliations, SKU, REASON, ["2026-06"])).toEqual([]);
  });

  it("mixes multiple SKUs and multiple reasons in the same reconciliation and still isolates the one matching row", () => {
    // Same shape as the double-filter test above, but this time the exact sku+reason row
    // carries real quantity — proves the positive case still works when unrelated rows for
    // other skus/reasons are mixed into the same loss_by_reason_sku array.
    const reconciliations = [
      reconciliation("2026-06", [
        row({ sku: OTHER_SKU, reason: REASON, quantity: 7 }),
        row({ sku: SKU, reason: OTHER_REASON, quantity: 9 }),
        row({ sku: SKU, reason: REASON, quantity: 3 }),
      ]),
    ];
    expect(periodsWithLoss(reconciliations, SKU, REASON, ["2026-06"])).toEqual(["2026-06"]);
  });

  it("sums quantity across multiple matching rows within the same period", () => {
    const reconciliations = [reconciliation("2026-06", [row({ quantity: 2 }), row({ quantity: 3 })])];
    expect(periodsWithLoss(reconciliations, SKU, REASON, ["2026-06"])).toEqual(["2026-06"]);
  });

  it("sums quantity across multiple ReconciliationInput entries for the same period", () => {
    const reconciliations = [reconciliation("2026-06", [row({ quantity: 0 })]), reconciliation("2026-06", [row({ quantity: 4 })], OTHER_STORE_ID)];
    expect(periodsWithLoss(reconciliations, SKU, REASON, ["2026-06"])).toEqual(["2026-06"]);
  });

  it("excludes a period with no matching reconciliation at all (not just zero quantity)", () => {
    const reconciliations = [reconciliation("2026-06", [row({ quantity: 5 })])];
    expect(periodsWithLoss(reconciliations, SKU, REASON, ["2026-06", "2026-09"])).toEqual(["2026-06"]);
  });

  it("returns [] when none of the given periods had loss for this sku+reason", () => {
    const reconciliations = [
      reconciliation("2026-05", [row({ quantity: 5 })]), // real loss, but period not in the requested list
      reconciliation("2026-06", [row({ quantity: 0 })]), // zero quantity
      reconciliation("2026-07", [row({ sku: OTHER_SKU, quantity: 5 })]), // real qty, wrong sku
    ];
    expect(periodsWithLoss(reconciliations, SKU, REASON, ["2026-06", "2026-07"])).toEqual([]);
  });

  it("preserves the order of the given `periods` list in its output, not reconciliation order", () => {
    const reconciliations = [
      reconciliation("2026-06", [row({ quantity: 5 })]),
      reconciliation("2026-07", [row({ quantity: 0 })]),
      reconciliation("2026-08", [row({ quantity: 2 })]),
    ];
    // `periods` deliberately given out of chronological order.
    expect(periodsWithLoss(reconciliations, SKU, REASON, ["2026-08", "2026-06", "2026-07"])).toEqual(["2026-08", "2026-06"]);
  });
});
