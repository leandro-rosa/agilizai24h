import { describe, it, expect } from "@jest/globals";
import { evaluateRecentHistory, hasOverwhelmingEvidence } from "./recent-history-guard";
import { DEFAULT_PARAMETERS } from "./parameters";
import type { Period, SupplyRecordInput } from "./types";

const STORE_ID = 1;
const SKU = "SKU-A";

function supply(period: Period, quantity_restocked: number, sku = SKU): SupplyRecordInput {
  return { store_id: STORE_ID, period, sku, quantity_restocked };
}

// recentHistory: { minClosedMonths: 2, minUnits: 15 }
const parameters = DEFAULT_PARAMETERS;

describe("evaluateRecentHistory", () => {
  it("returns no_history when firstSeenPeriod is null, ignoring any supply rows", () => {
    const result = evaluateRecentHistory({
      firstSeenPeriod: null,
      monthsSinceFirstSeen: 12, // would otherwise be well above minClosedMonths — must not matter
      allSupplyRows: [supply("2026-08", 999)], // must be irrelevant — short-circuited before filtering
      parameters,
    });

    expect(result).toEqual({ firstSeenRecently: true, qtyRestockedSinceFirstSeen: 0, reason: "no_history" });
  });

  it("returns no_history when monthsSinceFirstSeen is null, ignoring any supply rows", () => {
    const result = evaluateRecentHistory({
      firstSeenPeriod: "2026-08",
      monthsSinceFirstSeen: null,
      allSupplyRows: [supply("2026-08", 999)], // must be irrelevant — short-circuited before filtering
      parameters,
    });

    expect(result).toEqual({ firstSeenRecently: true, qtyRestockedSinceFirstSeen: 0, reason: "no_history" });
  });

  it("returns months_below_minimum when monthsSinceFirstSeen is below minClosedMonths, even with sufficient units", () => {
    // minClosedMonths = 2; monthsSinceFirstSeen = 1 < 2 → below minimum.
    // qtyRestockedSinceFirstSeen = 20 ≥ minUnits (15) — units ARE sufficient, but the months
    // check runs first in the code, so months_below_minimum must win regardless.
    const result = evaluateRecentHistory({
      firstSeenPeriod: "2026-08",
      monthsSinceFirstSeen: 1,
      allSupplyRows: [supply("2026-08", 20)],
      parameters,
    });

    expect(result).toEqual({ firstSeenRecently: true, qtyRestockedSinceFirstSeen: 20, reason: "months_below_minimum" });
  });

  it("boundary: monthsSinceFirstSeen exactly at minClosedMonths is NOT below minimum (< is strict)", () => {
    // monthsSinceFirstSeen = 2 === minClosedMonths → `2 < 2` is false, so the months check does
    // not fire and evaluation proceeds to the units check. Units are deliberately insufficient
    // (10 < 15) so the resulting reason ("units_below_minimum", not "months_below_minimum")
    // proves the months boundary itself did not block.
    const result = evaluateRecentHistory({
      firstSeenPeriod: "2026-07",
      monthsSinceFirstSeen: 2,
      allSupplyRows: [supply("2026-07", 10)],
      parameters,
    });

    expect(result).toEqual({ firstSeenRecently: true, qtyRestockedSinceFirstSeen: 10, reason: "units_below_minimum" });
  });

  it("counts qtyRestockedSinceFirstSeen only from firstSeenPeriod onward (>=), excluding earlier restocks", () => {
    // firstSeenPeriod = 2026-07. A restock in 2026-06 (before firstSeenPeriod) must be excluded
    // from the sum — if wrongly included (50 + 5 + 5 = 60 ≥ 15) the units check would
    // incorrectly pass.
    const result = evaluateRecentHistory({
      firstSeenPeriod: "2026-07",
      monthsSinceFirstSeen: 3,
      allSupplyRows: [
        supply("2026-06", 50), // before firstSeenPeriod — must be excluded
        supply("2026-07", 5),
        supply("2026-08", 5),
      ],
      parameters,
    });

    // Hand trace: qtyRestockedSinceFirstSeen = 5 + 5 = 10 (the 50 from 2026-06 is excluded by `>=`)
    // 10 < minUnits (15) → units_below_minimum.
    expect(result).toEqual({ firstSeenRecently: true, qtyRestockedSinceFirstSeen: 10, reason: "units_below_minimum" });
  });

  it("boundary: qtyRestockedSinceFirstSeen exactly one unit below minUnits is below minimum", () => {
    // minUnits = 15; sum = 14 < 15 → below minimum.
    const result = evaluateRecentHistory({
      firstSeenPeriod: "2026-07",
      monthsSinceFirstSeen: 3,
      allSupplyRows: [supply("2026-07", 14)],
      parameters,
    });

    expect(result).toEqual({ firstSeenRecently: true, qtyRestockedSinceFirstSeen: 14, reason: "units_below_minimum" });
  });

  it("boundary: both criteria satisfied exactly at their minimums (< is strict on both) → firstSeenRecently=false", () => {
    // monthsSinceFirstSeen = 2 === minClosedMonths → `2 < 2` is false, months check does not fire.
    // qtyRestockedSinceFirstSeen = 15 === minUnits → `15 < 15` is false, units check does not fire.
    // Both boundaries satisfied simultaneously → falls through to the final return.
    const result = evaluateRecentHistory({
      firstSeenPeriod: "2026-01",
      monthsSinceFirstSeen: 2,
      allSupplyRows: [supply("2026-01", 15)],
      parameters,
    });

    expect(result).toEqual({ firstSeenRecently: false, qtyRestockedSinceFirstSeen: 15, reason: null });
  });

  it("returns firstSeenRecently=false with a comfortable margin above both minimums", () => {
    const result = evaluateRecentHistory({
      firstSeenPeriod: "2026-01",
      monthsSinceFirstSeen: 6,
      allSupplyRows: [supply("2026-01", 30), supply("2026-04", 20)],
      parameters,
    });

    // Hand trace: qtyRestockedSinceFirstSeen = 30 + 20 = 50; 6 ≥ 2 and 50 ≥ 15 → not recent.
    expect(result).toEqual({ firstSeenRecently: false, qtyRestockedSinceFirstSeen: 50, reason: null });
  });
});

describe("hasOverwhelmingEvidence", () => {
  it("boundary: true when qtySold=0 and qtyRestocked is exactly 2× minUnits", () => {
    // minUnits = 15 → threshold = 30. qtyRestocked = 30 ≥ 30 → satisfies (>= is inclusive).
    // qtySold = 0 satisfies the other half. Both hold → true.
    expect(hasOverwhelmingEvidence({ qtySold: 0, qtyRestocked: 30, parameters })).toBe(true);
  });

  it("boundary: false when qtyRestocked is exactly one unit below 2× minUnits, even with qtySold=0", () => {
    // threshold = 30; qtyRestocked = 29 < 30 → restock half fails, even though qtySold=0
    // satisfies the sold half. Proves the function requires BOTH conditions, not qtySold=0 alone.
    expect(hasOverwhelmingEvidence({ qtySold: 0, qtyRestocked: 29, parameters })).toBe(false);
  });

  it("false when qtySold > 0, even with qtyRestocked far above the threshold", () => {
    // qtyRestocked = 1000 ≫ 30 satisfies the restock half, but qtySold = 1 ≠ 0 fails the sold
    // half. Proves the function requires BOTH conditions, not qtyRestocked alone.
    expect(hasOverwhelmingEvidence({ qtySold: 1, qtyRestocked: 1000, parameters })).toBe(false);
  });
});
