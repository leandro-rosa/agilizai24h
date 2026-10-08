import type { NewProductSuggestion } from "@/lib/api/pricing";
import { classifySuggestion, describeFailure, hasValidPrice } from "./suggestion";

const base: NewProductSuggestion = {
  sku: "(rascunho)", name: null, label: "Produto novo — sem histórico de vendas", status: "suggested", confidence: "low", minimumPriceCents: 2630, suggestedPriceCents: 2880, suggestedMargin: 0.351,
  initial: true, targetMargin: 0.35, minimumMargin: 0.3, dataUsed: [], reasons: [], insufficientReasons: [], blocker: null, validated: true, validationNotes: [],
};

describe("classifySuggestion", () => {
  it("a valid price is ready, with the initial-suggestion caveat", () => {
    const view = classifySuggestion(base);

    expect(view.kind).toBe("ready");
    expect(view.kind === "ready" && view.caveats[0]).toMatch(/Sugestão inicial/);
  });

  it("an unvalidated classification keeps the price and adds its notes as caveats", () => {
    const view = classifySuggestion({ ...base, validated: false, validationNotes: ["Cálculo incompleto: R$ 100,00 em despesas sem classificação"] });

    expect(view.kind === "ready" && view.validated).toBe(false);
    expect(view.kind === "ready" && view.caveats.join(" ")).toMatch(/Cálculo incompleto/);
  });

  it("missing information lists exactly what is missing", () => {
    const view = classifySuggestion({ ...base, status: "insufficient_data", suggestedPriceCents: null, insufficientReasons: ["Alíquota de imposto não configurada"], blocker: "missing_data" });

    expect(view).toEqual({ kind: "missing", reasons: ["Alíquota de imposto não configurada"] });
  });

  it("an unreachable target is explained, never turned into a price", () => {
    const view = classifySuggestion({ ...base, status: "insufficient_data", suggestedPriceCents: null, insufficientReasons: ["A meta de 35,0% não é alcançável pela fórmula"], blocker: "unreachable" });

    expect(view).toEqual({ kind: "unreachable", reason: "A meta de 35,0% não é alcançável pela fórmula" });
  });

  it("a 'suggested' answer without a usable price is treated as missing data, not as a price of zero", () => {
    expect(classifySuggestion({ ...base, suggestedPriceCents: 0 }).kind).toBe("missing");
    expect(classifySuggestion({ ...base, suggestedPriceCents: null }).kind).toBe("missing");
  });
});

describe("describeFailure", () => {
  it("a 404 says the installation is outdated instead of a generic failure", () => {
    expect(describeFailure({ status: 404 }).message).toMatch(/desatualizada/);
    expect(describeFailure({ status: 404 }).detail).toMatch(/404/);
  });

  it("no connection and server errors each say so and promise the typed data was kept", () => {
    expect(describeFailure({ status: "FETCH_ERROR" }).message).toMatch(/Sem conexão/);
    expect(describeFailure({ status: 502 }).message).toMatch(/não respondeu/);
  });

  it("a validation error shows the server's own reason", () => {
    expect(describeFailure({ status: 400, data: { message: ["unitCostCents must be positive"] } }).message).toBe("unitCostCents must be positive");
  });
});

describe("hasValidPrice", () => {
  it("only a positive whole number of cents is a price to approve", () => {
    expect(hasValidPrice(2880)).toBe(true);
    for (const bad of [0, -1, 12.5, null, undefined]) expect(hasValidPrice(bad)).toBe(false);
  });
});
