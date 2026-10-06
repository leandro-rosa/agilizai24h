import type { MonthItems, StockItem } from "@/lib/api/inventory";
import { buildMonthlyPending, pendingFetchRange, pendingMonths, pendingTrend, PENDING_BASELINE } from "./reconciliation-pending";

const item = (sku: string, period: string, over: Partial<StockItem> = {}): StockItem => ({
  store_id: 1, sku, period, restocked: 0, sold: 0, removed: 0, adjustment: 0, closing_stock: 0, inconsistent: false, recorded_closing_balance: null, ...over,
});
const month = (period: string, items: StockItem[]): MonthItems => ({ period, items });

describe("buildMonthlyPending — o estoque que veio do mês anterior conta", () => {
  it("venda sem abastecimento no mês coberta pela contagem do mês anterior NÃO é pendência (abastecidos 18, vendidos 15, sobraram 3)", () => {
    const aug = month("2026-08", [item("S", "2026-08", { restocked: 18, sold: 15, recorded_closing_balance: 3 })]);
    const sep = month("2026-09", [item("S", "2026-09", { sold: 3, recorded_closing_balance: 0 })]);
    const p = buildMonthlyPending([aug, sep], "2026-09");
    expect(p.rows).toEqual([]); // 3 − 3 = 0
    expect(p.hasData).toBe(true);
    expect(p.productsInMonth).toBe(1);
  });

  it("vendeu mais do que o estoque que veio + o abastecido: pendência de saída maior que a entrada", () => {
    const aug = month("2026-08", [item("S", "2026-08", { recorded_closing_balance: 3 })]);
    const sep = month("2026-09", [item("S", "2026-09", { sold: 8, recorded_closing_balance: 0 })]);
    const r = buildMonthlyPending([aug, sep], "2026-09").rows[0];
    expect(r).toMatchObject({ opening: 3, expected: -5, missing: 5, kind: "saiu_mais_que_entrou", noRestockInMonth: true });
  });

  it("Sprite Zero: sem nenhuma entrada lançada, vendeu 15 e há 5 contadas no fim — o produto existia, faltam 20 de entrada", () => {
    const sep = month("2026-09", [item("100114", "2026-09", { sold: 15, recorded_closing_balance: 5 })]);
    const r = buildMonthlyPending([sep], "2026-09").rows[0];
    expect(r.kind).toBe("entrada_nao_lancada");
    expect(r.expected).toBe(-15);
    expect(r.missing).toBe(20); // contagem 5 − esperado (−15)
    expect(r.opening).toBeNull(); // sem contagem de agosto: contou como 0, e a linha diz isso
  });

  it("o erro de um mês não se acumula no seguinte: a contagem de fim de mês reancora", () => {
    const jul = month("2026-07", [item("A", "2026-07", { sold: 10, recorded_closing_balance: 0 })]); // pendente em julho
    const aug = month("2026-08", [item("A", "2026-08", { restocked: 5, sold: 5, recorded_closing_balance: 0 })]);
    expect(buildMonthlyPending([jul, aug], "2026-07").productCount).toBe(1);
    expect(buildMonthlyPending([jul, aug], "2026-08").productCount).toBe(0); // agosto parte da contagem 0, não de −10
  });

  it("ajuste de inventário soma ao saldo, como no serviço de estoque", () => {
    const sep = month("2026-09", [item("A", "2026-09", { restocked: 2, sold: 5, adjustment: 3 })]);
    expect(buildMonthlyPending([sep], "2026-09").rows).toEqual([]);
  });

  it("mês sem registro: hasData=false, nunca 'zero pendências'", () => {
    const p = buildMonthlyPending([], "2026-09");
    expect(p.hasData).toBe(false);
    expect(p.productsInMonth).toBe(0);
  });

  it("ordena pelas unidades que mais faltam", () => {
    const sep = month("2026-09", [item("A", "2026-09", { sold: 2 }), item("B", "2026-09", { sold: 9 })]);
    expect(buildMonthlyPending([sep], "2026-09").rows.map((r) => r.sku)).toEqual(["B", "A"]);
  });
});

describe("meses analisados e tendência", () => {
  it("começa em julho; antes disso não se analisa", () => {
    expect(PENDING_BASELINE).toBe("2026-07");
    expect(pendingMonths("2026-09")).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(pendingMonths("2026-05")).toEqual([]);
    expect(pendingFetchRange("2026-09")).toEqual({ start: "2026-06", end: "2026-09" });
  });

  it("tendência mostra quantos negativos em cada mês", () => {
    const months = [
      month("2026-06", [item("A", "2026-06", { recorded_closing_balance: 0 })]),
      month("2026-07", [item("A", "2026-07", { sold: 4 }), item("B", "2026-07", { sold: 2 })]),
      month("2026-08", [item("A", "2026-08", { sold: 1 })]),
    ];
    expect(pendingTrend(months, "2026-09")).toEqual([
      { month: "2026-07", count: 2, hasData: true },
      { month: "2026-08", count: 1, hasData: true },
      { month: "2026-09", count: 0, hasData: false },
    ]);
  });
});
