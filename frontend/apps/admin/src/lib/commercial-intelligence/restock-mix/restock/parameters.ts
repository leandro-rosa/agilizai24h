import { PARAMETER_DOCS, PARAMETER_PATHS, type ParameterPath } from "./parameter-docs";
import { readRestockPublicEnv } from "./env";

export interface RestockParameters {
  evidence: { minMonthsWithSales: number };
  trend: { recentMonthsCount: number; recentWeightMultiplier: number; upThresholdPct: number; downThresholdPct: number; adjustPct: number; volatilityThreshold: number };
  action: { increaseThresholdPct: number; decreaseThresholdPct: number };
  lossIntegration: { reduceFactor: number };
  confidence: { highMin: number; mediumMin: number };
  rounding: { shortShelfLifeDays: number; lowAproveitamentoThreshold: number; leanToMinFraction: number };
}

export const DEFAULT_RESTOCK_PARAMETERS: RestockParameters = {
  evidence: { minMonthsWithSales: 2 },
  trend: { recentMonthsCount: 3, recentWeightMultiplier: 2, upThresholdPct: 0.2, downThresholdPct: 0.2, adjustPct: 0.1, volatilityThreshold: 0.4 },
  action: { increaseThresholdPct: 0.15, decreaseThresholdPct: 0.15 },
  lossIntegration: { reduceFactor: 0.5 },
  confidence: { highMin: 70, mediumMin: 40 },
  rounding: { shortShelfLifeDays: 14, lowAproveitamentoThreshold: 0.6, leanToMinFraction: 0.25 },
};

/** Todos são provisórios nesta fase — nenhum foi calibrado contra resultado real de intervenção. */
export function isProvisional(_path: ParameterPath): boolean {
  return true;
}

export function getRestockParameter(parameters: RestockParameters, path: ParameterPath): number {
  const [group, key] = path.split(".") as [keyof RestockParameters, string];
  return (parameters[group] as unknown as Record<string, number>)[key];
}

function withParameter(parameters: RestockParameters, path: ParameterPath, value: number): RestockParameters {
  const [group, key] = path.split(".") as [keyof RestockParameters, string];
  return { ...parameters, [group]: { ...(parameters[group] as object), [key]: value } };
}

export function envNameOf(path: ParameterPath): string {
  return `NEXT_PUBLIC_RESTOCK_${path.replace(/\./g, "_").replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`;
}

function inBounds(path: ParameterPath, value: number): boolean {
  const { min, max, integer } = PARAMETER_DOCS[path];
  return Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
}

const ORDERED_PAIRS: { lower: ParameterPath; upper: ParameterPath; text: string }[] = [
  { lower: "confidence.mediumMin", upper: "confidence.highMin", text: "o piso de confiança Média não pode passar do piso de confiança Alta" },
];

function enforceOrder(parameters: RestockParameters, warnings: string[]): RestockParameters {
  let result = parameters;
  for (const { lower, upper, text } of ORDERED_PAIRS) {
    if (getRestockParameter(result, lower) <= getRestockParameter(result, upper)) continue;
    warnings.push(`Parâmetros ${lower} e ${upper} voltaram ao padrão: ${text}.`);
    result = withParameter(withParameter(result, lower, getRestockParameter(DEFAULT_RESTOCK_PARAMETERS, lower)), upper, getRestockParameter(DEFAULT_RESTOCK_PARAMETERS, upper));
  }
  return result;
}

export interface ResolvedRestockParameters {
  parameters: RestockParameters;
  warnings: string[];
}

export function parametersFromEnv(env: Record<string, string | undefined>): ResolvedRestockParameters {
  const warnings: string[] = [];
  let parameters = DEFAULT_RESTOCK_PARAMETERS;

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

export function formatRestockParameterValue(path: ParameterPath, value: number): string {
  switch (PARAMETER_DOCS[path].unit) {
    case "share":
      return `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    case "months":
      return `${value} ${value === 1 ? "mês" : "meses"}`;
    default:
      return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  }
}

export const RUNTIME_RESTOCK_PARAMETERS = parametersFromEnv(readRestockPublicEnv());
