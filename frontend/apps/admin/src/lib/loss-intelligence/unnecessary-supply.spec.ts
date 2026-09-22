import { describe, it, expect } from "@jest/globals";
import { detectUnnecessarySupply } from "./unnecessary-supply";
import type { UnnecessarySupplyInput } from "./unnecessary-supply";
import { DEFAULT_PARAMETERS } from "./parameters";

// unnecessarySupply: { verylowSaleRatio: 0.15 }; validity: { lowSaleRatio: 0.5 } (both from DEFAULT_PARAMETERS).
const parameters = DEFAULT_PARAMETERS;

/** Baseline where none of the 4 signals fire — each test overrides only what it needs. */
function input(overrides: Partial<UnnecessarySupplyInput> = {}): UnnecessarySupplyInput {
  return {
    qtySold: 10,
    monthsWithRestock: 1,
    saleToSupplyRatio: 1,
    periodsWithExpiryLoss: [],
    periodsWithRestock: [],
    recurrencePeriodsWithAnyLoss: [],
    parameters,
    ...overrides,
  };
}

describe("detectUnnecessarySupply", () => {
  it("ZERO_SALES_RECURRING_SUPPLY fires alone: qtySold=0 and monthsWithRestock=2, with the other 3 signals' conditions explicitly false", () => {
    // Signal 1: qtySold === 0 (true) && monthsWithRestock >= 2 (2 >= 2, true) → fires.
    // Signal 2 guard: periodsWithExpiryLoss=[] → length > 0 is false, regardless of ratio.
    // Signal 3 guard: periodsWithExpiryLoss=[] → the outer .some() is vacuously false.
    // Signal 4 guard: recurrencePeriodsWithAnyLoss=[] → length >= 2 is false, regardless of ratio.
    const result = detectUnnecessarySupply(
      input({
        qtySold: 0,
        monthsWithRestock: 2,
        saleToSupplyRatio: 0, // 0 sold / restocked — deliberately also < verylowSaleRatio, to prove signal 2 still doesn't leak in via the guarded periodsWithExpiryLoss=[]
        periodsWithExpiryLoss: [],
        periodsWithRestock: ["2026-06", "2026-07"],
        recurrencePeriodsWithAnyLoss: [],
      }),
    );

    expect(result.sinaisTransversais).toEqual(["ZERO_SALES_RECURRING_SUPPLY"]);
  });

  it("LOW_SALES_EXPIRY_WASTE fires alone: ratio < verylowSaleRatio and an expiry-loss period exists, with the other 3 signals' conditions explicitly false", () => {
    // Signal 1 guard: qtySold=3 !== 0 → false.
    // Signal 2: ratio !== null (true) && 0.1 < 0.15 (true) && periodsWithExpiryLoss.length > 0 (1 > 0, true) → fires.
    // Signal 3 guard: the only restock period (2026-06) is BEFORE the only loss period (2026-08) —
    // "2026-06" > "2026-08" is false — so restockAfterLoss is false.
    // Signal 4 guard: recurrencePeriodsWithAnyLoss=[] → length >= 2 is false (ratio 0.1 < 0.5 would
    // otherwise satisfy signal 4's ratio half, so the guard here is load-bearing, not incidental).
    const result = detectUnnecessarySupply(
      input({
        qtySold: 3,
        monthsWithRestock: 1,
        saleToSupplyRatio: 0.1,
        periodsWithExpiryLoss: ["2026-08"],
        periodsWithRestock: ["2026-06"],
        recurrencePeriodsWithAnyLoss: [],
      }),
    );

    expect(result.sinaisTransversais).toEqual(["LOW_SALES_EXPIRY_WASTE"]);
  });

  it("RESTOCK_AFTER_EXPIRY_LOSS fires alone: a restock period comes after the only loss period, with the other 3 signals' conditions explicitly false", () => {
    // Signal 1 guard: qtySold=5 !== 0 → false.
    // Signal 2 guard: ratio=1, not < 0.15 → false.
    // Signal 3: periodsWithExpiryLoss=["2026-06"]; periodsWithRestock=["2026-05","2026-07"].
    // "2026-05" > "2026-06" is false, but "2026-07" > "2026-06" is true → restockAfterLoss=true → fires.
    // Signal 4 guard: ratio=1, not < 0.5 → false (recurrencePeriodsWithAnyLoss is irrelevant here).
    const result = detectUnnecessarySupply(
      input({
        qtySold: 5,
        monthsWithRestock: 2,
        saleToSupplyRatio: 1,
        periodsWithExpiryLoss: ["2026-06"],
        periodsWithRestock: ["2026-05", "2026-07"],
        recurrencePeriodsWithAnyLoss: [],
      }),
    );

    expect(result.sinaisTransversais).toEqual(["RESTOCK_AFTER_EXPIRY_LOSS"]);
  });

  it("RESTOCK_AFTER_EXPIRY_LOSS trap: a restock BEFORE the only loss period (never after) does NOT fire — order matters, not mere co-occurrence", () => {
    // If the implementation only checked "some restock AND some loss exist" (ignoring order),
    // this fixture would wrongly fire: there IS a restock (2026-05) and there IS a loss (2026-08).
    // The real condition requires restockPeriod > lossPeriod: "2026-05" > "2026-08" is false (lexicographic
    // "YYYY-MM" comparison — "05" < "08"), so restockAfterLoss must be false.
    // The other 3 signals are also explicitly guarded off, so the whole result must be [].
    const result = detectUnnecessarySupply(
      input({
        qtySold: 5, // !== 0 → signal 1 guard
        monthsWithRestock: 1,
        saleToSupplyRatio: 1, // not < 0.15 and not < 0.5 → signals 2 and 4 guard
        periodsWithExpiryLoss: ["2026-08"],
        periodsWithRestock: ["2026-05"], // before the loss period, not after
        recurrencePeriodsWithAnyLoss: [],
      }),
    );

    expect(result.sinaisTransversais).toEqual([]);
  });

  it("RESTOCK_AFTER_EXPIRY_LOSS boundary: a restock in the SAME period as the loss (equal, not strictly after) does not fire either", () => {
    // The comparison is strictly `restockPeriod > lossPeriod`; equal periods must not satisfy it.
    const result = detectUnnecessarySupply(
      input({
        qtySold: 5,
        monthsWithRestock: 1,
        saleToSupplyRatio: 1,
        periodsWithExpiryLoss: ["2026-08"],
        periodsWithRestock: ["2026-08"],
        recurrencePeriodsWithAnyLoss: [],
      }),
    );

    expect(result.sinaisTransversais).toEqual([]);
  });

  it("OVERSUPPLY_WITH_RECURRING_LOSS fires alone: ratio < validity.lowSaleRatio and 2+ recurrence periods with any loss, with the other 3 signals' conditions explicitly false", () => {
    // Signal 1 guard: qtySold=3 !== 0 → false.
    // Signal 2 guard: periodsWithExpiryLoss=[] → length > 0 is false, regardless of ratio.
    // Signal 3 guard: periodsWithExpiryLoss=[] → the outer .some() is vacuously false.
    // Signal 4: ratio !== null (true) && 0.3 < 0.5 (true) && recurrencePeriodsWithAnyLoss.length >= 2
    // (2 >= 2, true) → fires.
    const result = detectUnnecessarySupply(
      input({
        qtySold: 3,
        monthsWithRestock: 1,
        saleToSupplyRatio: 0.3,
        periodsWithExpiryLoss: [],
        periodsWithRestock: ["2026-06"],
        recurrencePeriodsWithAnyLoss: ["2026-04", "2026-05"],
      }),
    );

    expect(result.sinaisTransversais).toEqual(["OVERSUPPLY_WITH_RECURRING_LOSS"]);
  });

  it("combined case (Paçoquita, spec §10.4): 18 restocked / 0 sold / 5 lost to expiry in one period, followed by another restock, across 3 months with restock — triggers exactly 3 signals together", () => {
    // The request's literal numbers: 18 abastecido / 0 vendido / 5 vencido / 3 meses com abastecimento,
    // perda seguida de novo abastecimento. Window: restocked in 2026-05, 2026-06, 2026-07 (3 months);
    // the 5 units expired in 2026-06; a further restock followed in 2026-07 (after the loss period).
    const result = detectUnnecessarySupply(
      input({
        qtySold: 0,
        monthsWithRestock: 3,
        saleToSupplyRatio: 0, // 0 sold / 18 restocked
        periodsWithExpiryLoss: ["2026-06"],
        periodsWithRestock: ["2026-05", "2026-06", "2026-07"],
        // Only 1 recurrence-lookback period with loss so far — not yet "recurring" by signal 4's own
        // threshold (>= 2), so signal 4 must NOT join the other 3.
        recurrencePeriodsWithAnyLoss: ["2026-06"],
      }),
    );

    // Hand trace:
    // Signal 1: qtySold === 0 (true) && monthsWithRestock (3) >= 2 (true) → ZERO_SALES_RECURRING_SUPPLY.
    // Signal 2: ratio !== null (true) && 0 < 0.15 (true) && periodsWithExpiryLoss.length > 0 (true) →
    //   LOW_SALES_EXPIRY_WASTE.
    // Signal 3: loss period "2026-06"; restock periods "2026-05" (not after), "2026-06" (equal, not
    //   after), "2026-07" (after — "2026-07" > "2026-06" is true) → restockAfterLoss = true →
    //   RESTOCK_AFTER_EXPIRY_LOSS.
    // Signal 4: ratio 0 < 0.5 (true) but recurrencePeriodsWithAnyLoss.length (1) >= 2 is false →
    //   does NOT fire.
    expect(result.sinaisTransversais).toEqual(["ZERO_SALES_RECURRING_SUPPLY", "LOW_SALES_EXPIRY_WASTE", "RESTOCK_AFTER_EXPIRY_LOSS"]);
  });

  it("saleToSupplyRatio=null does not throw and does not trigger either ratio-dependent signal, even when their non-ratio conditions are satisfied", () => {
    // periodsWithExpiryLoss is non-empty (would satisfy signal 2's other condition) and
    // recurrencePeriodsWithAnyLoss has 2 periods (would satisfy signal 4's other condition) — both
    // must still be blocked purely by ratio === null, with no exception thrown.
    const call = () =>
      detectUnnecessarySupply(
        input({
          qtySold: 5, // !== 0 → signal 1 guard
          monthsWithRestock: 1,
          saleToSupplyRatio: null,
          periodsWithExpiryLoss: ["2026-06"],
          periodsWithRestock: [], // no restock at all → signal 3 guard, independent of ratio
          recurrencePeriodsWithAnyLoss: ["2026-01", "2026-02"],
        }),
      );

    expect(call).not.toThrow();
    expect(call().sinaisTransversais).toEqual([]);
  });
});
