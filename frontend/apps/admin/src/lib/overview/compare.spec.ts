import { avgOfAll, compareRate, compareValue, rateDelta, signedPct, signedPp, valueDelta } from "./compare";

describe("valueDelta", () => {
  it("computes pct and abs", () => {
    expect(valueDelta(108.4, 100).pct).toBeCloseTo(0.084);
    expect(valueDelta(108, 100).abs).toBe(8);
  });
  it("null base or zero base has no pct (never a fabricated 0%)", () => {
    expect(valueDelta(5, null)).toEqual({ pct: null, abs: null });
    expect(valueDelta(5, 0)).toEqual({ pct: null, abs: 5 });
  });
  it("uses |base| so a loss shrinking reads as an improvement sign", () => {
    expect(valueDelta(-50, -100).pct).toBeCloseTo(0.5);
  });
});

describe("rateDelta", () => {
  it("is in percentage points, not percent", () => {
    expect(rateDelta(0.252, 0.24).pp).toBeCloseTo(1.2);
  });
  it("null in, null out", () => {
    expect(rateDelta(null, 0.2).pp).toBeNull();
  });
});

describe("avgOfAll", () => {
  it("averages when all months present", () => expect(avgOfAll([10, 20, 30])).toBe(20));
  it("refuses to average a hole", () => expect(avgOfAll([10, null, 30])).toBeNull());
  it("refuses fewer months than expected", () => expect(avgOfAll([10, 20])).toBeNull());
});

describe("compare*", () => {
  it("compareValue yields both baselines", () => {
    const c = compareValue(120, 100, [90, 100, 110]);
    expect(c.vsPrevious.pct).toBeCloseTo(0.2);
    expect(c.vsAvg3.pct).toBeCloseTo(0.2);
  });
  it("compareRate yields p.p.", () => {
    expect(compareRate(0.252, 0.24, [0.24, 0.24, 0.24]).vsAvg3.pp).toBeCloseTo(1.2);
  });
});

describe("formatting", () => {
  it("signedPct", () => {
    expect(signedPct(0.084)).toBe("+8,4%");
    expect(signedPct(-0.148)).toBe("−14,8%");
    expect(signedPct(null)).toBe("sem comparação");
  });
  it("signedPp", () => {
    expect(signedPp(1.2)).toBe("+1,2 p.p.");
    expect(signedPp(-0.7)).toBe("−0,7 p.p.");
  });
});

describe("sinal de variação que arredonda para zero", () => {
  it("não mostra −0%", () => {
    expect(signedPct(-0.003, 0)).toBe("0%");
    expect(signedPct(0.0004, 1)).toBe("0,0%");
    expect(signedPct(-0.021, 1)).toBe("−2,1%");
    expect(signedPp(-0.02, 1)).toBe("0,0 p.p.");
  });
});
