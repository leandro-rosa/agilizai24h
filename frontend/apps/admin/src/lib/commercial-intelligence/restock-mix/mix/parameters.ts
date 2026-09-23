import { PARAMETER_DOCS, PARAMETER_PATHS, type ParameterPath } from "./parameter-docs";
import { readMixPublicEnv } from "./env";

export interface MixParameters {
  evidence: { minMonthsWithSales: number };
  trend: { recentMonthsCount: number; recentWeightMultiplier: number; upThresholdPct: number; downThresholdPct: number; adjustPct: number; volatilityThreshold: number };
  classification: { affinityExploreMin: number; affinityHealthyMin: number; marginHealthyMinPct: number };
  opportunity: { minNetworkStores: number; testQuantity: number };
  confidence: { highMin: number; mediumMin: number };
}

export const DEFAULT_MIX_PARAMETERS: MixParameters = {
  evidence: { minMonthsWithSales: 2 },
  trend: { recentMonthsCount: 3, recentWeightMultiplier: 2, upThresholdPct: 0.2, downThresholdPct: 0.2, adjustPct: 0.1, volatilityThreshold: 0.4 },
  classification: { affinityExploreMin: 1.2, affinityHealthyMin: 0.8, marginHealthyMinPct: 0.15 },
  opportunity: { minNetworkStores: 5, testQuantity: 4 },
  confidence: { highMin: 70, mediumMin: 40 },
};

export function isProvisional(_path: ParameterPath): boolean {
  return true;
}

export function getMixParameter(parameters: MixParameters, path: ParameterPath): number {
  const [group, key] = path.split(".") as [keyof MixParameters, string];
  return (parameters[group] as unknown as Record<string, number>)[key];
}

function withParameter(parameters: MixParameters, path: ParameterPath, value: number): MixParameters {
  const [group, key] = path.split(".") as [keyof MixParameters, string];
  return { ...parameters, [group]: { ...(parameters[group] as object), [key]: value } };
}

export function envNameOf(path: ParameterPath): string {
  return `NEXT_PUBLIC_MIX_${path.replace(/\./g, "_").replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`;
}

function inBounds(path: ParameterPath, value: number): boolean {
  const { min, max, integer } = PARAMETER_DOCS[path];
  return Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
}

const ORDERED_PAIRS: { lower: ParameterPath; upper: ParameterPath; text: string }[] = [
  { lower: "confidence.mediumMin", upper: "confidence.highMin", text: "o piso de confiança Média não pode passar do piso de confiança Alta" },
];

function enforceOrder(parameters: MixParameters, warnings: string[]): MixParameters {
  let result = parameters;
  for (const { lower, upper, text } of ORDERED_PAIRS) {
    if (getMixParameter(result, lower) <= getMixParameter(result, upper)) continue;
    warnings.push(`Parâmetros ${lower} e ${upper} voltaram ao padrão: ${text}.`);
    result = withParameter(withParameter(result, lower, getMixParameter(DEFAULT_MIX_PARAMETERS, lower)), upper, getMixParameter(DEFAULT_MIX_PARAMETERS, upper));
  }
  return result;
}

export interface ResolvedMixParameters {
  parameters: MixParameters;
  warnings: string[];
}

export function parametersFromEnv(env: Record<string, string | undefined>): ResolvedMixParameters {
  const warnings: string[] = [];
  let parameters = DEFAULT_MIX_PARAMETERS;

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

export function formatMixParameterValue(path: ParameterPath, value: number): string {
  switch (PARAMETER_DOCS[path].unit) {
    case "share":
      return `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    case "months":
      return `${value} ${value === 1 ? "mês" : "meses"}`;
    default:
      return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  }
}

export const RUNTIME_MIX_PARAMETERS = parametersFromEnv(readMixPublicEnv());
