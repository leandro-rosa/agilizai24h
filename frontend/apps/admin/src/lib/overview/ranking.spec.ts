import { baseText, needsBase, rankScore, recurrenceOf } from "./ranking";

describe("rankScore", () => {
  const base = 10_000_000; // R$ 100 mil de receita

  it("a huge % on a tiny base ranks BELOW a modest % on a big financial impact", () => {
    // Produto 1 → 12 unidades (+1.087%), R$ 55 de impacto, 1 loja.
    const tiny = rankScore({ impactCents: 5_500, baseCents: base, share: 0.0005, recurrence: 0, breadth: 1 / 20 });
    // Queda de 4% da receita, R$ 4 mil, 8 lojas, 3 meses seguidos.
    const big = rankScore({ impactCents: 400_000, baseCents: base, share: 0.4, recurrence: 1, breadth: 8 / 20 });
    expect(big).toBeGreaterThan(tiny * 5);
  });

  it("is bounded in [0, 1]", () => {
    expect(rankScore({ impactCents: 9e12, baseCents: base, share: 5, recurrence: 5, breadth: 5 })).toBeLessThanOrEqual(1);
    expect(rankScore({ impactCents: null, baseCents: null })).toBe(0);
  });

  it("no financial base means impact is ignored, not infinite", () => {
    expect(rankScore({ impactCents: 100, baseCents: 0 })).toBe(0);
  });
});

describe("recurrenceOf", () => {
  it("one move is not recurrence; two or three in a row are", () => {
    expect(recurrenceOf([10, 12])).toBe(0);
    expect(recurrenceOf([10, 12, 15])).toBe(0.5);
    expect(recurrenceOf([10, 12, 15, 20])).toBe(1);
  });
  it("a reversal resets it, a hole stops it, flat is zero", () => {
    expect(recurrenceOf([10, 15, 12, 14])).toBe(0);
    expect(recurrenceOf([10, null, 12, 14])).toBe(0);
    expect(recurrenceOf([10, 10])).toBe(0);
  });
});

describe("needsBase / baseText", () => {
  it("shows the base for jumps over 100%, tiny bases and from-zero", () => {
    expect(needsBase(1, 12, 11.87)).toBe(true);
    expect(needsBase(0, 5, null)).toBe(true);
    expect(needsBase(300, 650, 1.17)).toBe(true);
    expect(needsBase(5000, 5400, 0.08)).toBe(false);
  });
  it("renders 1 → 12 un.", () => expect(baseText(1, 12, String, "un.")).toBe("1 → 12 un."));
});
