import {
  DEFAULT_PARAMETERS,
  envNameOf,
  formatParameterValue,
  getParameter,
  isProvisional,
  PARAMETER_DOCS,
  PARAMETER_GROUP_LABELS,
  PARAMETER_PATHS,
  type CommercialParameters,
  type ParameterPath,
} from "./parameters";
import { KIND_LABELS, PARAMETER_EXTRA, PARAMETER_KINDS } from "./parameter-docs";
import type { ParameterKindSection, ParameterRuleRow } from "@/components/parameter-catalog";
import type { BusinessRuleRow } from "@/components/business-rules-sheet";

const UNIT_LABELS: Record<string, string> = {
  share: "proporção (mostrada em %)",
  ratio: "razão (×)",
  count: "contagem",
  days: "dias",
  minutes: "minutos",
  cents: "valor em R$ (guardado em centavos)",
  number: "número",
};

function toRow(path: ParameterPath, parameters: CommercialParameters, defaults: CommercialParameters): ParameterRuleRow {
  const doc = PARAMETER_DOCS[path];
  const extra = PARAMETER_EXTRA[path];
  const value = getParameter(parameters, path);
  const fallback = getParameter(defaults, path);
  const group = path.split(".")[0];

  return {
    path,
    label: doc.label,
    group,
    groupLabel: PARAMETER_GROUP_LABELS[group] ?? group,
    kind: extra.kind,
    formattedValue: formatParameterValue(path, value),
    fallbackFormattedValue: formatParameterValue(path, fallback),
    isOverridden: value !== fallback,
    isProvisional: isProvisional(path),
    controls: doc.controls,
    formula: extra.formula,
    unitLabel: UNIT_LABELS[doc.unit] ?? doc.unit,
    minFormatted: formatParameterValue(path, doc.min),
    maxFormatted: formatParameterValue(path, doc.max),
    why: extra.why,
    usedIn: extra.usedIn,
    up: extra.up,
    down: extra.down,
    envName: envNameOf(path),
  };
}

export function commercialParameterCatalogSections(parameters: CommercialParameters, defaults: CommercialParameters = DEFAULT_PARAMETERS): ParameterKindSection[] {
  return (["quality", "analytic", "business"] as const).map((kind) => ({
    kind,
    title: KIND_LABELS[kind].title,
    description: KIND_LABELS[kind].description,
    rows: PARAMETER_KINDS[kind].map((path) => toRow(path, parameters, defaults)),
  }));
}

export function commercialBusinessRuleRows(parameters: CommercialParameters, defaults: CommercialParameters = DEFAULT_PARAMETERS): BusinessRuleRow[] {
  return PARAMETER_KINDS.business.map((path) => {
    const row = toRow(path, parameters, defaults);
    return { path: row.path, label: row.label, formattedValue: row.formattedValue, controls: row.controls, usedIn: row.usedIn };
  });
}

// Sanity: every path in PARAMETER_PATHS must be reachable through PARAMETER_KINDS (used by parameter-rows.spec.ts).
export const ALL_PARAMETER_PATHS = PARAMETER_PATHS;
