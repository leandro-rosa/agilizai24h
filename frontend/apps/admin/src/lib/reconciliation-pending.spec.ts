import type { StockItem } from "@/lib/api/inventory";
import { buildPending, PENDING_BASELINE } from "./reconciliation-pending";

const item = (sku: string, over: Partial<StockItem> = {}): StockItem => ({
  store_id: 1, sku, period: "2026-09", restocked: 0, sold: 0, removed: 0, adjustment: 0, closing_stock: 0, inconsistent: false, recorded_closing_balance: null, ...over,
});

describe("buildPending (a partir de julho, começando pela contagem de junho)", () => {
  it("usa a contagem de junho como estoque inicial e só aponta o que ficou negativo", () => {
    const opening = [item("A", { period: "2026-06", recorded_closing_balance: 5 }), item("B", { period: "2026-06", recorded_closing_balance: 0 })];
    const movements = [
      item("A", { restocked: 10, sold: 14 }), // 5 + 10 − 14 = 1 → ok
      item("B", { restocked: 4, sold: 9, removed: 1 }), // 0 + 4 − 10 = −6 → pendente
      item("C", { sold: 3 }), // sem contagem, nunca abastecido, vendeu 3 → −3
    ];
    const s = buildPending(movements, opening);
    expect(s.baseline).toBe(PENDING_BASELINE);
    expect(s.openingPeriod).toBe("2026-06");
    expect(s.rows.map((r) => [r.sku, r.missing])).toEqual([["B", 6], ["C", 3]]);
    expect(s.missingUnits).toBe(9);
    expect(s.productCount).toBe(2);
  });

  it("marca o produto nunca abastecido e o sem contagem; a contagem ausente nunca vira dado inventado", () => {
    const s = buildPending([item("C", { sold: 3 }), item("D", { restocked: 2, sold: 5 })], []);
    const c = s.rows.find((r) => r.sku === "C")!;
    expect(c.neverRestocked).toBe(true);
    expect(c.opening).toBeNull();
    expect(s.neverRestockedCount).toBe(1);
    expect(s.withoutOpeningCount).toBe(2);
  });

  it("o ajuste de inventário soma ao saldo, como no serviço de estoque", () => {
    const s = buildPending([item("A", { restocked: 2, sold: 5, adjustment: 3 })], []);
    expect(s.rows).toEqual([]); // 2 − 5 + 3 = 0
  });

  it("sem pendências: lista vazia e zeros", () => {
    const s = buildPending([item("A", { restocked: 5, sold: 5 })], []);
    expect(s).toMatchObject({ productCount: 0, missingUnits: 0, rows: [] });
  });
});
