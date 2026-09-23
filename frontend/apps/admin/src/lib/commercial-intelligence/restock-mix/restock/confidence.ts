import type { Confidence } from "@/lib/loss-intelligence/types";
import type { Trend } from "../types";
import type { RestockParameters } from "./parameters";

export interface RestockConfidenceInput {
  mesesComVenda: number;
  mesesAnalisados: number;
  tendencia: Trend;
  reconciliacaoLimpa: boolean;
}

const MAX_POINTS = 70;

export function computeRestockConfidence(input: RestockConfidenceInput, parameters: RestockParameters): Confidence {
  if (input.mesesComVenda < parameters.evidence.minMonthsWithSales) return "insuficiente";

  let points = 0;
  points += input.mesesComVenda >= input.mesesAnalisados ? 30 : input.mesesComVenda >= Math.ceil(input.mesesAnalisados / 2) ? 20 : 10;
  points += input.tendencia === "volatil" ? 0 : input.tendencia === "indeterminada" ? 5 : 20;
  points += input.reconciliacaoLimpa ? 20 : 5;

  const score = (points / MAX_POINTS) * 100;
  let confidence: Confidence = score >= parameters.confidence.highMin ? "alta" : score >= parameters.confidence.mediumMin ? "media" : "baixa";

  // Tetos que só reduzem, nunca sobem — mesmo desenho de loss-intelligence/confidence.ts.
  if (confidence === "alta" && input.tendencia === "volatil") confidence = "media";
  if (confidence === "alta" && !input.reconciliacaoLimpa) confidence = "media";

  return confidence;
}
