import { describe, it, expect } from "@jest/globals";
import { computeRestockConfidence, type RestockConfidenceInput } from "./confidence";
import { DEFAULT_RESTOCK_PARAMETERS } from "./parameters";

function input(overrides: Partial<RestockConfidenceInput> = {}): RestockConfidenceInput {
  return { mesesComVenda: 6, mesesAnalisados: 6, tendencia: "estavel", reconciliacaoLimpa: true, ...overrides };
}

describe("computeRestockConfidence", () => {
  it("is insuficiente below the minimum months-with-sales gate, regardless of everything else", () => {
    expect(computeRestockConfidence(input({ mesesComVenda: 1, tendencia: "estavel", reconciliacaoLimpa: true }), DEFAULT_RESTOCK_PARAMETERS)).toBe("insuficiente");
  });

  it("is alta with full evidence, stable trend and clean reconciliation", () => {
    expect(computeRestockConfidence(input(), DEFAULT_RESTOCK_PARAMETERS)).toBe("alta");
  });

  it("is media with partial evidence and no red flags", () => {
    expect(computeRestockConfidence(input({ mesesComVenda: 4, mesesAnalisados: 6, tendencia: "estavel", reconciliacaoLimpa: false }), DEFAULT_RESTOCK_PARAMETERS)).toBe("media");
  });

  it("caps at media when the trend is volatil, even with full evidence and clean reconciliation", () => {
    expect(computeRestockConfidence(input({ tendencia: "volatil" }), DEFAULT_RESTOCK_PARAMETERS)).toBe("media");
  });

  it("caps at media when reconciliation is flagged, even with full evidence and a stable trend", () => {
    expect(computeRestockConfidence(input({ reconciliacaoLimpa: false }), DEFAULT_RESTOCK_PARAMETERS)).toBe("media");
  });

  it("is baixa with little evidence and a volatile, unreconciled series", () => {
    expect(computeRestockConfidence(input({ mesesComVenda: 2, mesesAnalisados: 6, tendencia: "volatil", reconciliacaoLimpa: false }), DEFAULT_RESTOCK_PARAMETERS)).toBe("baixa");
  });
});
