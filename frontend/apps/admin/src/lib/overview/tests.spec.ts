import { buildTests, type BuildTestsArgs, type SupplyCell } from "./tests";
import type { SalesCell } from "./types";

// Fixtures sintéticas, só neste spec.
const sup = (storeId: number, period: string, sku: string, quantity = 10): SupplyCell => ({ storeId, period, sku, quantity });
const sale = (storeId: number, period: string, sku: string, quantity: number, revenueCents = quantity * 500): SalesCell => ({ storeId, period, sku, quantity, revenueCents });

function args(over: Partial<BuildTestsArgs>): BuildTestsArgs {
  return {
    period: "2026-10",
    supply: { cells: [], ingestedPeriods: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"] },
    sales: [],
    costBySku: null,
    names: { T: "Teste", OLD: "Antigo", OLD2: "Antigo 2" },
    alias: {},
    lossBySkuByPeriod: {},
    ...over,
  };
}

describe("buildTests", () => {
  it("a SKU present since the first imported month is NOT a test (history start)", () => {
    const r = buildTests(args({ supply: { cells: [sup(1, "2026-05", "OLD")], ingestedPeriods: ["2026-05", "2026-10"] } }));
    expect(r.rows).toEqual([]);
  });

  it("a SKU first restocked in the window in few stores is a test, with facts", () => {
    const stores = [1, 2, 3, 4];
    const r = buildTests(args({
      supply: { cells: [sup(1, "2026-05", "OLD"), ...stores.map((s) => sup(s, "2026-08", "T"))], ingestedPeriods: ["2026-05", "2026-08", "2026-10"] },
      sales: [...[1, 2, 3].map((s) => sale(s, "2026-09", "T", 10)), ...[1, 2, 3].map((s) => sale(s, "2026-10", "T", 10))],
    }));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ sku: "T", firstPeriod: "2026-08", monthsInTest: 3, storesRestocked: 4, storesSold: 3, unitsSold: 60, signal: "positivo" });
    expect(r.rows[0].reasons[0]).toBe("vendeu em 3 de 4 lojas abastecidas");
  });

  it("rolled out to many stores is not a test", () => {
    const cells = Array.from({ length: 12 }, (_, i) => sup(i + 1, "2026-09", "T"));
    expect(buildTests(args({ supply: { cells: [sup(1, "2026-05", "OLD"), ...cells], ingestedPeriods: ["2026-05", "2026-09"] } })).rows).toEqual([]);
  });

  it("too little history or units says 'mais dados', never a verdict", () => {
    const r = buildTests(args({
      supply: { cells: [sup(1, "2026-05", "OLD"), sup(1, "2026-10", "T"), sup(2, "2026-10", "T")], ingestedPeriods: ["2026-05", "2026-10"] },
      sales: [sale(1, "2026-10", "T", 5)],
    }));
    expect(r.rows[0].signal).toBe("mais_dados");
  });

  it("result concentrated in one store asks for attention", () => {
    const r = buildTests(args({
      supply: { cells: [sup(1, "2026-05", "OLD"), ...[1, 2, 3].map((s) => sup(s, "2026-08", "T"))], ingestedPeriods: ["2026-05", "2026-08"] },
      sales: [sale(1, "2026-09", "T", 30), sale(1, "2026-10", "T", 30)],
    }));
    expect(r.rows[0].signal).toBe("atencao");
    expect(r.rows[0].reasons).toContain("resultado concentrado em uma loja");
  });

  it("high loss against the SKU's revenue asks for attention", () => {
    const r = buildTests(args({
      supply: { cells: [sup(1, "2026-05", "OLD"), ...[1, 2].map((s) => sup(s, "2026-08", "T"))], ingestedPeriods: ["2026-05", "2026-08"] },
      sales: [1, 2].flatMap((s) => [sale(s, "2026-09", "T", 15, 10_000), sale(s, "2026-10", "T", 15, 10_000)]),
      lossBySkuByPeriod: { "2026-09": [{ sku: "T", valueCents: 6_000 }] },
    }));
    expect(r.rows[0].signal).toBe("atencao");
  });

  it("a confirmed old code is merged: it no longer looks like a new product", () => {
    // OLD (código antigo) abastecido desde o início; NEW aparece agora. Com vínculo OLD→NEW, o primeiro abastecimento é o do OLD.
    const base = { supply: { cells: [sup(1, "2026-05", "OLD"), sup(1, "2026-10", "NEWCODE")], ingestedPeriods: ["2026-05", "2026-10"] } };
    expect(buildTests(args(base)).rows.map((x) => x.sku)).toEqual(["NEWCODE"]);
    expect(buildTests(args({ ...base, alias: { OLD: "NEWCODE" } })).rows).toEqual([]);
  });

  it("no imported supply history means no tests can be named", () => {
    expect(buildTests(args({ supply: { cells: [], ingestedPeriods: [] } })).rows).toEqual([]);
  });
});
