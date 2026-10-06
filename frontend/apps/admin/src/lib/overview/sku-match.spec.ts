import { buildAliasMap, nameScore, nameTokens, suggestPredecessors } from "./sku-match";

describe("nameTokens", () => {
  it("drops accents, weights and stop words", () => {
    expect(nameTokens("Chocolate Suflair Ao Leite 80g")).toEqual(["chocolate", "suflair", "leite"]);
    expect(nameTokens("Guaraná Antártica 2L")).toEqual(["guarana", "antartica"]);
  });
});

describe("nameScore", () => {
  it("same product with a different weight/format scores high", () => {
    expect(nameScore("Chocolate Suflair Ao Leite 80g", "SUFLAIR chocolate leite")).toBeGreaterThanOrEqual(0.9);
  });
  it("different flavours of one brand score below the threshold", () => {
    expect(nameScore("Monster Original", "Monster Mango Loco")).toBeLessThan(0.5);
  });
  it("empty names never match", () => expect(nameScore("", "x1")).toBe(0));
});

describe("suggestPredecessors", () => {
  const catalogue = [
    { sku: "OLD", name: "Chocolate Suflair Ao Leite 80g" },
    { sku: "NEW", name: "Suflair Chocolate ao Leite" },
    { sku: "OTHER", name: "Coca Cola Zero" },
  ];
  const salesInfo = new Map([["OLD", { lastSoldPeriod: "2026-08", unitsInPeriod: 0, peakBefore: 300 }]]);

  it("suggests the old SKU with its last sale month", () => {
    const r = suggestPredecessors({ newSkus: ["NEW"], catalogue, links: [], salesInfo });
    expect(r).toHaveLength(1);
    expect(r[0].candidates[0]).toMatchObject({ oldSku: "OLD", lastSoldPeriod: "2026-08", unitsInPeriod: 0 });
    expect(r[0].candidates.map((c) => c.oldSku)).not.toContain("OTHER");
  });

  it("a similar product that is still selling at full pace is NOT a barcode change (Monster 269 x 473)", () => {
    const steady = new Map([["OLD", { lastSoldPeriod: "2026-09", unitsInPeriod: 188, peakBefore: 260 }]]);
    expect(suggestPredecessors({ newSkus: ["NEW"], catalogue, links: [], salesInfo: steady })).toEqual([]);
  });

  it("an old SKU declining while the new one rises is offered (Snickers 314 -> 58)", () => {
    const handover = new Map([["OLD", { lastSoldPeriod: "2026-09", unitsInPeriod: 58, peakBefore: 314 }]]);
    expect(suggestPredecessors({ newSkus: ["NEW"], catalogue, links: [], salesInfo: handover })[0].candidates[0]).toMatchObject({ oldSku: "OLD", peakUnits: 314, unitsInPeriod: 58 });
  });

  it("an old SKU that sold a single unit once is noise, not a replaced product", () => {
    const noise = new Map([["OLD", { lastSoldPeriod: "2026-03", unitsInPeriod: 0, peakBefore: 1 }]]);
    expect(suggestPredecessors({ newSkus: ["NEW"], catalogue, links: [], salesInfo: noise })).toEqual([]);
  });

  it("a catalogue SKU that never sold cannot be proven to have been replaced", () => {
    const never = new Map([["OLD", { lastSoldPeriod: null, unitsInPeriod: 0, peakBefore: 0 }]]);
    expect(suggestPredecessors({ newSkus: ["NEW"], catalogue, links: [], salesInfo: never })).toEqual([]);
  });

  it("does not ask again after a decision either way", () => {
    for (const decision of ["same", "different"] as const) {
      expect(suggestPredecessors({ newSkus: ["NEW"], catalogue, links: [{ old_sku: "OLD", new_sku: "NEW", decision }], salesInfo })).toEqual([]);
    }
  });

  it("an old SKU already merged into another product is not offered again", () => {
    const links = [{ old_sku: "OLD", new_sku: "ELSE", decision: "same" as const }];
    expect(suggestPredecessors({ newSkus: ["NEW"], catalogue, links, salesInfo })).toEqual([]);
  });
});

describe("buildAliasMap", () => {
  it("resolves chains to the newest SKU and ignores 'different'", () => {
    const m = buildAliasMap([
      { old_sku: "A", new_sku: "B", decision: "same" },
      { old_sku: "B", new_sku: "C", decision: "same" },
      { old_sku: "X", new_sku: "Y", decision: "different" },
    ]);
    expect(m).toEqual({ A: "C", B: "C" });
  });
});
