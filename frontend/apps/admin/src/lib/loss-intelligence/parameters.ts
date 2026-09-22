import { PARAMETER_DOCS, PARAMETER_PATHS, type ParameterPath } from "./parameter-docs";
import { readLossIntelligencePublicEnv } from "./env";

export interface LossIntelligenceParameters {
  window: { primaryWindowMonths: number; recurrenceLookbackMonths: number };
  validity: { minRepeatedSupplyMonths: number; lowSaleRatio: number; localOutlierMaxShare: number; networkWideMinShare: number };
  network: { minStoresForNetworkVerdict: number };
  otherReason: { minHealthyUnits: number; viabilityMaxRatio: number; negligibleValueCents: number; localConcentrationMin: number; minRecurringPeriods: number };
  damage: { localConcentrationMin: number; minStoresCarryingForConcentration: number; minStoresForSystemic: number };
  unnecessarySupply: { verylowSaleRatio: number };
  recentHistory: { minClosedMonths: number; minUnits: number };
  priority: { criticalValueCents: number };
  confidence: { minMonthsForHigh: number };
}

export const DEFAULT_PARAMETERS: LossIntelligenceParameters = {
  window: { primaryWindowMonths: 3, recurrenceLookbackMonths: 6 },
  validity: { minRepeatedSupplyMonths: 2, lowSaleRatio: 0.5, localOutlierMaxShare: 0.3, networkWideMinShare: 0.7 },
  network: { minStoresForNetworkVerdict: 5 },
  otherReason: { minHealthyUnits: 20, viabilityMaxRatio: 0.3, negligibleValueCents: 5000, localConcentrationMin: 0.7, minRecurringPeriods: 3 },
  damage: { localConcentrationMin: 0.7, minStoresCarryingForConcentration: 3, minStoresForSystemic: 4 },
  unnecessarySupply: { verylowSaleRatio: 0.15 },
  recentHistory: { minClosedMonths: 2, minUnits: 15 },
  priority: { criticalValueCents: 30000 },
  confidence: { minMonthsForHigh: 3 },
};

/** All 20 are provisional in Fase 1 — no calibration against real months has happened yet. */
export function isProvisional(_path: ParameterPath): boolean {
  return true;
}

export function getParameter(parameters: LossIntelligenceParameters, path: ParameterPath): number {
  const [group, key] = path.split(".") as [keyof LossIntelligenceParameters, string];
  return (parameters[group] as unknown as Record<string, number>)[key];
}

function withParameter(parameters: LossIntelligenceParameters, path: ParameterPath, value: number): LossIntelligenceParameters {
  const [group, key] = path.split(".") as [keyof LossIntelligenceParameters, string];
  return { ...parameters, [group]: { ...(parameters[group] as object), [key]: value } };
}

export function envNameOf(path: ParameterPath): string {
  return `NEXT_PUBLIC_LI_${path.replace(/\./g, "_").replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`;
}

function inBounds(path: ParameterPath, value: number): boolean {
  const { min, max, integer } = PARAMETER_DOCS[path];
  return Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
}

const ORDERED_PAIRS: { lower: ParameterPath; upper: ParameterPath; text: string }[] = [
  { lower: "validity.localOutlierMaxShare", upper: "validity.networkWideMinShare", text: "o teto de outlier local não pode passar do piso de problema de rede" },
  { lower: "damage.minStoresCarryingForConcentration", upper: "damage.minStoresForSystemic", text: "o mínimo para calcular concentração não pode passar do mínimo para problema sistêmico" },
];

function enforceOrder(parameters: LossIntelligenceParameters, warnings: string[]): LossIntelligenceParameters {
  let result = parameters;
  for (const { lower, upper, text } of ORDERED_PAIRS) {
    if (getParameter(result, lower) <= getParameter(result, upper)) continue;
    warnings.push(`Parâmetros ${lower} e ${upper} voltaram ao padrão: ${text}.`);
    result = withParameter(withParameter(result, lower, getParameter(DEFAULT_PARAMETERS, lower)), upper, getParameter(DEFAULT_PARAMETERS, upper));
  }
  return result;
}

export interface ResolvedParameters {
  parameters: LossIntelligenceParameters;
  warnings: string[];
}

export function parametersFromEnv(env: Record<string, string | undefined>): ResolvedParameters {
  const warnings: string[] = [];
  let parameters = DEFAULT_PARAMETERS;

  for (const path of PARAMETER_PATHS) {
    const name = envNameOf(path);
    const raw = env[name]?.trim();
    if (raw === undefined || raw === "") continue;

    const value = Number(raw);
    if (!inBounds(path, value)) {
      const { min, max, integer } = PARAMETER_DOCS[path];
      warnings.push(`${name}="${raw}" foi ignorado: precisa ser um número entre ${min} e ${max}${integer ? ", inteiro" : ""}.`);
      continue;
    }
    parameters = withParameter(parameters, path, value);
  }

  return { parameters: enforceOrder(parameters, warnings), warnings };
}

export function formatParameterValue(path: ParameterPath, value: number): string {
  switch (PARAMETER_DOCS[path].unit) {
    case "share":
      return `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    case "months":
      return `${value} ${value === 1 ? "mês" : "meses"}`;
    case "cents":
      return (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    default:
      return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  }
}

export const RUNTIME_PARAMETERS = parametersFromEnv(readLossIntelligencePublicEnv());
