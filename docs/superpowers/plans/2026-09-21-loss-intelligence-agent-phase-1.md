# Agente de Inteligência de Perdas — Fase 1 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Fase 1 Loss Intelligence engine (motor puro em `frontend/apps/admin/src/lib/loss-intelligence/`) and its UI (painel + tabela de decisões + drill-down), integrado à aba Perdas existente (`loss-tab.tsx`), sem persistência, sem novo endpoint de backend, sem tocar nos widgets já existentes.

**Architecture:** Módulo TypeScript puro (sem React/fetch/Redux) que recebe dados já buscados pelos hooks RTK Query existentes (`finance`, `sales`, `supply`) mais um novo hook de custo datado (`products`), calcula métricas honestas (nunca dependentes de estoque), roda três árvores de decisão independentes por motivo (validade, danificado, "Outro motivo" — nunca uma árvore de roubo), consolida por Produto×Loja separando impacto financeiro de ação prioritária, e alimenta três componentes React novos renderizados dentro da aba Perdas atual.

**Tech Stack:** TypeScript, React 19 / Next.js (App Router), RTK Query, Jest (`pnpm --filter @agiliz/admin test`), shadcn/ui + Radix (componentes já existentes: `StatusBadge`, `ConfidenceBadge`, `ProvenanceBadge`, `Card`, `Sheet`).

**Spec:** [docs/superpowers/specs/2026-09-21-loss-intelligence-agent-phase-1-design.md](../specs/2026-09-21-loss-intelligence-agent-phase-1-design.md)

## Global Constraints

- **Zero dependência de estoque.** Nenhuma métrica, condição, regra ou texto gerado usa saldo, estoque atual/estimado, dias de cobertura, disponibilidade, ruptura ou a fórmula `estoque = abastecido − vendido − perdido`. Ver spec §2.
- **`other_reason` nunca é roubo**, nem no rótulo nem na lógica interna. `diagnosis/other-reason.ts` é neutro; nunca produz `avaliar_retirada_loja`/`avaliar_retirada_rede`. Ver spec §10.2.
- **Zero endpoint novo, zero migration.** Só consome `finance`/`sales`/`supply`/`products` já existentes. Ver spec §2.4.
- **Zero persistência nesta fase.** Recalcula tudo a cada carregamento. Ver spec §2.5.
- **`saleToSupplyRatio` nunca é chamado de "sell-through".** `monthsWithRestock` nunca é chamado de "frequência de visitas". `firstSeenRecently` nunca é chamado de "produto em teste"/`isTestProduct`. Ver spec §7, §9.
- **Mês em andamento nunca sozinho sustenta uma decisão estrutural** (suspender, avaliar retirada, avaliar permanência) — só reforça um alerta já sustentado por período fechado. Ver spec §8.
- **"Potencial de intervenção" é sempre ordinal (Alto/Médio/Baixo), documentado por regra — nunca uma fórmula numérica única aplicada entre motivos.** Ver spec §11.2.
- **Toda ação 🔴/⚫ tem pelo menos um `sinalDetectado`/`regraAcionada` nomeado.** Nenhuma recomendação severa aparece sem explicação auditável.
- **Nenhum teste roda contra o banco de dev real.** Toda fixture é sintética, em memória (regra de isolamento do projeto).
- **Todo `pnpm --filter @agiliz/admin typecheck lint test` deve passar limpo** ao final de cada task.
- Convenção de nomes do projeto: período é sempre `YYYY-MM`, nunca inferido — vem de dado já resolvido pelas rotas existentes.

---

## Task 0: Generalizar `BusinessRulesSheet` e `ParameterCatalog` para aceitar qualquer domínio de parâmetros

**Por quê primeiro:** a Fase 1 do motor de perdas precisa da mesma infraestrutura visual de parâmetros/calibração já construída para `commercial-intelligence`, mas sem acoplar o novo motor ao tipo `CommercialParameters` (spec §4, §26 do pedido original). Isso é um refactor mecânico — os dois componentes atuais calculam tudo a partir de `CommercialParameters` importado direto; passam a receber os dados já resolvidos como props. Nenhuma mudança de comportamento visual.

**Files:**
- Read first (não modificar, só entender o padrão exato antes de generalizar): `frontend/apps/admin/src/components/commercial-intelligence/business-rules-sheet.tsx`, `frontend/apps/admin/src/components/commercial-intelligence/parameter-catalog.tsx`, `frontend/apps/admin/src/lib/commercial-intelligence/parameter-docs.ts`, `frontend/apps/admin/src/lib/commercial-intelligence/parameters.ts` (as funções `getParameter`, `formatParameterValue`, `envNameOf`, `isProvisional`, `PARAMETER_GROUP_LABELS`).
- Create: `frontend/apps/admin/src/components/business-rules-sheet.tsx` (genérico, domain-agnostic)
- Create: `frontend/apps/admin/src/components/parameter-catalog.tsx` (genérico)
- Create: `frontend/apps/admin/src/lib/commercial-intelligence/parameter-rows.ts` (mapeia `CommercialParameters` → as linhas genéricas)
- Modify: `frontend/apps/admin/src/app/(app)/commercial-intelligence/page.tsx` (usa `BusinessRulesSheet` genérico via `parameter-rows.ts`)
- Modify: `frontend/apps/admin/src/app/(app)/commercial-intelligence/calibration/page.tsx` (usa `ParameterCatalog` genérico via `parameter-rows.ts`)
- Delete: `frontend/apps/admin/src/components/commercial-intelligence/business-rules-sheet.tsx`
- Delete: `frontend/apps/admin/src/components/commercial-intelligence/parameter-catalog.tsx`
- Test: `frontend/apps/admin/src/components/business-rules-sheet.spec.tsx`, `frontend/apps/admin/src/components/parameter-catalog.spec.tsx`, `frontend/apps/admin/src/lib/commercial-intelligence/parameter-rows.spec.ts`

**Interfaces:**
- Produces (usado por todas as tasks de UI da Fase 1, Tasks 16-19): `ParameterRuleRow`, `ParameterKindSection`, `BusinessRulesSheet`, `ParameterCatalog` — assinaturas exatas abaixo.

- [ ] **Passo 1: ler os 4 arquivos listados acima por completo, sem pular nenhum, antes de escrever qualquer código.** Confirmar a assinatura exata de `getParameter(parameters, path)`, `formatParameterValue(path, value)`, `envNameOf(path)`, `isProvisional(path)`, `PARAMETER_KINDS: Record<ParameterKind, ParameterPath[]>`, `PARAMETER_GROUP_LABELS: Record<string, string>`, `KIND_LABELS: Record<ParameterKind, {title, description}>`, `PARAMETER_DOCS[path]: {label, controls, unit, min, max}`, `PARAMETER_EXTRA[path]: {kind, formula, why, usedIn, up, down}`. Esses nomes são os que existiam no momento em que esta spec foi escrita — se algo divergir, seguir o que o código real disser, não este plano.

- [ ] **Passo 2: criar o tipo de linha genérico e o componente `ParameterCatalog`.**

`frontend/apps/admin/src/components/parameter-catalog.tsx`:

```tsx
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
```

- [ ] **Passo 3: criar o componente `BusinessRulesSheet` genérico.**

`frontend/apps/admin/src/components/business-rules-sheet.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Landmark } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { ParameterRuleRow } from "@/components/parameter-catalog";

export interface BusinessRuleRow {
  path: string;
  label: string;
  formattedValue: string;
  controls: string;
  usedIn: string;
}

export function businessRuleRowFrom(row: ParameterRuleRow): BusinessRuleRow {
  return { path: row.path, label: row.label, formattedValue: row.formattedValue, controls: row.controls, usedIn: row.usedIn };
}

/**
 * The few decisions that belong to the company, shown read-only. They have one
 * value for the whole operation, so they are never a setting of this browser.
 * Domain-agnostic: the caller resolves its own parameter type into rows and
 * says where its own calibration page lives.
 */
export function BusinessRulesSheet({
  description,
  rows,
  calibrationHref,
}: {
  description: string;
  rows: BusinessRuleRow[];
  calibrationHref: string;
}) {
  const sorted = [...rows].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Landmark aria-hidden />
          Regras de negócio
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Regras de negócio</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          <p className="rounded-lg border border-warning/30 bg-warning/12 p-3 text-sm text-warning" role="note">
            O registro oficial destas regras — valor único, com permissão para editar e histórico de alterações — ainda não existe. Por ora vale o padrão da implantação, que não pode ser
            alterado pelo navegador para que ninguém receba recomendações diferentes de outra pessoa.
          </p>

          <ul className="flex flex-col">
            {sorted.map((row) => (
              <li key={row.path} className="flex flex-col gap-0.5 border-t py-3 first:border-t-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-sm font-medium">{row.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular text-sm font-semibold">{row.formattedValue}</span>
                    <StatusBadge tone="attention">padrão provisório</StatusBadge>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{row.controls}</p>
                <p className="text-xs text-muted-foreground">Fonte: padrão da implantação · {row.usedIn}</p>
              </li>
            ))}
          </ul>

          <p className="text-xs text-muted-foreground">
            Os critérios de qualidade dos dados e o modelo analítico não são decisões de negócio: ficam em{" "}
            <Link href={calibrationHref} className="underline underline-offset-2">
              Configurações avançadas / calibração
            </Link>
            , todos provisórios até a calibração com os meses reais.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Passo 4: criar `parameter-rows.ts`** — mapeia `CommercialParameters` para os tipos genéricos acima, usando exatamente as funções lidas no Passo 1.

`frontend/apps/admin/src/lib/commercial-intelligence/parameter-rows.ts`:

```ts
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
import { KIND_LABELS, PARAMETER_EXTRA, PARAMETER_KINDS, type ParameterKind } from "./parameter-docs";
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
```

- [ ] **Passo 5: atualizar os dois call sites.** Em `frontend/apps/admin/src/app/(app)/commercial-intelligence/page.tsx`, trocar `import { BusinessRulesSheet } from "@/components/commercial-intelligence/business-rules-sheet"` por `import { BusinessRulesSheet } from "@/components/business-rules-sheet"` e `import { commercialBusinessRuleRows } from "@/lib/commercial-intelligence/parameter-rows"`; trocar `<BusinessRulesSheet parameters={parameters} />` por `<BusinessRulesSheet description="Decisões da empresa que mudam o que a inteligência recomenda. Valem para toda a operação: não são ajustes deste navegador." rows={commercialBusinessRuleRows(parameters)} calibrationHref="/commercial-intelligence/calibration" />`. Em `calibration/page.tsx`, trocar o import de `ParameterCatalog` para `@/components/parameter-catalog` e `<ParameterCatalog parameters={parameters} defaults={DEFAULT_PARAMETERS} />` por `<ParameterCatalog sections={commercialParameterCatalogSections(parameters)} />` (importando `commercialParameterCatalogSections` de `parameter-rows.ts`).

- [ ] **Passo 6: apagar os dois arquivos antigos** (`components/commercial-intelligence/business-rules-sheet.tsx`, `components/commercial-intelligence/parameter-catalog.tsx`) e confirmar que nenhum outro arquivo os importa (`grep -rn "commercial-intelligence/business-rules-sheet\|commercial-intelligence/parameter-catalog" frontend/apps/admin/src`).

- [ ] **Passo 7: escrever os testes.** `parameter-rows.spec.ts` — cada path de `PARAMETER_PATHS` aparece em exatamente uma `ParameterKindSection` e, se `kind==="business"`, também em `commercialBusinessRuleRows`; `formattedValue`/`envName` batem com as funções originais para um path conhecido. `business-rules-sheet.spec.tsx`/`parameter-catalog.spec.tsx` — render com fixtures sintéticas de `rows`/`sections` (não import de `CommercialParameters` real), confirma que renderiza label/valor/badge "provisório" quando `isProvisional`.

- [ ] **Passo 8: rodar `pnpm --filter @agiliz/admin typecheck lint test` e `pnpm --filter @agiliz/admin build`.** A tela `/commercial-intelligence` e `/commercial-intelligence/calibration` devem continuar idênticas visualmente — nenhuma mudança de comportamento, só de onde o dado vem.

- [ ] **Passo 9: commit.**

```bash
git add frontend/apps/admin/src/components/business-rules-sheet.tsx frontend/apps/admin/src/components/parameter-catalog.tsx frontend/apps/admin/src/lib/commercial-intelligence/parameter-rows.ts frontend/apps/admin/src/app/\(app\)/commercial-intelligence/
git add -u frontend/apps/admin/src/components/commercial-intelligence/
git commit -m "refactor(admin): generalize BusinessRulesSheet and ParameterCatalog to accept any parameter domain via props

Prepares shared UI for the Loss Intelligence engine (Fase 1) without
coupling it to CommercialParameters — each domain now maps its own
parameter type into plain ParameterRuleRow/BusinessRuleRow props.
No visual or behavioral change to /commercial-intelligence.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 1: `types.ts` — contratos de entrada e saída do motor

**Files:**
- Create: `frontend/apps/admin/src/lib/loss-intelligence/types.ts`
- Test: `frontend/apps/admin/src/lib/loss-intelligence/types.smoke.spec.ts` (typecheck-only smoke test — não há lógica para testar em runtime, só confirma que os tipos compõem sem erro)

**Interfaces:**
- Produces: todo tipo usado pelas Tasks 2-19. Este é o único arquivo que as outras tasks importam para tipos — nenhuma delas redeclara nada aqui.

- [ ] **Passo 1: escrever `types.ts` por completo.**

```ts
/**
 * Contratos do motor de Loss Intelligence (Fase 1). Ver
 * docs/superpowers/specs/2026-09-21-loss-intelligence-agent-phase-1-design.md
 * §6, §7, §13 — este arquivo é a tradução literal dessas seções para TypeScript.
 */

export type Period = string; // "YYYY-MM"

export type LossReason = "expired" | "damaged_product" | "other_reason";

export const LOSS_REASONS: LossReason[] = ["expired", "damaged_product", "other_reason"];

export type LossAction =
  | "manter"
  | "manter_monitorar"
  | "reduzir_abastecimento"
  | "investigar"
  | "suspender_abastecimento"
  | "avaliar_retirada_loja"
  | "avaliar_retirada_rede"
  | "avaliar_permanencia_loja"
  | "avaliar_permanencia_rede"
  | "dados_insuficientes";

/** Ordem de severidade, da mais para a menos grave — índice 0 é a mais severa. Espelha spec §11.2 passo 2. */
export const ACTION_SEVERITY_ORDER: LossAction[] = [
  "avaliar_retirada_rede",
  "avaliar_permanencia_rede",
  "avaliar_retirada_loja",
  "avaliar_permanencia_loja",
  "suspender_abastecimento",
  "reduzir_abastecimento",
  "investigar",
  "manter_monitorar",
  "manter",
  "dados_insuficientes",
];

export type InterventionPotential = "alto" | "medio" | "baixo";

/** Ordem para comparação ordinal — nunca numérica (spec §11.2). */
export const INTERVENTION_POTENTIAL_ORDER: InterventionPotential[] = ["alto", "medio", "baixo"];

export type Confidence = "alta" | "media" | "baixa" | "insuficiente";
export type Priority = "critica" | "alta" | "media" | "baixa";

// ---- Fontes de dado (formas mínimas que o motor precisa — a origem real, mais rica, é responsabilidade do caller) ----

export interface LossByReasonSkuRow {
  reason: string;
  sku: string;
  quantity: number;
  value_cents: number;
}

export interface ReconciliationInput {
  store_id: number;
  period: Period;
  loss_by_reason_sku: LossByReasonSkuRow[];
}

export interface SalesRecordInput {
  store_id: number;
  period: Period;
  sku: string;
  quantity_sold: number;
  revenue_cents: number;
}

export interface SupplyRecordInput {
  store_id: number;
  period: Period;
  sku: string;
  quantity_restocked: number;
}

export interface StoreInput {
  id: number;
  name: string;
}

// ---- Contrato de entrada (spec §6) ----

export interface LossIntelligenceInput {
  reconciliations: ReconciliationInput[];
  salesByStorePeriodSku: SalesRecordInput[];
  supplyByStorePeriodSku: SupplyRecordInput[];
  /** Custo datado — null quando o custo não é conhecido naquele período (nunca assumir zero). */
  costsBySkuAsOf: (sku: string, asOfPeriod: Period) => number | null;
  stores: StoreInput[];
  /** YYYY-MM-DD — decide qual período é "em andamento" (spec §8). */
  today: string;
  parameters: import("./parameters").LossIntelligenceParameters;
}

// ---- Métricas observadas (spec §7) ----

export interface PerReasonMetrics {
  qtyLost: number;
  valueLostCents: number;
  lossToSupplyRatio: number | null;
  lossToRevenueRatio: number | null;
  lossToMarginRatio: number | null;
}

export interface LossMetrics {
  qtyRestocked: number;
  qtySold: number;
  revenueCents: number;
  /** null = custo desconhecido para ao menos uma venda do período — nunca assume zero. */
  grossMarginCents: number | null;
  /** Só para exibição — nunca reentra como denominador de outra métrica (spec §7). */
  netMarginAfterLossCents: number | null;
  /** null quando qtyRestocked = 0 — indefinido, nunca chamado de "sell-through". */
  saleToSupplyRatio: number | null;
  monthsWithRestock: number;
  monthsWithSales: number;
  monthsAnalyzed: number;
  firstSeenPeriod: Period | null;
  monthsSinceFirstSeen: number | null;
  byReason: Record<LossReason, PerReasonMetrics>;
}

// ---- Janela temporal (spec §8) ----

export interface AnalysisWindow {
  storeId: number;
  sku: string;
  /** Períodos fechados dentro da janela principal, do mais antigo ao mais recente. */
  primaryClosedPeriods: Period[];
  /** Igual a primaryClosedPeriods, exceto o mais recente — a não ser que esse seja o único abastecimento de todo o histórico (spec §8). */
  qualifyingRestockPeriods: Period[];
  /** Período em andamento, se existir dentro da janela — nunca decide uma ação estrutural sozinho. */
  currentInProgressPeriod: Period | null;
  /** Períodos fechados do lookback de recorrência (mais longo que a janela principal). */
  recurrenceLookbackPeriods: Period[];
}

// ---- Comparação com a rede (spec §12) ----

export interface NetworkComparisonResult {
  storesCarryingSku: number;
  storesWithSameSignal: number;
  affectedShare: number;
  storesHealthy: string[];
}

export type NetworkComparison = NetworkComparisonResult | "dado_insuficiente";

// ---- Diagnóstico por motivo (spec §10, §13) ----

export interface ReasonDiagnosis {
  reason: LossReason;
  metrics: PerReasonMetrics;
  sinaisDetectados: string[];
  regrasAcionadas: string[];
  acao: LossAction;
  /** null quando acao === "dados_insuficientes". Nunca uma fórmula cross-motivo (spec §11.2). */
  potencialIntervencao: InterventionPotential | null;
  /** Só quando a árvore gera hipótese não-afirmada (hoje só danificado, §10.3). */
  hipoteses: string[];
}

// ---- Saída consolidada (spec §11, §13) ----

export interface LossIntelligenceRecommendation {
  sku: string;
  storeId: number;
  janelaAnalisada: { primaryMonths: Period[]; recurrenceLookbackMonths: Period[] };

  metricasObservadas: LossMetrics;
  diagnosticosPorMotivo: ReasonDiagnosis[];

  maiorImpactoFinanceiroMotivo: LossReason | null;
  maiorImpactoFinanceiroValueCents: number;

  motivoDiagnosticoPrioritario: LossReason | null;
  motivosSecundarios: LossReason[];

  acaoPrioritaria: LossAction;
  acoesSecundarias: LossAction[];

  sinaisTransversais: string[];

  prioridade: Priority | null; // null quando acaoPrioritaria === "dados_insuficientes"
  confianca: Confidence;

  comparacaoRede: Record<LossReason, NetworkComparison>;

  limitacoesDosDados: string[];
  firstSeenRecently: boolean;

  versaoMotor: string;
  versaoParametros: string;
}

export interface LossIntelligenceResult {
  recommendations: LossIntelligenceRecommendation[];
  /** Contagem por acaoPrioritaria — base do painel §15.1. */
  countsByAction: Record<LossAction, number>;
  impactEstimateCents: { conservative: number; expected: number; optimistic: number };
}
```

- [ ] **Passo 2: escrever o smoke test.**

```ts
import type { LossIntelligenceInput, LossIntelligenceRecommendation, LossAction } from "./types";
import { ACTION_SEVERITY_ORDER, INTERVENTION_POTENTIAL_ORDER, LOSS_REASONS } from "./types";

describe("loss-intelligence types", () => {
  it("ACTION_SEVERITY_ORDER contains every LossAction exactly once", () => {
    const all: LossAction[] = [
      "manter", "manter_monitorar", "reduzir_abastecimento", "investigar", "suspender_abastecimento",
      "avaliar_retirada_loja", "avaliar_retirada_rede", "avaliar_permanencia_loja", "avaliar_permanencia_rede", "dados_insuficientes",
    ];
    expect([...ACTION_SEVERITY_ORDER].sort()).toEqual([...all].sort());
    expect(ACTION_SEVERITY_ORDER).toHaveLength(all.length);
  });

  it("avaliar_retirada_* sorts above avaliar_permanencia_* within the same scope", () => {
    const rank = (a: LossAction) => ACTION_SEVERITY_ORDER.indexOf(a);
    expect(rank("avaliar_retirada_rede")).toBeLessThan(rank("avaliar_permanencia_rede"));
    expect(rank("avaliar_retirada_loja")).toBeLessThan(rank("avaliar_permanencia_loja"));
  });

  it("INTERVENTION_POTENTIAL_ORDER is alto > medio > baixo", () => {
    expect(INTERVENTION_POTENTIAL_ORDER).toEqual(["alto", "medio", "baixo"]);
  });

  it("LOSS_REASONS has exactly the three backend-observable reasons", () => {
    expect(LOSS_REASONS).toEqual(["expired", "damaged_product", "other_reason"]);
  });
});
```

- [ ] **Passo 3: `pnpm --filter @agiliz/admin typecheck` e `pnpm --filter @agiliz/admin test -- types.smoke.spec.ts`.**

- [ ] **Passo 4: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/types.ts frontend/apps/admin/src/lib/loss-intelligence/types.smoke.spec.ts
git commit -m "feat(admin): add Loss Intelligence engine type contracts (Fase 1)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `parameters.ts` + `parameter-docs.ts` + `env.ts` — os 20 thresholds provisórios (spec §14)

**Files:**
- Create: `frontend/apps/admin/src/lib/loss-intelligence/parameters.ts`
- Create: `frontend/apps/admin/src/lib/loss-intelligence/parameter-docs.ts`
- Create: `frontend/apps/admin/src/lib/loss-intelligence/env.ts`
- Test: `frontend/apps/admin/src/lib/loss-intelligence/parameters.spec.ts`

**Interfaces:**
- Consumes: nada (folha da árvore de dependências, junto com `types.ts`).
- Produces: `LossIntelligenceParameters`, `parametersFromEnv`, `getParameter`, `formatParameterValue`, `envNameOf`, `isProvisional`, `PARAMETER_DOCS`, `PARAMETER_PATHS`, `DEFAULT_PARAMETERS` — usado por toda árvore de diagnóstico (Tasks 6-10) e pela UI de calibração (Task 19).

- [ ] **Passo 1: escrever `parameter-docs.ts`** com os 20 parâmetros do spec §14, cada um com kind/formula/numerador/denominador/unidade/janela/motivo/controla/efeitos/comportamento-se-ausente/limites.

```ts
export type ParameterKind = "business" | "quality" | "analytic";
export type ParameterUnit = "share" | "ratio" | "count" | "months" | "cents" | "number";

export interface ParameterDoc {
  label: string;
  kind: ParameterKind;
  /** null quando o parâmetro não é uma razão calculada (ex.: uma contagem de meses). */
  formula: string | null;
  numerator: string;
  denominator: string;
  unit: ParameterUnit;
  window: string | null;
  why: string;
  controls: string;
  up: string;
  down: string;
  whenMissing: string;
  min: number;
  max: number;
  integer: boolean;
}

const d = (doc: ParameterDoc): ParameterDoc => doc;

export const PARAMETER_DOCS = {
  "window.primaryWindowMonths": d({
    label: "Janela principal (meses)",
    kind: "analytic",
    formula: null,
    numerator: "—",
    denominator: "—",
    unit: "months",
    window: null,
    why: "3 meses fechados equilibra reação a padrões recentes com ruído de mês isolado — valor de julgamento, a calibrar.",
    controls: "Quantos períodos fechados entram no cálculo de todas as métricas primárias (§7).",
    up: "Menos ruído, reage mais devagar a mudanças recentes.",
    down: "Mais reativo, mais sujeito a ruído de um mês isolado.",
    whenMissing: "Usa quantos meses fechados existirem, se menos que o valor configurado.",
    min: 1,
    max: 12,
    integer: true,
  }),
  "window.recurrenceLookbackMonths": d({
    label: "Janela de recorrência (meses)",
    kind: "analytic",
    formula: null,
    numerator: "—",
    denominator: "—",
    unit: "months",
    window: null,
    why: "6 meses dá margem para ver um padrão se repetir 2-3 vezes sem esperar o histórico inteiro.",
    controls: "Quantos períodos fechados entram no cálculo de recorrência (§10, §16), sem mudar a janela principal.",
    up: "Detecta padrões mais longos, mas mistura períodos mais antigos.",
    down: "Perde recorrência de médio prazo.",
    whenMissing: "Usa quantos meses fechados existirem, se menos que o valor configurado.",
    min: 2,
    max: 24,
    integer: true,
  }),
  "validity.minRepeatedSupplyMonths": d({
    label: "Validade: meses de abastecimento repetido",
    kind: "analytic",
    formula: null,
    numerator: "—",
    denominator: "—",
    unit: "months",
    window: "janela principal",
    why: "2 meses evita marcar como padrão um único abastecimento isolado.",
    controls: "Caso A de validade (§10.1) — zero venda + validade só dispara com abastecimento repetido.",
    up: "Exige mais repetição antes de recomendar suspender.",
    down: "Suspende mais cedo, com menos repetição observada.",
    whenMissing: "—",
    min: 1,
    max: 6,
    integer: true,
  }),
  "validity.lowSaleRatio": d({
    label: "Validade: taxa vendido/abastecido baixa",
    kind: "analytic",
    formula: "vendido ÷ abastecido",
    numerator: "quantidade vendida na janela",
    denominator: "quantidade abastecida na janela",
    unit: "share",
    window: "janela principal",
    why: "Abaixo de 50% do abastecido vendido é o corte inicial de julgamento entre demanda saudável e possível excesso de envio.",
    controls: "Separa o caso B (reduzir) do caso C (manter+monitorar) em validade (§10.1).",
    up: "Mais produtos são classificados como excesso de abastecimento.",
    down: "Menos produtos são classificados como excesso.",
    whenMissing: "Indefinida se abastecido = 0 na janela.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "validity.localOutlierMaxShare": d({
    label: "Validade: teto de lojas afetadas para outlier local",
    kind: "analytic",
    formula: "lojas com o mesmo sinal ruim ÷ lojas comparáveis",
    numerator: "lojas com o mesmo sinal de validade",
    denominator: "lojas onde o SKU é comparável (§12)",
    unit: "share",
    window: "janela principal",
    why: "Até 30% das lojas com o mesmo problema ainda é consistente com 'só esta loja tem o problema'.",
    controls: "Caso D de validade (§10.1) — escala suspender/reduzir para avaliar retirada da loja.",
    up: "Mais difícil escalar para retirada da loja (exige que a rede pareça mais saudável).",
    down: "Mais fácil escalar para retirada da loja.",
    whenMissing: "Usa dado_insuficiente de §12 — sem comparação de rede, nunca escala.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "validity.networkWideMinShare": d({
    label: "Validade: piso de lojas afetadas para problema de rede",
    kind: "analytic",
    formula: "lojas com o mesmo sinal ruim ÷ lojas comparáveis",
    numerator: "lojas com o mesmo sinal de validade",
    denominator: "lojas onde o SKU é comparável (§12)",
    unit: "share",
    window: "janela principal",
    why: "70%+ das lojas com o mesmo problema já é evidência de que o problema é do produto, não da loja.",
    controls: "Caso E de validade (§10.1) — escala para avaliar retirada da rede.",
    up: "Mais difícil escalar para retirada da rede.",
    down: "Mais fácil escalar para retirada da rede.",
    whenMissing: "Usa dado_insuficiente de §12 — sem comparação de rede, nunca escala.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "network.minStoresForNetworkVerdict": d({
    label: "Mínimo de lojas para veredito de rede",
    kind: "quality",
    formula: null,
    numerator: "—",
    denominator: "—",
    unit: "count",
    window: "janela principal",
    why: "Menos de 5 lojas comparáveis não sustenta uma conclusão sobre 'a rede' — vira opinião sobre um punhado de casos.",
    controls: "Habilita ou desabilita a comparação de rede (§12) para qualquer motivo.",
    up: "Exige mais lojas antes de confiar numa comparação de rede.",
    down: "Compara com poucas lojas — menos confiável.",
    whenMissing: "Abaixo do mínimo, a comparação de rede fica dado_insuficiente.",
    min: 2,
    max: 50,
    integer: true,
  }),
  "otherReason.minHealthyUnits": d({
    label: "Outro motivo: unidades vendidas para 'saudável'",
    kind: "analytic",
    formula: null,
    numerator: "—",
    denominator: "—",
    unit: "count",
    window: "janela principal",
    why: "20 unidades vendidas na janela é o piso de julgamento para considerar o produto comercialmente relevante nesta loja.",
    controls: "Condição de 'saudável' em §10.2 — sem isso, o produto nunca chega em manter/manter+monitorar por esta via.",
    up: "Mais exigente para considerar o produto saudável.",
    down: "Menos exigente.",
    whenMissing: "—",
    min: 0,
    max: 1000,
    integer: true,
  }),
  "otherReason.viabilityMaxRatio": d({
    label: "Outro motivo: perda tolerável sobre a margem",
    kind: "business",
    formula: "perda R$ ÷ margem bruta R$",
    numerator: "valor perdido em Outro motivo na janela",
    denominator: "margem bruta gerada pelo SKU nesta loja na janela",
    unit: "share",
    window: "janela principal",
    why: "Decisão de negócio: até que ponto a perda pode comer a margem gerada antes de a permanência do SKU precisar ser revista. 30% é o piso inicial de julgamento.",
    controls: "Corte do caso 'severo e recorrente' em §10.2 — acima disso, e recorrente, aciona avaliar permanência.",
    up: "Tolera mais perda antes de sugerir avaliar permanência.",
    down: "Sugere avaliar permanência com menos perda relativa.",
    whenMissing: "dados_insuficientes se margem bruta desconhecida — nunca assume margem.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "otherReason.negligibleValueCents": d({
    label: "Outro motivo: perda desprezível",
    kind: "business",
    formula: null,
    numerator: "—",
    denominator: "—",
    unit: "cents",
    window: "janela principal",
    why: "Decisão de negócio: abaixo de R$50 na janela, a perda não justifica sequer investigar.",
    controls: "Caso 'impacto desprezível' em §10.2 — mantém sem gerar ruído de investigação para valores pequenos.",
    up: "Mais casos viram 'manter' sem investigação.",
    down: "Mais casos entram na análise de recorrência/concentração.",
    whenMissing: "—",
    min: 0,
    max: 1000000,
    integer: true,
  }),
  "otherReason.localConcentrationMin": d({
    label: "Outro motivo: concentração numa loja",
    kind: "analytic",
    formula: "perda em Outro motivo nesta loja ÷ perda em Outro motivo do SKU em toda a rede",
    numerator: "valor perdido nesta loja",
    denominator: "valor perdido pelo SKU na rede inteira",
    unit: "share",
    window: "janela principal",
    why: "70% concentrado numa loja é o mesmo corte usado para dano (§10.3) — consistência entre as duas árvores que usam concentração.",
    controls: "Separa o caso 'recorrente ou concentrado' (investigar) do caso saudável isolado em §10.2.",
    up: "Mais exigente para afirmar concentração.",
    down: "Mais fácil afirmar concentração.",
    whenMissing: "Precisa do mesmo mínimo de lojas de network.minStoresForNetworkVerdict para ter significado.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "otherReason.minRecurringPeriods": d({
    label: "Outro motivo: períodos para 'severo e recorrente'",
    kind: "analytic",
    formula: null,
    numerator: "—",
    denominator: "—",
    unit: "months",
    window: "lookback de recorrência",
    why: "3 períodos com perda é o piso de julgamento para 'recorrente', consistente com o resto do motor.",
    controls: "Corte de recorrência do caso severo em §10.2 — sem isso, nunca aciona avaliar permanência.",
    up: "Exige mais repetição antes de avaliar permanência.",
    down: "Reage mais cedo.",
    whenMissing: "—",
    min: 1,
    max: 12,
    integer: true,
  }),
  "damage.localConcentrationMin": d({
    label: "Danificado: concentração numa loja",
    kind: "analytic",
    formula: "dano nesta loja ÷ dano do SKU em toda a rede",
    numerator: "unidades danificadas nesta loja",
    denominator: "unidades danificadas do SKU na rede inteira",
    unit: "share",
    window: "janela principal",
    why: "70% concentrado numa loja é evidência de causa provavelmente localizável (manuseio/armazenamento desta unidade).",
    controls: "Separa 'concentrado local' de 'espalhado na rede' em §10.3.",
    up: "Mais exigente para afirmar concentração local.",
    down: "Mais fácil afirmar concentração local.",
    whenMissing: "—",
    min: 0,
    max: 1,
    integer: false,
  }),
  "damage.minStoresCarryingForConcentration": d({
    label: "Danificado: mínimo de lojas para calcular concentração",
    kind: "quality",
    formula: null,
    numerator: "—",
    denominator: "—",
    unit: "count",
    window: "janela principal",
    why: "Com menos de 3 lojas carregando o SKU, 'concentração' não tem significado estatístico.",
    controls: "Habilita o cálculo de concentração em §10.3 — abaixo disso, dados insuficientes.",
    up: "Exige mais lojas antes de calcular concentração.",
    down: "Calcula com menos lojas — menos confiável.",
    whenMissing: "Abaixo do mínimo, dados_insuficientes.",
    min: 1,
    max: 50,
    integer: true,
  }),
  "damage.minStoresForSystemic": d({
    label: "Danificado: mínimo de lojas para problema sistêmico",
    kind: "analytic",
    formula: null,
    numerator: "—",
    denominator: "—",
    unit: "count",
    window: "janela principal",
    why: "4 lojas com dano recorrente e não-concentrado sustenta 'sistêmico' melhor que o mínimo de concentração — precisa ser igual ou maior.",
    controls: "Caso 'espalhado na rede' em §10.3.",
    up: "Mais exigente para afirmar problema sistêmico.",
    down: "Mais fácil afirmar.",
    whenMissing: "—",
    min: 1,
    max: 50,
    integer: true,
  }),
  "unnecessarySupply.verylowSaleRatio": d({
    label: "Abastecimento sem sentido: taxa vendido/abastecido baixíssima",
    kind: "analytic",
    formula: "vendido ÷ abastecido",
    numerator: "quantidade vendida na janela",
    denominator: "quantidade abastecida na janela",
    unit: "share",
    window: "janela principal",
    why: "15% é mais restrito que o corte de 'reduzir' de validade (50%) — este detector é para casos mais extremos, de prioridade alta.",
    controls: "Padrão 'zero/baixíssima venda + perda de validade' em §10.4.",
    up: "Menos casos disparam o detector.",
    down: "Mais casos disparam o detector.",
    whenMissing: "Indefinida se abastecido = 0.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "recentHistory.minClosedMonths": d({
    label: "Histórico recente: meses mínimos",
    kind: "quality",
    formula: null,
    numerator: "—",
    denominator: "—",
    unit: "months",
    window: null,
    why: "Menos de 2 meses fechados desde a primeira aparição não sustenta uma decisão estrutural sobre o SKU nesta loja.",
    controls: "Liga/desliga firstSeenRecently (§9) — modo protegido contra decisões prematuras.",
    up: "Protege por mais tempo.",
    down: "Protege por menos tempo.",
    whenMissing: "—",
    min: 0,
    max: 12,
    integer: true,
  }),
  "recentHistory.minUnits": d({
    label: "Histórico recente: unidades mínimas abastecidas",
    kind: "quality",
    formula: null,
    numerator: "—",
    denominator: "—",
    unit: "count",
    window: null,
    why: "Menos de 15 unidades abastecidas desde a primeira aparição é amostra pequena demais para conclusão estrutural.",
    controls: "Liga/desliga firstSeenRecently (§9), junto com o critério de meses.",
    up: "Protege por mais tempo.",
    down: "Protege por menos tempo.",
    whenMissing: "—",
    min: 0,
    max: 1000,
    integer: true,
  }),
  "priority.criticalValueCents": d({
    label: "Prioridade: valor perdido para Crítica",
    kind: "business",
    formula: null,
    numerator: "—",
    denominator: "—",
    unit: "cents",
    window: "janela principal",
    why: "Decisão de negócio: R$300 perdidos na janela, pelo motivo do diagnóstico prioritário, é o piso de julgamento para prioridade Crítica.",
    controls: "Corte Crítica vs Alta em §16.",
    up: "Menos casos viram Crítica.",
    down: "Mais casos viram Crítica.",
    whenMissing: "Não bloqueia — é valor de perda já valorado por finance-service, não depende de custo datado.",
    min: 0,
    max: 100000000,
    integer: true,
  }),
  "confidence.minMonthsForHigh": d({
    label: "Confiança: meses mínimos para Alta",
    kind: "quality",
    formula: null,
    numerator: "—",
    denominator: "—",
    unit: "months",
    window: "janela principal",
    why: "3 períodos qualificáveis sem contradição é o piso de julgamento para confiança Alta.",
    controls: "Corte Alta vs Média em §17.",
    up: "Mais exigente para confiança Alta.",
    down: "Menos exigente.",
    whenMissing: "—",
    min: 1,
    max: 12,
    integer: true,
  }),
} as const;

export type ParameterPath = keyof typeof PARAMETER_DOCS;

export const PARAMETER_PATHS = Object.keys(PARAMETER_DOCS) as ParameterPath[];

export const PARAMETER_KINDS: Record<ParameterKind, ParameterPath[]> = {
  business: PARAMETER_PATHS.filter((p) => PARAMETER_DOCS[p].kind === "business"),
  quality: PARAMETER_PATHS.filter((p) => PARAMETER_DOCS[p].kind === "quality"),
  analytic: PARAMETER_PATHS.filter((p) => PARAMETER_DOCS[p].kind === "analytic"),
};

export const KIND_LABELS: Record<ParameterKind, { title: string; description: string }> = {
  business: { title: "Regras de negócio", description: "Decisões da empresa — poucas, editáveis pelo gestor quando o registro oficial existir." },
  quality: { title: "Critérios de qualidade dos dados", description: "Decidem se há evidência suficiente para uma conclusão — nunca um ajuste de negócio." },
  analytic: { title: "Modelo analítico", description: "Como o motor de perdas classifica, prioriza e compara com a rede." },
};

export const PARAMETER_GROUP_LABELS: Record<string, string> = {
  window: "Janela de análise",
  validity: "Validade",
  network: "Comparação com a rede",
  otherReason: "Outro motivo",
  damage: "Danificado",
  unnecessarySupply: "Abastecimento sem sentido",
  recentHistory: "Histórico recente",
  priority: "Prioridade",
  confidence: "Confiança",
};
```

- [ ] **Passo 2: escrever `env.ts`.**

```ts
/**
 * The only place this module reads the environment. Next inlines a
 * NEXT_PUBLIC_* variable only where written literally — see the equivalent
 * note in commercial-intelligence/env.ts, same reasoning here.
 */
export function readLossIntelligencePublicEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_LI_WINDOW_PRIMARY_WINDOW_MONTHS: process.env.NEXT_PUBLIC_LI_WINDOW_PRIMARY_WINDOW_MONTHS,
    NEXT_PUBLIC_LI_WINDOW_RECURRENCE_LOOKBACK_MONTHS: process.env.NEXT_PUBLIC_LI_WINDOW_RECURRENCE_LOOKBACK_MONTHS,
    NEXT_PUBLIC_LI_VALIDITY_MIN_REPEATED_SUPPLY_MONTHS: process.env.NEXT_PUBLIC_LI_VALIDITY_MIN_REPEATED_SUPPLY_MONTHS,
    NEXT_PUBLIC_LI_VALIDITY_LOW_SALE_RATIO: process.env.NEXT_PUBLIC_LI_VALIDITY_LOW_SALE_RATIO,
    NEXT_PUBLIC_LI_VALIDITY_LOCAL_OUTLIER_MAX_SHARE: process.env.NEXT_PUBLIC_LI_VALIDITY_LOCAL_OUTLIER_MAX_SHARE,
    NEXT_PUBLIC_LI_VALIDITY_NETWORK_WIDE_MIN_SHARE: process.env.NEXT_PUBLIC_LI_VALIDITY_NETWORK_WIDE_MIN_SHARE,
    NEXT_PUBLIC_LI_NETWORK_MIN_STORES_FOR_NETWORK_VERDICT: process.env.NEXT_PUBLIC_LI_NETWORK_MIN_STORES_FOR_NETWORK_VERDICT,
    NEXT_PUBLIC_LI_OTHER_REASON_MIN_HEALTHY_UNITS: process.env.NEXT_PUBLIC_LI_OTHER_REASON_MIN_HEALTHY_UNITS,
    NEXT_PUBLIC_LI_OTHER_REASON_VIABILITY_MAX_RATIO: process.env.NEXT_PUBLIC_LI_OTHER_REASON_VIABILITY_MAX_RATIO,
    NEXT_PUBLIC_LI_OTHER_REASON_NEGLIGIBLE_VALUE_CENTS: process.env.NEXT_PUBLIC_LI_OTHER_REASON_NEGLIGIBLE_VALUE_CENTS,
    NEXT_PUBLIC_LI_OTHER_REASON_LOCAL_CONCENTRATION_MIN: process.env.NEXT_PUBLIC_LI_OTHER_REASON_LOCAL_CONCENTRATION_MIN,
    NEXT_PUBLIC_LI_OTHER_REASON_MIN_RECURRING_PERIODS: process.env.NEXT_PUBLIC_LI_OTHER_REASON_MIN_RECURRING_PERIODS,
    NEXT_PUBLIC_LI_DAMAGE_LOCAL_CONCENTRATION_MIN: process.env.NEXT_PUBLIC_LI_DAMAGE_LOCAL_CONCENTRATION_MIN,
    NEXT_PUBLIC_LI_DAMAGE_MIN_STORES_CARRYING_FOR_CONCENTRATION: process.env.NEXT_PUBLIC_LI_DAMAGE_MIN_STORES_CARRYING_FOR_CONCENTRATION,
    NEXT_PUBLIC_LI_DAMAGE_MIN_STORES_FOR_SYSTEMIC: process.env.NEXT_PUBLIC_LI_DAMAGE_MIN_STORES_FOR_SYSTEMIC,
    NEXT_PUBLIC_LI_UNNECESSARY_SUPPLY_VERYLOW_SALE_RATIO: process.env.NEXT_PUBLIC_LI_UNNECESSARY_SUPPLY_VERYLOW_SALE_RATIO,
    NEXT_PUBLIC_LI_RECENT_HISTORY_MIN_CLOSED_MONTHS: process.env.NEXT_PUBLIC_LI_RECENT_HISTORY_MIN_CLOSED_MONTHS,
    NEXT_PUBLIC_LI_RECENT_HISTORY_MIN_UNITS: process.env.NEXT_PUBLIC_LI_RECENT_HISTORY_MIN_UNITS,
    NEXT_PUBLIC_LI_PRIORITY_CRITICAL_VALUE_CENTS: process.env.NEXT_PUBLIC_LI_PRIORITY_CRITICAL_VALUE_CENTS,
    NEXT_PUBLIC_LI_CONFIDENCE_MIN_MONTHS_FOR_HIGH: process.env.NEXT_PUBLIC_LI_CONFIDENCE_MIN_MONTHS_FOR_HIGH,
  };
}
```

- [ ] **Passo 3: escrever `parameters.ts`** — `LossIntelligenceParameters`, os defaults, `getParameter`/`withParameter` (percorrem o path com split simples, sem mapped type genérico — deliberado, ver spec §26 "não conceitualmente acoplado a `CommercialParameters`"), `envNameOf`, `parametersFromEnv` com validação de limites e o par ordenado `validity.localOutlierMaxShare ≤ validity.networkWideMinShare` mais `damage.minStoresCarryingForConcentration ≤ damage.minStoresForSystemic`.

```ts
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
  return `NEXT_PUBLIC_LI_${path.toUpperCase().replace(/\./g, "_").replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`;
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
```

- [ ] **Passo 4: escrever `parameters.spec.ts`.** Cobrir: `getParameter`/`withParameter` roundtrip para todos os 20 paths; `envNameOf` produz o nome esperado para pelo menos 3 paths conhecidos (ex.: `window.primaryWindowMonths` → `NEXT_PUBLIC_LI_WINDOW_PRIMARY_WINDOW_MONTHS`); `parametersFromEnv` aplica um override válido, ignora um valor fora dos limites (com warning), ignora um valor não-numérico; `enforceOrder` restaura os dois pares quando violados, com warning; `PARAMETER_KINDS` particiona os 20 paths sem sobra nem repetição; todo path em `PARAMETER_PATHS` tem entrada em `DEFAULT_PARAMETERS` (roundtrip via `getParameter`, nunca `undefined`).

- [ ] **Passo 5: `pnpm --filter @agiliz/admin typecheck lint test`.**

- [ ] **Passo 6: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/parameters.ts frontend/apps/admin/src/lib/loss-intelligence/parameter-docs.ts frontend/apps/admin/src/lib/loss-intelligence/env.ts frontend/apps/admin/src/lib/loss-intelligence/parameters.spec.ts
git commit -m "feat(admin): add the 20 provisional Loss Intelligence thresholds (Fase 1)

Own namespace (loss.*, NEXT_PUBLIC_LI_*), not coupled to
CommercialParameters — per spec §14/§26.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `temporal.ts` — janela, período fechado/em andamento, borda (spec §8)

**Files:**
- Create: `frontend/apps/admin/src/lib/loss-intelligence/temporal.ts`
- Test: `frontend/apps/admin/src/lib/loss-intelligence/temporal.spec.ts`

**Interfaces:**
- Consumes: `Period`, `AnalysisWindow`, `LossIntelligenceParameters` (Tasks 1-2).
- Produces: `resolveAnalysisWindow`, `periodOf`, `addMonths` — usado por `metrics.ts` (Task 4) e `engine.ts` (Task 15).

- [ ] **Passo 1: escrever `temporal.ts`.**

```ts
import type { AnalysisWindow, Period } from "./types";
import type { LossIntelligenceParameters } from "./parameters";

export function periodOf(dateISO: string): Period {
  return dateISO.slice(0, 7);
}

export function addMonths(period: Period, delta: number): Period {
  const [y, m] = period.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const newY = Math.floor(total / 12);
  const newM = (total % 12) + 1;
  return `${newY}-${String(newM).padStart(2, "0")}`;
}

function lastNClosedPeriods(currentPeriod: Period, n: number): Period[] {
  const periods: Period[] = [];
  for (let i = n; i >= 1; i--) periods.push(addMonths(currentPeriod, -i));
  return periods;
}

export interface ResolveWindowInput {
  storeId: number;
  sku: string;
  /** YYYY-MM-DD. */
  today: string;
  /** Períodos (todo o histórico disponível, não só a janela) com quantity_restocked > 0 para esta loja×SKU. */
  allKnownRestockPeriods: Period[];
  parameters: LossIntelligenceParameters;
}

/**
 * Resolve a janela de análise (spec §8). O mês corrente nunca entra em
 * qualifyingRestockPeriods e nunca sozinho decide uma ação estrutural — ver
 * a Global Constraint correspondente e o uso em unnecessary-supply.ts /
 * diagnosis/*.ts (Tasks 7-10), que devem consumir qualifyingRestockPeriods
 * para qualquer condição de "abasteceu e não vendeu", nunca primaryClosedPeriods
 * direto.
 */
export function resolveAnalysisWindow(input: ResolveWindowInput): AnalysisWindow {
  const currentPeriod = periodOf(input.today);
  const primaryClosedPeriods = lastNClosedPeriods(currentPeriod, input.parameters.window.primaryWindowMonths);
  const recurrenceLookbackPeriods = lastNClosedPeriods(currentPeriod, input.parameters.window.recurrenceLookbackMonths);

  const mostRecent = primaryClosedPeriods[primaryClosedPeriods.length - 1];
  const isOnlyRestockEver = input.allKnownRestockPeriods.length === 1 && input.allKnownRestockPeriods[0] === mostRecent;
  const qualifyingRestockPeriods = primaryClosedPeriods.length === 0 || isOnlyRestockEver ? primaryClosedPeriods : primaryClosedPeriods.slice(0, -1);

  return {
    storeId: input.storeId,
    sku: input.sku,
    primaryClosedPeriods,
    qualifyingRestockPeriods,
    currentInProgressPeriod: currentPeriod,
    recurrenceLookbackPeriods,
  };
}
```

- [ ] **Passo 2: escrever `temporal.spec.ts`.** Casos: `addMonths` cruza virada de ano nos dois sentidos (`addMonths("2026-01", -1) === "2025-12"`, `addMonths("2025-12", 1) === "2026-01"`); `resolveAnalysisWindow` com janela de 3 meses e `today="2026-09-15"` produz `primaryClosedPeriods=["2026-06","2026-07","2026-08"]` e `currentInProgressPeriod="2026-09"`; `qualifyingRestockPeriods` exclui agosto por padrão; caso do SKU com um único abastecimento em toda a história, exatamente em agosto (o mais recente) — `qualifyingRestockPeriods` mantém os 3 meses inteiros (spec §8, exceção de histórico recente); janela com `primaryWindowMonths=1` produz `qualifyingRestockPeriods=[]` quando o único período também é o mais recente e não é exceção.

- [ ] **Passo 3: `pnpm --filter @agiliz/admin typecheck lint test`.**

- [ ] **Passo 4: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/temporal.ts frontend/apps/admin/src/lib/loss-intelligence/temporal.spec.ts
git commit -m "feat(admin): add Loss Intelligence temporal window resolution (Fase 1, spec §8)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `metrics.ts` — as métricas observadas (spec §7)

**Files:**
- Create: `frontend/apps/admin/src/lib/loss-intelligence/metrics.ts`
- Test: `frontend/apps/admin/src/lib/loss-intelligence/metrics.spec.ts`

**Interfaces:**
- Consumes: `LossMetrics`, `PerReasonMetrics`, `LOSS_REASONS`, `Period` (Task 1).
- Produces: `computeLossMetrics` — usado por `engine.ts` (Task 15) e por todas as árvores de diagnóstico (Tasks 7-10) via o `LossMetrics` que ele produz.

- [ ] **Passo 1: escrever `metrics.ts`.**

```ts
import { LOSS_REASONS, type LossMetrics, type LossReason, type PerReasonMetrics, type Period, type ReconciliationInput, type SalesRecordInput, type SupplyRecordInput } from "./types";

function sum<T>(rows: T[], get: (row: T) => number): number {
  return rows.reduce((total, row) => total + get(row), 0);
}

export interface ComputeLossMetricsInput {
  storeId: number;
  sku: string;
  /** TODO o histórico disponível para esta loja×SKU, não só a janela — usado para firstSeenPeriod. */
  allSalesRows: SalesRecordInput[];
  allSupplyRows: SupplyRecordInput[];
  /** Reconciliações desta loja, qualquer período — filtradas internamente por sku e pela janela. */
  allReconciliations: ReconciliationInput[];
  /** null = custo desconhecido naquele período — nunca assumir zero (spec §7). */
  costsBySkuAsOf: (sku: string, asOfPeriod: Period) => number | null;
  /** Períodos que contam para as somas da janela — já resolvidos por temporal.ts. */
  windowPeriods: Period[];
  /** Período usado para resolver o custo datado (o mais recente da janela). */
  asOfPeriod: Period;
}

export function computeLossMetrics(input: ComputeLossMetricsInput): LossMetrics {
  const inWindow = <T extends { period: Period }>(rows: T[]): T[] => rows.filter((row) => input.windowPeriods.includes(row.period));

  const salesInWindow = inWindow(input.allSalesRows);
  const supplyInWindow = inWindow(input.allSupplyRows);
  const reconciliationsInWindow = inWindow(input.allReconciliations);

  const qtyRestocked = sum(supplyInWindow, (r) => r.quantity_restocked);
  const qtySold = sum(salesInWindow, (r) => r.quantity_sold);
  const revenueCents = sum(salesInWindow, (r) => r.revenue_cents);

  const byReason = {} as Record<LossReason, PerReasonMetrics>;
  for (const reason of LOSS_REASONS) {
    const rows = reconciliationsInWindow.flatMap((r) => r.loss_by_reason_sku.filter((x) => x.reason === reason && x.sku === input.sku));
    const qtyLost = sum(rows, (r) => r.quantity);
    const valueLostCents = sum(rows, (r) => r.value_cents);
    byReason[reason] = {
      qtyLost,
      valueLostCents,
      lossToSupplyRatio: qtyRestocked > 0 ? qtyLost / qtyRestocked : null,
      lossToRevenueRatio: revenueCents > 0 ? valueLostCents / revenueCents : null,
      lossToMarginRatio: null, // preenchido abaixo, depois de resolver grossMarginCents
    };
  }

  // grossMarginCents: null assim que QUALQUER venda da janela não resolve custo — nunca assume
  // custo zero para parte das vendas e ignora o resto (spec §7, §19 "custo datado ausente").
  // Sem vendas na janela, a margem é 0 (não "desconhecida" — não há o que precificar).
  let grossMarginCents: number | null = 0;
  for (const row of salesInWindow) {
    const cost = input.costsBySkuAsOf(input.sku, input.asOfPeriod);
    if (cost === null) {
      grossMarginCents = null;
      break;
    }
    grossMarginCents = (grossMarginCents ?? 0) + row.revenue_cents - cost * row.quantity_sold;
  }

  const totalLostCents = sum(LOSS_REASONS.map((reason) => byReason[reason]), (r) => r.valueLostCents);
  for (const reason of LOSS_REASONS) {
    byReason[reason].lossToMarginRatio = grossMarginCents !== null && grossMarginCents > 0 ? byReason[reason].valueLostCents / grossMarginCents : null;
  }
  const netMarginAfterLossCents = grossMarginCents !== null ? grossMarginCents - totalLostCents : null;

  const monthsWithRestock = new Set(supplyInWindow.filter((r) => r.quantity_restocked > 0).map((r) => r.period)).size;
  const monthsWithSales = new Set(salesInWindow.filter((r) => r.quantity_sold > 0).map((r) => r.period)).size;
  const monthsAnalyzed = input.windowPeriods.length;

  const allKnownPeriods = [...new Set([...input.allSalesRows.map((r) => r.period), ...input.allSupplyRows.map((r) => r.period)])].sort();
  const firstSeenPeriod = allKnownPeriods[0] ?? null;
  const monthsSinceFirstSeen = firstSeenPeriod ? countClosedMonthsBetween(firstSeenPeriod, input.asOfPeriod) : null;

  return {
    qtyRestocked,
    qtySold,
    revenueCents,
    grossMarginCents,
    netMarginAfterLossCents,
    saleToSupplyRatio: qtyRestocked > 0 ? qtySold / qtyRestocked : null,
    monthsWithRestock,
    monthsWithSales,
    monthsAnalyzed,
    firstSeenPeriod,
    monthsSinceFirstSeen,
    byReason,
  };
}

function countClosedMonthsBetween(from: Period, to: Period): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty * 12 + tm) - (fy * 12 + fm);
}
```

- [ ] **Passo 2: escrever `metrics.spec.ts`.** Casos, cada um com fixtures sintéticas mínimas: (a) `qtyRestocked`/`qtySold`/`revenueCents` somam só as linhas dentro de `windowPeriods`, ignorando linhas fora; (b) `qtyLost`/`valueLostCents` filtram por `reason` E `sku` corretamente, dado um `loss_by_reason_sku` com múltiplos SKUs e motivos misturados; (c) `saleToSupplyRatio`/`lossToSupplyRatio` retornam `null` quando `qtyRestocked=0` (nunca `Infinity` nem `NaN`); (d) `lossToRevenueRatio` retorna `null` quando `revenueCents=0`; (e) `grossMarginCents` fica `null` quando qualquer venda da janela tem custo desconhecido (`costsBySkuAsOf` retorna `null` para uma delas), mesmo com outras vendas tendo custo conhecido; (f) `grossMarginCents=0` (não `null`) quando não há nenhuma venda na janela; (g) `lossToMarginRatio` fica `null` quando `grossMarginCents` é `null` ou `≤0`; (h) `netMarginAfterLossCents` nunca é usado como insumo de outro cálculo dentro desta função — teste que soma manualmente `grossMarginCents − Σ valueLostCents` e compara; (i) `firstSeenPeriod` usa o histórico completo passado (`allSalesRows`/`allSupplyRows`), não só `windowPeriods` — fixture com primeira venda fora da janela; (j) `monthsSinceFirstSeen` conta meses fechados corretamente, incluindo virada de ano.

- [ ] **Passo 3: `pnpm --filter @agiliz/admin typecheck lint test`.**

- [ ] **Passo 4: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/metrics.ts frontend/apps/admin/src/lib/loss-intelligence/metrics.spec.ts
git commit -m "feat(admin): add Loss Intelligence observed metrics (Fase 1, spec §7)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `recent-history-guard.ts` — histórico recente/insuficiente (spec §9)

**Files:**
- Create: `frontend/apps/admin/src/lib/loss-intelligence/recent-history-guard.ts`
- Test: `frontend/apps/admin/src/lib/loss-intelligence/recent-history-guard.spec.ts`

**Interfaces:**
- Consumes: `Period`, `SupplyRecordInput`, `LossIntelligenceParameters` (Tasks 1-2).
- Produces: `evaluateRecentHistory` — consumido por `diagnosis/validity.ts` (Task 7) e `diagnosis/other-reason.ts` (Task 9) para capar a severidade da ação; `diagnosis/damage.ts` (Task 8) não precisa (nunca produz ação estrutural). Também por `confidence.ts` (Task 13) e `unnecessary-supply.ts` (Task 10).

**Nota de nomenclatura obrigatória**: o campo de saída chama-se `firstSeenRecently`, nunca `isTestProduct`. "Histórico recente" é um indício observável (tempo desde a primeira aparição), não uma afirmação de que o produto está em teste deliberado — spec §9.

- [ ] **Passo 1: escrever `recent-history-guard.ts`.**

```ts
import type { Period, SupplyRecordInput } from "./types";
import type { LossIntelligenceParameters } from "./parameters";

export interface RecentHistoryGuardInput {
  firstSeenPeriod: Period | null;
  monthsSinceFirstSeen: number | null;
  /** TODO o histórico de abastecimento desta loja×SKU — mesmo array usado em computeLossMetrics. */
  allSupplyRows: SupplyRecordInput[];
  parameters: LossIntelligenceParameters;
}

export interface RecentHistoryGuardResult {
  firstSeenRecently: boolean;
  qtyRestockedSinceFirstSeen: number;
  reason: "no_history" | "months_below_minimum" | "units_below_minimum" | null;
}

export function evaluateRecentHistory(input: RecentHistoryGuardInput): RecentHistoryGuardResult {
  if (input.firstSeenPeriod === null || input.monthsSinceFirstSeen === null) {
    return { firstSeenRecently: true, qtyRestockedSinceFirstSeen: 0, reason: "no_history" };
  }

  const qtyRestockedSinceFirstSeen = input.allSupplyRows
    .filter((row) => row.period >= input.firstSeenPeriod!)
    .reduce((total, row) => total + row.quantity_restocked, 0);

  if (input.monthsSinceFirstSeen < input.parameters.recentHistory.minClosedMonths) {
    return { firstSeenRecently: true, qtyRestockedSinceFirstSeen, reason: "months_below_minimum" };
  }
  if (qtyRestockedSinceFirstSeen < input.parameters.recentHistory.minUnits) {
    return { firstSeenRecently: true, qtyRestockedSinceFirstSeen, reason: "units_below_minimum" };
  }
  return { firstSeenRecently: false, qtyRestockedSinceFirstSeen, reason: null };
}

/**
 * "Evidência esmagadora" (spec §9) — decisão de implementação explícita, não
 * um parâmetro novo (a spec aprovada lista 20 parâmetros; isto reaproveita
 * `recentHistory.minUnits` com um multiplicador fixo, documentado aqui em vez
 * de inventar um 21º threshold): abastecido pelo menos o dobro do mínimo de
 * histórico recente, com zero vendas. Usada por `diagnosis/validity.ts` e
 * `diagnosis/other-reason.ts` para decidir se a exceção do §9 se aplica.
 */
export function hasOverwhelmingEvidence(input: { qtySold: number; qtyRestocked: number; parameters: LossIntelligenceParameters }): boolean {
  return input.qtySold === 0 && input.qtyRestocked >= input.parameters.recentHistory.minUnits * 2;
}
```

- [ ] **Passo 2: escrever `recent-history-guard.spec.ts`.** Casos: `firstSeenPeriod=null` → `firstSeenRecently=true`, `reason="no_history"`; `monthsSinceFirstSeen` abaixo do mínimo → `firstSeenRecently=true`, `reason="months_below_minimum"`, mesmo com unidades suficientes; unidades abaixo do mínimo (contadas SÓ a partir de `firstSeenPeriod`, ignorando abastecimento anterior a essa data se a fixture tiver — não deveria ter, mas o filtro `>=` precisa estar certo) → `firstSeenRecently=true`, `reason="units_below_minimum"`; ambos os critérios satisfeitos → `firstSeenRecently=false`; `hasOverwhelmingEvidence` verdadeiro só quando `qtySold===0` E `qtyRestocked ≥ 2×minUnits`, falso se `qtySold>0` mesmo com `qtyRestocked` alto, falso se `qtyRestocked` exatamente `2×minUnits − 1`.

- [ ] **Passo 3: `pnpm --filter @agiliz/admin typecheck lint test`.**

- [ ] **Passo 4: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/recent-history-guard.ts frontend/apps/admin/src/lib/loss-intelligence/recent-history-guard.spec.ts
git commit -m "feat(admin): add Loss Intelligence recent-history guard (Fase 1, spec §9)

firstSeenRecently, never isTestProduct — an observed-recency signal,
not a claim about deliberate testing.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: `network-comparison.ts` — comparação com a rede (spec §12)

**Files:**
- Create: `frontend/apps/admin/src/lib/loss-intelligence/network-comparison.ts`
- Test: `frontend/apps/admin/src/lib/loss-intelligence/network-comparison.spec.ts`

**Interfaces:**
- Consumes: `NetworkComparison`, `NetworkComparisonResult`, `LossIntelligenceParameters` (Tasks 1-2).
- Produces: `computeNetworkComparison` — consumido por `engine.ts` (Task 15) numa segunda passada (ver nota abaixo), e o resultado é repassado como entrada para `diagnosis/validity.ts` (Task 7) e `diagnosis/other-reason.ts` (Task 9).

**Nota de orquestração (importante para a Task 15):** este módulo não decide sozinho o que é "sinal ruim" — quem chama (`engine.ts`) já rodou uma primeira passada de diagnóstico por loja (casos A/B/C de validade, caso base de Outro motivo) e informa, por loja, se o resultado caiu no lado ruim daquele motivo. Só depois desta função rodar é que `engine.ts` roda uma segunda passada das duas árvores, agora com `NetworkComparison` disponível para decidir escalada (casos D/E de validade, "avaliar permanência" de Outro motivo).

- [ ] **Passo 1: escrever `network-comparison.ts`.**

```ts
import type { NetworkComparison } from "./types";
import type { LossIntelligenceParameters } from "./parameters";

export interface StoreSignal {
  storeId: number;
  storeName: string;
  qtyRestocked: number;
  qtySold: number;
  /** Definido por quem chama — cada árvore de diagnóstico decide o que conta como "lado ruim" para o seu motivo. */
  hasBadSignal: boolean;
}

export interface NetworkComparisonInput {
  perStore: StoreSignal[];
  parameters: LossIntelligenceParameters;
}

export function computeNetworkComparison(input: NetworkComparisonInput): NetworkComparison {
  const storesCarryingSku = input.perStore.filter((store) => store.qtyRestocked > 0 || store.qtySold > 0);

  if (storesCarryingSku.length < input.parameters.network.minStoresForNetworkVerdict) {
    return "dado_insuficiente";
  }

  const storesWithSameSignal = storesCarryingSku.filter((store) => store.hasBadSignal);
  const storesHealthy = storesCarryingSku.filter((store) => !store.hasBadSignal).map((store) => store.storeName);

  return {
    storesCarryingSku: storesCarryingSku.length,
    storesWithSameSignal: storesWithSameSignal.length,
    affectedShare: storesWithSameSignal.length / storesCarryingSku.length,
    storesHealthy,
  };
}
```

- [ ] **Passo 2: escrever `network-comparison.spec.ts`.** Casos: menos lojas que `minStoresForNetworkVerdict` → `"dado_insuficiente"`, mesmo com todas com sinal ruim; exatamente no mínimo → calcula normalmente; `affectedShare` calculado corretamente (ex.: 3 de 10 lojas com sinal ruim → `0.3`); `storesHealthy` lista só os nomes das lojas sem sinal ruim, na ordem em que vieram; loja sem abastecimento nem venda não conta em `storesCarryingSku` mesmo se estivesse na lista de entrada; caso do pedido original — Paçoquita saudável em 9 outras lojas com sinal ruim só na loja em análise (10 lojas no total, 1 com sinal ruim) → `affectedShare=0.1`, abaixo de `validity.localOutlierMaxShare` (0.3), portanto candidato ao caso D quando consumido por `diagnosis/validity.ts`.

- [ ] **Passo 3: `pnpm --filter @agiliz/admin typecheck lint test`.**

- [ ] **Passo 4: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/network-comparison.ts frontend/apps/admin/src/lib/loss-intelligence/network-comparison.spec.ts
git commit -m "feat(admin): add Loss Intelligence network comparison (Fase 1, spec §12)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: `recurrence.ts` + `severity.ts` — utilitários compartilhados pelas 3 árvores

**Por quê antes das árvores:** `diagnosis/validity.ts` e `diagnosis/other-reason.ts` (Tasks 8-9) precisam da mesma lógica de "quais períodos do lookback tiveram perda" e do mesmo mecanismo de "nunca passar de X de severidade" (o teto do histórico recente, spec §9). Escrever uma vez aqui evita duplicar em duas árvores.

**Files:**
- Create: `frontend/apps/admin/src/lib/loss-intelligence/recurrence.ts`
- Create: `frontend/apps/admin/src/lib/loss-intelligence/severity.ts`
- Test: `frontend/apps/admin/src/lib/loss-intelligence/recurrence.spec.ts`, `frontend/apps/admin/src/lib/loss-intelligence/severity.spec.ts`

**Interfaces:**
- Consumes: `Period`, `LossReason`, `LossAction`, `ACTION_SEVERITY_ORDER`, `ReconciliationInput` (Task 1).
- Produces: `periodsWithLoss`, `clampSeverity` — consumidos por `diagnosis/validity.ts` (Task 8) e `diagnosis/other-reason.ts` (Task 10).

- [ ] **Passo 1: escrever `recurrence.ts`.**

```ts
import type { LossReason, Period, ReconciliationInput } from "./types";

/** Quais dos `periods` dados tiveram perda (quantidade > 0) para este SKU e motivo. */
export function periodsWithLoss(reconciliations: ReconciliationInput[], sku: string, reason: LossReason, periods: Period[]): Period[] {
  return periods.filter((period) => {
    const qty = reconciliations
      .filter((r) => r.period === period)
      .flatMap((r) => r.loss_by_reason_sku.filter((row) => row.sku === sku && row.reason === reason))
      .reduce((total, row) => total + row.quantity, 0);
    return qty > 0;
  });
}
```

- [ ] **Passo 2: escrever `severity.ts`.**

```ts
import { ACTION_SEVERITY_ORDER, type LossAction } from "./types";

/** Índice 0 = mais severo. Usado para comparar duas ações e para tetos (clamp). */
export function severityRank(action: LossAction): number {
  return ACTION_SEVERITY_ORDER.indexOf(action);
}

/** Se `action` é mais severo que `ceiling`, retorna `ceiling`; senão retorna `action` inalterado. */
export function clampSeverity(action: LossAction, ceiling: LossAction): LossAction {
  return severityRank(action) < severityRank(ceiling) ? ceiling : action;
}

/** A mais severa dentre as ações dadas (usado pela consolidação, Task 12). */
export function mostSevere(actions: LossAction[]): LossAction {
  return [...actions].sort((a, b) => severityRank(a) - severityRank(b))[0];
}
```

- [ ] **Passo 3: testes.** `recurrence.spec.ts` — filtra corretamente por sku+reason+período, ignora outros SKUs/motivos misturados na mesma reconciliação, retorna `[]` quando nenhum período da lista teve perda. `severity.spec.ts` — `severityRank` ordena os 10 valores sem empate; `clampSeverity("avaliar_retirada_rede", "reduzir_abastecimento") === "reduzir_abastecimento"`; `clampSeverity("manter", "reduzir_abastecimento") === "manter"` (nunca "piora" uma ação já mais branda que o teto); `mostSevere` com lista de 3 ações retorna a de menor índice em `ACTION_SEVERITY_ORDER`.

- [ ] **Passo 4: `pnpm --filter @agiliz/admin typecheck lint test`.**

- [ ] **Passo 5: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/recurrence.ts frontend/apps/admin/src/lib/loss-intelligence/severity.ts frontend/apps/admin/src/lib/loss-intelligence/recurrence.spec.ts frontend/apps/admin/src/lib/loss-intelligence/severity.spec.ts
git commit -m "feat(admin): add recurrence and severity-clamp helpers shared by the diagnosis trees (Fase 1)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: `diagnosis/validity.ts` — árvore de validade (spec §10.1)

**Files:**
- Create: `frontend/apps/admin/src/lib/loss-intelligence/diagnosis/validity.ts`
- Test: `frontend/apps/admin/src/lib/loss-intelligence/diagnosis/validity.spec.ts`

**Interfaces:**
- Consumes: `ReasonDiagnosis`, `PerReasonMetrics`, `NetworkComparison`, `LossIntelligenceParameters` (Tasks 1-2), `periodsWithLoss`/`clampSeverity` (Task 7), `RecentHistoryGuardResult`/`hasOverwhelmingEvidence` (Task 5).
- Produces: `diagnoseValidity` — chamado duas vezes por `engine.ts` (Task 15): passe 1 sem `networkComparison` (para alimentar os `hasBadSignal` do Task 6), passe 2 com `networkComparison` resolvido (para decidir escalada D/E).

- [ ] **Passo 1: escrever `diagnosis/validity.ts`.**

```ts
import type { InterventionPotential, LossAction, NetworkComparison, PerReasonMetrics, Period, ReasonDiagnosis } from "../types";
import type { LossIntelligenceParameters } from "../parameters";
import { clampSeverity } from "../severity";

export interface ValidityDiagnosisInput {
  /** byReason.expired da janela principal. Assume-se qtyLost > 0 — engine.ts só chama esta função quando houver perda de validade no período. */
  metrics: PerReasonMetrics;
  qtySold: number;
  saleToSupplyRatio: number | null;
  monthsWithRestock: number;
  /** Períodos do lookback de recorrência (§8) com perda de validade — de recurrence.ts, filtrado por reason="expired". */
  recurrencePeriodsWithLoss: Period[];
  /** null na passe 1 (rede ainda não calculada); resolvido na passe 2. */
  networkComparison: NetworkComparison | null;
  firstSeenRecently: boolean;
  overwhelmingEvidence: boolean;
  parameters: LossIntelligenceParameters;
}

/** true quando o diagnóstico local (sem escalada de rede) caiu no "lado ruim" — usado por engine.ts para alimentar network-comparison.ts (Task 6) com `hasBadSignal`. */
export function isValidityBadSignal(action: LossAction): boolean {
  return action === "suspender_abastecimento" || action === "reduzir_abastecimento";
}

export function diagnoseValidity(input: ValidityDiagnosisInput): ReasonDiagnosis {
  const p = input.parameters.validity;
  const { metrics, qtySold, saleToSupplyRatio, monthsWithRestock, recurrencePeriodsWithLoss } = input;
  const isRecurrent = recurrencePeriodsWithLoss.length >= 2;
  const isIsolated = recurrencePeriodsWithLoss.length <= 1;

  let action: LossAction;
  let potencialIntervencao: InterventionPotential | null;
  let signals: string[];

  if (qtySold === 0 && monthsWithRestock >= p.minRepeatedSupplyMonths) {
    action = "suspender_abastecimento";
    potencialIntervencao = "alto";
    signals = ["ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS"];
  } else if (qtySold > 0 && saleToSupplyRatio !== null && saleToSupplyRatio < p.lowSaleRatio && isRecurrent) {
    action = "reduzir_abastecimento";
    potencialIntervencao = "alto";
    signals = ["LOW_SALE_RATIO_RECURRING_EXPIRY"];
  } else if (saleToSupplyRatio !== null && saleToSupplyRatio >= p.lowSaleRatio && isIsolated) {
    action = "manter_monitorar";
    potencialIntervencao = "baixo";
    signals = ["HEALTHY_SALE_RATIO_ISOLATED_EXPIRY"];
  } else {
    return { reason: "expired", metrics, sinaisDetectados: ["INSUFFICIENT_EVIDENCE"], regrasAcionadas: ["INSUFFICIENT_EVIDENCE"], acao: "dados_insuficientes", potencialIntervencao: null, hipoteses: [] };
  }

  // Escalada por rede (casos D/E) — só na passe 2, e só refina suspender/reduzir.
  if (input.networkComparison && input.networkComparison !== "dado_insuficiente" && (action === "suspender_abastecimento" || action === "reduzir_abastecimento")) {
    const nc = input.networkComparison;
    if (nc.affectedShare <= p.localOutlierMaxShare) {
      action = "avaliar_retirada_loja";
      potencialIntervencao = "alto";
      signals = [...signals, "LOCAL_OUTLIER_VS_HEALTHY_NETWORK"];
    } else if (nc.affectedShare >= p.networkWideMinShare) {
      action = "avaliar_retirada_rede";
      potencialIntervencao = "alto";
      signals = [...signals, "NETWORK_WIDE_LOW_PERFORMANCE_EXPIRY"];
    }
  }

  // Teto de histórico recente (spec §9) — nunca mais severo que "reduzir_abastecimento" nesta condição, salvo evidência esmagadora.
  if (input.firstSeenRecently && !input.overwhelmingEvidence) {
    const capped = clampSeverity(action, "reduzir_abastecimento");
    if (capped !== action) signals = [...signals, "CAPPED_RECENT_HISTORY"];
    action = capped;
  }

  return { reason: "expired", metrics, sinaisDetectados: signals, regrasAcionadas: signals, acao: action, potencialIntervencao, hipoteses: [] };
}
```

- [ ] **Passo 2: escrever `diagnosis/validity.spec.ts`.** Um teste por linha da tabela do spec §10.1, usando fixtures com números reais:
  - **Caso A** (exemplo literal do pedido): `qtySold=0, monthsWithRestock=3, metrics.qtyLost=5` → `acao="suspender_abastecimento"`, `potencialIntervencao="alto"`, `sinaisDetectados` contém `"ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS"`.
  - **Caso A com `monthsWithRestock=1`** (abaixo do mínimo) → cai em `dados_insuficientes`, não suspende com um mês só.
  - **Caso B** (exemplo "diferente" do pedido: 50 abastecidos, 42 vendidos, 4 vencidos, recorrente) → `saleToSupplyRatio=0.84 ≥ 0.5`, então NÃO é caso B — ajustar a fixture para reproduzir o cenário pretendido pelo usuário com uma razão abaixo de 0.5 e recorrência real (ex.: 50 abastecidos, 20 vendidos, recorrente em 2+ períodos) → `acao="reduzir_abastecimento"`, nunca `"avaliar_retirada_*"`.
  - **Caso C**: `saleToSupplyRatio=0.84`, perda isolada (1 período no lookback) → `acao="manter_monitorar"`, `potencialIntervencao="baixo"`.
  - **Caso D**: caso A ou B com `networkComparison.affectedShare=0.1` (≤0.3) → `acao="avaliar_retirada_loja"`.
  - **Caso E**: caso A ou B com `networkComparison.affectedShare=0.8` (≥0.7) → `acao="avaliar_retirada_rede"`.
  - **Zona sem escalada**: `affectedShare=0.5` (entre os dois limiares) → ação permanece a de A/B, sem upgrade nem downgrade.
  - **`networkComparison=null`** (passe 1) → nunca escala para D/E, mesmo que os números por trás justificassem.
  - **`networkComparison="dado_insuficiente"`** → mesmo comportamento de `null` (nunca escala).
  - **Teto de histórico recente**: caso A com `firstSeenRecently=true, overwhelmingEvidence=false` → `acao="reduzir_abastecimento"` (nunca suspender), `sinaisDetectados` contém `"CAPPED_RECENT_HISTORY"`.
  - **Exceção de evidência esmagadora**: mesmo cenário acima mas `overwhelmingEvidence=true` → `acao="suspender_abastecimento"` sem cap.
  - **`saleToSupplyRatio=null`** (qtyRestocked=0 na janela, mas com perda registrada de um abastecimento anterior à janela) → cai em `dados_insuficientes`, nunca divide por zero nem lança exceção.

- [ ] **Passo 3: `pnpm --filter @agiliz/admin typecheck lint test`.**

- [ ] **Passo 4: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/diagnosis/validity.ts frontend/apps/admin/src/lib/loss-intelligence/diagnosis/validity.spec.ts
git commit -m "feat(admin): add Loss Intelligence validity diagnosis tree (Fase 1, spec §10.1)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: `diagnosis/damage.ts` — árvore de danificado (spec §10.3)

**Files:**
- Create: `frontend/apps/admin/src/lib/loss-intelligence/diagnosis/damage.ts`
- Test: `frontend/apps/admin/src/lib/loss-intelligence/diagnosis/damage.spec.ts`

**Interfaces:**
- Consumes: `ReasonDiagnosis`, `PerReasonMetrics`, `LossIntelligenceParameters` (Tasks 1-2).
- Produces: `diagnoseDamage` — chamado uma vez por `engine.ts` (não precisa de duas passadas: calcula sua própria concentração inline, não usa `network-comparison.ts`).

**Nota:** esta árvore nunca produz ação estrutural (suspender/retirada/permanência) — só `investigar` ou `dados_insuficientes` — então não precisa do teto de histórico recente nem de `firstSeenRecently` como entrada.

- [ ] **Passo 1: escrever `diagnosis/damage.ts`.**

```ts
import type { PerReasonMetrics, ReasonDiagnosis } from "../types";
import type { LossIntelligenceParameters } from "../parameters";

export interface DamageDiagnosisInput {
  /** byReason.damaged_product da janela principal, nesta loja. Assume-se qtyLost > 0. */
  metrics: PerReasonMetrics;
  /** Perda de danificado deste SKU em cada loja da rede (incluindo esta), mesma janela — quantity apenas, já resolvido por engine.ts. */
  qtyLostDamagedByStore: { storeId: number; qtyLost: number }[];
  thisStoreId: number;
  parameters: LossIntelligenceParameters;
}

export function diagnoseDamage(input: DamageDiagnosisInput): ReasonDiagnosis {
  const p = input.parameters.damage;
  const storesCarrying = input.qtyLostDamagedByStore.filter((store) => store.qtyLost > 0);

  if (storesCarrying.length < p.minStoresCarryingForConcentration) {
    return {
      reason: "damaged_product", metrics: input.metrics,
      sinaisDetectados: ["INSUFFICIENT_STORES_FOR_DAMAGE_PATTERN"], regrasAcionadas: ["INSUFFICIENT_STORES_FOR_DAMAGE_PATTERN"],
      acao: "dados_insuficientes", potencialIntervencao: null, hipoteses: [],
    };
  }

  const totalNetwork = storesCarrying.reduce((total, store) => total + store.qtyLost, 0);
  const thisStoreQty = input.metrics.qtyLost;
  const concentrationShare = totalNetwork > 0 ? thisStoreQty / totalNetwork : 0;

  if (concentrationShare >= p.localConcentrationMin) {
    return {
      reason: "damaged_product", metrics: input.metrics,
      sinaisDetectados: ["DAMAGE_CONCENTRATED_LOCAL"], regrasAcionadas: ["DAMAGE_CONCENTRATED_LOCAL"],
      acao: "investigar", potencialIntervencao: "alto",
      hipoteses: ["manuseio", "armazenamento", "exposição"],
    };
  }

  if (storesCarrying.length >= p.minStoresForSystemic) {
    return {
      reason: "damaged_product", metrics: input.metrics,
      sinaisDetectados: ["DAMAGE_SYSTEMIC_NETWORK"], regrasAcionadas: ["DAMAGE_SYSTEMIC_NETWORK"],
      acao: "investigar", potencialIntervencao: "medio",
      hipoteses: ["embalagem", "transporte", "característica do produto"],
    };
  }

  return {
    reason: "damaged_product", metrics: input.metrics,
    sinaisDetectados: ["INSUFFICIENT_STORES_FOR_DAMAGE_PATTERN"], regrasAcionadas: ["INSUFFICIENT_STORES_FOR_DAMAGE_PATTERN"],
    acao: "dados_insuficientes", potencialIntervencao: null, hipoteses: [],
  };
}
```

- [ ] **Passo 2: escrever `diagnosis/damage.spec.ts`.** Casos: (a) exemplo literal do pedido — 12 de 14 unidades danificadas nesta loja, mesmo SKU em ≥3 lojas → `concentrationShare≈0.86 ≥ 0.7` → `acao="investigar"`, `sinaisDetectados` contém `"DAMAGE_CONCENTRATED_LOCAL"`, `hipoteses` não-vazio e nunca afirma causa como fato (são strings como "manuseio", nunca uma frase afirmativa); (b) dano espalhado por ≥4 lojas sem concentração em nenhuma → `"DAMAGE_SYSTEMIC_NETWORK"`, `potencialIntervencao="medio"` (menor que o caso local, que é `"alto"`); (c) menos de 3 lojas carregando o SKU → `"dados_insuficientes"` mesmo com 100% de concentração aparente; (d) `totalNetwork=0` (não deveria acontecer já que `metrics.qtyLost>0` implica pelo menos esta loja em `storesCarrying`, mas testar a guarda de divisão por zero mesmo assim).

- [ ] **Passo 3: `pnpm --filter @agiliz/admin typecheck lint test`.**

- [ ] **Passo 4: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/diagnosis/damage.ts frontend/apps/admin/src/lib/loss-intelligence/diagnosis/damage.spec.ts
git commit -m "feat(admin): add Loss Intelligence damage diagnosis tree (Fase 1, spec §10.3)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: `diagnosis/other-reason.ts` — análise neutra de Outro motivo (spec §10.2)

**Files:**
- Create: `frontend/apps/admin/src/lib/loss-intelligence/diagnosis/other-reason.ts`
- Test: `frontend/apps/admin/src/lib/loss-intelligence/diagnosis/other-reason.spec.ts`

**Interfaces:**
- Consumes: `ReasonDiagnosis`, `PerReasonMetrics`, `NetworkComparison`, `LossIntelligenceParameters` (Tasks 1-2), `clampSeverity` (Task 7).
- Produces: `diagnoseOtherReason`, `isOtherReasonSevereSignal` — chamado duas vezes por `engine.ts` (mesma orquestração de duas passadas de `diagnosis/validity.ts`, Task 8).

**Regra obrigatória, verificada estruturalmente**: esta função nunca deve atribuir `"avaliar_retirada_loja"` nem `"avaliar_retirada_rede"` a `action` em nenhum ramo — só `"avaliar_permanencia_loja"`/`"avaliar_permanencia_rede"`. Nenhuma string de regra, sinal ou hipótese neste arquivo menciona roubo/furto/theft.

- [ ] **Passo 1: escrever `diagnosis/other-reason.ts`.**

```ts
import type { InterventionPotential, LossAction, NetworkComparison, PerReasonMetrics, Period, ReasonDiagnosis } from "../types";
import type { LossIntelligenceParameters } from "../parameters";
import { clampSeverity } from "../severity";

/** true quando o critério "severo e recorrente" (spec §10.2) já está satisfeito, ANTES de decidir loja vs rede — usado por engine.ts como `hasBadSignal` na passe 1 de network-comparison.ts (Task 6). */
export function isOtherReasonSevereSignal(input: { lossToMarginRatio: number | null; recurrencePeriodsWithLoss: Period[]; parameters: LossIntelligenceParameters }): boolean {
  return (
    input.lossToMarginRatio !== null &&
    input.lossToMarginRatio >= input.parameters.otherReason.viabilityMaxRatio &&
    input.recurrencePeriodsWithLoss.length >= input.parameters.otherReason.minRecurringPeriods
  );
}

export interface OtherReasonDiagnosisInput {
  /** byReason.other_reason da janela principal. Assume-se qtyLost > 0. */
  metrics: PerReasonMetrics;
  qtySold: number;
  grossMarginCents: number | null;
  recurrencePeriodsWithLoss: Period[];
  /** null quando não há lojas suficientes para calcular concentração (mesmo piso de network.minStoresForNetworkVerdict). */
  concentrationShareStore: number | null;
  /** null na passe 1; resolvido na passe 2, só usado quando isOtherReasonSevereSignal já é true. */
  networkComparison: NetworkComparison | null;
  firstSeenRecently: boolean;
  overwhelmingEvidence: boolean;
  parameters: LossIntelligenceParameters;
}

export function diagnoseOtherReason(input: OtherReasonDiagnosisInput): ReasonDiagnosis {
  const p = input.parameters.otherReason;
  const { metrics, qtySold, grossMarginCents, recurrencePeriodsWithLoss } = input;
  const isRecurrent = recurrencePeriodsWithLoss.length >= 2;

  if (metrics.valueLostCents < p.negligibleValueCents) {
    return { reason: "other_reason", metrics, sinaisDetectados: ["OTHER_REASON_NEGLIGIBLE"], regrasAcionadas: ["OTHER_REASON_NEGLIGIBLE"], acao: "manter", potencialIntervencao: "baixo", hipoteses: [] };
  }

  if (grossMarginCents === null) {
    return { reason: "other_reason", metrics, sinaisDetectados: ["OTHER_REASON_MARGIN_UNKNOWN"], regrasAcionadas: ["OTHER_REASON_MARGIN_UNKNOWN"], acao: "dados_insuficientes", potencialIntervencao: null, hipoteses: [] };
  }

  const isSevere = isOtherReasonSevereSignal({ lossToMarginRatio: metrics.lossToMarginRatio, recurrencePeriodsWithLoss, parameters: input.parameters });

  let action: LossAction;
  let potencialIntervencao: InterventionPotential;
  let signals: string[];

  if (isSevere) {
    // "Permanência", nunca "retirada": a causa continua desconhecida mesmo quando o impacto é severo (regra obrigatória §10.2).
    action = "avaliar_permanencia_loja";
    potencialIntervencao = "alto";
    signals = ["OTHER_REASON_SEVERE_RECURRING"];

    // Reaproveita deliberadamente validity.networkWideMinShare — não existe um 6º parâmetro
    // otherReason.networkWideMinShare na spec aprovada (§14 lista só 5 para este namespace);
    // a spec pede "a mesma comparação de rede do §12... igual aos casos D/E de validade".
    if (input.networkComparison && input.networkComparison !== "dado_insuficiente" && input.networkComparison.affectedShare >= input.parameters.validity.networkWideMinShare) {
      action = "avaliar_permanencia_rede";
      signals = [...signals, "OTHER_REASON_NETWORK_WIDE"];
    }
  } else {
    const isHealthy = qtySold >= p.minHealthyUnits && grossMarginCents > 0 && metrics.lossToMarginRatio !== null && metrics.lossToMarginRatio < p.viabilityMaxRatio;
    const isConcentrated = input.concentrationShareStore !== null && input.concentrationShareStore >= p.localConcentrationMin;

    if (isHealthy && !isRecurrent && !isConcentrated) {
      action = "manter_monitorar";
      potencialIntervencao = "baixo";
      signals = ["OTHER_REASON_HEALTHY_ISOLATED"];
    } else if (isRecurrent || isConcentrated) {
      action = "investigar";
      potencialIntervencao = "medio";
      signals = ["OTHER_REASON_RECURRING_OR_CONCENTRATED"];
    } else {
      return { reason: "other_reason", metrics, sinaisDetectados: ["INSUFFICIENT_EVIDENCE"], regrasAcionadas: ["INSUFFICIENT_EVIDENCE"], acao: "dados_insuficientes", potencialIntervencao: null, hipoteses: [] };
    }
  }

  if (input.firstSeenRecently && !input.overwhelmingEvidence) {
    const capped = clampSeverity(action, "investigar");
    if (capped !== action) signals = [...signals, "CAPPED_RECENT_HISTORY"];
    action = capped;
  }

  return { reason: "other_reason", metrics, sinaisDetectados: signals, regrasAcionadas: signals, acao: action, potencialIntervencao, hipoteses: [] };
}
```

- [ ] **Passo 2: escrever `diagnosis/other-reason.spec.ts`.**
  - **Teste que EXPLICITAMENTE falha se `diagnoseOtherReason` retornar `acao==="avaliar_retirada_loja"` ou `acao==="avaliar_retirada_rede"`** para qualquer combinação de entradas — rodar contra uma matriz de fixtures cobrindo todos os ramos (negligível, margem desconhecida, saudável isolado, recorrente, concentrado, severo loja, severo rede, capado por histórico recente).
  - **Teste de nomenclatura**: nenhuma string em `sinaisDetectados`/`regrasAcionadas`/`hipoteses` contém "roubo", "furto" ou "theft" (case-insensitive), para toda a matriz de fixtures acima.
  - Impacto desprezível (`valueLostCents` abaixo do parâmetro) → `"manter"`.
  - Margem desconhecida → `"dados_insuficientes"`, nunca assume margem.
  - Saudável e pontual (exemplo do pedido: 84 vendidos, margem positiva, 1 período com perda) → `"manter_monitorar"`.
  - Saudável mas recorrente (≥2 períodos) → `"investigar"`, nunca pula direto para permanência.
  - Saudável mas concentrado (`concentrationShareStore ≥ 0.7`) → `"investigar"`, mesmo sem recorrência.
  - Severo e recorrente (`lossToMarginRatio ≥ 0.3`, ≥3 períodos), rede saudável (`affectedShare < networkWideMinShare`) → `"avaliar_permanencia_loja"`.
  - Severo e recorrente, rede também severa (`affectedShare ≥ networkWideMinShare`) → `"avaliar_permanencia_rede"`.
  - Severo mas NÃO recorrente (só 1-2 períodos, abaixo de `minRecurringPeriods`) → nunca vira permanência — cai em investigar ou dados insuficientes conforme os outros critérios.
  - Teto de histórico recente: caso severo com `firstSeenRecently=true, overwhelmingEvidence=false` → `acao="investigar"` (nunca permanência), com `"CAPPED_RECENT_HISTORY"` em `sinaisDetectados`.
  - `concentrationShareStore=null` (poucas lojas) → nunca conta como concentrado, só recorrência pode levar a investigar.

- [ ] **Passo 3: `pnpm --filter @agiliz/admin typecheck lint test`.**

- [ ] **Passo 4: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/diagnosis/other-reason.ts frontend/apps/admin/src/lib/loss-intelligence/diagnosis/other-reason.spec.ts
git commit -m "feat(admin): add Loss Intelligence neutral Outro-motivo diagnosis tree (Fase 1, spec §10.2)

Never theft/roubo, structurally can't produce avaliar_retirada_* —
only avaliar_permanencia_loja/rede, and only after recorrência +
impacto econômico consistente.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: `unnecessary-supply.ts` — detector transversal (spec §10.4)

**Files:**
- Create: `frontend/apps/admin/src/lib/loss-intelligence/unnecessary-supply.ts`
- Test: `frontend/apps/admin/src/lib/loss-intelligence/unnecessary-supply.spec.ts`

**Interfaces:**
- Consumes: `Period`, `LossIntelligenceParameters` (Tasks 1-2).
- Produces: `detectUnnecessarySupply` — usado por `engine.ts` (Task 16) para preencher `sinaisTransversais` na saída consolidada; o teto de prioridade por histórico recente é aplicado em `priority.ts` (Task 13), não aqui.

- [ ] **Passo 1: escrever `unnecessary-supply.ts`.**

```ts
import type { Period } from "./types";
import type { LossIntelligenceParameters } from "./parameters";

export interface UnnecessarySupplyInput {
  qtySold: number;
  monthsWithRestock: number;
  saleToSupplyRatio: number | null;
  /** Períodos (dentro da janela principal) com perda de validade > 0, em ordem cronológica. */
  periodsWithExpiryLoss: Period[];
  /** Períodos (dentro da janela principal, todos, não só qualifyingRestockPeriods) com abastecimento > 0. */
  periodsWithRestock: Period[];
  /** Períodos do lookback de recorrência com perda de QUALQUER motivo. */
  recurrencePeriodsWithAnyLoss: Period[];
  parameters: LossIntelligenceParameters;
}

export interface UnnecessarySupplyResult {
  sinaisTransversais: string[];
}

/**
 * Detector transversal — roda sobre o Produto×Loja consolidado, não por
 * motivo isolado (spec §10.4). O teto de prioridade para SKU com histórico
 * recente é responsabilidade de priority.ts (Task 13), que recebe
 * `firstSeenRecently` separadamente — este módulo só relata os sinais.
 */
export function detectUnnecessarySupply(input: UnnecessarySupplyInput): UnnecessarySupplyResult {
  const p = input.parameters.unnecessarySupply;
  const signals: string[] = [];

  if (input.qtySold === 0 && input.monthsWithRestock >= 2) {
    signals.push("ZERO_SALES_RECURRING_SUPPLY");
  }

  if (input.saleToSupplyRatio !== null && input.saleToSupplyRatio < p.verylowSaleRatio && input.periodsWithExpiryLoss.length > 0) {
    signals.push("LOW_SALES_EXPIRY_WASTE");
  }

  const restockAfterLoss = input.periodsWithExpiryLoss.some((lossPeriod) => input.periodsWithRestock.some((restockPeriod) => restockPeriod > lossPeriod));
  if (restockAfterLoss) {
    signals.push("RESTOCK_AFTER_EXPIRY_LOSS");
  }

  if (input.saleToSupplyRatio !== null && input.saleToSupplyRatio < input.parameters.validity.lowSaleRatio && input.recurrencePeriodsWithAnyLoss.length >= 2) {
    signals.push("OVERSUPPLY_WITH_RECURRING_LOSS");
  }

  return { sinaisTransversais: signals };
}
```

- [ ] **Passo 2: escrever `unnecessary-supply.spec.ts`.** Um teste por padrão isolado (cada um dos 4 sinais disparando sozinho, com os outros três explicitamente não disparando); caso combinado — reproduzir o exemplo do pedido (Paçoquita: 18 abastecidos, 0 vendidos, 5 perdidos por validade em um período seguido de novo abastecimento, 3 meses com abastecimento) e confirmar que `sinaisTransversais` contém `ZERO_SALES_RECURRING_SUPPLY`, `LOW_SALES_EXPIRY_WASTE` e `RESTOCK_AFTER_EXPIRY_LOSS` simultaneamente; `RESTOCK_AFTER_EXPIRY_LOSS` falso quando o abastecimento ocorre ANTES do período de perda, nunca depois (ordem importa); `saleToSupplyRatio=null` não dispara nenhum sinal que dependa dele, sem lançar exceção.

- [ ] **Passo 3: `pnpm --filter @agiliz/admin typecheck lint test`.**

- [ ] **Passo 4: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/unnecessary-supply.ts frontend/apps/admin/src/lib/loss-intelligence/unnecessary-supply.spec.ts
git commit -m "feat(admin): add Loss Intelligence unnecessary-supply detector (Fase 1, spec §10.4)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: `consolidate.ts` — consolidação Produto × Loja (spec §11)

**Files:**
- Create: `frontend/apps/admin/src/lib/loss-intelligence/consolidate.ts`
- Test: `frontend/apps/admin/src/lib/loss-intelligence/consolidate.spec.ts`

**Interfaces:**
- Consumes: `ReasonDiagnosis`, `LossReason`, `LossAction`, `Confidence`, `INTERVENTION_POTENTIAL_ORDER` (Task 1), `severityRank` (Task 7).
- Produces: `consolidate` — chamado por `engine.ts` (Task 16) uma vez por Produto×Loja, depois que os diagnósticos por motivo (Tasks 8-10) e a confiança por motivo (Task 14) já foram calculados.

**Nota de design — a "exceção de segurança" (spec §11.2 item 5) não precisa de código extra**: como a saída inclui TODO diagnóstico presente, seja como prioritário ou dentro de `motivosSecundarios`/`acoesSecundarias`, nenhum diagnóstico é descartado pela ordenação — um sinal grave secundário nunca desaparece, só não vira o principal. A função abaixo garante isso por construção (`slice(1)`, nunca um filtro).

- [ ] **Passo 1: escrever `consolidate.ts`.**

```ts
import type { Confidence, LossAction, LossReason, ReasonDiagnosis } from "./types";
import { INTERVENTION_POTENTIAL_ORDER } from "./types";
import { severityRank } from "./severity";

const CONFIDENCE_ORDER: Confidence[] = ["alta", "media", "baixa", "insuficiente"];

export interface ConsolidateInput {
  /** Só diagnósticos de motivos com qtyLost > 0 no período — engine.ts já filtra antes de chamar. */
  diagnoses: ReasonDiagnosis[];
  /** Nº de períodos do lookback de recorrência com perda, por motivo — usado no desempate (a). */
  recurrencePeriodCountByReason: Record<LossReason, number>;
  confidenceByReason: Record<LossReason, Confidence>;
}

export interface ConsolidateResult {
  maiorImpactoFinanceiroMotivo: LossReason | null;
  maiorImpactoFinanceiroValueCents: number;
  motivoDiagnosticoPrioritario: LossReason | null;
  motivosSecundarios: LossReason[];
  acaoPrioritaria: LossAction;
  acoesSecundarias: LossAction[];
}

export function consolidate(input: ConsolidateInput): ConsolidateResult {
  if (input.diagnoses.length === 0) {
    return { maiorImpactoFinanceiroMotivo: null, maiorImpactoFinanceiroValueCents: 0, motivoDiagnosticoPrioritario: null, motivosSecundarios: [], acaoPrioritaria: "dados_insuficientes", acoesSecundarias: [] };
  }

  // §11.1 — maior impacto financeiro: puramente por valor, desempatado por unidades e depois alfabética.
  const byValue = [...input.diagnoses].sort((a, b) => {
    if (b.metrics.valueLostCents !== a.metrics.valueLostCents) return b.metrics.valueLostCents - a.metrics.valueLostCents;
    if (b.metrics.qtyLost !== a.metrics.qtyLost) return b.metrics.qtyLost - a.metrics.qtyLost;
    return a.reason.localeCompare(b.reason);
  });

  // §11.2 — diagnóstico e ação prioritária: por severidade da ação, depois os 4 critérios de desempate em ordem.
  const bySeverity = [...input.diagnoses].sort((a, b) => {
    const rankA = severityRank(a.acao);
    const rankB = severityRank(b.acao);
    if (rankA !== rankB) return rankA - rankB;

    const recA = input.recurrencePeriodCountByReason[a.reason] ?? 0;
    const recB = input.recurrencePeriodCountByReason[b.reason] ?? 0;
    if (recA !== recB) return recB - recA; // (a) mais recorrência vence

    const potA = a.potencialIntervencao ? INTERVENTION_POTENTIAL_ORDER.indexOf(a.potencialIntervencao) : INTERVENTION_POTENTIAL_ORDER.length;
    const potB = b.potencialIntervencao ? INTERVENTION_POTENTIAL_ORDER.indexOf(b.potencialIntervencao) : INTERVENTION_POTENTIAL_ORDER.length;
    if (potA !== potB) return potA - potB; // (b) maior potencial (índice menor) vence

    const confA = CONFIDENCE_ORDER.indexOf(input.confidenceByReason[a.reason]);
    const confB = CONFIDENCE_ORDER.indexOf(input.confidenceByReason[b.reason]);
    if (confA !== confB) return confA - confB; // (c) maior confiança vence

    if (b.metrics.valueLostCents !== a.metrics.valueLostCents) return b.metrics.valueLostCents - a.metrics.valueLostCents; // (d) maior valor vence

    return a.reason.localeCompare(b.reason); // (e) alfabética
  });

  const prioritario = bySeverity[0];
  const secundarios = bySeverity.slice(1);

  return {
    maiorImpactoFinanceiroMotivo: byValue[0].reason,
    maiorImpactoFinanceiroValueCents: byValue[0].metrics.valueLostCents,
    motivoDiagnosticoPrioritario: prioritario.reason,
    motivosSecundarios: secundarios.map((d) => d.reason),
    acaoPrioritaria: prioritario.acao,
    acoesSecundarias: secundarios.map((d) => d.acao),
  };
}
```

- [ ] **Passo 2: escrever `consolidate.spec.ts`.**
  - `diagnoses=[]` → todos os campos `null`/vazios, `acaoPrioritaria="dados_insuficientes"`.
  - **Exemplo do pedido (§11.3)**: danificado R$300 pontual (`acao="investigar"`, baixa recorrência) vs validade R$220 recorrente (`acao="suspender_abastecimento"`) → `maiorImpactoFinanceiroMotivo="damaged_product"` (R$300 > R$220) **e simultaneamente** `motivoDiagnosticoPrioritario="expired"`, `acaoPrioritaria="suspender_abastecimento"` — os dois campos divergem no mesmo resultado.
  - Caso sem divergência (só validade com perda) → os dois campos coincidem, `motivosSecundarios=[]`.
  - Ordem `avaliar_retirada_rede > avaliar_permanencia_rede > avaliar_retirada_loja > avaliar_permanencia_loja > suspender_abastecimento` testada isoladamente com fixtures de 2 motivos em cada par adjacente.
  - Cada critério de desempate testado isoladamente, forçando os demais a empatar: (a) mesma severidade, recorrência diferente; (b) mesma severidade e recorrência, potencial de intervenção diferente (incluindo o caso "alto"×"alto" caindo para o próximo critério); (c) até aqui empatado, confiança diferente; (d) até aqui empatado, valor diferente; (e) tudo empatado, desempate alfabético determinístico (rodar duas vezes com a mesma entrada em ordem diferente no array de entrada e confirmar que o resultado não muda).
  - **Exceção de segurança**: 3 diagnósticos, um deles `avaliar_retirada_rede` mas não o de maior severidade isolada por algum motivo artificial — confirmar que ele sempre aparece em `acoesSecundarias` quando não é o prioritário (nunca desaparece do resultado).

- [ ] **Passo 3: `pnpm --filter @agiliz/admin typecheck lint test`.**

- [ ] **Passo 4: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/consolidate.ts frontend/apps/admin/src/lib/loss-intelligence/consolidate.spec.ts
git commit -m "feat(admin): add Loss Intelligence Produto×Loja consolidation (Fase 1, spec §11)

Separates maior impacto financeiro (puramente R\$) from
diagnóstico/ação prioritária (severidade > recorrência > potencial de
intervenção ordinal > confiança > valor > alfabética) — the two can
diverge, and the UI shows both.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 13: `priority.ts` — cálculo de prioridade (spec §16)

**Files:**
- Create: `frontend/apps/admin/src/lib/loss-intelligence/priority.ts`
- Test: `frontend/apps/admin/src/lib/loss-intelligence/priority.spec.ts`

**Interfaces:**
- Consumes: `LossAction`, `Confidence`, `Priority`, `LossIntelligenceParameters` (Tasks 1-2).
- Produces: `computePriority` — chamado por `engine.ts` (Task 16) uma vez por Produto×Loja, depois de `consolidate.ts` (Task 12) e `confidence.ts` (Task 14).

- [ ] **Passo 1: escrever `priority.ts`.**

```ts
import type { Confidence, LossAction, Priority } from "./types";
import type { LossIntelligenceParameters } from "./parameters";

export interface PriorityInput {
  acaoPrioritaria: LossAction;
  confianca: Confidence;
  sinaisTransversais: string[];
  /** valueLostCents do motivo de motivoDiagnosticoPrioritario — nunca o de maiorImpactoFinanceiro. */
  valueLostCentsPrioritario: number;
  firstSeenRecently: boolean;
  parameters: LossIntelligenceParameters;
}

const CRITICAL_ACTIONS: LossAction[] = ["suspender_abastecimento", "avaliar_retirada_rede", "avaliar_permanencia_rede"];
const HIGH_ACTIONS: LossAction[] = ["suspender_abastecimento", "avaliar_retirada_loja", "avaliar_retirada_rede", "avaliar_permanencia_loja", "avaliar_permanencia_rede", "reduzir_abastecimento"];
const MEDIUM_ACTIONS: LossAction[] = ["investigar", "manter_monitorar"];

export function computePriority(input: PriorityInput): Priority | null {
  if (input.acaoPrioritaria === "dados_insuficientes") return null;

  const confidenceAtLeastMedia = input.confianca === "alta" || input.confianca === "media";

  let priority: Priority;
  if (
    CRITICAL_ACTIONS.includes(input.acaoPrioritaria) &&
    confidenceAtLeastMedia &&
    (input.sinaisTransversais.length > 0 || input.valueLostCentsPrioritario > input.parameters.priority.criticalValueCents)
  ) {
    priority = "critica";
  } else if (HIGH_ACTIONS.includes(input.acaoPrioritaria)) {
    priority = "alta";
  } else if (MEDIUM_ACTIONS.includes(input.acaoPrioritaria)) {
    priority = "media";
  } else {
    priority = "baixa";
  }

  // Teto explícito para histórico recente (spec §9/§10.4): nunca passa de "media", mesmo que a
  // ação em si já tenha sido capada a montante pelas árvores de diagnóstico — "só Média no máximo",
  // não "só Alta".
  if (input.firstSeenRecently && (priority === "critica" || priority === "alta")) {
    priority = "media";
  }

  return priority;
}
```

- [ ] **Passo 2: escrever `priority.spec.ts`.** Casos: `acaoPrioritaria="dados_insuficientes"` → `null`, sempre, independente dos outros campos; `suspender_abastecimento` + confiança alta + `sinaisTransversais` não-vazio → `"critica"`; `suspender_abastecimento` + confiança baixa → nunca `"critica"` mesmo com sinais transversais (exige confiança ≥ média); `avaliar_retirada_rede` sem sinais transversais mas com `valueLostCentsPrioritario` acima do parâmetro → `"critica"`; mesmo caso com valor abaixo do parâmetro e sem sinais → `"alta"`, não `"critica"`; `reduzir_abastecimento` → sempre `"alta"` (nunca `"critica"`, está fora de `CRITICAL_ACTIONS`); `investigar`/`manter_monitorar` → `"media"`; `manter` → `"baixa"`; **teto de histórico recente**: um caso que seria `"critica"` com `firstSeenRecently=true` vira `"media"` (não `"alta"` — confirmar o "só Média no máximo" literal); um caso `"alta"` com `firstSeenRecently=true` também vira `"media"`; um caso `"media"` com `firstSeenRecently=true` permanece `"media"` (o teto não altera o que já está no nível ou abaixo); **prioridade e confiança são dimensões independentes**: fixture com `acaoPrioritaria="suspender_abastecimento"`, `confianca="baixa"` → prioridade não pode ser `"critica"` (falha a checagem de confiança), mas pode legitimamente ser `"alta"` — o teste confirma que o par (prioridade=alta, confiança=baixa) é aceito pela função sem erro, reproduzindo o exemplo do pedido original.

- [ ] **Passo 3: `pnpm --filter @agiliz/admin typecheck lint test`.**

- [ ] **Passo 4: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/priority.ts frontend/apps/admin/src/lib/loss-intelligence/priority.spec.ts
git commit -m "feat(admin): add Loss Intelligence priority calculation (Fase 1, spec §16)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 14: `confidence.ts` — cálculo de confiança (spec §17)

**Files:**
- Create: `frontend/apps/admin/src/lib/loss-intelligence/confidence.ts`
- Test: `frontend/apps/admin/src/lib/loss-intelligence/confidence.spec.ts`

**Interfaces:**
- Consumes: `Confidence`, `LossIntelligenceParameters` (Tasks 1-2).
- Produces: `computeConfidence` — chamado por `engine.ts` (Task 16) uma vez por motivo, antes de `consolidate.ts` (Task 12) e `priority.ts` (Task 13), que dependem do resultado.

- [ ] **Passo 1: escrever `confidence.ts`.**

```ts
import type { Confidence } from "./types";
import type { LossIntelligenceParameters } from "./parameters";

const CONFIDENCE_ORDER: Confidence[] = ["alta", "media", "baixa", "insuficiente"];

export interface ConfidenceInput {
  /** window.qualifyingRestockPeriods.length (spec §8) — mesmo conceito de "período qualificável" para toda árvore. */
  qualifyingPeriodsCount: number;
  firstSeenRecently: boolean;
  overwhelmingEvidence: boolean;
  /** true só quando a árvore depende de margem para decidir (Outro motivo) e grossMarginCents é null. */
  marginUnknownButNeeded: boolean;
  /** true quando a árvore precisaria da comparação de rede para este caso mas ela ficou "dado_insuficiente". */
  networkComparisonMissingButNeeded: boolean;
  hasContradictoryData: boolean;
  parameters: LossIntelligenceParameters;
}

export function computeConfidence(input: ConfidenceInput): Confidence {
  let confidence: Confidence;

  if (input.qualifyingPeriodsCount < 1 || (input.firstSeenRecently && !input.overwhelmingEvidence) || input.marginUnknownButNeeded) {
    confidence = "insuficiente";
  } else if (input.qualifyingPeriodsCount === 1 || (input.firstSeenRecently && input.overwhelmingEvidence) || input.networkComparisonMissingButNeeded) {
    confidence = "baixa";
  } else if (input.qualifyingPeriodsCount >= input.parameters.confidence.minMonthsForHigh) {
    confidence = "alta";
  } else {
    confidence = "media";
  }

  // Dados contraditórios rebaixam um nível, nunca sobem, e nunca abaixo de "insuficiente" (spec §17).
  if (input.hasContradictoryData) {
    const idx = CONFIDENCE_ORDER.indexOf(confidence);
    confidence = CONFIDENCE_ORDER[Math.min(idx + 1, CONFIDENCE_ORDER.length - 1)];
  }

  return confidence;
}
```

- [ ] **Passo 2: escrever `confidence.spec.ts`.** Um teste por linha do spec §17: `qualifyingPeriodsCount=0` → `"insuficiente"`; `firstSeenRecently=true, overwhelmingEvidence=false` → `"insuficiente"` (nunca "baixa" — checar essa distinção com cuidado, é o ponto onde um erro de leitura da spec seria fácil de cometer); `marginUnknownButNeeded=true` → `"insuficiente"`, mesmo com histórico longo; `qualifyingPeriodsCount=1` → `"baixa"`; `firstSeenRecently=true, overwhelmingEvidence=true` → `"baixa"` (nunca "insuficiente" quando a evidência é esmagadora); `networkComparisonMissingButNeeded=true` com histórico longo → `"baixa"`; `qualifyingPeriodsCount` entre 2 e `minMonthsForHigh-1`, sem nenhuma outra condição → `"media"`; `qualifyingPeriodsCount ≥ minMonthsForHigh`, sem condição rebaixando → `"alta"`; **dados contraditórios**: um caso que seria `"alta"` vira `"media"` com `hasContradictoryData=true`; um caso `"insuficiente"` permanece `"insuficiente"` com `hasContradictoryData=true` (nunca "abaixo" de insuficiente, não existe nível mais baixo).

- [ ] **Passo 3: `pnpm --filter @agiliz/admin typecheck lint test`.**

- [ ] **Passo 4: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/confidence.ts frontend/apps/admin/src/lib/loss-intelligence/confidence.spec.ts
git commit -m "feat(admin): add Loss Intelligence confidence calculation (Fase 1, spec §17)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 15: `explain.ts` — texto determinístico (spec §15.4)

**Files:**
- Create: `frontend/apps/admin/src/lib/loss-intelligence/explain.ts`
- Test: `frontend/apps/admin/src/lib/loss-intelligence/explain.spec.ts`

**Interfaces:**
- Consumes: `LossIntelligenceRecommendation`, `LossReason`, `LossAction` (Task 1).
- Produces: `explainRecommendation` — usado pelo drill-down (Task 19) e por `engine.ts` (Task 16) se quiser anexar o texto à saída (opcional — a UI também pode chamar direto).

- [ ] **Passo 1: escrever `explain.ts`.**

```ts
import type { LossAction, LossIntelligenceRecommendation, LossReason } from "./types";

const REASON_LABELS: Record<LossReason, string> = { expired: "validade", damaged_product: "danificado", other_reason: "Outro motivo" };

const ACTION_LABELS: Record<LossAction, string> = {
  manter: "Manter",
  manter_monitorar: "Manter e monitorar",
  reduzir_abastecimento: "Reduzir abastecimento",
  investigar: "Investigar",
  suspender_abastecimento: "Suspender novos abastecimentos",
  avaliar_retirada_loja: "Avaliar retirada da loja",
  avaliar_retirada_rede: "Avaliar retirada da rede",
  avaliar_permanencia_loja: "Avaliar permanência na loja",
  avaliar_permanencia_rede: "Avaliar permanência na rede",
  dados_insuficientes: "Dados insuficientes",
};

/**
 * Template determinístico — nunca um LLM (spec §15.4/§21). Só usa campos já
 * presentes em `recommendation`; nunca inventa um número.
 */
export function explainRecommendation(recommendation: LossIntelligenceRecommendation): string {
  const r = recommendation;
  const prioritario = r.diagnosticosPorMotivo.find((d) => d.reason === r.motivoDiagnosticoPrioritario);

  if (!prioritario || !r.motivoDiagnosticoPrioritario) {
    return "Evidência insuficiente para uma leitura detalhada neste período.";
  }

  const motivoLabel = REASON_LABELS[r.motivoDiagnosticoPrioritario];
  const factsSentence = `${r.metricasObservadas.qtyRestocked} abastecidos, ${r.metricasObservadas.qtySold} vendidos, ${prioritario.metrics.qtyLost} perdidos por ${motivoLabel} em ${r.metricasObservadas.monthsWithRestock} meses com abastecimento nos últimos ${r.janelaAnalisada.primaryMonths.length} meses.`;

  const nc = r.comparacaoRede[r.motivoDiagnosticoPrioritario];
  const networkSentence =
    nc && nc !== "dado_insuficiente"
      ? nc.storesHealthy.length > 0
        ? `O SKU tem desempenho saudável em ${nc.storesHealthy.length} outras lojas.`
        : `O padrão se repete em ${nc.storesWithSameSignal} de ${nc.storesCarryingSku} lojas comparáveis.`
      : null;

  const recommendationSentence = `${ACTION_LABELS[r.acaoPrioritaria]}.`;

  return [factsSentence, networkSentence, recommendationSentence].filter((sentence): sentence is string => sentence !== null).join(" ");
}
```

- [ ] **Passo 2: escrever `explain.spec.ts`.** Reproduzir o exemplo literal do pedido (Paçoquita, 18/0/5, 3 meses, suspender) e conferir que a string de saída contém os 4 números certos e "Suspender novos abastecimentos"; caso sem diagnóstico prioritário (`motivoDiagnosticoPrioritario=null`) → mensagem de evidência insuficiente, sem lançar exceção; caso sem comparação de rede disponível → frase de rede omitida, sem "undefined" nem string vazia solta na saída; **teste do critério de aceite §22.3**: para uma bateria de fixtures cobrindo todos os `LossAction` e os 3 motivos, a saída nunca contém "estoque", "saldo", "disponibilidade", "ruptura", "cobertura", "sell-through", "roubo", "furto" ou "theft" (case-insensitive).

- [ ] **Passo 3: `pnpm --filter @agiliz/admin typecheck lint test`.**

- [ ] **Passo 4: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/explain.ts frontend/apps/admin/src/lib/loss-intelligence/explain.spec.ts
git commit -m "feat(admin): add Loss Intelligence deterministic explanation template (Fase 1, spec §15.4)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 16: `engine.ts` — orquestração completa (integra Tasks 1-15)

**Por quê é a task mais delicada do plano:** é a única peça que sabe a ordem certa de chamar tudo — inclusive as duas passadas exigidas pela comparação de rede (§12): passe 1 roda `diagnosis/validity.ts` e `diagnosis/other-reason.ts` sem `networkComparison` só para saber quem tem "sinal ruim"; `network-comparison.ts` consome esse resultado; passe 2 roda as duas árvores de novo, agora com `networkComparison` resolvido, para decidir escalada. `diagnosis/damage.ts` não participa dessas duas passadas — calcula sua própria concentração inline e roda uma vez só.

**Files:**
- Create: `frontend/apps/admin/src/lib/loss-intelligence/engine.ts`
- Test: `frontend/apps/admin/src/lib/loss-intelligence/engine.spec.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1-15.
- Produces: `analyzeLossIntelligence(input: LossIntelligenceInput): LossIntelligenceResult` — a única função pública que `loss-tab.tsx` chama (Task 20).

**Duas decisões de implementação que a spec deixou em aberto, resolvidas aqui e documentadas no código (não um novo parâmetro — a spec aprovada tem exatamente 20 em §14):**
1. Os três cenários de impacto (§15.1) usam os mesmos 20%/40%/60% já em uso em `commercial-intelligence` — constantes fixas, não um parâmetro configurável.
2. "Dados contraditórios" (§17) é implementado como a checagem mais simples que a spec cita como exemplo — zero vendas num período fechado seguido de vendas positivas no período seguinte, dentro da janela principal.

- [ ] **Passo 1: escrever `engine.ts`.**

```ts
import {
  LOSS_REASONS,
  type Confidence,
  type LossAction,
  type LossIntelligenceInput,
  type LossIntelligenceRecommendation,
  type LossIntelligenceResult,
  type LossReason,
  type NetworkComparison,
  type Period,
  type ReasonDiagnosis,
  type SalesRecordInput,
} from "./types";
import type { LossIntelligenceParameters } from "./parameters";
import { resolveAnalysisWindow } from "./temporal";
import { computeLossMetrics } from "./metrics";
import { evaluateRecentHistory, hasOverwhelmingEvidence } from "./recent-history-guard";
import { periodsWithLoss } from "./recurrence";
import { computeNetworkComparison, type StoreSignal } from "./network-comparison";
import { diagnoseValidity, isValidityBadSignal } from "./diagnosis/validity";
import { diagnoseDamage } from "./diagnosis/damage";
import { diagnoseOtherReason } from "./diagnosis/other-reason";
import { detectUnnecessarySupply } from "./unnecessary-supply";
import { consolidate } from "./consolidate";
import { computePriority } from "./priority";
import { computeConfidence } from "./confidence";

const ENGINE_VERSION = "loss-intelligence/0.1.0-provisional";
const PARAMETERS_VERSION = "loss-parameters/0.1.0-provisional";

// Mesmos três cenários já usados em commercial-intelligence (20/40/60%) — constantes fixas, não
// um parâmetro configurável: a spec aprovada (§14) lista os 20 thresholds do motor de perdas e
// este não é um deles. Recalibrar exigiria uma nova aprovação de spec, não uma env var.
const IMPACT_SCENARIOS = { conservative: 0.2, expected: 0.4, optimistic: 0.6 } as const;

export function analyzeLossIntelligence(input: LossIntelligenceInput): LossIntelligenceResult {
  const pairs = uniqueStoreSkuPairs(input);

  const pass1 = pairs.map((pair) => computePairAnalysis(pair.storeId, pair.sku, input, null));
  const networkComparisons = computeAllNetworkComparisons(pass1, input);
  const pass2 = pairs.map((pair) => computePairAnalysis(pair.storeId, pair.sku, input, networkComparisons));

  const countsByAction = {} as Record<LossAction, number>;
  for (const rec of pass2) countsByAction[rec.acaoPrioritaria] = (countsByAction[rec.acaoPrioritaria] ?? 0) + 1;

  return { recommendations: pass2, countsByAction, impactEstimateCents: computeImpactEstimate(pass2) };
}

function uniqueStoreSkuPairs(input: LossIntelligenceInput): { storeId: number; sku: string }[] {
  const set = new Set<string>();
  for (const row of input.salesByStorePeriodSku) set.add(`${row.store_id}::${row.sku}`);
  for (const row of input.supplyByStorePeriodSku) set.add(`${row.store_id}::${row.sku}`);
  for (const reconciliation of input.reconciliations) {
    for (const row of reconciliation.loss_by_reason_sku) set.add(`${reconciliation.store_id}::${row.sku}`);
  }
  return [...set].map((key) => {
    const [storeId, sku] = key.split("::");
    return { storeId: Number(storeId), sku };
  });
}

function networkKey(sku: string, reason: LossReason): string {
  return `${sku}::${reason}`;
}

function qtyLostByStoreForSkuReason(input: LossIntelligenceInput, sku: string, reason: LossReason, periods: Period[]): { storeId: number; qtyLost: number }[] {
  return input.stores.map((store) => {
    const qty = input.reconciliations
      .filter((r) => r.store_id === store.id && periods.includes(r.period))
      .flatMap((r) => r.loss_by_reason_sku.filter((row) => row.sku === sku && row.reason === reason))
      .reduce((total, row) => total + row.quantity, 0);
    return { storeId: store.id, qtyLost: qty };
  });
}

function computeConcentrationShareStore(input: LossIntelligenceInput, sku: string, storeId: number, periods: Period[], parameters: LossIntelligenceParameters): number | null {
  const byStore = qtyLostByStoreForSkuReason(input, sku, "other_reason", periods);
  const storesCarrying = byStore.filter((s) => s.qtyLost > 0);
  if (storesCarrying.length < parameters.network.minStoresForNetworkVerdict) return null;
  const total = storesCarrying.reduce((sum, s) => sum + s.qtyLost, 0);
  const thisStore = byStore.find((s) => s.storeId === storeId)?.qtyLost ?? 0;
  return total > 0 ? thisStore / total : 0;
}

/** Zero vendas num período fechado seguido de vendas positivas no seguinte, dentro da janela principal — a checagem mais simples que o exemplo do spec §17 cita, documentada como tal. */
function hasContradictoryPattern(salesRows: SalesRecordInput[], periods: Period[]): boolean {
  const sorted = [...periods].sort();
  const soldByPeriod = new Map(sorted.map((period) => [period, salesRows.filter((row) => row.period === period).reduce((total, row) => total + row.quantity_sold, 0)]));
  for (let i = 0; i < sorted.length - 1; i++) {
    if ((soldByPeriod.get(sorted[i]) ?? 0) === 0 && (soldByPeriod.get(sorted[i + 1]) ?? 0) > 0) return true;
  }
  return false;
}

function computePairAnalysis(storeId: number, sku: string, input: LossIntelligenceInput, network: Map<string, NetworkComparison> | null): LossIntelligenceRecommendation {
  const salesRows = input.salesByStorePeriodSku.filter((r) => r.store_id === storeId && r.sku === sku);
  const supplyRows = input.supplyByStorePeriodSku.filter((r) => r.store_id === storeId && r.sku === sku);
  const reconciliationsForStore = input.reconciliations.filter((r) => r.store_id === storeId);
  const allKnownRestockPeriods = [...new Set(supplyRows.filter((r) => r.quantity_restocked > 0).map((r) => r.period))];

  const window = resolveAnalysisWindow({ storeId, sku, today: input.today, allKnownRestockPeriods, parameters: input.parameters });
  const asOfPeriod = window.primaryClosedPeriods[window.primaryClosedPeriods.length - 1] ?? window.currentInProgressPeriod;

  const metrics = computeLossMetrics({
    storeId, sku,
    allSalesRows: salesRows, allSupplyRows: supplyRows, allReconciliations: reconciliationsForStore,
    costsBySkuAsOf: input.costsBySkuAsOf,
    windowPeriods: window.primaryClosedPeriods,
    asOfPeriod,
  });

  const guard = evaluateRecentHistory({ firstSeenPeriod: metrics.firstSeenPeriod, monthsSinceFirstSeen: metrics.monthsSinceFirstSeen, allSupplyRows: supplyRows, parameters: input.parameters });
  const overwhelming = hasOverwhelmingEvidence({ qtySold: metrics.qtySold, qtyRestocked: metrics.qtyRestocked, parameters: input.parameters });

  const diagnoses: ReasonDiagnosis[] = [];
  const confidenceByReason = {} as Record<LossReason, Confidence>;
  const recurrenceCountByReason = {} as Record<LossReason, number>;

  for (const reason of LOSS_REASONS) {
    const perReason = metrics.byReason[reason];
    if (perReason.qtyLost === 0) continue; // spec §11 item 1

    const recurrencePeriods = periodsWithLoss(reconciliationsForStore, sku, reason, window.recurrenceLookbackPeriods);
    recurrenceCountByReason[reason] = recurrencePeriods.length;

    let diagnosis: ReasonDiagnosis;
    let networkMissingButNeeded = false;
    let marginUnknownButNeeded = false;

    if (reason === "expired") {
      const nc = network?.get(networkKey(sku, "expired")) ?? null;
      diagnosis = diagnoseValidity({
        metrics: perReason, qtySold: metrics.qtySold, saleToSupplyRatio: metrics.saleToSupplyRatio,
        monthsWithRestock: metrics.monthsWithRestock, recurrencePeriodsWithLoss: recurrencePeriods,
        networkComparison: nc, firstSeenRecently: guard.firstSeenRecently, overwhelmingEvidence: overwhelming,
        parameters: input.parameters,
      });
      networkMissingButNeeded = (diagnosis.acao === "suspender_abastecimento" || diagnosis.acao === "reduzir_abastecimento") && nc === "dado_insuficiente";
    } else if (reason === "damaged_product") {
      const qtyLostByStore = qtyLostByStoreForSkuReason(input, sku, "damaged_product", window.primaryClosedPeriods);
      diagnosis = diagnoseDamage({ metrics: perReason, qtyLostDamagedByStore: qtyLostByStore, thisStoreId: storeId, parameters: input.parameters });
    } else {
      const nc = network?.get(networkKey(sku, "other_reason")) ?? null;
      const concentration = computeConcentrationShareStore(input, sku, storeId, window.primaryClosedPeriods, input.parameters);
      marginUnknownButNeeded = metrics.grossMarginCents === null;
      diagnosis = diagnoseOtherReason({
        metrics: perReason, qtySold: metrics.qtySold, grossMarginCents: metrics.grossMarginCents,
        recurrencePeriodsWithLoss: recurrencePeriods, concentrationShareStore: concentration,
        networkComparison: nc, firstSeenRecently: guard.firstSeenRecently, overwhelmingEvidence: overwhelming,
        parameters: input.parameters,
      });
      networkMissingButNeeded = (diagnosis.acao === "avaliar_permanencia_loja" || diagnosis.acao === "avaliar_permanencia_rede") && nc === "dado_insuficiente";
    }

    diagnoses.push(diagnosis);
    confidenceByReason[reason] = computeConfidence({
      qualifyingPeriodsCount: window.qualifyingRestockPeriods.length,
      firstSeenRecently: guard.firstSeenRecently, overwhelmingEvidence: overwhelming,
      marginUnknownButNeeded, networkComparisonMissingButNeeded: networkMissingButNeeded,
      hasContradictoryData: hasContradictoryPattern(salesRows, window.primaryClosedPeriods),
      parameters: input.parameters,
    });
  }

  const consolidated = consolidate({ diagnoses, recurrencePeriodCountByReason: recurrenceCountByReason, confidenceByReason });

  const expiryPeriods = periodsWithLoss(reconciliationsForStore, sku, "expired", window.primaryClosedPeriods);
  const restockPeriods = [...new Set(supplyRows.filter((r) => window.primaryClosedPeriods.includes(r.period) && r.quantity_restocked > 0).map((r) => r.period))];
  const anyReasonRecurrencePeriods = LOSS_REASONS.flatMap((reason) => periodsWithLoss(reconciliationsForStore, sku, reason, window.recurrenceLookbackPeriods));

  const unnecessary = detectUnnecessarySupply({
    qtySold: metrics.qtySold, monthsWithRestock: metrics.monthsWithRestock, saleToSupplyRatio: metrics.saleToSupplyRatio,
    periodsWithExpiryLoss: expiryPeriods, periodsWithRestock: restockPeriods,
    recurrencePeriodsWithAnyLoss: anyReasonRecurrencePeriods, parameters: input.parameters,
  });

  const overallConfidence: Confidence = consolidated.motivoDiagnosticoPrioritario ? confidenceByReason[consolidated.motivoDiagnosticoPrioritario] : "insuficiente";

  const priority = computePriority({
    acaoPrioritaria: consolidated.acaoPrioritaria, confianca: overallConfidence, sinaisTransversais: unnecessary.sinaisTransversais,
    valueLostCentsPrioritario: consolidated.motivoDiagnosticoPrioritario ? metrics.byReason[consolidated.motivoDiagnosticoPrioritario].valueLostCents : 0,
    firstSeenRecently: guard.firstSeenRecently, parameters: input.parameters,
  });

  const comparacaoRede = {} as Record<LossReason, NetworkComparison>;
  for (const reason of LOSS_REASONS) comparacaoRede[reason] = network?.get(networkKey(sku, reason)) ?? "dado_insuficiente";

  const limitacoesDosDados: string[] = [];
  if (metrics.grossMarginCents === null) limitacoesDosDados.push("margem_desconhecida");
  if (guard.firstSeenRecently) limitacoesDosDados.push("historico_recente");

  return {
    sku, storeId,
    janelaAnalisada: { primaryMonths: window.primaryClosedPeriods, recurrenceLookbackMonths: window.recurrenceLookbackPeriods },
    metricasObservadas: metrics,
    diagnosticosPorMotivo: diagnoses,
    maiorImpactoFinanceiroMotivo: consolidated.maiorImpactoFinanceiroMotivo,
    maiorImpactoFinanceiroValueCents: consolidated.maiorImpactoFinanceiroValueCents,
    motivoDiagnosticoPrioritario: consolidated.motivoDiagnosticoPrioritario,
    motivosSecundarios: consolidated.motivosSecundarios,
    acaoPrioritaria: consolidated.acaoPrioritaria,
    acoesSecundarias: consolidated.acoesSecundarias,
    sinaisTransversais: unnecessary.sinaisTransversais,
    prioridade: priority,
    confianca: overallConfidence,
    comparacaoRede,
    limitacoesDosDados,
    firstSeenRecently: guard.firstSeenRecently,
    versaoMotor: ENGINE_VERSION,
    versaoParametros: PARAMETERS_VERSION,
  };
}

function isBadSignalFor(reason: LossReason, rec: LossIntelligenceRecommendation): boolean {
  const diagnosis = rec.diagnosticosPorMotivo.find((d) => d.reason === reason);
  if (!diagnosis) return false;
  if (reason === "expired") return isValidityBadSignal(diagnosis.acao);
  if (reason === "other_reason") return diagnosis.acao === "avaliar_permanencia_loja" || diagnosis.acao === "avaliar_permanencia_rede";
  return false; // damaged_product não usa network-comparison.ts — calcula concentração inline.
}

function computeAllNetworkComparisons(pass1: LossIntelligenceRecommendation[], input: LossIntelligenceInput): Map<string, NetworkComparison> {
  const map = new Map<string, NetworkComparison>();
  const skus = [...new Set(pass1.map((r) => r.sku))];

  for (const sku of skus) {
    for (const reason of LOSS_REASONS) {
      const perStore: StoreSignal[] = input.stores.map((store) => {
        const rec = pass1.find((r) => r.sku === sku && r.storeId === store.id);
        return {
          storeId: store.id,
          storeName: store.name,
          qtyRestocked: rec?.metricasObservadas.qtyRestocked ?? 0,
          qtySold: rec?.metricasObservadas.qtySold ?? 0,
          hasBadSignal: rec ? isBadSignalFor(reason, rec) : false,
        };
      });
      map.set(networkKey(sku, reason), computeNetworkComparison({ perStore, parameters: input.parameters }));
    }
  }
  return map;
}

function computeImpactEstimate(recommendations: LossIntelligenceRecommendation[]): { conservative: number; expected: number; optimistic: number } {
  const eligible = recommendations.filter((r) => r.acaoPrioritaria !== "manter" && r.acaoPrioritaria !== "dados_insuficientes");
  const totalValueLostCents = eligible.reduce((sum, r) => {
    const reason = r.motivoDiagnosticoPrioritario;
    return sum + (reason ? r.metricasObservadas.byReason[reason].valueLostCents : 0);
  }, 0);
  return {
    conservative: Math.round(totalValueLostCents * IMPACT_SCENARIOS.conservative),
    expected: Math.round(totalValueLostCents * IMPACT_SCENARIOS.expected),
    optimistic: Math.round(totalValueLostCents * IMPACT_SCENARIOS.optimistic),
  };
}
```

- [ ] **Passo 2: escrever `engine.spec.ts`.** Teste de integração ponta a ponta, com um `LossIntelligenceInput` sintético (nunca dado real do banco):
  - Fixture com **3 lojas, 1 SKU**, cobrindo os 3 motivos ao mesmo tempo na loja em análise, reproduzindo o exemplo de divergência do spec §11.3 (dano pontual de maior R$, validade recorrente de menor R$) → confirma `maiorImpactoFinanceiroMotivo` e `motivoDiagnosticoPrioritario` divergem exatamente como o consolidate.spec.ts já testou isoladamente, agora vindos do pipeline completo.
  - Fixture reproduzindo o exemplo literal Paçoquita (18 abastecidos, 0 vendidos, 5 perdidos por validade, 3 meses com abastecimento, saudável em 9 de 10 lojas) → `acaoPrioritaria="suspender_abastecimento"` na loja afetada (via passe 1 + passe 2, confirmando que a escalada de rede D/E só acontece depois de a comparação estar disponível).
  - Fixture com 17 lojas onde o SKU tem baixo desempenho recorrente em 14 → a loja em análise recebe `avaliar_retirada_rede`, confirmando que a segunda passada realmente usa o resultado da primeira.
  - Fixture de "Outro motivo" severo e recorrente, com rede majoritariamente saudável → `avaliar_permanencia_loja`, nunca `avaliar_retirada_*` — checagem explícita em todo o array de `recommendations`.
  - Fixture com SKU novo (`firstSeenRecently=true` esperado) → nenhuma recomendação para esse par Produto×Loja ultrapassa a severidade de `reduzir_abastecimento`/`investigar`, e `prioridade` nunca passa de `"media"`.
  - `countsByAction` soma exatamente para o número de pares Produto×Loja da fixture.
  - `impactEstimateCents.conservative ≤ expected ≤ optimistic`, e a soma exclui explicitamente linhas com `acaoPrioritaria` igual a `"manter"` ou `"dados_insuficientes"` (fixture com uma linha "manter" de valor alto, confirmando que não entra na soma).
  - Nenhum objeto de saída lança exceção nem produz `NaN`/`Infinity` em nenhum campo numérico, para uma fixture com todos os denominadores em zero (loja sem nenhum abastecimento nem venda, só perda registrada — caso extremo do spec §19).

- [ ] **Passo 3: `pnpm --filter @agiliz/admin typecheck lint test`.** Este é o ponto de verificação mais importante do motor — toda a suíte das Tasks 1-16 deve passar junto.

- [ ] **Passo 4: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/engine.ts frontend/apps/admin/src/lib/loss-intelligence/engine.spec.ts
git commit -m "feat(admin): add Loss Intelligence engine orchestration (Fase 1)

analyzeLossIntelligence() — two-pass per Produto×Loja: pass 1 resolves
each reason's local diagnosis, network-comparison.ts consumes it,
pass 2 re-runs validity/other-reason with the network verdict
available for escalation. Completes the Fase 1 engine end to end.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 17: `agent-summary-panel.tsx` — painel do topo (spec §15.1)

**Files:**
- Create: `frontend/apps/admin/src/components/supply/loss-intelligence/agent-summary-panel.tsx`
- Test: `frontend/apps/admin/src/components/supply/loss-intelligence/agent-summary-panel.spec.tsx`

**Interfaces:**
- Consumes: `LossIntelligenceResult`, `LossAction` (Task 1).
- Produces: `AgentSummaryPanel` — usado por `loss-tab.tsx` (Task 20).

- [ ] **Passo 1: escrever `agent-summary-panel.tsx`.**

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LossAction, LossIntelligenceResult } from "@/lib/loss-intelligence/types";

const ACTION_ROWS: { action: LossAction; icon: string; label: string }[] = [
  { action: "suspender_abastecimento", icon: "🔴", label: "suspender abastecimento" },
  { action: "reduzir_abastecimento", icon: "🟡", label: "reduzir abastecimento" },
  { action: "investigar", icon: "🟠", label: "investigar" },
  { action: "avaliar_retirada_rede", icon: "⚫", label: "avaliar retirada da rede" },
  { action: "avaliar_retirada_loja", icon: "🔴", label: "avaliar retirada da loja" },
  { action: "avaliar_permanencia_rede", icon: "⚫", label: "avaliar permanência na rede (Outro motivo)" },
  { action: "avaliar_permanencia_loja", icon: "🔴", label: "avaliar permanência na loja (Outro motivo)" },
];

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Bloco de prioridades no topo da seção inteligente da aba Perdas — nunca duplica os KPIs/gráficos já existentes (spec §15.1, §25 do pedido). */
export function AgentSummaryPanel({ result, onSeeAll }: { result: LossIntelligenceResult; onSeeAll: () => void }) {
  const rows = ACTION_ROWS.filter((row) => (result.countsByAction[row.action] ?? 0) > 0);
  const totalActionable = rows.reduce((sum, row) => sum + (result.countsByAction[row.action] ?? 0), 0);

  if (totalActionable === 0) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>✦ Agente de Perdas</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Nenhuma recomendação de atenção neste período.</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>✦ Agente de Perdas</CardTitle>
        <p className="text-sm text-muted-foreground">{totalActionable} decisões recomendadas</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1 text-sm">
          {rows.map((row) => (
            <li key={row.action}>
              {row.icon} {result.countsByAction[row.action]} {row.label}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          Impacto potencial estimado: {formatCents(result.impactEstimateCents.conservative)}–{formatCents(result.impactEstimateCents.optimistic)}/mês em perdas potencialmente evitáveis.
        </p>
        <Button variant="outline" size="sm" onClick={onSeeAll} className="self-start">
          Ver todas as recomendações
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Passo 2: escrever `agent-summary-panel.spec.tsx`.** Render com um `LossIntelligenceResult` sintético contendo contagens em 3 ações diferentes → confirma as 3 linhas aparecem com os números certos e nenhuma linha de contagem zero aparece; `totalActionable=0` → mensagem "Nenhuma recomendação", sem renderizar a lista nem o botão; texto de impacto nunca contém a palavra "garantid" (nunca "economia garantida" — checagem literal); clique no botão chama `onSeeAll`.

- [ ] **Passo 3: `pnpm --filter @agiliz/admin typecheck lint test`.**

- [ ] **Passo 4: commit.**

```bash
git add frontend/apps/admin/src/components/supply/loss-intelligence/agent-summary-panel.tsx frontend/apps/admin/src/components/supply/loss-intelligence/agent-summary-panel.spec.tsx
git commit -m "feat(admin): add Loss Intelligence agent summary panel (Fase 1, spec §15.1)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 18: `decisions-table.tsx` — tabela "Produtos que exigem decisão" (spec §15.2)

**Files:**
- Create: `frontend/apps/admin/src/components/supply/loss-intelligence/decisions-table.tsx`
- Test: `frontend/apps/admin/src/components/supply/loss-intelligence/decisions-table.spec.tsx`

**Interfaces:**
- Consumes: `LossIntelligenceRecommendation`, `LossAction`, `LossReason`, `Priority`, `Confidence` (Task 1).
- Produces: `LossDecisionsTable` — usado por `loss-tab.tsx` (Task 20); emite `onSelect(recommendation)` para abrir o drawer (Task 19).

- [ ] **Passo 1: ler `frontend/apps/admin/src/components/supply/loss-tab.tsx` primeiro**, especificamente como ele já implementa filtro de coluna hoje (`ColumnValueFilter`, mencionado no cabeçalho do arquivo), para decidir se reaproveita o mesmo componente de filtro ou usa `Select` do shadcn diretamente — usar o padrão já estabelecido no arquivo, não inventar um novo.

- [ ] **Passo 2: escrever `decisions-table.tsx`.**

```tsx
"use client";

import { useMemo, useState } from "react";

import { ConfidenceBadge } from "@/components/confidence-badge";
import { StatusBadge } from "@/components/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Confidence, LossAction, LossIntelligenceRecommendation, LossReason, Priority } from "@/lib/loss-intelligence/types";

const ACTION_LABELS: Record<LossAction, string> = {
  manter: "Manter",
  manter_monitorar: "Manter e monitorar",
  reduzir_abastecimento: "Reduzir",
  investigar: "Investigar",
  suspender_abastecimento: "Suspender",
  avaliar_retirada_loja: "Avaliar retirada (loja)",
  avaliar_retirada_rede: "Avaliar retirada (rede)",
  avaliar_permanencia_loja: "Avaliar permanência (loja)",
  avaliar_permanencia_rede: "Avaliar permanência (rede)",
  dados_insuficientes: "Dados insuficientes",
};

const ACTION_TONE: Record<LossAction, "neutral" | "positive" | "attention" | "critical"> = {
  manter: "positive",
  manter_monitorar: "positive",
  reduzir_abastecimento: "attention",
  investigar: "attention",
  suspender_abastecimento: "critical",
  avaliar_retirada_loja: "critical",
  avaliar_retirada_rede: "critical",
  avaliar_permanencia_loja: "critical",
  avaliar_permanencia_rede: "critical",
  dados_insuficientes: "neutral",
};

const REASON_LABELS: Record<LossReason, string> = { expired: "Validade", damaged_product: "Danificado", other_reason: "Outro motivo" };

export interface DecisionRowData {
  recommendation: LossIntelligenceRecommendation;
  productLabel: string;
  storeName: string;
  category: string | null;
  diagnosticoResumo: string;
}

export function LossDecisionsTable({ rows, onSelect }: { rows: DecisionRowData[]; onSelect: (recommendation: LossIntelligenceRecommendation) => void }) {
  const [reasonFilter, setReasonFilter] = useState<LossReason | "all">("all");
  const [actionFilter, setActionFilter] = useState<LossAction | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [confidenceFilter, setConfidenceFilter] = useState<Confidence | "all">("all");
  const [storeFilter, setStoreFilter] = useState<string | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<string | "all">("all");

  const stores = useMemo(() => [...new Set(rows.map((row) => row.storeName))].sort(), [rows]);
  const categories = useMemo(() => [...new Set(rows.map((row) => row.category).filter((c): c is string => c !== null))].sort(), [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const r = row.recommendation;
        if (reasonFilter !== "all" && r.motivoDiagnosticoPrioritario !== reasonFilter) return false;
        if (actionFilter !== "all" && r.acaoPrioritaria !== actionFilter) return false;
        if (priorityFilter !== "all" && r.prioridade !== priorityFilter) return false;
        if (confidenceFilter !== "all" && r.confianca !== confidenceFilter) return false;
        if (storeFilter !== "all" && row.storeName !== storeFilter) return false;
        if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
        return true;
      }),
    [rows, reasonFilter, actionFilter, priorityFilter, confidenceFilter, storeFilter, categoryFilter],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <FilterSelect label="Motivo" value={reasonFilter} onChange={setReasonFilter} options={[["expired", "Validade"], ["damaged_product", "Danificado"], ["other_reason", "Outro motivo"]]} />
        <FilterSelect label="Ação" value={actionFilter} onChange={setActionFilter} options={(Object.entries(ACTION_LABELS) as [LossAction, string][])} />
        <FilterSelect label="Prioridade" value={priorityFilter} onChange={setPriorityFilter} options={[["critica", "Crítica"], ["alta", "Alta"], ["media", "Média"], ["baixa", "Baixa"]]} />
        <FilterSelect label="Confiança" value={confidenceFilter} onChange={setConfidenceFilter} options={[["alta", "Alta"], ["media", "Média"], ["baixa", "Baixa"], ["insuficiente", "Insuficiente"]]} />
        <FilterSelect label="Loja" value={storeFilter} onChange={setStoreFilter} options={stores.map((s) => [s, s] as [string, string])} />
        <FilterSelect label="Categoria" value={categoryFilter} onChange={setCategoryFilter} options={categories.map((c) => [c, c] as [string, string])} />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produto</TableHead>
            <TableHead>Loja</TableHead>
            <TableHead className="text-right">Vendas</TableHead>
            <TableHead className="text-right">Abastecido</TableHead>
            <TableHead className="text-right">Perda</TableHead>
            <TableHead>Maior impacto</TableHead>
            <TableHead>Ação prioritária</TableHead>
            <TableHead>Diagnóstico</TableHead>
            <TableHead>Prioridade</TableHead>
            <TableHead>Confiança</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((row) => {
            const r = row.recommendation;
            const divergent = r.maiorImpactoFinanceiroMotivo !== null && r.maiorImpactoFinanceiroMotivo !== r.motivoDiagnosticoPrioritario;
            return (
              <TableRow key={`${r.storeId}-${r.sku}`} className="cursor-pointer" onClick={() => onSelect(r)}>
                <TableCell>{row.productLabel}</TableCell>
                <TableCell>{row.storeName}</TableCell>
                <TableCell className="text-right tabular">{r.metricasObservadas.qtySold}</TableCell>
                <TableCell className="text-right tabular">{r.metricasObservadas.qtyRestocked}</TableCell>
                <TableCell className="text-right tabular">{r.motivoDiagnosticoPrioritario ? r.metricasObservadas.byReason[r.motivoDiagnosticoPrioritario].qtyLost : 0}</TableCell>
                <TableCell>
                  {r.maiorImpactoFinanceiroMotivo ? REASON_LABELS[r.maiorImpactoFinanceiroMotivo] : "—"}
                  {divergent && <span className="ml-1 text-xs text-muted-foreground">(diagnóstico prioritário é outro)</span>}
                </TableCell>
                <TableCell>
                  <StatusBadge tone={ACTION_TONE[r.acaoPrioritaria]}>{ACTION_LABELS[r.acaoPrioritaria]}</StatusBadge>
                </TableCell>
                <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{row.diagnosticoResumo}</TableCell>
                <TableCell className="capitalize">{r.prioridade ?? "—"}</TableCell>
                <TableCell>
                  <ConfidenceBadge level={r.confianca} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function FilterSelect<T extends string>({ label, value, onChange, options }: { label: string; value: T | "all"; onChange: (value: T | "all") => void; options: [T, string][] }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T | "all")}>
      <SelectTrigger className="w-auto min-w-36">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{label}: todos</SelectItem>
        {options.map(([optValue, optLabel]) => (
          <SelectItem key={optValue} value={optValue}>
            {optLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

**Nota**: se `ConfidenceBadge`/`StatusBadge` tiverem uma prop diferente de `level`/`tone` do que o assumido aqui, ajustar para a assinatura real — confirmar lendo `frontend/apps/admin/src/components/confidence-badge.tsx` e `status-badge.tsx` antes de finalizar (mesma cautela do Passo 1 do Task 0).

- [ ] **Passo 3: escrever `decisions-table.spec.tsx`.** Render com 5 linhas sintéticas cobrindo os 3 motivos e pelo menos 3 ações diferentes; cada filtro isolado reduz a lista para exatamente as linhas esperadas; combinação de 2 filtros simultâneos; clique numa linha chama `onSelect` com a recomendação certa; linha com `maiorImpactoFinanceiroMotivo !== motivoDiagnosticoPrioritario` mostra o aviso de divergência, linha sem divergência não mostra.

- [ ] **Passo 4: `pnpm --filter @agiliz/admin typecheck lint test`.**

- [ ] **Passo 5: commit.**

```bash
git add frontend/apps/admin/src/components/supply/loss-intelligence/decisions-table.tsx frontend/apps/admin/src/components/supply/loss-intelligence/decisions-table.spec.tsx
git commit -m "feat(admin): add Loss Intelligence decisions table with filters (Fase 1, spec §15.2)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 19: `decision-drawer.tsx` + `rules-fired-detail.tsx` — drill-down (spec §15.3)

**Files:**
- Modify: `frontend/apps/admin/src/lib/loss-intelligence/types.ts` (campo `historico` — ver Passo 0)
- Modify: `frontend/apps/admin/src/lib/loss-intelligence/engine.ts` (preenche `historico`)
- Modify: `frontend/apps/admin/src/lib/loss-intelligence/engine.spec.ts` (cobre o campo novo)
- Create: `frontend/apps/admin/src/components/supply/loss-intelligence/decision-drawer.tsx`
- Create: `frontend/apps/admin/src/components/supply/loss-intelligence/rules-fired-detail.tsx`
- Test: `frontend/apps/admin/src/components/supply/loss-intelligence/decision-drawer.spec.tsx`

**Interfaces:**
- Consumes: `LossIntelligenceRecommendation` (Task 1, estendido), `explainRecommendation` (Task 15).
- Produces: `LossDecisionDrawer` — usado por `loss-tab.tsx` (Task 20).

**Passo 0 — gap descoberto ao desenhar o drill-down: falta histórico por período.** O contrato de saída original (Task 1) não tem uma quebra por período dentro do lookback de recorrência, que a seção "Histórico" do spec §15.3/§24 do pedido exige ("Junho: X / Julho: X / Agosto: X"). Adicionar:

- [ ] Em `types.ts`, dentro de `LossIntelligenceRecommendation`, adicionar o campo:

```ts
  /** Uma entrada por período do lookback de recorrência, do mais antigo ao mais recente — spec §15.3. */
  historico: { period: Period; qtyRestocked: number; qtySold: number; qtyLostByReason: Record<LossReason, number> }[];
```

- [ ] Em `engine.ts`, dentro de `computePairAnalysis`, antes do `return`, calcular:

```ts
const historico = window.recurrenceLookbackPeriods.map((period) => ({
  period,
  qtyRestocked: supplyRows.filter((r) => r.period === period).reduce((total, r) => total + r.quantity_restocked, 0),
  qtySold: salesRows.filter((r) => r.period === period).reduce((total, r) => total + r.quantity_sold, 0),
  qtyLostByReason: Object.fromEntries(
    LOSS_REASONS.map((reason) => [
      reason,
      reconciliationsForStore
        .filter((r) => r.period === period)
        .flatMap((r) => r.loss_by_reason_sku.filter((row) => row.sku === sku && row.reason === reason))
        .reduce((total, row) => total + row.quantity, 0),
    ]),
  ) as Record<LossReason, number>,
}));
```

  e incluir `historico,` no objeto retornado.

- [ ] Em `engine.spec.ts`, adicionar um caso: fixture com valores diferentes de abastecido/vendido em cada um dos 6 períodos do lookback padrão → `historico` tem 6 entradas, em ordem cronológica, cada uma batendo com os números da fixture daquele período especificamente (não confundir com a soma da janela principal).

- [ ] **Passo 1: `pnpm --filter @agiliz/admin typecheck lint test` antes de seguir**, confirmando que a extensão não quebrou nada das Tasks 1-16.

- [ ] **Passo 2: escrever `rules-fired-detail.tsx`.**

```tsx
"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReasonDiagnosis } from "@/lib/loss-intelligence/types";

const REASON_LABELS: Record<string, string> = { expired: "Validade", damaged_product: "Danificado", other_reason: "Outro motivo" };

/** "Ver detalhes técnicos" dentro do drawer — mostra sinais/regras acionadas por motivo, escondido por padrão. */
export function RulesFiredDetail({ diagnoses }: { diagnoses: ReasonDiagnosis[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 p-3 text-left text-sm font-medium">
        {open ? <ChevronDown aria-hidden className="size-4" /> : <ChevronRight aria-hidden className="size-4" />}
        Ver regras acionadas
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t p-3 text-sm">
          {diagnoses.map((diagnosis) => (
            <div key={diagnosis.reason}>
              <p className="font-medium">{REASON_LABELS[diagnosis.reason]}</p>
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {diagnosis.regrasAcionadas.map((rule) => (
                  <li key={rule}>
                    <code>{rule}</code>
                  </li>
                ))}
              </ul>
              {diagnosis.hipoteses.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">Hipóteses a investigar (não afirmadas): {diagnosis.hipoteses.join(", ")}.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Passo 3: escrever `decision-drawer.tsx`.**

```tsx
"use client";

import { ConfidenceBadge } from "@/components/confidence-badge";
import { StatusBadge } from "@/components/status-badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { explainRecommendation } from "@/lib/loss-intelligence/explain";
import type { LossIntelligenceRecommendation, LossReason } from "@/lib/loss-intelligence/types";
import { RulesFiredDetail } from "./rules-fired-detail";

const REASON_LABELS: Record<LossReason, string> = { expired: "Validade", damaged_product: "Danificado", other_reason: "Outro motivo" };

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function LossDecisionDrawer({
  recommendation,
  productLabel,
  storeName,
  open,
  onOpenChange,
}: {
  recommendation: LossIntelligenceRecommendation | null;
  productLabel: string;
  storeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!recommendation) return null;
  const r = recommendation;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {productLabel} — {storeName}
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="critical">{r.acaoPrioritaria}</StatusBadge>
            <span className="text-sm text-muted-foreground capitalize">Prioridade: {r.prioridade ?? "—"}</span>
            <ConfidenceBadge level={r.confianca} />
          </div>

          <section>
            <h3 className="mb-1 text-sm font-medium">Evidências ({r.janelaAnalisada.primaryMonths.length} meses)</h3>
            <dl className="grid grid-cols-2 gap-1 text-sm">
              <dt className="text-muted-foreground">Abastecido</dt>
              <dd className="tabular">{r.metricasObservadas.qtyRestocked}</dd>
              <dt className="text-muted-foreground">Vendido</dt>
              <dd className="tabular">{r.metricasObservadas.qtySold}</dd>
              <dt className="text-muted-foreground">Meses com abastecimento</dt>
              <dd className="tabular">{r.metricasObservadas.monthsWithRestock}</dd>
              <dt className="text-muted-foreground">Margem gerada</dt>
              <dd className="tabular">{r.metricasObservadas.grossMarginCents !== null ? formatCents(r.metricasObservadas.grossMarginCents) : "desconhecida"}</dd>
            </dl>
          </section>

          <section>
            <h3 className="mb-1 text-sm font-medium">Histórico</h3>
            <ul className="text-sm">
              {r.historico.map((entry) => (
                <li key={entry.period}>
                  {entry.period}: abastecido {entry.qtyRestocked} / vendido {entry.qtySold} / perdido {Object.values(entry.qtyLostByReason).reduce((sum, q) => sum + q, 0)}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-1 text-sm font-medium">Comparação com a rede</h3>
            {r.motivoDiagnosticoPrioritario && r.comparacaoRede[r.motivoDiagnosticoPrioritario] !== "dado_insuficiente" ? (
              <p className="text-sm text-muted-foreground">
                O SKU tem desempenho saudável em {(r.comparacaoRede[r.motivoDiagnosticoPrioritario] as Exclude<typeof r.comparacaoRede[LossReason], "dado_insuficiente">).storesHealthy.length} outras lojas.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Lojas comparáveis insuficientes para uma comparação de rede.</p>
            )}
          </section>

          <section>
            <h3 className="mb-1 text-sm font-medium">Diagnóstico</h3>
            <p className="text-sm">
              Maior impacto financeiro: {r.maiorImpactoFinanceiroMotivo ? REASON_LABELS[r.maiorImpactoFinanceiroMotivo] : "—"} ({formatCents(r.maiorImpactoFinanceiroValueCents)})
            </p>
            <p className="text-sm">Diagnóstico prioritário: {r.motivoDiagnosticoPrioritario ? REASON_LABELS[r.motivoDiagnosticoPrioritario] : "—"}</p>
            {r.motivosSecundarios.length > 0 && <p className="text-sm text-muted-foreground">Também presente: {r.motivosSecundarios.map((m) => REASON_LABELS[m]).join(", ")}.</p>}
          </section>

          <section>
            <h3 className="mb-1 text-sm font-medium">Recomendação</h3>
            <p className="text-sm">{explainRecommendation(r)}</p>
          </section>

          <RulesFiredDetail diagnoses={r.diagnosticosPorMotivo} />

          {r.limitacoesDosDados.length > 0 && (
            <section className="rounded-lg border border-warning/30 bg-warning/12 p-3 text-sm text-warning">
              <p className="font-medium">Limitações</p>
              <ul className="list-disc pl-4 text-xs">
                {r.limitacoesDosDados.map((limitacao) => (
                  <li key={limitacao}>{limitacao}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

**Nota**: verificar a assinatura real de `StatusBadge`/`ConfidenceBadge` (mesma ressalva do Task 18) e trocar o texto cru de `r.acaoPrioritaria` por um label amigável (reaproveitar `ACTION_LABELS` de `decisions-table.tsx` — exportar de lá em vez de duplicar).

- [ ] **Passo 4: escrever `decision-drawer.spec.tsx`.** Render com uma recomendação sintética completa → cada seção mostra os números certos; `recommendation=null` → não renderiza nada (sem erro); seção "Comparação com a rede" mostra a mensagem de dado insuficiente quando `comparacaoRede[motivo]==="dado_insuficiente"`; `historico` renderiza uma linha por período, na ordem cronológica da fixture; limitações só aparecem quando `limitacoesDosDados` não está vazio.

- [ ] **Passo 5: `pnpm --filter @agiliz/admin typecheck lint test`.**

- [ ] **Passo 6: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/types.ts frontend/apps/admin/src/lib/loss-intelligence/engine.ts frontend/apps/admin/src/lib/loss-intelligence/engine.spec.ts frontend/apps/admin/src/components/supply/loss-intelligence/decision-drawer.tsx frontend/apps/admin/src/components/supply/loss-intelligence/rules-fired-detail.tsx frontend/apps/admin/src/components/supply/loss-intelligence/decision-drawer.spec.tsx
git commit -m "feat(admin): add Loss Intelligence decision drill-down drawer (Fase 1, spec §15.3)

Also extends the output contract with per-period historico, a gap
found while designing this drawer's Histórico section.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 20: Ligar tudo em `loss-tab.tsx` + página de calibração do Agente de Perdas

**Última task — integra as Tasks 0-19 na tela real.**

**Files:**
- Read first (confirmar assinaturas exatas antes de escrever qualquer linha): `frontend/apps/admin/src/components/supply/loss-tab.tsx` (estrutura completa, hooks já usados, onde a matriz Produto×Loja e o ranking já são renderizados — a nova seção entra ANTES ou DEPOIS deles, nunca no meio, e nunca duplica o que já existe ali, per spec §15.2), `frontend/apps/admin/src/lib/api/finance.ts` (`Reconciliation`, `NetworkReconciliationRangeRow`, `useGetNetworkReconciliationRangeQuery`), `frontend/apps/admin/src/lib/api/sales.ts` (`SalesRecord`, `useGetNetworkSalesRangeQuery`), `frontend/apps/admin/src/lib/api/supply.ts` (`useGetNetworkSupplyRangeQuery`), `frontend/apps/admin/src/lib/api/products.ts` (procurar o hook de custo datado — `GET /costs` per `products-service/CLAUDE.md`; se não existir um hook RTK Query pronto, criar um pequeno, seguindo o padrão dos demais em `lib/api/products.ts`), `frontend/apps/admin/src/lib/api/stores.ts` (`Store`, lista de lojas já carregada em algum nível de `/supply`).

- Create: `frontend/apps/admin/src/lib/loss-intelligence/parameter-rows.ts`
- Create: `frontend/apps/admin/src/app/(app)/supply/loss-intelligence/calibration/page.tsx`
- Modify: `frontend/apps/admin/src/components/supply/loss-tab.tsx`
- Test: `frontend/apps/admin/src/lib/loss-intelligence/parameter-rows.spec.ts`

**Interfaces:**
- Consumes: tudo das Tasks 0-19.
- Produces: a seção "Agente de Perdas" visível na aba Perdas real.

- [ ] **Passo 1: escrever `parameter-rows.ts`** (mesmo padrão do Task 0, agora para `loss.*`):

```ts
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
```

- [ ] **Passo 2: escrever `parameter-rows.spec.ts`** — mesma cobertura do equivalente em `commercial-intelligence` (Task 0, Passo 7): todo path de `PARAMETER_PATHS` aparece em exatamente uma seção; todo path `kind==="business"` também aparece em `lossBusinessRuleRows`.

- [ ] **Passo 3: escrever a página de calibração** `frontend/apps/admin/src/app/(app)/supply/loss-intelligence/calibration/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ParameterCatalog } from "@/components/parameter-catalog";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RUNTIME_PARAMETERS } from "@/lib/loss-intelligence/parameters";
import { lossParameterCatalogSections } from "@/lib/loss-intelligence/parameter-rows";

export default function LossIntelligenceCalibrationPage() {
  const { parameters, warnings } = RUNTIME_PARAMETERS;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Configurações avançadas / calibração — Agente de Perdas"
        description="Os 20 thresholds provisórios do motor de Loss Intelligence, com a documentação de cada um. Não é a experiência principal: aqui se revisa, não se decide o negócio."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/supply">
              <ArrowLeft aria-hidden />
              Voltar a Perdas
            </Link>
          </Button>
        }
      />

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Todos os valores são provisórios
            <StatusBadge tone="attention">provisório</StatusBadge>
          </CardTitle>
          <CardDescription>Escritos antes de ver meses reais — guardrails, não regras definitivas. Nunca ajustados para fazer aparecer resultado.</CardDescription>
        </CardHeader>
      </Card>

      {warnings.length > 0 && (
        <section className="rounded-lg border border-warning/30 bg-warning/12 p-3 text-sm text-warning" role="status">
          <p className="font-medium">Valores do ambiente ignorados</p>
          <ul className="mt-1 list-disc pl-4 text-xs">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      <ParameterCatalog sections={lossParameterCatalogSections(parameters)} />
    </div>
  );
}
```

- [ ] **Passo 4: montar o `LossIntelligenceInput` dentro de `loss-tab.tsx`** e renderizar as três peças novas. A forma exata depende do que o Passo "Read first" encontrar — o esqueleto é:

```tsx
// Novos imports no topo de loss-tab.tsx
import { useMemo, useState } from "react";
import { analyzeLossIntelligence } from "@/lib/loss-intelligence/engine";
import { RUNTIME_PARAMETERS } from "@/lib/loss-intelligence/parameters";
import { AgentSummaryPanel } from "./loss-intelligence/agent-summary-panel";
import { LossDecisionsTable, type DecisionRowData } from "./loss-intelligence/decisions-table";
import { LossDecisionDrawer } from "./loss-intelligence/decision-drawer";
import type { LossIntelligenceInput, LossIntelligenceRecommendation } from "@/lib/loss-intelligence/types";

// Dentro do componente LossTab, junto dos hooks já existentes:
const [selectedRecommendation, setSelectedRecommendation] = useState<LossIntelligenceRecommendation | null>(null);

const lossIntelligenceInput = useMemo<LossIntelligenceInput | null>(() => {
  // CONFIRMAR contra o shape real de reconciliationRange/salesRange/supplyRange/costsData
  // encontrado no Passo "Read first" — os nomes de campo abaixo são o contrato de
  // types.ts (Task 1), não o shape das respostas RTK Query, que precisa ser adaptado aqui.
  if (!reconciliationRange || !salesRange || !supplyRange || !costsBySkuAsOf || !stores) return null;

  return {
    reconciliations: /* adaptar reconciliationRange para ReconciliationInput[] */,
    salesByStorePeriodSku: /* adaptar salesRange para SalesRecordInput[] */,
    supplyByStorePeriodSku: /* adaptar supplyRange para SupplyRecordInput[] */,
    costsBySkuAsOf,
    stores: stores.map((s) => ({ id: s.id, name: s.name })),
    today: new Date().toISOString().slice(0, 10),
    parameters: RUNTIME_PARAMETERS.parameters,
  };
}, [reconciliationRange, salesRange, supplyRange, costsBySkuAsOf, stores]);

const lossIntelligenceResult = useMemo(() => (lossIntelligenceInput ? analyzeLossIntelligence(lossIntelligenceInput) : null), [lossIntelligenceInput]);

const decisionRows = useMemo<DecisionRowData[]>(() => {
  if (!lossIntelligenceResult) return [];
  return lossIntelligenceResult.recommendations
    .filter((r) => r.acaoPrioritaria !== "manter") // tabela de decisão não precisa listar "sem problema" — mantém o foco em quem exige atenção
    .map((r) => ({
      recommendation: r,
      productLabel: /* resolver nome do produto a partir de r.sku, mesma fonte já usada pelo ranking existente */,
      storeName: /* resolver nome da loja a partir de r.storeId */,
      category: /* resolver categoria, se disponível — null se não */,
      diagnosticoResumo: explainRecommendation(r).split(".")[0] + ".", // primeira frase só, para a célula da tabela
    }));
}, [lossIntelligenceResult]);
```

E, no JSX, **antes** da seção "Produto × Loja" já existente (nunca substituindo nada):

```tsx
{lossIntelligenceResult && (
  <>
    <AgentSummaryPanel result={lossIntelligenceResult} onSeeAll={() => document.getElementById("loss-intelligence-table")?.scrollIntoView({ behavior: "smooth" })} />
    <div id="loss-intelligence-table">
      <LossDecisionsTable rows={decisionRows} onSelect={setSelectedRecommendation} />
    </div>
    <LossDecisionDrawer
      recommendation={selectedRecommendation}
      productLabel={selectedRecommendation ? /* mesmo resolvedor de nome usado acima */ : ""}
      storeName={selectedRecommendation ? /* idem */ : ""}
      open={selectedRecommendation !== null}
      onOpenChange={(open) => !open && setSelectedRecommendation(null)}
    />
  </>
)}
```

- [ ] **Passo 5: acrescentar o link de calibração e as regras de negócio.** Onde `loss-tab.tsx` já tem um cabeçalho de seção/ações (mesmo padrão do `BusinessRulesSheet` em `commercial-intelligence`), adicionar:

```tsx
<BusinessRulesSheet
  description="Decisões da empresa que mudam o que o Agente de Perdas recomenda. Valem para toda a operação: não são ajustes deste navegador."
  rows={lossBusinessRuleRows(RUNTIME_PARAMETERS.parameters)}
  calibrationHref="/supply/loss-intelligence/calibration"
/>
```

(import de `@/components/business-rules-sheet` e `@/lib/loss-intelligence/parameter-rows`.)

- [ ] **Passo 6: testar manualmente no browser.** Subir `admin-dev` (`docker compose up -d admin-dev` a partir de `frontend/apps/admin`, ou o fluxo de dev já usado no projeto), abrir `/supply`, aba Perdas, confirmar visualmente: (a) o painel do Agente aparece no topo da nova seção, com contagens reais; (b) a tabela filtra corretamente; (c) clicar numa linha abre o drawer com todas as seções preenchidas; (d) nenhum widget existente (KPIs, gráfico de evolução, donut, ranking, matriz Produto×Loja) mudou de lugar ou de conteúdo; (e) `/supply/loss-intelligence/calibration` carrega e lista os 20 parâmetros; (f) o botão "Regras de negócio" abre a ficha com os parâmetros `kind: "business"` (3 deles: `otherReason.viabilityMaxRatio`, `otherReason.negligibleValueCents`, `priority.criticalValueCents`).

- [ ] **Passo 7: `pnpm --filter @agiliz/admin typecheck lint test` e `pnpm --filter @agiliz/admin build`.** Toda a suíte das 20 tasks deve passar junto — este é o primeiro momento em que o build de produção do admin inteiro roda com o motor de perdas dentro.

- [ ] **Passo 8: commit.**

```bash
git add frontend/apps/admin/src/lib/loss-intelligence/parameter-rows.ts frontend/apps/admin/src/lib/loss-intelligence/parameter-rows.spec.ts frontend/apps/admin/src/app/\(app\)/supply/loss-intelligence/ frontend/apps/admin/src/components/supply/loss-tab.tsx
git commit -m "feat(admin): wire the Loss Intelligence Agent into the Perdas tab (Fase 1)

Adds the agent summary panel, decisions table and drill-down drawer
inside the existing loss-tab.tsx — no existing widget touched — plus
a calibration page for the 20 provisional thresholds and a business
rules sheet, both reusing the generic components from Task 0. This
closes out Fase 1 of docs/superpowers/specs/2026-09-21-loss-intelligence-agent-phase-1-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final Self-Review (performed before handing this plan to the user)

- **Spec coverage**: every numbered section of the design spec (§2-§22) maps to at least one task — restrições em Global Constraints; §3/§4 → Task 0; §6/§7/§13 → Tasks 1, 4; §8 → Task 3; §9 → Task 5; §10.1-§10.4 → Tasks 7-11; §11 → Task 12; §12 → Task 6; §14 → Task 2; §15 → Tasks 17-20; §16 → Task 13; §17 → Task 14; §18/§19/§22 → os testes de cada task, mais os critérios de aceite revisitados no Passo 6 do Task 20.
- **Placeholder scan**: nenhum "TODO"/"implementar depois" restante. Os dois pontos genuinamente incertos (assinatura exata de `StatusBadge`/`ConfidenceBadge`, shape exato dos hooks RTK Query consumidos por `loss-tab.tsx`) estão marcados como "ler primeiro" / "CONFIRMAR", nunca como código fictício assumido correto.
- **Consistência de tipos**: `LossAction`, `LossReason`, `InterventionPotential`, `Confidence`, `Priority` são declarados uma vez (Task 1) e usados literalmente em todas as tasks seguintes — nenhuma task redeclara ou diverge do nome de campo.
- **Duas decisões de implementação fora da spec aprovada, ambas documentadas explicitamente no código onde aparecem** (nunca como um 21º parâmetro silencioso): o multiplicador de "evidência esmagadora" (Task 5) e os cenários de impacto 20/40/60% (Task 16).
- **Gap descoberto durante o desenho**: o campo `historico` (Task 19) não estava no contrato original da spec §13 — foi adicionado como extensão explícita de `types.ts`/`engine.ts`, com nota própria no plano, não escondido.
- **Escopo**: as 20 tasks cobrem exatamente a Fase 1 aprovada — nada de persistência, decisão humana ou chat (Fases 2/3, fora de escopo aqui).

---

## Execution Handoff

Plano completo e salvo em `docs/superpowers/plans/2026-09-21-loss-intelligence-agent-phase-1.md`. Duas opções de execução:

**1. Subagent-Driven (recomendado)** — dispara um subagent por task, revisão entre tasks, iteração rápida.

**2. Inline Execution** — executa as tasks nesta sessão via `executing-plans`, em lote com checkpoints.

Qual abordagem?
