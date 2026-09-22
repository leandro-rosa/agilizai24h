import type { Confidence } from "./types";
import type { LossIntelligenceParameters } from "./parameters";

const CONFIDENCE_ORDER: Confidence[] = ["alta", "media", "baixa", "insuficiente"];

export interface ConfidenceInput {
  /** window.qualifyingRestockPeriods.length (spec §8) — mesmo conceito de "período qualificável" para toda árvore. */
  qualifyingPeriodsCount: number;
  firstSeenRecently: boolean;
  overwhelmingEvidence: boolean;
  /** true só quando a árvore depende de margem para decidir (Outro motivo) e grossMarginCents é null. */
  marginUnknownButNeeded: boolean;
  /** true quando a árvore precisaria da comparação de rede para este caso mas ela ficou "dado_insuficiente". */
  networkComparisonMissingButNeeded: boolean;
  hasContradictoryData: boolean;
  parameters: LossIntelligenceParameters;
}

export function computeConfidence(input: ConfidenceInput): Confidence {
  let confidence: Confidence;

  if (input.qualifyingPeriodsCount < 1 || (input.firstSeenRecently && !input.overwhelmingEvidence) || input.marginUnknownButNeeded) {
    confidence = "insuficiente";
  } else if (input.qualifyingPeriodsCount === 1 || (input.firstSeenRecently && input.overwhelmingEvidence) || input.networkComparisonMissingButNeeded) {
    confidence = "baixa";
  } else if (input.qualifyingPeriodsCount >= input.parameters.confidence.minMonthsForHigh) {
    confidence = "alta";
  } else {
    confidence = "media";
  }

  // Dados contraditórios rebaixam um nível, nunca sobem, e nunca abaixo de "insuficiente" (spec §17).
  if (input.hasContradictoryData) {
    const idx = CONFIDENCE_ORDER.indexOf(confidence);
    confidence = CONFIDENCE_ORDER[Math.min(idx + 1, CONFIDENCE_ORDER.length - 1)];
  }

  return confidence;
}
