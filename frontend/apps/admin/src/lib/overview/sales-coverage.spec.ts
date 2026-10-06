import { checkSalesCoverage } from "./sales-coverage";

// Fixtures sintéticas, só neste spec.
const months = ["2026-06", "2026-07", "2026-08", "2026-09"];
const rows = (storeId: number, period: string, n: number) => Array.from({ length: n }, (_, i) => ({ storeId, period, sku: `S${i}`, quantity: 1 }));
const stores = [{ id: 1, name: "Loja 1" }, { id: 2, name: "Loja 2" }, { id: 3, name: "Loja 3" }];

describe("checkSalesCoverage", () => {
  it("flags a store with 1 SKU in a month where it usually has dozens (the Aug/2026 case)", () => {
    const cells = [
      ...months.flatMap((p) => rows(1, p, 70)),
      ...months.flatMap((p) => rows(2, p, p === "2026-08" ? 1 : 65)),
      ...months.flatMap((p) => rows(3, p, 80)),
    ];
    const r = checkSalesCoverage("2026-08", cells, months, stores)!;
    expect(r.suspects).toEqual([{ storeId: 2, name: "Loja 2", skus: 1, typicalSkus: 65 }]);
    expect(r.checked).toBe(3);
  });

  it("a healthy month has no suspects", () => {
    const cells = stores.flatMap((s) => months.flatMap((p) => rows(s.id, p, 60)));
    expect(checkSalesCoverage("2026-08", cells, months, stores)!.suspects).toEqual([]);
  });

  it("a small store is not judged (too little history to call it incomplete)", () => {
    const cells = months.flatMap((p) => rows(1, p, p === "2026-08" ? 0 : 8));
    expect(checkSalesCoverage("2026-08", cells, months, [stores[0]])!.suspects).toEqual([]);
  });

  it("a store with no sale rows at all in the month counts as zero SKUs", () => {
    const cells = months.filter((p) => p !== "2026-08").flatMap((p) => rows(1, p, 50));
    expect(checkSalesCoverage("2026-08", cells, months, [stores[0]])!.suspects[0]).toMatchObject({ skus: 0, typicalSkus: 50 });
  });

  it("returns null when the month was never ingested or there is no history to compare", () => {
    expect(checkSalesCoverage("2026-10", [], months, stores)).toBeNull();
    expect(checkSalesCoverage("2026-08", rows(1, "2026-08", 3), ["2026-08", "2026-09"], stores)).toBeNull();
  });
});
