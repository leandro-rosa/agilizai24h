import { describe, it, expect } from "@jest/globals";
import { computeLossMetrics, type ComputeLossMetricsInput } from "./metrics";
import type { Period, ReconciliationInput, SalesRecordInput, SupplyRecordInput } from "./types";

const STORE_ID = 1;
const SKU = "SKU-A";

function sale(period: Period, quantity_sold: number, revenue_cents: number, sku = SKU): SalesRecordInput {
  return { store_id: STORE_ID, period, sku, quantity_sold, revenue_cents };
}

function supply(period: Period, quantity_restocked: number, sku = SKU): SupplyRecordInput {
  return { store_id: STORE_ID, period, sku, quantity_restocked };
}

function reconciliation(period: Period, loss_by_reason_sku: ReconciliationInput["loss_by_reason_sku"]): ReconciliationInput {
  return { store_id: STORE_ID, period, loss_by_reason_sku };
}

/** Base fixture with everything empty; each test overrides only what it needs. */
function baseInput(overrides: Partial<ComputeLossMetricsInput>): ComputeLossMetricsInput {
  return {
    storeId: STORE_ID,
    sku: SKU,
    allSalesRows: [],
    allSupplyRows: [],
    allReconciliations: [],
    costsBySkuAsOf: () => null,
    windowPeriods: [],
    asOfPeriod: "2026-08",
    ...overrides,
  };
}

describe("computeLossMetrics", () => {
  // (a) qtyRestocked/qtySold/revenueCents somam só as linhas dentro de windowPeriods.
  it("sums qtyRestocked, qtySold and revenueCents only over rows inside windowPeriods", () => {
    const result = computeLossMetrics(
      baseInput({
        windowPeriods: ["2026-07", "2026-08"],
        asOfPeriod: "2026-08",
        allSalesRows: [
          sale("2026-06", 100, 100_000), // outside window — must be ignored
          sale("2026-07", 10, 5_000),
          sale("2026-08", 20, 8_000),
        ],
        allSupplyRows: [
          supply("2026-06", 50), // outside window — must be ignored
          supply("2026-07", 15),
          supply("2026-08", 25),
        ],
        costsBySkuAsOf: () => 100,
      }),
    );

    // Hand trace: qtySold = 10 + 20 = 30 (100 from 06 excluded)
    expect(result.qtySold).toBe(30);
    // Hand trace: revenueCents = 5_000 + 8_000 = 13_000 (100_000 from 06 excluded)
    expect(result.revenueCents).toBe(13_000);
    // Hand trace: qtyRestocked = 15 + 25 = 40 (50 from 06 excluded)
    expect(result.qtyRestocked).toBe(40);
  });

  // (b) qtyLost/valueLostCents filtram por reason E sku corretamente.
  it("filters qtyLost/valueLostCents by reason AND sku, ignoring other SKUs and other reasons", () => {
    const result = computeLossMetrics(
      baseInput({
        windowPeriods: ["2026-08"],
        asOfPeriod: "2026-08",
        allReconciliations: [
          reconciliation("2026-08", [
            { reason: "expired", sku: "SKU-A", quantity: 5, value_cents: 500 },
            { reason: "expired", sku: "SKU-A", quantity: 1, value_cents: 100 }, // second expired row for SKU-A — must accumulate
            { reason: "expired", sku: "SKU-B", quantity: 99, value_cents: 9_999 }, // different sku — must be excluded
            { reason: "damaged_product", sku: "SKU-A", quantity: 3, value_cents: 300 },
            { reason: "damaged_product", sku: "SKU-B", quantity: 40, value_cents: 4_000 }, // different sku — must be excluded
            { reason: "other_reason", sku: "SKU-A", quantity: 2, value_cents: 200 },
          ]),
        ],
      }),
    );

    // Hand trace expired (SKU-A only): qty 5+1=6, value 500+100=600
    expect(result.byReason.expired.qtyLost).toBe(6);
    expect(result.byReason.expired.valueLostCents).toBe(600);
    // Hand trace damaged_product (SKU-A only): qty 3, value 300
    expect(result.byReason.damaged_product.qtyLost).toBe(3);
    expect(result.byReason.damaged_product.valueLostCents).toBe(300);
    // Hand trace other_reason (SKU-A only): qty 2, value 200
    expect(result.byReason.other_reason.qtyLost).toBe(2);
    expect(result.byReason.other_reason.valueLostCents).toBe(200);
  });

  // (c) saleToSupplyRatio/lossToSupplyRatio retornam null quando qtyRestocked=0 — nunca Infinity nem NaN.
  describe("division guards against qtyRestocked = 0", () => {
    it("returns null (not Infinity) when qtyRestocked is 0 and numerators are positive", () => {
      const result = computeLossMetrics(
        baseInput({
          windowPeriods: ["2026-08"],
          asOfPeriod: "2026-08",
          allSalesRows: [sale("2026-08", 10, 1_000)],
          allSupplyRows: [], // qtyRestocked = 0
          allReconciliations: [reconciliation("2026-08", [{ reason: "expired", sku: SKU, quantity: 2, value_cents: 200 }])],
          costsBySkuAsOf: () => 50,
        }),
      );

      // Unguarded would be 10/0 = Infinity and 2/0 = Infinity.
      expect(result.saleToSupplyRatio).toBeNull();
      expect(result.byReason.expired.lossToSupplyRatio).toBeNull();
    });

    it("returns null (not NaN) when qtyRestocked is 0 and numerators are also 0", () => {
      const result = computeLossMetrics(
        baseInput({
          windowPeriods: ["2026-08"],
          asOfPeriod: "2026-08",
          allSalesRows: [], // qtySold = 0
          allSupplyRows: [], // qtyRestocked = 0
          allReconciliations: [], // qtyLost = 0
        }),
      );

      // Unguarded would be 0/0 = NaN.
      expect(result.saleToSupplyRatio).toBeNull();
      expect(result.byReason.expired.lossToSupplyRatio).toBeNull();
    });
  });

  // (d) lossToRevenueRatio retorna null quando revenueCents=0.
  it("returns null for lossToRevenueRatio when revenueCents is 0", () => {
    const result = computeLossMetrics(
      baseInput({
        windowPeriods: ["2026-08"],
        asOfPeriod: "2026-08",
        allSalesRows: [], // no sales in window -> revenueCents = 0
        allSupplyRows: [supply("2026-08", 10)],
        allReconciliations: [reconciliation("2026-08", [{ reason: "expired", sku: SKU, quantity: 2, value_cents: 200 }])],
      }),
    );

    expect(result.revenueCents).toBe(0);
    // Unguarded would be 200/0 = Infinity.
    expect(result.byReason.expired.lossToRevenueRatio).toBeNull();
  });

  // (e) grossMarginCents fica null quando QUALQUER venda da janela tem custo desconhecido,
  // mesmo com outras vendas tendo custo conhecido.
  it("sets grossMarginCents to null as soon as any sale in the window fails to resolve cost, even after earlier sales resolved", () => {
    // costsBySkuAsOf is called once per sale row, always with the same (sku, asOfPeriod)
    // arguments (asOfPeriod is fixed for the whole window) — so to model "earlier sales
    // resolved a cost, a later one didn't" we use a call-counting stub that returns a
    // known cost on its first two calls and null on the third, mirroring a lookup whose
    // underlying data was incomplete partway through.
    let calls = 0;
    const costsBySkuAsOf = (): number | null => {
      calls += 1;
      return calls <= 2 ? 100 : null;
    };

    const result = computeLossMetrics(
      baseInput({
        windowPeriods: ["2026-07", "2026-08"],
        asOfPeriod: "2026-08",
        allSalesRows: [
          sale("2026-07", 10, 5_000), // 1st call -> cost 100 (known)
          sale("2026-07", 4, 2_000), // 2nd call -> cost 100 (known)
          sale("2026-08", 6, 3_000), // 3rd call -> cost null (unknown) -> breaks the loop
        ],
        costsBySkuAsOf,
      }),
    );

    expect(calls).toBe(3);
    expect(result.grossMarginCents).toBeNull();
    // netMarginAfterLossCents must follow suit — never a number derived from a null margin.
    expect(result.netMarginAfterLossCents).toBeNull();
  });

  // (f) grossMarginCents = 0 (não null) quando não há nenhuma venda na janela.
  it("sets grossMarginCents to exactly 0 (not null) when there are no sales in the window", () => {
    const result = computeLossMetrics(
      baseInput({
        windowPeriods: ["2026-08"],
        asOfPeriod: "2026-08",
        allSalesRows: [sale("2026-06", 5, 2_500)], // outside window -> salesInWindow is empty
        costsBySkuAsOf: () => null, // never called — loop over 0 rows never executes
      }),
    );

    expect(result.grossMarginCents).toBe(0);
    expect(result.grossMarginCents).not.toBeNull();
  });

  // (g) lossToMarginRatio fica null quando grossMarginCents é null OU <= 0.
  describe("lossToMarginRatio is null whenever grossMarginCents is null or <= 0", () => {
    it("is null when grossMarginCents is null (unresolved cost)", () => {
      const result = computeLossMetrics(
        baseInput({
          windowPeriods: ["2026-08"],
          asOfPeriod: "2026-08",
          allSalesRows: [sale("2026-08", 5, 1_000)],
          allReconciliations: [reconciliation("2026-08", [{ reason: "expired", sku: SKU, quantity: 1, value_cents: 200 }])],
          costsBySkuAsOf: () => null,
        }),
      );

      expect(result.grossMarginCents).toBeNull();
      expect(result.byReason.expired.lossToMarginRatio).toBeNull();
    });

    it("is null when grossMarginCents is exactly 0 from a break-even sale (not an empty window)", () => {
      // Hand trace: revenue 500 - cost(50) * qty(10) = 500 - 500 = 0
      const result = computeLossMetrics(
        baseInput({
          windowPeriods: ["2026-08"],
          asOfPeriod: "2026-08",
          allSalesRows: [sale("2026-08", 10, 500)],
          allReconciliations: [reconciliation("2026-08", [{ reason: "expired", sku: SKU, quantity: 1, value_cents: 50 }])],
          costsBySkuAsOf: () => 50,
        }),
      );

      expect(result.grossMarginCents).toBe(0);
      expect(result.byReason.expired.lossToMarginRatio).toBeNull();
    });

    it("is null when grossMarginCents is negative", () => {
      // Hand trace: revenue 100 - cost(50) * qty(10) = 100 - 500 = -400
      const result = computeLossMetrics(
        baseInput({
          windowPeriods: ["2026-08"],
          asOfPeriod: "2026-08",
          allSalesRows: [sale("2026-08", 10, 100)],
          allReconciliations: [reconciliation("2026-08", [{ reason: "expired", sku: SKU, quantity: 1, value_cents: 50 }])],
          costsBySkuAsOf: () => 50,
        }),
      );

      expect(result.grossMarginCents).toBe(-400);
      expect(result.byReason.expired.lossToMarginRatio).toBeNull();
    });
  });

  // (h) netMarginAfterLossCents nunca é usado como insumo de outro cálculo dentro desta função.
  it("computes netMarginAfterLossCents as grossMarginCents minus total loss, and never feeds it back as a denominator", () => {
    // Hand trace: grossMarginCents = revenue(10_000) - cost(200) * qty(10) = 10_000 - 2_000 = 8_000
    const result = computeLossMetrics(
      baseInput({
        windowPeriods: ["2026-08"],
        asOfPeriod: "2026-08",
        allSalesRows: [sale("2026-08", 10, 10_000)],
        allReconciliations: [
          reconciliation("2026-08", [
            { reason: "expired", sku: SKU, quantity: 2, value_cents: 300 },
            { reason: "damaged_product", sku: SKU, quantity: 1, value_cents: 150 },
            { reason: "other_reason", sku: SKU, quantity: 3, value_cents: 450 },
          ]),
        ],
        costsBySkuAsOf: () => 200,
      }),
    );

    const manualGrossMarginCents = 10_000 - 200 * 10;
    expect(manualGrossMarginCents).toBe(8_000);
    expect(result.grossMarginCents).toBe(manualGrossMarginCents);

    // Manually sum Σ valueLostCents across all 3 reasons: 300 + 150 + 450 = 900
    const manualTotalLostCents = 300 + 150 + 450;
    expect(manualTotalLostCents).toBe(900);
    const manualNetMarginAfterLossCents = manualGrossMarginCents - manualTotalLostCents;
    expect(manualNetMarginAfterLossCents).toBe(7_100);
    expect(result.netMarginAfterLossCents).toBe(manualNetMarginAfterLossCents);

    // If netMarginAfterLossCents (7_100) had leaked in as the denominator instead of
    // grossMarginCents (8_000), lossToMarginRatio would be 300/7_100 ≈ 0.042253... instead
    // of 300/8_000 = 0.0375. Assert the correct value and explicitly rule out the wrong one.
    const correctRatio = 300 / manualGrossMarginCents;
    const wrongRatioIfNetLeaked = 300 / manualNetMarginAfterLossCents;
    expect(result.byReason.expired.lossToMarginRatio).toBe(correctRatio);
    expect(result.byReason.expired.lossToMarginRatio).not.toBe(wrongRatioIfNetLeaked);
  });

  // (i) firstSeenPeriod usa o histórico completo (allSalesRows/allSupplyRows), não só windowPeriods.
  it("derives firstSeenPeriod from the full history, including a first sale before the window", () => {
    const result = computeLossMetrics(
      baseInput({
        windowPeriods: ["2026-08"],
        asOfPeriod: "2026-08",
        allSalesRows: [
          sale("2026-03", 5, 1_000), // earliest known activity — well before the window
          sale("2026-08", 10, 2_000), // inside window
        ],
        allSupplyRows: [
          supply("2026-04", 20), // also before the window, but after the first sale
        ],
        costsBySkuAsOf: () => 10,
      }),
    );

    // Hand trace: allKnownPeriods = sorted unique of ["2026-03","2026-08"] ∪ ["2026-04"]
    // = ["2026-03", "2026-04", "2026-08"] -> firstSeenPeriod is the earliest: "2026-03",
    // which is NOT in windowPeriods (["2026-08"]) — proves full-history scan, not window-only.
    expect(result.firstSeenPeriod).toBe("2026-03");
    // Hand trace: countClosedMonthsBetween("2026-03", "2026-08") = (2026*12+8) - (2026*12+3) = 5
    expect(result.monthsSinceFirstSeen).toBe(5);
  });

  // (j) monthsSinceFirstSeen conta meses fechados corretamente, incluindo virada de ano.
  it("counts closed months between firstSeenPeriod and asOfPeriod across a year boundary", () => {
    const result = computeLossMetrics(
      baseInput({
        windowPeriods: ["2026-02"],
        asOfPeriod: "2026-02",
        allSalesRows: [
          sale("2025-11", 1, 100), // firstSeenPeriod, previous year
          sale("2026-02", 3, 300), // inside window
        ],
        costsBySkuAsOf: () => 50,
      }),
    );

    expect(result.firstSeenPeriod).toBe("2025-11");
    // Hand trace: (2026*12 + 2) - (2025*12 + 11) = 24314 - 24311 = 3
    // (Dec, Jan, Feb = 3 closed months between 2025-11 and 2026-02.)
    expect(result.monthsSinceFirstSeen).toBe(3);
  });
});
