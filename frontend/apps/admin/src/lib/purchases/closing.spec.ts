import type { ClosingPreview } from "@/lib/api/purchases";

import { issueText, nextAfter, overlapsLast, rangeOfLength, verdictOf } from "./closing";

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
