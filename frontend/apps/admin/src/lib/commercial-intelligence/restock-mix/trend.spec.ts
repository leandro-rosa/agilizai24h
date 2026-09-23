import { describe, it, expect } from "@jest/globals";
import { computeTrend, type TrendParameters } from "./trend";

const PARAMS: TrendParameters = {
  recentMonthsCount: 3,
  recentWeightMultiplier: 2,
  upThresholdPct: 0.2,
  downThresholdPct: 0.08,
  adjustPct: 0.1,
  volatilityThreshold: 0.4,
};

describe("computeTrend", () => {
  it("returns indeterminada with a zero range for an empty series", () => {
    expect(computeTrend([], PARAMS)).toEqual({ tendencia: "indeterminada", estimativaCentral: 0, faixaEstimada: { min: 0, max: 0 } });
  });

  it("classifies estavel for a flat series and centers the estimate on it", () => {
    const result = computeTrend([10, 10, 10, 10, 10, 10], PARAMS);
    expect(result.tendencia).toBe("estavel");
    expect(result.estimativaCentral).toBe(10);
    expect(result.faixaEstimada).toEqual({ min: 10, max: 10 });
  });

  it("classifies crescendo when the last 2 months clearly outpace the 2 before them, and nudges the estimate up", () => {
    // últimos 2 (jul,ago) = média 19; 2 anteriores (mai,jun) = média 11 -> +72%, bem acima do teto de 20%
    const result = computeTrend([10, 11, 11, 12, 18, 20], PARAMS);
    expect(result.tendencia).toBe("crescendo");
    // mediana bruta = 11.5 -> arred. método par; média ponderada pesa mai/jun/jul/ago x2: garantidamente > mediana simples
    expect(result.estimativaCentral).toBeGreaterThan(11);
  });

  it("classifies caindo when the last 2 months are clearly below the 2 before them", () => {
    const result = computeTrend([20, 18, 12, 11, 11, 10], PARAMS);
    expect(result.tendencia).toBe("caindo");
  });

  it("stays estavel with fewer than 4 months — not enough to claim a direction", () => {
    const result = computeTrend([10, 30], PARAMS);
    expect(result.tendencia).toBe("estavel");
  });

  it("overrides to volatil when the coefficient of variation exceeds the threshold, and widens the range", () => {
    const estavel = computeTrend([10, 10, 10, 10, 10, 10], PARAMS);
    const volatil = computeTrend([1, 20, 1, 20, 1, 20], PARAMS);
    expect(volatil.tendencia).toBe("volatil");
    expect(volatil.faixaEstimada.max - volatil.faixaEstimada.min).toBeGreaterThan(estavel.faixaEstimada.max - estavel.faixaEstimada.min);
  });

  it("never returns a negative floor for the range", () => {
    const result = computeTrend([0, 0, 0, 1, 0, 0], PARAMS);
    expect(result.faixaEstimada.min).toBeGreaterThanOrEqual(0);
  });
});
