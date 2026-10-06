import { buildStoreSummary, explainers } from "./stores";
import type { StoreContribution, StoreMonthPnl } from "./types";

// Fixtures sintéticas, só neste spec.
const c = (id: number, delta: number, prev = 1000): StoreContribution => ({ storeId: id, name: `L${id}`, deltaCents: delta, deltaPct: delta / prev, previousCents: prev, currentCents: prev + delta });
const pnl = (id: number, net: number): StoreMonthPnl => ({ storeId: id, name: `L${id}`, netRevenueCents: net, contributionMarginCents: net * 0.4, operatingProfitCents: net * 0.2, lossCents: 0 });

describe("explainers", () => {
  it("picks the fewest stores that cover ~60% of the movement, biggest first, with shares", () => {
    const e = explainers([c(1, 500), c(2, 300), c(3, 100), c(4, 60), c(5, 40)]);
    expect(e.stores.map((s) => s.storeId)).toEqual([1, 2]);
    expect(e.coveredShare).toBeCloseTo(0.8);
    expect(e.totalCents).toBe(1000);
    expect(e.storeCount).toBe(5);
    expect(e.stores[0].share).toBeCloseTo(0.5);
  });
  it("stops at 5 stores even if the movement is evenly spread", () => {
    const e = explainers(Array.from({ length: 12 }, (_, i) => c(i + 1, 100)));
    expect(e.stores).toHaveLength(5);
    expect(e.coveredShare).toBeCloseTo(5 / 12);
  });
  it("empty movement is empty, never a division by zero", () => {
    expect(explainers([])).toEqual({ totalCents: 0, stores: [], coveredShare: 0, storeCount: 0 });
  });
});

describe("buildStoreSummary explainers and base", () => {
  it("separates who explains growth from who explains decline, carrying previous → current", () => {
    const sales = {
      previous: new Map([[1, 1000], [2, 1000], [3, 1000], [4, 1000]]),
      current: new Map([[1, 1500], [2, 1100], [3, 600], [4, 990]]),
    };
    const s = buildStoreSummary([1, 2, 3, 4].map((i) => pnl(i, 1000)), [1, 2, 3, 4].map((i) => pnl(i, 1000)), 4, 4000, sales)!;
    expect(s.growthExplainers.stores.map((x) => x.storeId)).toEqual([1]);
    expect(s.declineExplainers.stores.map((x) => x.storeId)).toEqual([3]);
    expect(s.growthExplainers.stores[0]).toMatchObject({ previousCents: 1000, currentCents: 1500, share: 500 / 600 });
  });
});
