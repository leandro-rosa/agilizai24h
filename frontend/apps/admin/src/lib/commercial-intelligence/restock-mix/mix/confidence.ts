import type { Confidence } from "@/lib/loss-intelligence/types";
import type { Trend } from "../types";
import type { MixParameters } from "./parameters";

export interface MixConfidenceInput {
  mesesComVenda: number;
  mesesAnalisados: number;
  tendencia: Trend;
  reconciliacaoLimpa: boolean;
}

const MAX_POINTS = 70;

/** Mesma régua de restock/confidence.ts (Task 4) — gate duro, fatores aplicáveis, tetos que só reduzem. */
export function computeMixConfidence(input: MixConfidenceInput, parameters: MixParameters): Confidence {
  if (input.mesesComVenda < parameters.evidence.minMonthsWithSales) return "insuficiente";

  let points = 0;
  points += input.mesesComVenda >= input.mesesAnalisados ? 30 : input.mesesComVenda >= Math.ceil(input.mesesAnalisados / 2) ? 20 : 10;
  points += input.tendencia === "volatil" ? 0 : input.tendencia === "indeterminada" ? 5 : 20;
  points += input.reconciliacaoLimpa ? 20 : 5;

  const score = (points / MAX_POINTS) * 100;
  let confidence: Confidence = score >= parameters.confidence.highMin ? "alta" : score >= parameters.confidence.mediumMin ? "media" : "baixa";

  if (confidence === "alta" && input.tendencia === "volatil") confidence = "media";
  if (confidence === "alta" && !input.reconciliacaoLimpa) confidence = "media";

  return confidence;
}

/** Nunca "alta" (Global Constraint) — extrapolação de rede, não histórico direto do par loja×SKU. */
export function computeOpportunityConfidence(storesComBomDesempenho: number, parameters: MixParameters): Confidence {
  if (storesComBomDesempenho < parameters.opportunity.minNetworkStores) return "insuficiente";
  return storesComBomDesempenho >= parameters.opportunity.minNetworkStores * 2 ? "media" : "baixa";
}
