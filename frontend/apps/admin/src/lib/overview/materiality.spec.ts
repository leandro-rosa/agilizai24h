import { byImpact, isMaterial } from "./materiality";

describe("isMaterial", () => {
  it("tiny product falling 40% but 0.1% of revenue is not material", () => {
    expect(isMaterial({ deltaAbs: -400, deltaPct: -0.4, base: 1_000_000 })).toBe(false);
  });
  it("product with 8% of revenue falling 12% is material", () => {
    expect(isMaterial({ deltaAbs: -96_000, deltaPct: -0.12, base: 1_000_000 })).toBe(true);
  });
  it("large item with small oscillation is not material", () => {
    expect(isMaterial({ deltaAbs: -20_000, deltaPct: -0.02, base: 1_000_000 })).toBe(false);
  });
  it("new item (no base pct) with relevant absolute value shows", () => {
    expect(isMaterial({ deltaAbs: 50_000, deltaPct: null, base: 1_000_000 })).toBe(true);
  });
  it("unknown inputs are never material", () => {
    expect(isMaterial({ deltaAbs: null, deltaPct: null, base: 1 })).toBe(false);
    expect(isMaterial({ deltaAbs: 1, deltaPct: 1, base: null })).toBe(false);
    expect(isMaterial({ deltaAbs: 1, deltaPct: 1, base: 0 })).toBe(false);
  });
});

describe("byImpact", () => {
  it("sorts by absolute impact desc", () => {
    const rows = [{ deltaAbs: 5 }, { deltaAbs: -50 }, { deltaAbs: 20 }];
    expect(rows.sort(byImpact).map((r) => r.deltaAbs)).toEqual([-50, 20, 5]);
  });
});
