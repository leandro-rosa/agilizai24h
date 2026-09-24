import { KIND_LABELS, PARAMETER_DOCS, PARAMETER_GROUP_LABELS, PARAMETER_KINDS, type ParameterPath } from "./parameter-docs";
import { DEFAULT_RESTOCK_PARAMETERS, envNameOf, formatRestockParameterValue, getRestockParameter, isProvisional, type RestockParameters } from "./parameters";
import type { ParameterKindSection, ParameterRuleRow } from "@/components/parameter-catalog";
import type { BusinessRuleRow } from "@/components/business-rules-sheet";

const UNIT_LABELS: Record<string, string> = { share: "proporção (mostrada em %)", months: "meses", number: "número" };

function toRow(path: ParameterPath, parameters: RestockParameters, defaults: RestockParameters): ParameterRuleRow {
  const doc = PARAMETER_DOCS[path];
  const value = getRestockParameter(parameters, path);
  const fallback = getRestockParameter(defaults, path);
  const group = path.split(".")[0];

  return {
    path,
    label: doc.label,
    group,
    groupLabel: PARAMETER_GROUP_LABELS[group] ?? group,
    kind: doc.kind,
    formattedValue: formatRestockParameterValue(path, value),
    fallbackFormattedValue: formatRestockParameterValue(path, fallback),
    isOverridden: value !== fallback,
    isProvisional: isProvisional(path),
    controls: doc.controls,
    formula: null,
    unitLabel: UNIT_LABELS[doc.unit] ?? doc.unit,
    minFormatted: formatRestockParameterValue(path, doc.min),
    maxFormatted: formatRestockParameterValue(path, doc.max),
    why: doc.why,
    usedIn: doc.controls,
    up: doc.up,
    down: doc.down,
    envName: envNameOf(path),
  };
}

export function restockParameterCatalogSections(parameters: RestockParameters, defaults: RestockParameters = DEFAULT_RESTOCK_PARAMETERS): ParameterKindSection[] {
  return (["quality", "analytic", "business"] as const).map((kind) => ({
    kind,
    title: KIND_LABELS[kind].title,
    description: KIND_LABELS[kind].description,
    rows: PARAMETER_KINDS[kind].map((path) => toRow(path, parameters, defaults)),
  }));
}

export function restockBusinessRuleRows(parameters: RestockParameters, defaults: RestockParameters = DEFAULT_RESTOCK_PARAMETERS): BusinessRuleRow[] {
  return PARAMETER_KINDS.business.map((path) => {
    const row = toRow(path, parameters, defaults);
    return { path: row.path, label: row.label, formattedValue: row.formattedValue, controls: row.controls, usedIn: row.usedIn };
  });
}
