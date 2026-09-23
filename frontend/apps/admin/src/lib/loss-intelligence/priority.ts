import type { Confidence, LossAction, Priority } from "./types";
import type { LossIntelligenceParameters } from "./parameters";

export interface PriorityInput {
  acaoPrioritaria: LossAction;
  confianca: Confidence;
  sinaisTransversais: string[];
  /** valueLostCents do motivo de motivoDiagnosticoPrioritario — nunca o de maiorImpactoFinanceiro. */
  valueLostCentsPrioritario: number;
  firstSeenRecently: boolean;
  parameters: LossIntelligenceParameters;
}

const CRITICAL_ACTIONS: LossAction[] = ["suspender_abastecimento", "avaliar_retirada_rede", "avaliar_permanencia_rede"];
const HIGH_ACTIONS: LossAction[] = ["suspender_abastecimento", "avaliar_retirada_loja", "avaliar_retirada_rede", "avaliar_permanencia_loja", "avaliar_permanencia_rede", "reduzir_abastecimento"];
const MEDIUM_ACTIONS: LossAction[] = ["investigar", "manter_monitorar"];

export function computePriority(input: PriorityInput): Priority | null {
  if (input.acaoPrioritaria === "dados_insuficientes") return null;

  const confidenceAtLeastMedia = input.confianca === "alta" || input.confianca === "media";

  let priority: Priority;
  if (
    CRITICAL_ACTIONS.includes(input.acaoPrioritaria) &&
    confidenceAtLeastMedia &&
    (input.sinaisTransversais.length > 0 || input.valueLostCentsPrioritario > input.parameters.priority.criticalValueCents)
  ) {
    priority = "critica";
  } else if (HIGH_ACTIONS.includes(input.acaoPrioritaria)) {
    priority = "alta";
  } else if (MEDIUM_ACTIONS.includes(input.acaoPrioritaria)) {
    priority = "media";
  } else {
    priority = "baixa";
  }

  // Teto explícito para histórico recente (spec §9/§10.4): nunca passa de "media", mesmo que a
  // ação em si já tenha sido capada a montante pelas árvores de diagnóstico — "só Média no máximo",
  // não "só Alta".
  if (input.firstSeenRecently && (priority === "critica" || priority === "alta")) {
    priority = "media";
  }

  return priority;
}
