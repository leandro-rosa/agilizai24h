import type { Trend, TrendResult } from "./types";

export interface TrendParameters {
  recentMonthsCount: number;
  recentWeightMultiplier: number;
  upThresholdPct: number;
  downThresholdPct: number;
  adjustPct: number;
  volatilityThreshold: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function weightedMean(values: number[], parameters: TrendParameters): number {
  const weights = values.map((_, i) => (values.length - i <= parameters.recentMonthsCount ? parameters.recentWeightMultiplier : 1));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const weightedSum = values.reduce((sum, v, i) => sum + v * weights[i], 0);
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

function meanAbsoluteDeviation(values: number[], center: number): number {
  return values.reduce((sum, v) => sum + Math.abs(v - center), 0) / values.length;
}

function directionOf(values: number[], parameters: TrendParameters): Trend {
  if (values.length < 4) return "estavel";
  const recentAvg = (values[values.length - 1] + values[values.length - 2]) / 2;
  const priorAvg = (values[values.length - 3] + values[values.length - 4]) / 2;
  if (priorAvg === 0) return recentAvg > 0 ? "crescendo" : "estavel";
  const ratio = recentAvg / priorAvg;
  if (ratio >= 1 + parameters.upThresholdPct) return "crescendo";
  if (ratio <= 1 - parameters.downThresholdPct) return "caindo";
  return "estavel";
}

/** §6 passos 2-4: mediana + média ponderada por recência -> estimativa; desvio absoluto médio -> faixa; direção por metades; volatilidade sobrepõe e alarga. */
export function computeTrend(monthlyQuantities: number[], parameters: TrendParameters): TrendResult {
  if (monthlyQuantities.length === 0) return { tendencia: "indeterminada", estimativaCentral: 0, faixaEstimada: { min: 0, max: 0 } };

  const med = median(monthlyQuantities);
  const wMean = weightedMean(monthlyQuantities, parameters);
  const base = Math.round((med + wMean) / 2);
  const mad = meanAbsoluteDeviation(monthlyQuantities, med);

  let tendencia = directionOf(monthlyQuantities, parameters);
  let estimativaCentral = base;
  if (tendencia === "crescendo") estimativaCentral = Math.round(base * (1 + parameters.adjustPct));
  else if (tendencia === "caindo") estimativaCentral = Math.round(base * (1 - parameters.adjustPct));

  let madForRange = mad;
  if (monthlyQuantities.length >= 4) {
    const coefficientOfVariation = base > 0 ? mad / base : 0;
    if (coefficientOfVariation > parameters.volatilityThreshold) {
      tendencia = "volatil";
      madForRange = mad * 1.5;
    }
  }

  return {
    tendencia,
    estimativaCentral,
    faixaEstimada: { min: Math.max(0, Math.round(estimativaCentral - madForRange)), max: Math.round(estimativaCentral + madForRange) },
  };
}
