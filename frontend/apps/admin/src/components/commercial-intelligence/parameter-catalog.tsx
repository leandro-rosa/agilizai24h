"use client";

import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KIND_LABELS, PARAMETER_EXTRA, PARAMETER_KINDS, type ParameterKind } from "@/lib/commercial-intelligence/parameter-docs";
import {
  envNameOf,
  formatParameterValue,
  getParameter,
  isProvisional,
  PARAMETER_DOCS,
  PARAMETER_GROUP_LABELS,
  type CommercialParameters,
  type ParameterPath,
} from "@/lib/commercial-intelligence/parameters";

const UNIT_LABELS = {
  share: "proporção (mostrada em %)",
  ratio: "razão (×)",
  count: "contagem",
  days: "dias",
  minutes: "minutos",
  cents: "valor em R$ (guardado em centavos)",
  number: "número",
} as const;

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** One parameter with everything the operator needs to judge it: purpose, formula, unit, value, why that default, where it is used, and what raising or lowering it does. */
function ParameterRow({ path, parameters, defaults }: { path: ParameterPath; parameters: CommercialParameters; defaults: CommercialParameters }) {
  const doc = PARAMETER_DOCS[path];
  const extra = PARAMETER_EXTRA[path];
  const value = getParameter(parameters, path);
  const fallback = getParameter(defaults, path);

  return (
    <details className="group border-t first:border-t-0">
      <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5 text-sm marker:content-none">
        <span className="font-medium">{doc.label}</span>
        <span className="flex items-center gap-2">
          <span className="tabular font-semibold">{formatParameterValue(path, value)}</span>
          {isProvisional(path) && <StatusBadge tone="attention">provisório</StatusBadge>}
        </span>
      </summary>
      <dl className="flex flex-col gap-2 pb-4 pl-1">
        <Detail label="Finalidade">{doc.controls}</Detail>
        {extra.formula && <Detail label="Fórmula">{extra.formula}</Detail>}
        <Detail label="Unidade e limites">
          {UNIT_LABELS[doc.unit]} · entre {formatParameterValue(path, doc.min)} e {formatParameterValue(path, doc.max)}
        </Detail>
        <Detail label="Valor atual">
          <span className="tabular">{formatParameterValue(path, value)}</span>
          {value !== fallback && <span className="text-muted-foreground"> (padrão do código: {formatParameterValue(path, fallback)}; o ambiente sobrescreveu)</span>}
        </Detail>
        <Detail label="Motivo do padrão">{extra.why}</Detail>
        <Detail label="Onde é usado">{extra.usedIn}</Detail>
        <Detail label="Se aumentar">{extra.up}</Detail>
        <Detail label="Se diminuir">{extra.down}</Detail>
        <Detail label="Variável de ambiente">
          <code className="break-all text-xs">{envNameOf(path)}</code> <span className="text-muted-foreground">(lida na compilação)</span>
        </Detail>
      </dl>
    </details>
  );
}

function KindSection({ kind, parameters, defaults }: { kind: ParameterKind; parameters: CommercialParameters; defaults: CommercialParameters }) {
  const groups = [...new Set(PARAMETER_KINDS[kind].map((path) => path.split(".")[0]))];
  const { title, description } = KIND_LABELS[kind];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {title}
          <span className="text-sm font-normal text-muted-foreground">{PARAMETER_KINDS[kind].length} parâmetros</span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {groups.map((group) => (
          <section key={group} aria-label={PARAMETER_GROUP_LABELS[group] ?? group}>
            <h3 className="mb-1 text-sm font-medium text-muted-foreground">{PARAMETER_GROUP_LABELS[group] ?? group}</h3>
            <div>
              {PARAMETER_KINDS[kind]
                .filter((path) => path.startsWith(`${group}.`))
                .map((path) => (
                  <ParameterRow key={path} path={path} parameters={parameters} defaults={defaults} />
                ))}
            </div>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

/** Every parameter, by kind, with its documentation. Read-only: the values come from the deployment and are calibrated, not edited here. */
export function ParameterCatalog({ parameters, defaults }: { parameters: CommercialParameters; defaults: CommercialParameters }) {
  return (
    <div className="flex flex-col gap-6">
      {(["quality", "analytic", "business"] as const).map((kind) => (
        <KindSection key={kind} kind={kind} parameters={parameters} defaults={defaults} />
      ))}
    </div>
  );
}
