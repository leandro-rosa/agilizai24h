import { describe, it, expect } from "@jest/globals";
import { computeNetworkComparison } from "./network-comparison";
import type { StoreSignal } from "./network-comparison";
import { DEFAULT_PARAMETERS } from "./parameters";
import type { NetworkComparison, NetworkComparisonResult } from "./types";

// network: { minStoresForNetworkVerdict: 5 }; validity: { localOutlierMaxShare: 0.3 } (both from DEFAULT_PARAMETERS)
const parameters = DEFAULT_PARAMETERS;

function store(storeId: number, storeName: string, overrides: Partial<Pick<StoreSignal, "qtyRestocked" | "qtySold" | "hasBadSignal">> = {}): StoreSignal {
  return {
    storeId,
    storeName,
    qtyRestocked: 10,
    qtySold: 5,
    hasBadSignal: false,
    ...overrides,
  };
}

/** Narrows the union return type so tests can assert on individual fields, not just the whole object. */
function expectComputed(result: NetworkComparison): NetworkComparisonResult {
  if (result === "dado_insuficiente") {
    throw new Error("expected a computed NetworkComparisonResult, got \"dado_insuficiente\"");
  }
  return result;
}

describe("computeNetworkComparison", () => {
  it("boundary: fewer stores than minStoresForNetworkVerdict returns dado_insuficiente, even when all have a bad signal", () => {
    // minStoresForNetworkVerdict = 5. Using exactly minStoresForNetworkVerdict - 1 = 4 qualifying
    // stores (default qtyRestocked=10, qtySold=5 — both carry the sku), every one with hasBadSignal
    // true — a maximally "bad" network that should still be insufficient data.
    const perStore: StoreSignal[] = [
      store(1, "Loja A", { hasBadSignal: true }),
      store(2, "Loja B", { hasBadSignal: true }),
      store(3, "Loja C", { hasBadSignal: true }),
      store(4, "Loja D", { hasBadSignal: true }),
    ];

    const result = computeNetworkComparison({ perStore, parameters });

    // Hand trace: storesCarryingSku = 4 (all 4 have qtyRestocked=10 > 0); 4 < 5 → "dado_insuficiente",
    // regardless of every store having hasBadSignal=true.
    expect(result).toBe("dado_insuficiente");
  });

  it("boundary: exactly minStoresForNetworkVerdict stores computes normally, not dado_insuficiente", () => {
    // minStoresForNetworkVerdict = 5. Using exactly 5 qualifying stores: 2 bad, 3 healthy.
    const perStore: StoreSignal[] = [
      store(1, "Loja A", { hasBadSignal: true }),
      store(2, "Loja B", { hasBadSignal: true }),
      store(3, "Loja C", { hasBadSignal: false }),
      store(4, "Loja D", { hasBadSignal: false }),
      store(5, "Loja E", { hasBadSignal: false }),
    ];

    const result = computeNetworkComparison({ perStore, parameters });

    // Hand trace: storesCarryingSku = 5; the code checks `5 < 5`, which is false, so it does NOT
    // short-circuit to "dado_insuficiente" and computes normally.
    // storesWithSameSignal = 2 (Loja A, Loja B); affectedShare = 2 / 5 = 0.4.
    // storesHealthy = [Loja C, Loja D, Loja E], preserving input order.
    expect(result).toEqual({
      storesCarryingSku: 5,
      storesWithSameSignal: 2,
      affectedShare: 0.4,
      storesHealthy: ["Loja C", "Loja D", "Loja E"],
    });
  });

  it("computes affectedShare as a plain division of storesWithSameSignal over storesCarryingSku (3 of 10 → 0.3)", () => {
    const perStore: StoreSignal[] = [
      store(1, "Loja 01", { hasBadSignal: true }),
      store(2, "Loja 02", { hasBadSignal: true }),
      store(3, "Loja 03", { hasBadSignal: true }),
      store(4, "Loja 04", { hasBadSignal: false }),
      store(5, "Loja 05", { hasBadSignal: false }),
      store(6, "Loja 06", { hasBadSignal: false }),
      store(7, "Loja 07", { hasBadSignal: false }),
      store(8, "Loja 08", { hasBadSignal: false }),
      store(9, "Loja 09", { hasBadSignal: false }),
      store(10, "Loja 10", { hasBadSignal: false }),
    ];

    const result = computeNetworkComparison({ perStore, parameters });

    // Hand trace: storesCarryingSku = 10 (all 10 have default qtyRestocked=10 > 0).
    // storesWithSameSignal = 3 (Loja 01-03); affectedShare = 3 / 10 = 0.3 — a plain division against
    // storesCarryingSku (10), not against the raw input array length (also 10 here, but the point is
    // the denominator is storesCarryingSku, verified for real in the exclusion test below where the
    // two diverge).
    expect(result).toEqual({
      storesCarryingSku: 10,
      storesWithSameSignal: 3,
      affectedShare: 0.3,
      storesHealthy: ["Loja 04", "Loja 05", "Loja 06", "Loja 07", "Loja 08", "Loja 09", "Loja 10"],
    });
  });

  it("storesHealthy lists only the names of stores without a bad signal, in the order they came in the input", () => {
    // Interleaved bad/healthy pattern (not contiguous) so order preservation is not trivially true.
    const perStore: StoreSignal[] = [
      store(1, "Loja Bad-1", { hasBadSignal: true }),
      store(2, "Loja Healthy-1", { hasBadSignal: false }),
      store(3, "Loja Bad-2", { hasBadSignal: true }),
      store(4, "Loja Healthy-2", { hasBadSignal: false }),
      store(5, "Loja Healthy-3", { hasBadSignal: false }),
    ];

    const result = computeNetworkComparison({ perStore, parameters });

    // Hand trace: storesCarryingSku = 5 (meets the minimum). Filtering for !hasBadSignal preserves
    // the original array positions (indices 1, 3, 4) → ["Loja Healthy-1", "Loja Healthy-2", "Loja Healthy-3"],
    // in that order — not sorted, not reversed, not the bad stores.
    expect(result).toEqual({
      storesCarryingSku: 5,
      storesWithSameSignal: 2,
      affectedShare: 0.4,
      storesHealthy: ["Loja Healthy-1", "Loja Healthy-2", "Loja Healthy-3"],
    });
  });

  it("a store with qtyRestocked=0 AND qtySold=0 does not count toward storesCarryingSku, even when present in the input array", () => {
    // 5 qualifying stores already meet minStoresForNetworkVerdict (5) on their own — the zero-activity
    // store mixed in is NOT needed to reach the minimum, so this proves the filter actually excludes
    // it, rather than the test coincidentally having enough qualifying stores anyway. If the filter
    // wrongly counted "Loja Zero-Activity", storesCarryingSku would be 6 (not 5), storesWithSameSignal
    // would be 2 (not 1, since it's given hasBadSignal=true), and affectedShare would be
    // 2/6 = 0.333... (not 1/5 = 0.2) — every field below would differ.
    const perStore: StoreSignal[] = [
      store(1, "Loja Qualifying-1", { hasBadSignal: true }),
      store(2, "Loja Zero-Activity", { qtyRestocked: 0, qtySold: 0, hasBadSignal: true }),
      store(3, "Loja Qualifying-2", { hasBadSignal: false }),
      store(4, "Loja Qualifying-3", { hasBadSignal: false }),
      store(5, "Loja Qualifying-4", { hasBadSignal: false }),
      store(6, "Loja Qualifying-5", { hasBadSignal: false }),
    ];

    const result = computeNetworkComparison({ perStore, parameters });

    // Hand trace: the filter is `qtyRestocked > 0 || qtySold > 0`. For "Loja Zero-Activity",
    // 0 > 0 is false AND 0 > 0 is false → excluded from storesCarryingSku entirely, so it never
    // reaches the healthy/bad split either.
    // storesCarryingSku = 5 (the 5 "Qualifying" stores only); storesWithSameSignal = 1
    // (Qualifying-1); affectedShare = 1 / 5 = 0.2.
    // storesHealthy = the 4 healthy qualifying stores, in order — "Loja Zero-Activity" is absent
    // from storesHealthy too, since it never entered storesCarryingSku to begin with.
    expect(result).toEqual({
      storesCarryingSku: 5,
      storesWithSameSignal: 1,
      affectedShare: 0.2,
      storesHealthy: ["Loja Qualifying-2", "Loja Qualifying-3", "Loja Qualifying-4", "Loja Qualifying-5"],
    });
  });

  it("original request case: SKU healthy in 9 stores, bad signal only in the store under analysis → affectedShare=0.1, below validity.localOutlierMaxShare", () => {
    // The Paçoquita case from the request that motivated spec §12: a SKU carried in 10 stores
    // network-wide, with the bad signal present only in the one store currently being diagnosed.
    const perStore: StoreSignal[] = [
      store(1, "Loja em Análise", { hasBadSignal: true }),
      store(2, "Loja 02", { hasBadSignal: false }),
      store(3, "Loja 03", { hasBadSignal: false }),
      store(4, "Loja 04", { hasBadSignal: false }),
      store(5, "Loja 05", { hasBadSignal: false }),
      store(6, "Loja 06", { hasBadSignal: false }),
      store(7, "Loja 07", { hasBadSignal: false }),
      store(8, "Loja 08", { hasBadSignal: false }),
      store(9, "Loja 09", { hasBadSignal: false }),
      store(10, "Loja 10", { hasBadSignal: false }),
    ];

    const result = expectComputed(computeNetworkComparison({ perStore, parameters }));

    // Hand trace: storesCarryingSku = 10; storesWithSameSignal = 1 (Loja em Análise);
    // affectedShare = 1 / 10 = 0.1.
    expect(result).toEqual({
      storesCarryingSku: 10,
      storesWithSameSignal: 1,
      affectedShare: 0.1,
      storesHealthy: ["Loja 02", "Loja 03", "Loja 04", "Loja 05", "Loja 06", "Loja 07", "Loja 08", "Loja 09", "Loja 10"],
    });
    // 0.1 < validity.localOutlierMaxShare (0.3) → candidate for case D (local outlier, not a
    // network-wide problem) when this result is consumed by diagnosis/validity.ts.
    expect(result.affectedShare).toBeLessThan(parameters.validity.localOutlierMaxShare);
  });
});
