import { describe, expect, it } from "@jest/globals";

import type { CostVersionView } from "@/lib/api/products";
import { costChangesWithin, costInForce, costNumbers, lastClosedMonth, lastMonths } from "./cost-metrics";

let id = 0;
const v = (effective_from: string, cost_cents: number, over: Partial<CostVersionView> = {}): CostVersionView => ({
  id: ++id, effective_from: `${effective_from}T00:00:00.000Z`, cost_cents, valid_to: null, superseded: false, source: "manual", actor: null, reason: null, supplier_id: null, purchase_id: null,
  invoice_number: null, purchase_quantity: null, purchase_total_cents: null, pack_quantity: null, units_per_pack: null, created_at: "2026-10-01T00:00:00.000Z", ...over,
});

describe("costInForce", () => {
  const series = [v("2026-08-01", 570, { source: "catalogue_sync" }), v("2026-10-10", 620, { source: "invoice" })];

  it("é o custo mais recente até a data; antes da primeira versão não há custo (nunca a mais antiga)", () => {
    expect(costInForce(series, "2026-08-31")?.cost_cents).toBe(570);
    expect(costInForce(series, "2026-10-31")?.cost_cents).toBe(620);
    expect(costInForce(series, "2026-07-31")).toBeNull();
  });

  it("no mesmo dia a nota prevalece sobre a manual, e entre iguais vale a última registrada", () => {
    const sameDay = [v("2026-10-10", 600, { source: "manual" }), v("2026-10-10", 620, { source: "invoice" }), v("2026-10-10", 610, { source: "manual" })];

    expect(costInForce(sameDay, "2026-10-10")?.cost_cents).toBe(620);
    expect(costInForce([sameDay[0], sameDay[2]], "2026-10-10")?.cost_cents).toBe(610);
  });
});

describe("costNumbers", () => {
  const purchases = [
    v("2026-08-10", 500, { source: "invoice", purchase_quantity: 100, purchase_total_cents: 50000 }),
    // Duas notas no mesmo dia: a registrada depois vale, a outra fica no histórico como substituída.
    v("2026-10-10", 610, { source: "invoice", superseded: true, purchase_quantity: 10, purchase_total_cents: 6100 }),
    v("2026-10-10", 620, { source: "invoice", purchase_quantity: 150, purchase_total_cents: 93000 }),
    v("2026-01-01", 400, { source: "legacy_import" }),
  ];

  it("separa vigente, última compra, média ponderada das compras e o custo do CMV do mês", () => {
    const numbers = costNumbers(purchases, "2026-10-20", "2026-09");

    expect(numbers.inForce?.cost_cents).toBe(620);
    expect(numbers.lastPurchase?.cost_cents).toBe(620);
    // (50000 + 93000) / (100 + 150) = 572 centavos; a versão substituída fica fora.
    expect(numbers.weightedPurchase).toEqual({ centsPerUnit: 572, units: 250, purchases: 2 });
    // O CMV de setembro usa o custo vigente em 30/09: o de agosto.
    expect(numbers.forCmv).toMatchObject({ month: "2026-09" });
    expect(numbers.forCmv.version?.cost_cents).toBe(500);
  });

  it("sem compra com quantidade e total não inventa média nem última compra", () => {
    const numbers = costNumbers([v("2026-01-01", 400, { source: "legacy_import" })], "2026-10-20", "2026-09");

    expect(numbers.lastPurchase).toBeNull();
    expect(numbers.weightedPurchase).toBeNull();
    expect(numbers.inForce?.cost_cents).toBe(400);
  });

  it("o mês de fechamento mais recente é o anterior ao de hoje, na virada de ano também", () => {
    expect(lastClosedMonth("2026-10-20")).toBe("2026-09");
    expect(lastClosedMonth("2026-01-05")).toBe("2025-12");
  });
});

describe("costChangesWithin", () => {
  const series = [v("2026-08-01", 570, { source: "catalogue_sync" }), v("2026-10-10", 620, { source: "invoice" }), v("2026-10-20", 620, { source: "invoice" }), v("2026-11-01", 650, { source: "manual" })];

  it("aponta a mudança do custo no meio do mês, com o valor antes e depois", () => {
    expect(costChangesWithin(series, "2026-10")).toEqual([{ date: "2026-10-10", from: 570, to: 620 }]);
  });

  it("uma versão no dia 1 vale o mês inteiro e não é mudança dentro do mês; repetir o valor também não", () => {
    expect(costChangesWithin(series, "2026-11")).toEqual([]);
    expect(costChangesWithin(series, "2026-08")).toEqual([]);
    expect(costChangesWithin(series, "2026-09")).toEqual([]);
  });

  it("antes da primeira versão não afirma mudança", () => {
    expect(costChangesWithin([v("2026-08-15", 570)], "2026-08")).toEqual([]);
  });
});

describe("lastMonths", () => {
  it("lista os meses completos mais recentes, atravessando o ano", () => {
    expect(lastMonths("2026-02-10", 4)).toEqual(["2026-01", "2025-12", "2025-11", "2025-10"]);
  });
});
