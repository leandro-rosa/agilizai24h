import { describe, expect, it } from "@jest/globals";

import type { PricingParameters } from "@/lib/api/pricing";

import { buildPatch, parseAliases, toForm } from "./rules-form";

const params: PricingParameters = {
  margin: { targetBps: 3500, minimumBps: 3000, categories: {} },
  taxRateBps: null,
  rounding: { stepCents: 10 },
  psychological: { enabled: false, endingCents: 90 },
  guards: { maxIncreaseBps: 1500, opportunityBandBps: 300 },
  data: { lookbackMonths: 3, minUnitsPerMonth: 10, voucherMinReceiptLines: 50, lossMinUnits: 100, costMaxAgeDays: 120, stableCostBps: 500 },
  operating: { accountBehavior: { "4.2.01": "percent_of_sales", "4.2.03": "per_visit", "4.3.01": "fixed" }, unclassifiedRelevantBps: 50 },
  payment: { brandAliases: { sodexo: "pluxee", pagseguro: "pagbank" } },
  minConfidence: "low",
};

describe("toForm", () => {
  it("mostra percentuais e reais, e a alíquota vazia enquanto não houver", () => {
    const form = toForm(params);

    expect(form).toMatchObject({ targetPct: "35", minimumPct: "30", roundingStepReais: "0,1", taxRatePct: "", minUnitsPerMonth: "10", minConfidence: "low" });
    expect(form.aliases).toBe("sodexo=pluxee\npagseguro=pagbank");
  });
});

describe("buildPatch", () => {
  it("sem mudança não envia nada", () => {
    expect(buildPatch(toForm(params), params)).toEqual({ patch: {}, invalid: [] });
  });

  it("converte a margem-alvo de 38% em 3800 bps e só manda o que mudou", () => {
    const form = { ...toForm(params), targetPct: "38" };

    expect(buildPatch(form, params).patch).toEqual({ margin: { targetBps: 3800 } });
  });

  it("aceita vírgula decimal e converte a alíquota 7,07% em 707 bps", () => {
    expect(buildPatch({ ...toForm(params), taxRatePct: "7,07" }, params).patch).toEqual({ taxRateBps: 707 });
  });

  it("envia o conjunto de margens por categoria quando muda", () => {
    const form = { ...toForm(params), categories: { meal: { targetPct: "30", minimumPct: "30" } } };

    expect(buildPatch(form, params).patch).toEqual({ margin: { categories: { meal: { targetBps: 3000, minimumBps: 3000 } } } });
  });

  it("converte o arredondamento de reais em centavos e a confiança mínima", () => {
    const form = { ...toForm(params), roundingStepReais: "0,05", minConfidence: "medium" as const };

    expect(buildPatch(form, params).patch).toEqual({ rounding: { stepCents: 5 }, minConfidence: "medium" });
  });

  it("não deixa apagar uma alíquota já definida", () => {
    const withTax = { ...params, taxRateBps: 707 };

    expect(buildPatch({ ...toForm(withTax), taxRatePct: "" }, withTax).invalid.join(" ")).toContain("Alíquota");
  });

  it("lista todos os campos inválidos de uma vez e não manda nada que dependa deles", () => {
    const form = { ...toForm(params), targetPct: "abc", roundingStepReais: "0", minUnitsPerMonth: "-2" };
    const { invalid } = buildPatch(form, params);

    expect(invalid).toEqual(expect.arrayContaining(["Margem-alvo", "Arredondamento", "Quantidade mínima de vendas"]));
  });

  it("converte apelidos de bandeira e recusa linha mal formada", () => {
    expect(buildPatch({ ...toForm(params), aliases: "Sodexo=Pluxee" }, params).patch).toEqual({ payment: { brandAliases: { sodexo: "pluxee" } } });
    expect(buildPatch({ ...toForm(params), aliases: "sodexo" }, params).invalid.join(" ")).toContain("Apelidos");
    expect(parseAliases("a=b\n\nc=d")).toEqual({ a: "b", c: "d" });
    expect(parseAliases("a=b=c")).toBeNull();
  });
});

describe("classificação das despesas da DRE", () => {
  it("sem mudança não manda a classificação", () => {
    expect(buildPatch(toForm(params), params).patch).toEqual({});
  });

  it("classificar uma conta manda o mapa inteiro, que o backend troca de uma vez", () => {
    const form = { ...toForm(params), behavior: { ...toForm(params).behavior, "4.2.07": "fixed" } };

    expect(buildPatch(form, params).patch).toEqual({ operating: { accountBehavior: { "4.2.01": "percent_of_sales", "4.2.03": "per_visit", "4.3.01": "fixed", "4.2.07": "fixed" } } });
  });

  it("escolher 'sem classificação' tira a conta do mapa em vez de gravar um texto vazio", () => {
    const form = { ...toForm(params), behavior: { ...toForm(params).behavior, "4.3.01": "" } };

    expect(buildPatch(form, params).patch).toEqual({ operating: { accountBehavior: { "4.2.01": "percent_of_sales", "4.2.03": "per_visit" } } });
  });
});
