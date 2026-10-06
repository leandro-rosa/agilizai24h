import { sumStock, type StockItem, type StoreStock } from "./inventory";

const item = (sku: string, period: string, over: Partial<StockItem> = {}): StockItem => ({
  store_id: 1, sku, period, restocked: 0, sold: 0, removed: 0, adjustment: 0, closing_stock: 0, inconsistent: false, recorded_closing_balance: null, ...over,
});
const month = (period: string, items: StockItem[]): StoreStock => ({ store_id: 1, period, items, has_inconsistencies: false });

describe("sumStock", () => {
  it("não repete o movimento de um registro antigo em cada mês seguinte (Suco de uva Ades: vendeu 2 em fevereiro, nada de julho a setembro)", () => {
    // Para jul, ago e set o serviço devolve o último registro do produto: o de fevereiro.
    const stale = item("110023", "2026-02", { sold: 2 });
    const r = sumStock(1, { start: "2026-07", end: "2026-09" }, [month("2026-07", [stale]), month("2026-08", [stale]), month("2026-09", [stale])]);
    expect(r.items.find((i) => i.sku === "110023")!.sold).toBe(0); // antes dava 6
  });

  it("soma normalmente o movimento de cada mês em que o produto teve registro próprio", () => {
    const r = sumStock(1, { start: "2026-07", end: "2026-09" }, [
      month("2026-07", [item("A", "2026-07", { restocked: 10, sold: 4 })]),
      month("2026-08", [item("A", "2026-08", { restocked: 6, sold: 5, removed: 1 })]),
      month("2026-09", [item("A", "2026-09", { sold: 2 })]),
    ]);
    const a = r.items.find((i) => i.sku === "A")!;
    expect([a.restocked, a.sold, a.removed]).toEqual([16, 11, 1]);
  });

  it("mês que o produto pulou não herda o movimento do mês anterior", () => {
    const r = sumStock(1, { start: "2026-07", end: "2026-09" }, [
      month("2026-07", [item("A", "2026-07", { sold: 4 })]),
      month("2026-08", [item("A", "2026-07", { sold: 4 })]), // sem registro de agosto: vem o de julho de novo
      month("2026-09", [item("A", "2026-07", { sold: 4 })]),
    ]);
    expect(r.items.find((i) => i.sku === "A")!.sold).toBe(4); // e não 12
  });
});
