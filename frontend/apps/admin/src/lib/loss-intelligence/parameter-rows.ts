import { KIND_LABELS, PARAMETER_DOCS, PARAMETER_GROUP_LABELS, PARAMETER_KINDS, PARAMETER_PATHS, type ParameterPath } from "./parameter-docs";
import { DEFAULT_PARAMETERS, envNameOf, formatParameterValue, getParameter, isProvisional, type LossIntelligenceParameters } from "./parameters";
import type { ParameterKindSection, ParameterRuleRow } from "@/components/parameter-catalog";
import type { BusinessRuleRow } from "@/components/business-rules-sheet";

const UNIT_LABELS: Record<string, string> = {
  share: "proporção (mostrada em %)",
  months: "meses",
  cents: "valor em R$ (guardado em centavos)",
  count: "contagem",
  number: "número",
};

function toRow(path: ParameterPath, parameters: LossIntelligenceParameters, defaults: LossIntelligenceParameters): ParameterRuleRow {
  const doc = PARAMETER_DOCS[path];
  const value = getParameter(parameters, path);
  const fallback = getParameter(defaults, path);
  const group = path.split(".")[0];

  return {
    path,
    label: doc.label,
    group,
    groupLabel: PARAMETER_GROUP_LABELS[group] ?? group,
    kind: doc.kind,
    formattedValue: formatParameterValue(path, value),
    fallbackFormattedValue: formatParameterValue(path, fallback),
    isOverridden: value !== fallback,
    isProvisional: isProvisional(path),
    controls: doc.controls,
    formula: doc.formula,
    unitLabel: UNIT_LABELS[doc.unit] ?? doc.unit,
    minFormatted: formatParameterValue(path, doc.min),
    maxFormatted: formatParameterValue(path, doc.max),
    why: doc.why,
    // §14 da spec só tem uma coluna "Controla" — reaproveitada aqui para os dois campos
    // genéricos (o componente compartilhado não sabe que este domínio não separa os dois).
    usedIn: doc.controls,
    up: doc.up,
    down: doc.down,
    envName: envNameOf(path),
  };
}

export function lossParameterCatalogSections(parameters: LossIntelligenceParameters, defaults: LossIntelligenceParameters = DEFAULT_PARAMETERS): ParameterKindSection[] {
  return (["quality", "analytic", "business"] as const).map((kind) => ({
    kind,
    title: KIND_LABELS[kind].title,
    description: KIND_LABELS[kind].description,
    rows: PARAMETER_KINDS[kind].map((path) => toRow(path, parameters, defaults)),
  }));
}

export function lossBusinessRuleRows(parameters: LossIntelligenceParameters, defaults: LossIntelligenceParameters = DEFAULT_PARAMETERS): BusinessRuleRow[] {
  return PARAMETER_KINDS.business.map((path) => {
    const row = toRow(path, parameters, defaults);
    return { path: row.path, label: row.label, formattedValue: row.formattedValue, controls: row.controls, usedIn: row.usedIn };
  });
}

// Sanity: every path in PARAMETER_PATHS must be reachable through PARAMETER_KINDS (used by parameter-rows.spec.ts).
export const ALL_PARAMETER_PATHS = PARAMETER_PATHS;
