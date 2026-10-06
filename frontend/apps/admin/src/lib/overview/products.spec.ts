import { buildProducts } from "./products";
import type { SalesCell } from "./types";

const periods = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const cell = (storeId: number, period: string, sku: string, quantity: number, revenueCents: number): SalesCell => ({ storeId, period, sku, quantity, revenueCents });

// Fixtures sintéticas, só neste spec.
function sales(cells: SalesCell[], ingested = periods) {
  return { cells, ingestedPeriods: ingested, seriesPeriods: periods };
}

describe("buildProducts", () => {
  it("returns null when the competence month was never ingested (no fabricated zeros)", () => {
    expect(buildProducts("2026-10", "2026-09", sales([], periods.slice(0, 5)), null, {})).toBeNull();
  });

  it("ranks by revenue and computes margin only over resolved-cost SKUs", () => {
    const cells = [cell(1, "2026-10", "A", 10, 10_000), cell(1, "2026-10", "B", 5, 4_000), cell(1, "2026-09", "A", 10, 10_000), cell(1, "2026-09", "B", 5, 4_000)];
    const r = buildProducts("2026-10", "2026-09", sales(cells), { A: 600 }, { A: "Alpha" })!;
    expect(r.topSold.map((p) => p.sku)).toEqual(["A", "B"]);
    const a = r.topSold[0];
    expect(a.name).toBe("Alpha");
    expect(a.marginPct).toBeCloseTo((10_000 - 6_000) / 10_000);
    const b = r.topSold[1];
    expect(b.marginPct).toBeNull(); // sem custo: nunca 0% nem 100%
    expect(b.marginUnresolved).toBe(true);
  });

  it("splits rising and falling by material revenue change, with store distribution", () => {
    const cells = [
      // Monster: +23% espalhado em 3 lojas; base relevante
      ...[1, 2, 3].flatMap((s) => [cell(s, "2026-09", "M", 100, 100_000), cell(s, "2026-10", "M", 123, 123_000)]),
      // Pão: queda relevante
      cell(1, "2026-09", "P", 100, 100_000),
      cell(1, "2026-10", "P", 70, 70_000),
      // Pequeno: -40% mas irrelevante
      cell(1, "2026-09", "S", 5, 500),
      cell(1, "2026-10", "S", 3, 300),
    ];
    const r = buildProducts("2026-10", "2026-09", sales(cells), null, {})!;
    expect(r.rising.map((p) => p.sku)).toEqual(["M"]);
    expect(r.falling.map((p) => p.sku)).toEqual(["P"]);
    expect(r.rising[0].distribution).toMatchObject({ storesAffected: 3, concentrated: false });
  });

  it("an ingestion hole in the series is null, not a fall to zero", () => {
    const cells = [cell(1, "2026-10", "A", 10, 1_000), cell(1, "2026-09", "A", 10, 1_000)];
    const r = buildProducts("2026-10", "2026-09", sales(cells, ["2026-07", "2026-08", "2026-09", "2026-10"]), null, {})!;
    expect(r.topSold[0].series.slice(0, 2)).toEqual([null, null]);
  });

  it("without comparison month, rising/falling are empty and flagged", () => {
    const cells = [cell(1, "2026-10", "A", 10, 1_000)];
    const r = buildProducts("2026-10", "2026-09", sales(cells, ["2026-10"]), null, {})!;
    expect(r.hasComparison).toBe(false);
    expect(r.rising).toEqual([]);
  });
});
