import type { EscopoProblema, PerReasonMetrics, ReasonDiagnosis } from "../types";
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
      acao: "dados_insuficientes", potencialIntervencao: null, hipoteses: [], escopoProblema: "indeterminado",
    };
  }

  const totalNetwork = storesCarrying.reduce((total, store) => total + store.qtyLost, 0);
  const thisStoreQty = input.metrics.qtyLost;
  const concentrationShare = totalNetwork > 0 ? thisStoreQty / totalNetwork : 0;

  // Distribuição observada — descreve onde o dano se concentra, nunca por que (adenda 2026-09-23
  // §A). Mesmos dois limiares que já decidiam a ação abaixo, sem nenhum parâmetro novo:
  // concentração de valor numa loja só decide "local"; nº de lojas carregando dano decide o
  // resto. O meio-termo (concentração baixa mas poucas lojas) é "múltiplas lojas" — antes não
  // tinha rótulo, caía direto em "dados insuficientes" junto do caso de poucas lojas comparáveis.
  const escopoProblema: EscopoProblema =
    concentrationShare >= p.localConcentrationMin ? "local" : storesCarrying.length >= p.minStoresForSystemic ? "rede" : "multiplas_lojas";

  if (concentrationShare >= p.localConcentrationMin) {
    return {
      reason: "damaged_product", metrics: input.metrics,
      sinaisDetectados: ["DAMAGE_CONCENTRATED_LOCAL"], regrasAcionadas: ["DAMAGE_CONCENTRATED_LOCAL"],
      acao: "investigar", potencialIntervencao: "alto",
      hipoteses: ["manuseio", "armazenamento", "exposição"], escopoProblema,
    };
  }

  if (storesCarrying.length >= p.minStoresForSystemic) {
    return {
      reason: "damaged_product", metrics: input.metrics,
      sinaisDetectados: ["DAMAGE_SYSTEMIC_NETWORK"], regrasAcionadas: ["DAMAGE_SYSTEMIC_NETWORK"],
      acao: "investigar", potencialIntervencao: "medio",
      hipoteses: ["embalagem", "transporte", "característica do produto"], escopoProblema,
    };
  }

  // Concentração baixa (não é "local") E ainda sem lojas suficientes para o piso sistêmico da
  // AÇÃO — a ação continua "dados_insuficientes", exatamente como antes (não é o pedido do
  // operador mudar quando "investigar" dispara). Mas o ESCOPO já é descritível: sabemos que não
  // está concentrado numa loja só e que está presente em ≥3 lojas — "múltiplas lojas", não mais
  // "indeterminado" só porque a ação ainda não tem confiança suficiente para ser recomendada.
  return {
    reason: "damaged_product", metrics: input.metrics,
    sinaisDetectados: ["INSUFFICIENT_STORES_FOR_DAMAGE_PATTERN"], regrasAcionadas: ["INSUFFICIENT_STORES_FOR_DAMAGE_PATTERN"],
    acao: "dados_insuficientes", potencialIntervencao: null, hipoteses: [], escopoProblema,
  };
}
