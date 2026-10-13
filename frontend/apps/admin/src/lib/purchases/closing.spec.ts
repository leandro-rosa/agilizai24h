import type { ClosingPreview } from "@/lib/api/purchases";

import { issueText, nextAfter, overlapsLast, pickKey, pickedTotal, picksOf, rangeOfLength, verdictOf, coverageWithHome } from "./closing";

const base: ClosingPreview = {
  supplier_id: 75, supplier_name: "Quinoa", period_from: "2026-09-30", period_to: "2026-10-12", status: "ready", config_missing: [], conflict: null,
  lines: [], total_units: 0, total_cents: 0, configured_skus: 1, skus_without_sales: 0, issues: [], withdrawals: null, confirmable: true,
};

describe("verdictOf — cada situação tem o seu nome, e zero não serve para todas", () => {
  it("diferencia as cinco respostas", () => {
    const titles = (["ready", "no_sales", "incomplete", "config_pending", "conflict"] as const).map((status) => verdictOf({ ...base, status }).title);
    expect(new Set(titles).size).toBe(5);
    expect(titles).toContain("Sem vendas no período");
    expect(titles).toContain("Configuração pendente");
    expect(titles).toContain("Dados incompletos");
  });

  it("o conflito diz qual fechamento e que dia não pode repetir", () => {
    const text = verdictOf({ ...base, status: "conflict", conflict: { settlement_id: 1, period_from: "2026-09-22", period_to: "2026-09-29", state: "paid", suggested_from: "2026-09-30" } }).text;
    expect(text).toContain("22/09/2026 a 29/09/2026");
    expect(text).toContain("pago");
  });
});

describe("issueText", () => {
  it("custo que muda no período diz o SKU e a data", () => {
    expect(issueText({ code: "cost_changes_in_period", acceptable: false, sku: "A", detail: "2026-10-05" })).toContain("A começa ou muda em 05/10/2026");
  });

  it("mês sem venda com data diz o mês em MM/AAAA e o que fazer", () => {
    const text = issueText({ code: "sales_dates_missing", acceptable: false, detail: "2026-10" });
    expect(text).toContain("10/2026");
    expect(text).toContain("Importe");
  });
});

describe("período", () => {
  it("29/09 começa dentro do fechamento de 22/09 a 29/09: sobreposição; 30/09 não", () => {
    const last = { period_from: "2026-09-22", period_to: "2026-09-29" };
    expect(overlapsLast(last, "2026-09-29", "2026-10-12")).toBe(true);
    expect(overlapsLast(last, "2026-09-30", "2026-10-12")).toBe(false);
    expect(overlapsLast(null, "2026-09-29", "2026-10-12")).toBe(false);
    expect(nextAfter(last)).toBe("2026-09-30");
  });

  it("duração de 14 dias a partir de 30/09 termina em 13/10", () => {
    expect(rangeOfLength("2026-09-30", 14)).toEqual({ from: "2026-09-30", to: "2026-10-13" });
  });
});

describe("escolha de vencidas e outro motivo", () => {
  const lines = [
    { sku: "100083", name: "Cone", month: "2026-09", expired: { units: 109, cents: 64855 }, other_reason: { units: 2, cents: 1190 }, returned: { units: 0, cents: 0 } },
    { sku: "100083", name: "Cone", month: "2026-10", expired: { units: 10, cents: 5950 }, other_reason: { units: 0, cents: 0 }, returned: { units: 0, cents: 0 } },
    { sku: "9992", name: "Pizza", month: "2026-10", expired: { units: 10, cents: 7920 }, other_reason: { units: 0, cents: 0 }, returned: { units: 0, cents: 0 } },
    { sku: "X", name: "Sem custo", month: "2026-10", expired: { units: 3, cents: null }, other_reason: { units: 0, cents: 0 }, returned: { units: 0, cents: 0 } },
  ];

  it("soma só o que foi marcado: os cones vencidos de setembro e outubro dão R$ 708,05", () => {
    const keys = new Set([pickKey("100083", "2026-09", "expired"), pickKey("100083", "2026-10", "expired")]);
    expect(pickedTotal(lines, keys)).toEqual({ units: 119, cents: 70805 });
  });

  it("nada marcado soma zero; sem custo ou sem unidades não soma", () => {
    expect(pickedTotal(lines, new Set())).toEqual({ units: 0, cents: 0 });
    expect(pickedTotal(lines, new Set([pickKey("X", "2026-10", "expired"), pickKey("100083", "2026-10", "other_reason")]))).toEqual({ units: 0, cents: 0 });
  });

  it("devolve a seleção na forma que o servidor recebe", () => {
    expect(picksOf(new Set([pickKey("100083", "2026-09", "expired")]))).toEqual([{ sku: "100083", month: "2026-09", kind: "expired" }]);
  });
});

describe("cobertura com o estoque em casa", () => {
  it("(lojas + casa) ÷ vendas por dia, com uma casa decimal", () => {
    expect(coverageWithHome({ in_stores: 69, per_day: 3 }, 21)).toBe(30);
    expect(coverageWithHome({ in_stores: 10, per_day: 3 }, 0)).toBe(3.3);
  });

  it("sem ritmo de venda ou sem saldo conhecido não há cobertura", () => {
    expect(coverageWithHome({ in_stores: 69, per_day: null }, 5)).toBeNull();
    expect(coverageWithHome({ in_stores: null, per_day: 3 }, 5)).toBeNull();
  });
});
