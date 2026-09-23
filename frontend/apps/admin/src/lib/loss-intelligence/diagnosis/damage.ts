import type { PerReasonMetrics, ReasonDiagnosis } from "../types";
import type { LossIntelligenceParameters } from "../parameters";

export interface DamageDiagnosisInput {
  /** byReason.damaged_product da janela principal, nesta loja. Assume-se qtyLost > 0. */
  metrics: PerReasonMetrics;
  /** Perda de danificado deste SKU em cada loja da rede (incluindo esta), mesma janela — quantity apenas, já resolvido por engine.ts. */
  qtyLostDamagedByStore: { storeId: number; qtyLost: number }[];
  thisStoreId: number;
  parameters: LossIntelligenceParameters;
}

export function diagnoseDamage(input: DamageDiagnosisInput): ReasonDiagnosis {
  const p = input.parameters.damage;
  const storesCarrying = input.qtyLostDamagedByStore.filter((store) => store.qtyLost > 0);

  if (storesCarrying.length < p.minStoresCarryingForConcentration) {
    return {
      reason: "damaged_product", metrics: input.metrics,
      sinaisDetectados: ["INSUFFICIENT_STORES_FOR_DAMAGE_PATTERN"], regrasAcionadas: ["INSUFFICIENT_STORES_FOR_DAMAGE_PATTERN"],
      acao: "dados_insuficientes", potencialIntervencao: null, hipoteses: [],
    };
  }

  const totalNetwork = storesCarrying.reduce((total, store) => total + store.qtyLost, 0);
  const thisStoreQty = input.metrics.qtyLost;
  const concentrationShare = totalNetwork > 0 ? thisStoreQty / totalNetwork : 0;

  if (concentrationShare >= p.localConcentrationMin) {
    return {
      reason: "damaged_product", metrics: input.metrics,
      sinaisDetectados: ["DAMAGE_CONCENTRATED_LOCAL"], regrasAcionadas: ["DAMAGE_CONCENTRATED_LOCAL"],
      acao: "investigar", potencialIntervencao: "alto",
      hipoteses: ["manuseio", "armazenamento", "exposição"],
    };
  }

  if (storesCarrying.length >= p.minStoresForSystemic) {
    return {
      reason: "damaged_product", metrics: input.metrics,
      sinaisDetectados: ["DAMAGE_SYSTEMIC_NETWORK"], regrasAcionadas: ["DAMAGE_SYSTEMIC_NETWORK"],
      acao: "investigar", potencialIntervencao: "medio",
      hipoteses: ["embalagem", "transporte", "característica do produto"],
    };
  }

  return {
    reason: "damaged_product", metrics: input.metrics,
    sinaisDetectados: ["INSUFFICIENT_STORES_FOR_DAMAGE_PATTERN"], regrasAcionadas: ["INSUFFICIENT_STORES_FOR_DAMAGE_PATTERN"],
    acao: "dados_insuficientes", potencialIntervencao: null, hipoteses: [],
  };
}
