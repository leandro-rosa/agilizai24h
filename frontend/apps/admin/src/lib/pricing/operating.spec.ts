import { describe, expect, it } from "@jest/globals";

import type { OperatingReport } from "@/lib/api/pricing";

import { classifiableAccounts, incompleteSummary, isClassified } from "./operating";

const empty = { costCents: 0, share: 0, accounts: [] };
const report = (over: Partial<OperatingReport> = {}): OperatingReport => ({
  scope: "rede",
  months: ["2026-07", "2026-08", "2026-09"],
  revenueCents: 29_729_312,
  complete: true,
  unclassified: [],
  unclassifiedCents: 0,
  unclassifiedShare: 0,
  classes: {
    percent_of_sales: { costCents: 342_205, share: 0.0115, accounts: [{ code: "4.2.01", label: "Repasse de vendas", amountCents: 342_205 }] },
    per_transaction: empty,
    per_visit: { costCents: 1_319_433, share: 0.044, accounts: [{ code: "4.2.03", label: "Deslocamento", amountCents: 1_319_433 }] },
    fixed: empty,
    other_revenue_cost: empty,
    already_component: { costCents: 700_000, share: 0.02, accounts: [{ code: "3.2.01", label: "Impostos", amountCents: 700_000 }] },
  },
  percentOfSalesShare: 0.0115,
  perTransaction: null,
  legacy: { share: 0.2335, costCents: 6_942_413, accounts: [] },
  ...over,
});

describe("classifiableAccounts", () => {
  it("lista primeiro as contas sem classe e marca como travadas as que já são componente do preço", () => {
    const rows = classifiableAccounts(report({ unclassified: [{ code: "4.2.07", label: "Marketing", amountCents: 90_000 }] }));

    expect(rows[0]).toMatchObject({ code: "4.2.07", class: null, locked: false });
    expect(rows.find((r) => r.code === "4.2.01")).toMatchObject({ class: "percent_of_sales", locked: false });
    expect(rows.find((r) => r.code === "3.2.01")).toMatchObject({ class: "already_component", locked: true });
  });

  it("um relatório antigo (sem classes) não tem nada a classificar nem a validar", () => {
    const legacy = { share: 0.23, months: ["2026-09"], accounts: [] };

    expect(isClassified(legacy)).toBe(false);
    expect(classifiableAccounts(legacy)).toEqual([]);
    expect(incompleteSummary(legacy)).toBeNull();
    expect(classifiableAccounts(null)).toEqual([]);
  });
});

describe("incompleteSummary", () => {
  it("diz o valor, o período e o escopo, e que nada está validado", () => {
    const text = incompleteSummary(report({ complete: false, unclassifiedCents: 90_000, unclassifiedShare: 0.003, unclassified: [{ code: "4.2.07", label: "Marketing", amountCents: 90_000 }] }));

    expect(text).toContain("R$ 900,00");
    expect(text).toContain("0,30% da receita de vendas das lojas");
    expect(text).toContain("escopo: rede");
    expect(text).toContain("2026-07, 2026-08, 2026-09");
    expect(text).toContain("4.2.07 Marketing");
    expect(text).toContain("Nenhuma recomendação está validada");
  });

  it("é nulo quando o cálculo está completo", () => {
    expect(incompleteSummary(report())).toBeNull();
  });
});
