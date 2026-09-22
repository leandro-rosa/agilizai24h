"use client";

import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type ParameterKind = "business" | "quality" | "analytic";

export interface ParameterRuleRow {
  path: string;
  label: string;
  group: string;
  groupLabel: string;
  kind: ParameterKind;
  formattedValue: string;
  fallbackFormattedValue: string;
  isOverridden: boolean;
  isProvisional: boolean;
  controls: string;
  formula: string | null;
  unitLabel: string;
  minFormatted: string;
  maxFormatted: string;
  why: string;
  usedIn: string;
  up: string;
  down: string;
  envName: string;
}

export interface ParameterKindSection {
  kind: ParameterKind;
  title: string;
  description: string;
  rows: ParameterRuleRow[];
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function ParameterRow({ row }: { row: ParameterRuleRow }) {
  return (
    <details className="group border-t first:border-t-0">
      <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5 text-sm marker:content-none">
        <span className="font-medium">{row.label}</span>
        <span className="flex items-center gap-2">
          <span className="tabular font-semibold">{row.formattedValue}</span>
          {row.isProvisional && <StatusBadge tone="attention">provisório</StatusBadge>}
        </span>
      </summary>
      <dl className="flex flex-col gap-2 pb-4 pl-1">
        <Detail label="Finalidade">{row.controls}</Detail>
        {row.formula && <Detail label="Fórmula">{row.formula}</Detail>}
        <Detail label="Unidade e limites">
          {row.unitLabel} · entre {row.minFormatted} e {row.maxFormatted}
        </Detail>
        <Detail label="Valor atual">
          <span className="tabular">{row.formattedValue}</span>
          {row.isOverridden && <span className="text-muted-foreground"> (padrão do código: {row.fallbackFormattedValue}; o ambiente sobrescreveu)</span>}
        </Detail>
        <Detail label="Motivo do padrão">{row.why}</Detail>
        <Detail label="Onde é usado">{row.usedIn}</Detail>
        <Detail label="Se aumentar">{row.up}</Detail>
        <Detail label="Se diminuir">{row.down}</Detail>
        <Detail label="Variável de ambiente">
          <code className="break-all text-xs">{row.envName}</code> <span className="text-muted-foreground">(lida na compilação)</span>
        </Detail>
      </dl>
    </details>
  );
}

function KindSection({ section }: { section: ParameterKindSection }) {
  const groups = [...new Set(section.rows.map((row) => row.group))];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {section.title}
          <span className="text-sm font-normal text-muted-foreground">{section.rows.length} parâmetros</span>
        </CardTitle>
        <CardDescription>{section.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {groups.map((group) => {
          const rows = section.rows.filter((row) => row.group === group);
          return (
            <section key={group} aria-label={rows[0]?.groupLabel ?? group}>
              <h3 className="mb-1 text-sm font-medium text-muted-foreground">{rows[0]?.groupLabel ?? group}</h3>
              <div>
                {rows.map((row) => (
                  <ParameterRow key={row.path} row={row} />
                ))}
              </div>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Every parameter, by kind, with its documentation. Read-only: the values come from the deployment and are calibrated, not edited here. Domain-agnostic — the caller resolves its own parameter type into rows. */
export function ParameterCatalog({ sections }: { sections: ParameterKindSection[] }) {
  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => (
        <KindSection key={section.kind} section={section} />
      ))}
    </div>
  );
}
