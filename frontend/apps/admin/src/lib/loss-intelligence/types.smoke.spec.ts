import type { LossIntelligenceInput, LossIntelligenceRecommendation, LossAction } from "./types";
import { ACTION_SEVERITY_ORDER, INTERVENTION_POTENTIAL_ORDER, LOSS_REASONS } from "./types";

describe("loss-intelligence types", () => {
  it("ACTION_SEVERITY_ORDER contains every LossAction exactly once", () => {
    const all: LossAction[] = [
      "manter", "manter_monitorar", "reduzir_abastecimento", "investigar", "suspender_abastecimento",
      "avaliar_retirada_loja", "avaliar_retirada_rede", "avaliar_permanencia_loja", "avaliar_permanencia_rede", "dados_insuficientes",
    ];
    expect([...ACTION_SEVERITY_ORDER].sort()).toEqual([...all].sort());
    expect(ACTION_SEVERITY_ORDER).toHaveLength(all.length);
  });

  it("avaliar_retirada_* sorts above avaliar_permanencia_* within the same scope", () => {
    const rank = (a: LossAction) => ACTION_SEVERITY_ORDER.indexOf(a);
    expect(rank("avaliar_retirada_rede")).toBeLessThan(rank("avaliar_permanencia_rede"));
    expect(rank("avaliar_retirada_loja")).toBeLessThan(rank("avaliar_permanencia_loja"));
  });

  it("INTERVENTION_POTENTIAL_ORDER is alto > medio > baixo", () => {
    expect(INTERVENTION_POTENTIAL_ORDER).toEqual(["alto", "medio", "baixo"]);
  });

  it("LOSS_REASONS has exactly the three backend-observable reasons", () => {
    expect(LOSS_REASONS).toEqual(["expired", "damaged_product", "other_reason"]);
  });
});
