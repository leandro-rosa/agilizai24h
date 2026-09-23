import { describe, it, expect } from "@jest/globals";
import { computeMixConfidence, computeOpportunityConfidence, type MixConfidenceInput } from "./confidence";
import { DEFAULT_MIX_PARAMETERS } from "./parameters";

function input(overrides: Partial<MixConfidenceInput> = {}): MixConfidenceInput {
  return { mesesComVenda: 6, mesesAnalisados: 6, tendencia: "estavel", reconciliacaoLimpa: true, ...overrides };
}

describe("computeMixConfidence", () => {
  it("is insuficiente below the minimum months-with-sales gate", () => {
    expect(computeMixConfidence(input({ mesesComVenda: 1 }), DEFAULT_MIX_PARAMETERS)).toBe("insuficiente");
  });

  it("is alta with full evidence, stable trend and clean reconciliation", () => {
    expect(computeMixConfidence(input(), DEFAULT_MIX_PARAMETERS)).toBe("alta");
  });

  it("caps at media when the trend is volatil", () => {
    expect(computeMixConfidence(input({ tendencia: "volatil" }), DEFAULT_MIX_PARAMETERS)).toBe("media");
  });
});

describe("computeOpportunityConfidence", () => {
  it("never returns alta, no matter how many stores show good performance", () => {
    expect(computeOpportunityConfidence(5, DEFAULT_MIX_PARAMETERS)).not.toBe("alta");
    expect(computeOpportunityConfidence(500, DEFAULT_MIX_PARAMETERS)).not.toBe("alta");
  });

  it("is media with comfortably more stores than the minimum gate, baixa right at the gate", () => {
    expect(computeOpportunityConfidence(DEFAULT_MIX_PARAMETERS.opportunity.minNetworkStores * 2, DEFAULT_MIX_PARAMETERS)).toBe("media");
    expect(computeOpportunityConfidence(DEFAULT_MIX_PARAMETERS.opportunity.minNetworkStores, DEFAULT_MIX_PARAMETERS)).toBe("baixa");
  });
});
