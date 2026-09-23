# Abastecimento Inteligente + Mix das Lojas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 6-tab Inteligência Comercial UX with 2 new tabs — Abastecimento Inteligente
(quantidade recomendada de abastecimento por produto×loja) and Mix das Lojas (o que deveria existir
em cada loja) — sem apagar nenhum motor/código da versão atual.

**Architecture:** Dois motores puros novos (`restock/engine.ts`, `mix/engine.ts`) sobre uma série
mensal compartilhada por loja×SKU (`series.ts`, combinando vendas/abastecimento/perdas já buscados
pelo app) e uma função de tendência compartilhada (`trend.ts`). Os dois motores só **leem** o
resultado já computado do Loss Intelligence (`analyzeLossIntelligence`, `@/lib/loss-intelligence/`)
— nunca recalculam perda. Parâmetros/calibração seguem 1:1 o padrão já usado por
`@/lib/loss-intelligence/parameters.ts` (mais simples e mais recente que o de
`commercial-intelligence/`): paths `grupo.campo`, override por env var, `ParameterCatalog`/
`BusinessRulesSheet` reaproveitados como estão.

**Tech Stack:** Next.js 16 (App Router), TypeScript, RTK Query, Jest + Testing Library, shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-09-23-commercial-intelligence-restock-mix-design.md](../specs/2026-09-23-commercial-intelligence-restock-mix-design.md) — as 4 decisões arquiteturais e os 3 defaults menores do §11 já estão resolvidos e aprovados; este plano não os reabre.

## Global Constraints

- Motor puro: nenhum arquivo em `src/lib/commercial-intelligence/restock-mix/**` importa React, `fetch` ou `next/navigation` — só `import type` de outros módulos `lib/api/*` é permitido (erased at compile time, não introduz dependência de runtime).
- O motor de Abastecimento **nunca recalcula perda** — só lê `LossIntelligenceRecommendation` já computado.
- Nunca inferir estoque (`abastecido − vendido − perdido`) nem "estoque alvo − estoque atual". A saída chama-se sempre "quantidade recomendada de abastecimento", nunca "reposição necessária".
- Nenhum número fingindo precisão: toda quantidade sugerida vem acompanhada de uma faixa (`faixaEstimada`), nunca só um ponto.
- Categoria de produto usa os 4 valores reais do catálogo (`meal | snack | beverage | essential`) — nunca um rótulo inventado.
- Janela de análise do motor de Abastecimento e do motor de Mix é a **mesma** do Loss Intelligence — resolvida via `resolveAnalysisWindow` (`@/lib/loss-intelligence/temporal`) com o `LossIntelligenceParameters` já em uso, nunca uma janela própria recalculada.
- Confiança de oportunidades de novo mix (SKU ausente na loja) nunca é `"alta"` — é extrapolação de rede, não histórico direto do par loja×SKU (decisão do operador, spec §8).
- Loss Intelligence `avaliar_permanencia_loja`/`avaliar_permanencia_rede` mapeiam para a classificação de Mix `"avaliar_retirada"` (decisão do operador, spec §7) — nunca um rótulo novo.
- Parâmetros de negócio destes 2 motores seguem o caminho interino via `NEXT_PUBLIC_*` env var, mesmo padrão do resto do painel (decisão do operador, spec §10) — nenhuma dependência do `intelligence-service` (ainda não aprovado).
- Todo componente novo em `src/components/commercial-intelligence/{restock,mix}/` é `"use client"` e segue o padrão de badge/tabela/drawer já usado em `src/components/supply/loss-intelligence/` (mesma sessão, mesmo autor, precedente mais próximo).
- Nada do código/motor atual de `src/lib/commercial-intelligence/*` (fora de `restock-mix/`) é apagado ou modificado por este plano.

---

## File Structure

```
src/lib/commercial-intelligence/restock-mix/
  types.ts                 # Task 1 — todo tipo cross-cutting (série, Trend, RestockRecommendation, MixRecommendation, MixOpportunity, LossSignal)
  series.spec.ts
  series.ts                 # Task 1 — buildStoreSkuSeries
  trend.spec.ts
  trend.ts                  # Task 2 — computeTrend
  restock/
    logic-version.ts        # Task 3
    parameter-docs.ts       # Task 3
    parameters.spec.ts
    parameters.ts            # Task 3
    env.ts                    # Task 3
    parameter-rows.ts        # Task 3
    confidence.spec.ts
    confidence.ts             # Task 4
    engine.spec.ts
    engine.ts                 # Task 5 — computeRestockRecommendations
  mix/
    logic-version.ts        # Task 8
    parameter-docs.ts       # Task 8
    parameters.spec.ts
    parameters.ts             # Task 8
    env.ts                     # Task 8
    parameter-rows.ts        # Task 8
    confidence.spec.ts
    confidence.ts              # Task 9
    engine.spec.ts
    engine.ts                  # Task 10 — computeMixRecommendations, computeMixOpportunities

src/components/commercial-intelligence/restock/
  restock-panel.spec.tsx
  restock-panel.tsx          # Task 6 — resumo (X aumentar / reduzir / não abastecer / testar)
  restock-table.spec.tsx
  restock-table.tsx           # Task 6 — lista principal + filtros + quantidade editável + "Gerar lista"
  restock-drawer.spec.tsx
  restock-drawer.tsx           # Task 7 — drill-down

src/components/commercial-intelligence/mix/
  mix-table.spec.tsx
  mix-table.tsx                 # Task 11 — resumo + lista + oportunidades de novo mix
  mix-drawer.spec.tsx
  mix-drawer.tsx                 # Task 12 — drill-down

src/app/(app)/commercial-intelligence/page.tsx           # Task 13 — reescrita, 2 abas
src/app/(app)/commercial-intelligence/calibration/page.tsx  # Task 14 — + seções Restock/Mix
```

**Por que `restock-mix/` e não dentro de `commercial-intelligence/` direto:** os 12 arquivos atuais
de `src/lib/commercial-intelligence/` continuam 100% intocados (Global Constraint); um subdiretório
novo deixa claro, só pelo caminho do arquivo, o que é motor novo vs. motor preservado da fase
anterior — mesma razão pela qual `loss-intelligence/diagnosis/` é subpasta, não arquivos soltos.

**Por que `types.ts` central em vez de um por subpasta:** `restock/engine.ts` precisa emitir linhas
de "testar" que na verdade vêm do motor de Mix (`MixOpportunity`, injetadas na tabela de
Abastecimento — ver Task 6) — colocar os 3 contratos de saída (Restock, Mix, Opportunity) num único
arquivo evita import circular entre as duas subpastas.

---

## Task 1: Série compartilhada por loja×SKU

**Files:**
- Create: `src/lib/commercial-intelligence/restock-mix/types.ts`
- Create: `src/lib/commercial-intelligence/restock-mix/series.ts`
- Test: `src/lib/commercial-intelligence/restock-mix/series.spec.ts`

**Interfaces:**
- Consumes: `StoreMonthSales`/`SalesRecord` (`@/lib/api/sales`), `StoreMonthSupply`/`RestockRow` (`@/lib/api/supply`), `PerStoreMonthlyTotal` (`@/lib/api/finance`), `Store` (`@/lib/api/stores`).
- Produces: `StoreSkuMonth`, `StoreSkuSeries`, `buildStoreSkuSeries(stores, salesByStoreMonth, supplyByStoreMonth, reconciliationByStoreMonth, periods): StoreSkuSeries[]` — usado por Task 5 e Task 10.

- [ ] **Step 1: Write `types.ts` with every cross-cutting type this plan uses**

```ts
// src/lib/commercial-intelligence/restock-mix/types.ts
import type { Confidence, EscopoProblema, LossAction, Priority } from "@/lib/loss-intelligence/types";
import type { Product } from "@/lib/api/products";

/**
 * `import type` só existe em tempo de compilação — este módulo continua sem
 * nenhuma dependência de runtime em fetch/React mesmo importando de
 * `lib/api/products` (mesma regra que já vale pro resto do motor puro).
 */
export type ProductCategory = Product["category"];

export type Trend = "crescendo" | "estavel" | "caindo" | "volatil" | "indeterminada";

export interface TrendResult {
  tendencia: Trend;
  estimativaCentral: number;
  faixaEstimada: { min: number; max: number };
}

/** Um mês da série loja×SKU — sempre um por período da janela, mesmo com tudo zero. */
export interface StoreSkuMonth {
  period: string;
  vendido: number;
  abastecido: number;
  perdido: number;
  receitaCents: number;
}

/** Série mensal de um SKU numa loja, do mês mais antigo ao mais recente da janela. */
export interface StoreSkuSeries {
  storeId: number;
  sku: string;
  meses: StoreSkuMonth[];
}

/** Leitura do Loss Intelligence já computado — nunca recalculada aqui (Global Constraint). */
export interface LossSignal {
  acao: LossAction;
  prioridade: Priority | null;
  confianca: Confidence;
  escopoProblema: EscopoProblema;
  limitacoesDosDados: string[];
}

// ---- Abastecimento Inteligente ----

export type RestockAction = "aumentar" | "manter" | "reduzir" | "nao_abastecer" | "testar" | "dados_insuficientes";

export interface RestockRecommendation {
  sku: string;
  storeId: number;
  categoria: ProductCategory;
  vendasUltimoMes: number;
  historicoMensal: StoreSkuMonth[];
  ultimoAbastecimento: number | null;
  mesesComVenda: number;
  mesesAnalisados: number;
  tendencia: Trend;
  faixaEstimada: { min: number; max: number };
  sinalPerdas: LossSignal | null;
  quantidadeSugeridaIA: number;
  acao: RestockAction;
  motivo: string;
  confianca: Confidence;
  limitacoes: string[];
  versaoMotor: string;
  versaoParametros: string;
}

// ---- Mix das Lojas ----

export type MixClassification = "manter" | "explorar" | "reduzir" | "suspender_abastecimento" | "avaliar_retirada" | "dados_insuficientes";

export interface MixRecommendation {
  sku: string;
  storeId: number;
  categoria: ProductCategory;
  classificacao: MixClassification;
  evidencia: string;
  tendencia: Trend;
  affinity: number | null;
  margemPct: number | null;
  sinalPerdas: LossSignal | null;
  confianca: Confidence;
  limitacoes: string[];
  versaoMotor: string;
  versaoParametros: string;
}

/** SKU ausente na loja, candidato por bom desempenho na rede (spec §8 — v1 sem "lojas parecidas"). */
export interface MixOpportunity {
  sku: string;
  storeId: number;
  origem: "rede_inteira";
  evidencia: string;
  quantidadeTeste: number;
  confianca: Confidence;
  versaoMotor: string;
  versaoParametros: string;
}
```

- [ ] **Step 2: Write the failing test for `buildStoreSkuSeries`**

```ts
// src/lib/commercial-intelligence/restock-mix/series.spec.ts
import { describe, it, expect } from "@jest/globals";
import { buildStoreSkuSeries } from "./series";
import type { Store } from "@/lib/api/stores";
import type { StoreMonthSales } from "@/lib/api/sales";
import type { StoreMonthSupply } from "@/lib/api/supply";
import type { PerStoreMonthlyTotal } from "@/lib/api/finance";
import type { ReconciliationTotals } from "@/lib/reconciliation-aggregate";

const STORES: Store[] = [{ id: 1, name: "Loja A" } as Store, { id: 2, name: "Loja B" } as Store];
const PERIODS = ["2026-06", "2026-07", "2026-08"];

function totals(overrides: Partial<ReconciliationTotals> = {}): ReconciliationTotals {
  return {
    monthsWithData: 1,
    restocked_value_cents: 0,
    cogs_cents: 0,
    remaining_value_cents: 0,
    loss_value_cents: 0,
    loss_quantity: 0,
    unclassified_stock_adjustment_value_cents: 0,
    complete: true,
    loss_by_reason: [],
    loss_by_sku: [],
    loss_by_reason_sku: [],
    ...overrides,
  } as ReconciliationTotals;
}

describe("buildStoreSkuSeries", () => {
  it("combines sales, supply and losses into one row per period, oldest to newest", () => {
    const sales: StoreMonthSales[] = [
      { storeId: 1, period: "2026-06", bySku: [{ store_id: 1, period: "2026-06", sku: "SKU-1", quantity_sold: 10, revenue_cents: 5000, ingestion_id: "x" }] },
      { storeId: 1, period: "2026-07", bySku: [{ store_id: 1, period: "2026-07", sku: "SKU-1", quantity_sold: 12, revenue_cents: 6000, ingestion_id: "x" }] },
      { storeId: 1, period: "2026-08", bySku: [{ store_id: 1, period: "2026-08", sku: "SKU-1", quantity_sold: 15, revenue_cents: 7500, ingestion_id: "x" }] },
    ];
    const supply: StoreMonthSupply[] = [
      { storeId: 1, period: "2026-06", restocks: [{ sku: "SKU-1", quantity_restocked: 20 }] },
      { storeId: 1, period: "2026-07", restocks: [{ sku: "SKU-1", quantity_restocked: 0 }] },
      { storeId: 1, period: "2026-08", restocks: [{ sku: "SKU-1", quantity_restocked: 18 }] },
    ];
    const reconciliation: PerStoreMonthlyTotal[] = [
      { storeId: 1, period: "2026-06", totals: totals() },
      { storeId: 1, period: "2026-07", totals: totals({ loss_by_reason_sku: [{ reason: "expired", sku: "SKU-1", quantity: 2, value_cents: 1000 }] }) },
      { storeId: 1, period: "2026-08", totals: totals() },
    ];

    const result = buildStoreSkuSeries(STORES, sales, supply, reconciliation, PERIODS);

    expect(result).toHaveLength(1);
    expect(result[0].storeId).toBe(1);
    expect(result[0].sku).toBe("SKU-1");
    expect(result[0].meses).toEqual([
      { period: "2026-06", vendido: 10, abastecido: 20, perdido: 0, receitaCents: 5000 },
      { period: "2026-07", vendido: 12, abastecido: 0, perdido: 2, receitaCents: 6000 },
      { period: "2026-08", vendido: 15, abastecido: 18, perdido: 0, receitaCents: 7500 },
    ]);
  });

  it("sums loss quantity across every reason for the same sku in the same month", () => {
    const reconciliation: PerStoreMonthlyTotal[] = [
      {
        storeId: 1,
        period: "2026-08",
        totals: totals({
          loss_by_reason_sku: [
            { reason: "expired", sku: "SKU-2", quantity: 3, value_cents: 300 },
            { reason: "damaged_product", sku: "SKU-2", quantity: 1, value_cents: 100 },
          ],
        }),
      },
    ];

    const result = buildStoreSkuSeries(STORES, [], [], reconciliation, ["2026-08"]);

    expect(result[0].meses[0].perdido).toBe(4);
  });

  it("emits one row per period in the window even when a period has no data for that sku", () => {
    const sales: StoreMonthSales[] = [{ storeId: 1, period: "2026-08", bySku: [{ store_id: 1, period: "2026-08", sku: "SKU-3", quantity_sold: 5, revenue_cents: 500, ingestion_id: "x" }] }];

    const result = buildStoreSkuSeries(STORES, sales, [], [], PERIODS);

    expect(result[0].meses.map((m) => m.period)).toEqual(PERIODS);
    expect(result[0].meses[0]).toEqual({ period: "2026-06", vendido: 0, abastecido: 0, perdido: 0, receitaCents: 0 });
  });

  it("keeps stores and skus separate — never mixes SKU-1 of store 1 with SKU-1 of store 2", () => {
    const sales: StoreMonthSales[] = [
      { storeId: 1, period: "2026-08", bySku: [{ store_id: 1, period: "2026-08", sku: "SKU-1", quantity_sold: 10, revenue_cents: 1000, ingestion_id: "x" }] },
      { storeId: 2, period: "2026-08", bySku: [{ store_id: 2, period: "2026-08", sku: "SKU-1", quantity_sold: 40, revenue_cents: 4000, ingestion_id: "x" }] },
    ];

    const result = buildStoreSkuSeries(STORES, sales, [], [], ["2026-08"]);

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.storeId === 1)?.meses[0].vendido).toBe(10);
    expect(result.find((r) => r.storeId === 2)?.meses[0].vendido).toBe(40);
  });

  it("never emits a series for a sku with zero activity in every field across the whole window", () => {
    const supply: StoreMonthSupply[] = [{ storeId: 1, period: "2026-08", restocks: [{ sku: "SKU-4", quantity_restocked: 0 }] }];
    const result = buildStoreSkuSeries(STORES, [], supply, [], ["2026-08"]);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @agiliz/admin exec jest src/lib/commercial-intelligence/restock-mix/series.spec.ts`
Expected: FAIL — `Cannot find module './series'`.

- [ ] **Step 4: Implement `buildStoreSkuSeries`**

```ts
// src/lib/commercial-intelligence/restock-mix/series.ts
import type { Store } from "@/lib/api/stores";
import type { StoreMonthSales } from "@/lib/api/sales";
import type { StoreMonthSupply } from "@/lib/api/supply";
import type { PerStoreMonthlyTotal } from "@/lib/api/finance";
import type { StoreSkuMonth, StoreSkuSeries } from "./types";

/**
 * Combina vendas, abastecimento e perdas (já buscados pelo caller, mesmos
 * hooks que o Loss Intelligence usa) numa série mensal por loja×SKU. Emite
 * um `StoreSkuMonth` por período de `periods` para todo par loja×SKU que
 * teve QUALQUER atividade (venda, abastecimento ou perda) em algum mês da
 * janela — nunca um período pulado, mesmo que o valor daquele mês seja zero
 * (a série precisa ter comprimento fixo para o cálculo de tendência, Task 2).
 */
export function buildStoreSkuSeries(
  _stores: Store[],
  salesByStoreMonth: StoreMonthSales[],
  supplyByStoreMonth: StoreMonthSupply[],
  reconciliationByStoreMonth: PerStoreMonthlyTotal[],
  periods: string[],
): StoreSkuSeries[] {
  type Cell = { vendido: number; abastecido: number; perdido: number; receitaCents: number };
  const byStoreSku = new Map<string, Map<string, Map<string, Cell>>>();

  function cellFor(storeId: number, sku: string, period: string): Cell {
    const key = String(storeId);
    if (!byStoreSku.has(key)) byStoreSku.set(key, new Map());
    const bySku = byStoreSku.get(key)!;
    if (!bySku.has(sku)) bySku.set(sku, new Map());
    const byPeriod = bySku.get(sku)!;
    if (!byPeriod.has(period)) byPeriod.set(period, { vendido: 0, abastecido: 0, perdido: 0, receitaCents: 0 });
    return byPeriod.get(period)!;
  }

  for (const month of salesByStoreMonth) {
    for (const row of month.bySku) {
      const cell = cellFor(month.storeId, row.sku, month.period);
      cell.vendido += row.quantity_sold;
      cell.receitaCents += row.revenue_cents;
    }
  }

  for (const month of supplyByStoreMonth) {
    for (const row of month.restocks) {
      cellFor(month.storeId, row.sku, month.period).abastecido += row.quantity_restocked;
    }
  }

  for (const row of reconciliationByStoreMonth) {
    for (const entry of row.totals.loss_by_reason_sku) {
      cellFor(row.storeId, entry.sku, row.period).perdido += entry.quantity;
    }
  }

  const result: StoreSkuSeries[] = [];
  for (const [storeIdStr, bySku] of byStoreSku) {
    const storeId = Number(storeIdStr);
    for (const [sku, byPeriod] of bySku) {
      const meses: StoreSkuMonth[] = periods.map((period) => {
        const cell = byPeriod.get(period);
        return { period, vendido: cell?.vendido ?? 0, abastecido: cell?.abastecido ?? 0, perdido: cell?.perdido ?? 0, receitaCents: cell?.receitaCents ?? 0 };
      });
      const hasActivity = meses.some((m) => m.vendido > 0 || m.abastecido > 0 || m.perdido > 0);
      if (hasActivity) result.push({ storeId, sku, meses });
    }
  }

  return result;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @agiliz/admin exec jest src/lib/commercial-intelligence/restock-mix/series.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/commercial-intelligence/restock-mix/types.ts src/lib/commercial-intelligence/restock-mix/series.ts src/lib/commercial-intelligence/restock-mix/series.spec.ts
git commit -m "feat(admin): add shared store×sku monthly series builder for restock/mix engines"
```

---

## Task 2: Tendência e faixa compartilhadas (`computeTrend`)

**Files:**
- Create: `src/lib/commercial-intelligence/restock-mix/trend.ts`
- Test: `src/lib/commercial-intelligence/restock-mix/trend.spec.ts`

**Interfaces:**
- Consumes: `Trend`, `TrendResult` (Task 1, `./types`).
- Produces: `TrendParameters`, `computeTrend(monthlyQuantities: number[], parameters: TrendParameters): TrendResult` — usado por Task 5 (`restock/engine.ts`) e Task 10 (`mix/engine.ts`).

**Fórmula implementada (spec §6, passos 2-4):** mediana bruta + média ponderada por recência →
`estimativaCentral`; desvio absoluto médio em torno da mediana → `faixaEstimada`; comparação
últimos-2-meses vs. 2-meses-anteriores → direção; coeficiente de variação → sobrepõe para
`"volatil"` e alarga a faixa. Pesos por recência são 2 números escalares (`recentMonthsCount`,
`recentWeightMultiplier`), não um array — mantém todo parâmetro do motor no mesmo formato escalar
que `ParameterCatalog`/`formatParameterValue` já sabem exibir (simplificação deliberada do exemplo
ilustrativo `[1,1,2,2,3,3]` do spec, mesma ideia, calibrável por 2 números em vez de 6).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/commercial-intelligence/restock-mix/trend.spec.ts
import { describe, it, expect } from "@jest/globals";
import { computeTrend, type TrendParameters } from "./trend";

const PARAMS: TrendParameters = {
  recentMonthsCount: 3,
  recentWeightMultiplier: 2,
  upThresholdPct: 0.2,
  downThresholdPct: 0.2,
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @agiliz/admin exec jest src/lib/commercial-intelligence/restock-mix/trend.spec.ts`
Expected: FAIL — `Cannot find module './trend'`.

- [ ] **Step 3: Implement `computeTrend`**

```ts
// src/lib/commercial-intelligence/restock-mix/trend.ts
import type { Trend, TrendResult } from "./types";

export interface TrendParameters {
  recentMonthsCount: number;
  recentWeightMultiplier: number;
  upThresholdPct: number;
  downThresholdPct: number;
  adjustPct: number;
  volatilityThreshold: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function weightedMean(values: number[], parameters: TrendParameters): number {
  const weights = values.map((_, i) => (values.length - i <= parameters.recentMonthsCount ? parameters.recentWeightMultiplier : 1));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const weightedSum = values.reduce((sum, v, i) => sum + v * weights[i], 0);
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

function meanAbsoluteDeviation(values: number[], center: number): number {
  return values.reduce((sum, v) => sum + Math.abs(v - center), 0) / values.length;
}

function directionOf(values: number[], parameters: TrendParameters): Trend {
  if (values.length < 4) return "estavel";
  const recentAvg = (values[values.length - 1] + values[values.length - 2]) / 2;
  const priorAvg = (values[values.length - 3] + values[values.length - 4]) / 2;
  if (priorAvg === 0) return recentAvg > 0 ? "crescendo" : "estavel";
  const ratio = recentAvg / priorAvg;
  if (ratio >= 1 + parameters.upThresholdPct) return "crescendo";
  if (ratio <= 1 - parameters.downThresholdPct) return "caindo";
  return "estavel";
}

/** §6 passos 2-4: mediana + média ponderada por recência -> estimativa; desvio absoluto médio -> faixa; direção por metades; volatilidade sobrepõe e alarga. */
export function computeTrend(monthlyQuantities: number[], parameters: TrendParameters): TrendResult {
  if (monthlyQuantities.length === 0) return { tendencia: "indeterminada", estimativaCentral: 0, faixaEstimada: { min: 0, max: 0 } };

  const med = median(monthlyQuantities);
  const wMean = weightedMean(monthlyQuantities, parameters);
  const base = Math.round((med + wMean) / 2);
  const mad = meanAbsoluteDeviation(monthlyQuantities, med);

  let tendencia = directionOf(monthlyQuantities, parameters);
  let estimativaCentral = base;
  if (tendencia === "crescendo") estimativaCentral = Math.round(base * (1 + parameters.adjustPct));
  else if (tendencia === "caindo") estimativaCentral = Math.round(base * (1 - parameters.adjustPct));

  let madForRange = mad;
  const coefficientOfVariation = base > 0 ? mad / base : 0;
  if (coefficientOfVariation > parameters.volatilityThreshold) {
    tendencia = "volatil";
    madForRange = mad * 1.5;
  }

  return {
    tendencia,
    estimativaCentral,
    faixaEstimada: { min: Math.max(0, Math.round(estimativaCentral - madForRange)), max: Math.round(estimativaCentral + madForRange) },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @agiliz/admin exec jest src/lib/commercial-intelligence/restock-mix/trend.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/commercial-intelligence/restock-mix/trend.ts src/lib/commercial-intelligence/restock-mix/trend.spec.ts
git commit -m "feat(admin): add shared trend/range calculation for restock/mix engines"
```

---

## Task 3: Parâmetros e calibração do motor de Abastecimento

**Files:**
- Create: `src/lib/commercial-intelligence/restock-mix/restock/parameter-docs.ts`
- Create: `src/lib/commercial-intelligence/restock-mix/restock/parameters.ts`
- Create: `src/lib/commercial-intelligence/restock-mix/restock/env.ts`
- Create: `src/lib/commercial-intelligence/restock-mix/restock/parameter-rows.ts`
- Create: `src/lib/commercial-intelligence/restock-mix/restock/logic-version.ts`
- Test: `src/lib/commercial-intelligence/restock-mix/restock/parameters.spec.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `RestockParameters`, `DEFAULT_RESTOCK_PARAMETERS`, `RUNTIME_RESTOCK_PARAMETERS`, `getRestockParameter`, `formatRestockParameterValue`, `restockParameterCatalogSections`, `restockBusinessRuleRows`, `RESTOCK_LOGIC_VERSION` — usados por Task 4, Task 5 e Task 14.

Este task só produz scaffolding mecânico (parâmetros + documentação + override por env + adaptação
para `ParameterCatalog`/`BusinessRulesSheet`) — um único task por engenharia de tarefa: nenhum dos 5
arquivos tem valor de review isolado do resto (Task Right-Sizing da skill). Segue **exatamente** o
padrão de `@/lib/loss-intelligence/{parameter-docs,parameters,env,parameter-rows}.ts` (lido como
referência) — mesmas funções, mesmos nomes, prefixo de env var trocado de `LI_` para `RESTOCK_`.

- [ ] **Step 1: Write `parameter-docs.ts`**

```ts
// src/lib/commercial-intelligence/restock-mix/restock/parameter-docs.ts
export type ParameterKind = "business" | "quality" | "analytic";
export type ParameterUnit = "share" | "months" | "number";

export interface ParameterDoc {
  label: string;
  kind: ParameterKind;
  unit: ParameterUnit;
  why: string;
  controls: string;
  up: string;
  down: string;
  min: number;
  max: number;
  integer: boolean;
}

const d = (doc: ParameterDoc): ParameterDoc => doc;

export const PARAMETER_DOCS = {
  "evidence.minMonthsWithSales": d({
    label: "Meses mínimos com venda",
    kind: "quality",
    unit: "months",
    why: "Menos de 2 meses com venda não sustenta uma quantidade sugerida — vira dados insuficientes.",
    controls: "Gate de entrada do motor (§6 passo 1) — abaixo disso, ação vira dados_insuficientes.",
    up: "Mais SKUs caem em dados insuficientes.",
    down: "Menos exigente para sugerir uma quantidade.",
    min: 1,
    max: 6,
    integer: true,
  }),
  "trend.recentMonthsCount": d({
    label: "Quantos meses contam como 'recentes'",
    kind: "analytic",
    unit: "months",
    why: "3 dos 6 meses da janela pesarem mais equilibra reagir ao presente sem esquecer o histórico.",
    controls: "Quantos meses do fim da série recebem o peso maior na média ponderada (§6 passo 2).",
    up: "Menos meses pesam mais — motor reage mais rápido a mudanças recentes.",
    down: "Mais meses pesam igual — motor mais estável, mais lento para reagir.",
    min: 1,
    max: 6,
    integer: true,
  }),
  "trend.recentWeightMultiplier": d({
    label: "Quanto mais pesam os meses recentes",
    kind: "analytic",
    unit: "number",
    why: "Peso 2x é o corte inicial de julgamento entre 'ignorar o passado' e 'não dar nenhuma prioridade ao presente'.",
    controls: "Multiplicador de peso dos meses recentes na média ponderada (§6 passo 2).",
    up: "Meses recentes dominam ainda mais a estimativa.",
    down: "Estimativa se aproxima de uma média simples de todo o histórico.",
    min: 1,
    max: 5,
    integer: false,
  }),
  "trend.upThresholdPct": d({
    label: "Corte para considerar 'crescendo'",
    kind: "analytic",
    unit: "share",
    why: "20% de alta entre as duas metades recentes é o piso de julgamento para chamar de tendência, não ruído de mês a mês.",
    controls: "Compara os últimos 2 meses com os 2 anteriores (§6 passo 4).",
    up: "Mais difícil classificar como crescendo.",
    down: "Mais fácil classificar como crescendo.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "trend.downThresholdPct": d({
    label: "Corte para considerar 'caindo'",
    kind: "analytic",
    unit: "share",
    why: "Mesmo raciocínio do corte de alta, para o lado da queda.",
    controls: "Compara os últimos 2 meses com os 2 anteriores (§6 passo 4).",
    up: "Mais difícil classificar como caindo.",
    down: "Mais fácil classificar como caindo.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "trend.adjustPct": d({
    label: "Ajuste aplicado quando há tendência",
    kind: "business",
    unit: "share",
    why: "Decisão de negócio: quanto a sugestão sobe/desce quando o motor já confirmou uma direção clara.",
    controls: "Nudge sobre a estimativa central quando tendência é crescendo/caindo (§6 passo 4).",
    up: "Sugestão reage mais forte à tendência detectada.",
    down: "Sugestão fica mais próxima da média histórica, mesmo com tendência clara.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "trend.volatilityThreshold": d({
    label: "Corte de volatilidade",
    kind: "analytic",
    unit: "share",
    why: "Coeficiente de variação acima de 40% indica série instável demais para uma leitura de tendência confiável.",
    controls: "Sobrepõe a tendência para 'volátil' e alarga a faixa estimada (§6 passo 4).",
    up: "Menos séries são classificadas como voláteis.",
    down: "Mais séries são classificadas como voláteis, com faixa mais larga e confiança capada.",
    min: 0,
    max: 2,
    integer: false,
  }),
  "action.increaseThresholdPct": d({
    label: "Corte para sugerir 'aumentar'",
    kind: "analytic",
    unit: "share",
    why: "15% acima do último abastecimento é o piso de julgamento para recomendar aumentar, não só oscilação normal.",
    controls: "Compara quantidadeSugeridaIA com o último abastecimento (§6 passo 6).",
    up: "Mais difícil sugerir aumentar.",
    down: "Mais fácil sugerir aumentar.",
    min: 0,
    max: 2,
    integer: false,
  }),
  "action.decreaseThresholdPct": d({
    label: "Corte para sugerir 'reduzir'",
    kind: "analytic",
    unit: "share",
    why: "Mesmo raciocínio do corte de aumentar, para o lado da redução.",
    controls: "Compara quantidadeSugeridaIA com o último abastecimento (§6 passo 6).",
    up: "Mais difícil sugerir reduzir.",
    down: "Mais fácil sugerir reduzir.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "lossIntegration.reduceFactor": d({
    label: "Fator de corte quando a Inteligência de Perdas já sinaliza reduzir",
    kind: "business",
    unit: "share",
    why: "Decisão de negócio: quando o Loss Intelligence já decidiu reduzir_abastecimento, a quantidade cai pela metade em vez de zerar — o produto continua vendendo, só menos.",
    controls: "Precedência do Loss Intelligence sobre a fórmula própria (§4, §6 passo 5).",
    up: "Corta menos a quantidade quando há sinal de perdas para reduzir.",
    down: "Corta mais a quantidade quando há sinal de perdas para reduzir.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "confidence.highMin": d({
    label: "Pontuação mínima para confiança Alta",
    kind: "quality",
    unit: "number",
    why: "70 de 100 pontos possíveis é o piso de julgamento para confiar bastante na quantidade sugerida.",
    controls: "Corte Alta vs Média na régua de confiança (Task 4).",
    up: "Mais exigente para confiança Alta.",
    down: "Menos exigente.",
    min: 0,
    max: 100,
    integer: true,
  }),
  "confidence.mediumMin": d({
    label: "Pontuação mínima para confiança Média",
    kind: "quality",
    unit: "number",
    why: "40 de 100 pontos possíveis separa 'alguma evidência' de 'evidência fraca demais'.",
    controls: "Corte Média vs Baixa na régua de confiança (Task 4).",
    up: "Mais exigente para confiança Média — mais casos caem em Baixa.",
    down: "Menos exigente.",
    min: 0,
    max: 100,
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
  quality: { title: "Critérios de qualidade dos dados", description: "Decidem se há evidência suficiente para uma sugestão — nunca um ajuste de negócio." },
  analytic: { title: "Modelo analítico", description: "Como o motor de Abastecimento calcula tendência, faixa e ação." },
};

export const PARAMETER_GROUP_LABELS: Record<string, string> = {
  evidence: "Evidência mínima",
  trend: "Tendência",
  action: "Ação operacional",
  lossIntegration: "Integração com a Inteligência de Perdas",
  confidence: "Confiança",
};
```

- [ ] **Step 2: Write the failing test for `parameters.ts`**

```ts
// src/lib/commercial-intelligence/restock-mix/restock/parameters.spec.ts
import { describe, it, expect } from "@jest/globals";
import { DEFAULT_RESTOCK_PARAMETERS, envNameOf, formatRestockParameterValue, getRestockParameter, parametersFromEnv } from "./parameters";

describe("restock parameters", () => {
  it("reads a nested value by dotted path", () => {
    expect(getRestockParameter(DEFAULT_RESTOCK_PARAMETERS, "trend.recentMonthsCount")).toBe(3);
  });

  it("derives the env var name from the path", () => {
    expect(envNameOf("trend.recentWeightMultiplier")).toBe("NEXT_PUBLIC_RESTOCK_TREND_RECENT_WEIGHT_MULTIPLIER");
  });

  it("overrides a value from env when in bounds", () => {
    const { parameters, warnings } = parametersFromEnv({ NEXT_PUBLIC_RESTOCK_EVIDENCE_MIN_MONTHS_WITH_SALES: "3" });
    expect(getRestockParameter(parameters, "evidence.minMonthsWithSales")).toBe(3);
    expect(warnings).toEqual([]);
  });

  it("ignores and warns on an out-of-bounds env value, keeping the default", () => {
    const { parameters, warnings } = parametersFromEnv({ NEXT_PUBLIC_RESTOCK_EVIDENCE_MIN_MONTHS_WITH_SALES: "999" });
    expect(getRestockParameter(parameters, "evidence.minMonthsWithSales")).toBe(2);
    expect(warnings).toHaveLength(1);
  });

  it("resets an ordered pair to defaults when mediumMin would exceed highMin", () => {
    const { parameters, warnings } = parametersFromEnv({ NEXT_PUBLIC_RESTOCK_CONFIDENCE_MEDIUM_MIN: "90", NEXT_PUBLIC_RESTOCK_CONFIDENCE_HIGH_MIN: "70" });
    expect(getRestockParameter(parameters, "confidence.mediumMin")).toBe(40);
    expect(getRestockParameter(parameters, "confidence.highMin")).toBe(70);
    expect(warnings.some((w) => w.includes("confidence.mediumMin"))).toBe(true);
  });

  it("formats a share as a percentage", () => {
    expect(formatRestockParameterValue("trend.upThresholdPct", 0.2)).toBe("20%");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @agiliz/admin exec jest src/lib/commercial-intelligence/restock-mix/restock/parameters.spec.ts`
Expected: FAIL — `Cannot find module './parameters'`.

- [ ] **Step 4: Implement `parameters.ts`, `env.ts`, `parameter-rows.ts`, `logic-version.ts`**

```ts
// src/lib/commercial-intelligence/restock-mix/restock/parameters.ts
import { PARAMETER_DOCS, PARAMETER_PATHS, type ParameterPath } from "./parameter-docs";
import { readRestockPublicEnv } from "./env";

export interface RestockParameters {
  evidence: { minMonthsWithSales: number };
  trend: { recentMonthsCount: number; recentWeightMultiplier: number; upThresholdPct: number; downThresholdPct: number; adjustPct: number; volatilityThreshold: number };
  action: { increaseThresholdPct: number; decreaseThresholdPct: number };
  lossIntegration: { reduceFactor: number };
  confidence: { highMin: number; mediumMin: number };
}

export const DEFAULT_RESTOCK_PARAMETERS: RestockParameters = {
  evidence: { minMonthsWithSales: 2 },
  trend: { recentMonthsCount: 3, recentWeightMultiplier: 2, upThresholdPct: 0.2, downThresholdPct: 0.2, adjustPct: 0.1, volatilityThreshold: 0.4 },
  action: { increaseThresholdPct: 0.15, decreaseThresholdPct: 0.15 },
  lossIntegration: { reduceFactor: 0.5 },
  confidence: { highMin: 70, mediumMin: 40 },
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
```

```ts
// src/lib/commercial-intelligence/restock-mix/restock/env.ts
/** Único lugar que lê `process.env` para este motor — Next só inlina NEXT_PUBLIC_* escrito literal. */
export function readRestockPublicEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_RESTOCK_EVIDENCE_MIN_MONTHS_WITH_SALES: process.env.NEXT_PUBLIC_RESTOCK_EVIDENCE_MIN_MONTHS_WITH_SALES,
    NEXT_PUBLIC_RESTOCK_TREND_RECENT_MONTHS_COUNT: process.env.NEXT_PUBLIC_RESTOCK_TREND_RECENT_MONTHS_COUNT,
    NEXT_PUBLIC_RESTOCK_TREND_RECENT_WEIGHT_MULTIPLIER: process.env.NEXT_PUBLIC_RESTOCK_TREND_RECENT_WEIGHT_MULTIPLIER,
    NEXT_PUBLIC_RESTOCK_TREND_UP_THRESHOLD_PCT: process.env.NEXT_PUBLIC_RESTOCK_TREND_UP_THRESHOLD_PCT,
    NEXT_PUBLIC_RESTOCK_TREND_DOWN_THRESHOLD_PCT: process.env.NEXT_PUBLIC_RESTOCK_TREND_DOWN_THRESHOLD_PCT,
    NEXT_PUBLIC_RESTOCK_TREND_ADJUST_PCT: process.env.NEXT_PUBLIC_RESTOCK_TREND_ADJUST_PCT,
    NEXT_PUBLIC_RESTOCK_TREND_VOLATILITY_THRESHOLD: process.env.NEXT_PUBLIC_RESTOCK_TREND_VOLATILITY_THRESHOLD,
    NEXT_PUBLIC_RESTOCK_ACTION_INCREASE_THRESHOLD_PCT: process.env.NEXT_PUBLIC_RESTOCK_ACTION_INCREASE_THRESHOLD_PCT,
    NEXT_PUBLIC_RESTOCK_ACTION_DECREASE_THRESHOLD_PCT: process.env.NEXT_PUBLIC_RESTOCK_ACTION_DECREASE_THRESHOLD_PCT,
    NEXT_PUBLIC_RESTOCK_LOSS_INTEGRATION_REDUCE_FACTOR: process.env.NEXT_PUBLIC_RESTOCK_LOSS_INTEGRATION_REDUCE_FACTOR,
    NEXT_PUBLIC_RESTOCK_CONFIDENCE_HIGH_MIN: process.env.NEXT_PUBLIC_RESTOCK_CONFIDENCE_HIGH_MIN,
    NEXT_PUBLIC_RESTOCK_CONFIDENCE_MEDIUM_MIN: process.env.NEXT_PUBLIC_RESTOCK_CONFIDENCE_MEDIUM_MIN,
  };
}
```

```ts
// src/lib/commercial-intelligence/restock-mix/restock/logic-version.ts
/** Anexada a toda RestockRecommendation — incrementar (minor) sempre que a fórmula de quantidade ou a árvore de ação mudar. */
export const RESTOCK_LOGIC_VERSION = "restock-logic/0.1.0-provisional";
```

```ts
// src/lib/commercial-intelligence/restock-mix/restock/parameter-rows.ts
import { KIND_LABELS, PARAMETER_DOCS, PARAMETER_GROUP_LABELS, PARAMETER_KINDS, PARAMETER_PATHS, type ParameterPath } from "./parameter-docs";
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @agiliz/admin exec jest src/lib/commercial-intelligence/restock-mix/restock/parameters.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/commercial-intelligence/restock-mix/restock/parameter-docs.ts src/lib/commercial-intelligence/restock-mix/restock/parameters.ts src/lib/commercial-intelligence/restock-mix/restock/env.ts src/lib/commercial-intelligence/restock-mix/restock/parameter-rows.ts src/lib/commercial-intelligence/restock-mix/restock/logic-version.ts src/lib/commercial-intelligence/restock-mix/restock/parameters.spec.ts
git commit -m "feat(admin): add restock engine parameters, docs and calibration scaffolding"
```

---

## Task 4: Confiança do motor de Abastecimento

**Files:**
- Create: `src/lib/commercial-intelligence/restock-mix/restock/confidence.ts`
- Test: `src/lib/commercial-intelligence/restock-mix/restock/confidence.spec.ts`

**Interfaces:**
- Consumes: `Trend` (Task 1), `RestockParameters` (Task 3).
- Produces: `RestockConfidenceInput`, `computeRestockConfidence(input, parameters): Confidence` — usado por Task 5.

**Arquitetura (mesmo desenho de `@/lib/loss-intelligence/confidence.ts`, lido como referência):**
gate duro → soma de fatores aplicáveis → score 0-100 → nível por limiar → tetos que só reduzem,
nunca sobem.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/commercial-intelligence/restock-mix/restock/confidence.spec.ts
import { describe, it, expect } from "@jest/globals";
import { computeRestockConfidence, type RestockConfidenceInput } from "./confidence";
import { DEFAULT_RESTOCK_PARAMETERS } from "./parameters";

function input(overrides: Partial<RestockConfidenceInput> = {}): RestockConfidenceInput {
  return { mesesComVenda: 6, mesesAnalisados: 6, tendencia: "estavel", reconciliacaoLimpa: true, ...overrides };
}

describe("computeRestockConfidence", () => {
  it("is insuficiente below the minimum months-with-sales gate, regardless of everything else", () => {
    expect(computeRestockConfidence(input({ mesesComVenda: 1, tendencia: "estavel", reconciliacaoLimpa: true }), DEFAULT_RESTOCK_PARAMETERS)).toBe("insuficiente");
  });

  it("is alta with full evidence, stable trend and clean reconciliation", () => {
    expect(computeRestockConfidence(input(), DEFAULT_RESTOCK_PARAMETERS)).toBe("alta");
  });

  it("is media with partial evidence and no red flags", () => {
    expect(computeRestockConfidence(input({ mesesComVenda: 4, mesesAnalisados: 6, tendencia: "estavel", reconciliacaoLimpa: false }), DEFAULT_RESTOCK_PARAMETERS)).toBe("media");
  });

  it("caps at media when the trend is volatil, even with full evidence and clean reconciliation", () => {
    expect(computeRestockConfidence(input({ tendencia: "volatil" }), DEFAULT_RESTOCK_PARAMETERS)).toBe("media");
  });

  it("caps at media when reconciliation is flagged, even with full evidence and a stable trend", () => {
    expect(computeRestockConfidence(input({ reconciliacaoLimpa: false }), DEFAULT_RESTOCK_PARAMETERS)).toBe("media");
  });

  it("is baixa with little evidence and a volatile, unreconciled series", () => {
    expect(computeRestockConfidence(input({ mesesComVenda: 2, mesesAnalisados: 6, tendencia: "volatil", reconciliacaoLimpa: false }), DEFAULT_RESTOCK_PARAMETERS)).toBe("baixa");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @agiliz/admin exec jest src/lib/commercial-intelligence/restock-mix/restock/confidence.spec.ts`
Expected: FAIL — `Cannot find module './confidence'`.

- [ ] **Step 3: Implement `computeRestockConfidence`**

```ts
// src/lib/commercial-intelligence/restock-mix/restock/confidence.ts
import type { Confidence } from "@/lib/loss-intelligence/types";
import type { Trend } from "../types";
import type { RestockParameters } from "./parameters";

export interface RestockConfidenceInput {
  mesesComVenda: number;
  mesesAnalisados: number;
  tendencia: Trend;
  reconciliacaoLimpa: boolean;
}

const MAX_POINTS = 70;

export function computeRestockConfidence(input: RestockConfidenceInput, parameters: RestockParameters): Confidence {
  if (input.mesesComVenda < parameters.evidence.minMonthsWithSales) return "insuficiente";

  let points = 0;
  points += input.mesesComVenda >= input.mesesAnalisados ? 30 : input.mesesComVenda >= Math.ceil(input.mesesAnalisados / 2) ? 20 : 10;
  points += input.tendencia === "volatil" ? 0 : input.tendencia === "indeterminada" ? 5 : 20;
  points += input.reconciliacaoLimpa ? 20 : 5;

  const score = (points / MAX_POINTS) * 100;
  let confidence: Confidence = score >= parameters.confidence.highMin ? "alta" : score >= parameters.confidence.mediumMin ? "media" : "baixa";

  // Tetos que só reduzem, nunca sobem — mesmo desenho de loss-intelligence/confidence.ts.
  if (confidence === "alta" && input.tendencia === "volatil") confidence = "media";
  if (confidence === "alta" && !input.reconciliacaoLimpa) confidence = "media";

  return confidence;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @agiliz/admin exec jest src/lib/commercial-intelligence/restock-mix/restock/confidence.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/commercial-intelligence/restock-mix/restock/confidence.ts src/lib/commercial-intelligence/restock-mix/restock/confidence.spec.ts
git commit -m "feat(admin): add restock engine confidence scoring"
```

---

## Task 5: Motor de Abastecimento — `computeRestockRecommendations`

**Files:**
- Create: `src/lib/commercial-intelligence/restock-mix/restock/engine.ts`
- Test: `src/lib/commercial-intelligence/restock-mix/restock/engine.spec.ts`

**Interfaces:**
- Consumes: `buildStoreSkuSeries` (Task 1), `computeTrend` (Task 2), `RestockParameters`/`RUNTIME_RESTOCK_PARAMETERS` (Task 3), `computeRestockConfidence` (Task 4), `resolveAnalysisWindow` (`@/lib/loss-intelligence/temporal`), `LossIntelligenceResult`/`LossIntelligenceRecommendation`/`LossIntelligenceParameters` (`@/lib/loss-intelligence/types`, `@/lib/loss-intelligence/parameters`).
- Produces: `RestockEngineInput`, `computeRestockRecommendations(input): RestockRecommendation[]` — usado por Task 6, Task 13.

**Regra de precedência implementada (spec §4, §6 passo 5) — sempre nesta ordem, nunca a fórmula
própria sobrepõe um sinal de perdas:**
1. `suspender_abastecimento` / `avaliar_retirada_loja` / `avaliar_retirada_rede` → quantidade 0, ação "Não abastecer", confiança herdada do Loss Intelligence.
2. `reduzir_abastecimento` → quantidade da fórmula cortada por `lossIntegration.reduceFactor`, ação "Reduzir", confiança herdada.
3. `investigar` / `avaliar_permanencia_loja` / `avaliar_permanencia_rede` → fórmula própria normal, mas ganha uma limitação explícita e a confiança nunca passa de "media".
4. Sem sinal ativo (`manter`/`manter_monitorar`) ou sem `LossIntelligenceRecommendation` para o par → fórmula própria, sem ajuste.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/commercial-intelligence/restock-mix/restock/engine.spec.ts
import { describe, it, expect } from "@jest/globals";
import { computeRestockRecommendations, type RestockEngineInput } from "./engine";
import { DEFAULT_RESTOCK_PARAMETERS } from "./parameters";
import { DEFAULT_PARAMETERS as DEFAULT_LOSS_PARAMETERS } from "@/lib/loss-intelligence/parameters";
import type { LossIntelligenceRecommendation, LossIntelligenceResult } from "@/lib/loss-intelligence/types";
import type { Store } from "@/lib/api/stores";
import type { Product } from "@/lib/api/products";
import type { StoreMonthSales } from "@/lib/api/sales";
import type { StoreMonthSupply } from "@/lib/api/supply";

const TODAY = "2026-09-01"; // currentPeriod "2026-09" -> lookback fecha em mar..ago/2026 (6 meses)
const MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
const STORES: Store[] = [{ id: 1, name: "Loja A" } as Store];
const PRODUCTS: Product[] = [{ id: 1, sku: "SKU-1", name: "Produto 1", category: "beverage" } as Product];

function salesFor(qty: number[]): StoreMonthSales[] {
  return MONTHS.map((period, i) => ({ storeId: 1, period, bySku: qty[i] > 0 ? [{ store_id: 1, period, sku: "SKU-1", quantity_sold: qty[i], revenue_cents: qty[i] * 500, ingestion_id: "x" }] : [] }));
}

function supplyFor(qty: (number | null)[]): StoreMonthSupply[] {
  return MONTHS.map((period, i) => ({ storeId: 1, period, restocks: qty[i] !== null ? [{ sku: "SKU-1", quantity_restocked: qty[i]! }] : [] }));
}

function buildLossRecommendation(overrides: Partial<LossIntelligenceRecommendation> = {}): LossIntelligenceRecommendation {
  return {
    sku: "SKU-1",
    storeId: 1,
    janelaAnalisada: { primaryMonths: MONTHS.slice(3), recurrenceLookbackMonths: MONTHS },
    metricasObservadas: {
      qtyRestocked: 0, qtySold: 0, revenueCents: 0, grossMarginCents: null, netMarginAfterLossCents: null, saleToSupplyRatio: null,
      monthsWithRestock: 0, monthsWithSales: 0, monthsAnalyzed: 6, firstSeenPeriod: null, monthsSinceFirstSeen: null,
      byReason: {
        expired: { qtyLost: 0, valueLostCents: 0, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null },
        damaged_product: { qtyLost: 0, valueLostCents: 0, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null },
        other_reason: { qtyLost: 0, valueLostCents: 0, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null },
      },
    },
    diagnosticosPorMotivo: [
      { reason: "other_reason", metrics: { qtyLost: 0, valueLostCents: 0, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null }, sinaisDetectados: [], regrasAcionadas: [], acao: "investigar", potencialIntervencao: "medio", hipoteses: [], escopoProblema: "indeterminado" },
    ],
    historico: [],
    maiorImpactoFinanceiroMotivo: null,
    maiorImpactoFinanceiroValueCents: 0,
    motivoDiagnosticoPrioritario: "other_reason",
    motivosSecundarios: [],
    acaoPrioritaria: "investigar",
    acoesSecundarias: [],
    sinaisTransversais: [],
    prioridade: "media",
    confianca: "alta",
    comparacaoRede: { expired: "dado_insuficiente", damaged_product: "dado_insuficiente", other_reason: "dado_insuficiente" },
    limitacoesDosDados: [],
    firstSeenRecently: false,
    versaoMotor: "test",
    versaoParametros: "test",
    ...overrides,
  };
}

function lossResult(recommendations: LossIntelligenceRecommendation[]): LossIntelligenceResult {
  return { recommendations, countsByAction: {} as LossIntelligenceResult["countsByAction"], valueLostInPrioritizedCasesCents: 0, impactEstimateCents: { conservative: 0, expected: 0, optimistic: 0 } };
}

function baseInput(overrides: Partial<RestockEngineInput> = {}): RestockEngineInput {
  return {
    stores: STORES,
    products: PRODUCTS,
    salesByStoreMonth: salesFor([10, 10, 10, 10, 10, 10]),
    supplyByStoreMonth: supplyFor([12, 12, 12, 12, 12, 12]),
    reconciliationByStoreMonth: [],
    lossResult: lossResult([]),
    today: TODAY,
    lossParameters: DEFAULT_LOSS_PARAMETERS,
    restockParameters: DEFAULT_RESTOCK_PARAMETERS,
    ...overrides,
  };
}

describe("computeRestockRecommendations", () => {
  it("marks dados_insuficientes with zero quantity when fewer than the minimum months have sales", () => {
    const result = computeRestockRecommendations(baseInput({ salesByStoreMonth: salesFor([0, 0, 0, 0, 0, 10]) }));
    expect(result[0].acao).toBe("dados_insuficientes");
    expect(result[0].confianca).toBe("insuficiente");
    expect(result[0].quantidadeSugeridaIA).toBe(0);
  });

  it("suspender_abastecimento from Loss Intelligence overrides the formula to zero and 'não abastecer', inheriting its confidence", () => {
    const result = computeRestockRecommendations(
      baseInput({ lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "suspender_abastecimento", confianca: "baixa" })]) }),
    );
    expect(result[0].quantidadeSugeridaIA).toBe(0);
    expect(result[0].acao).toBe("nao_abastecer");
    expect(result[0].confianca).toBe("baixa");
    expect(result[0].motivo).toMatch(/Inteligência de Perdas/);
  });

  it("reduzir_abastecimento from Loss Intelligence cuts the formula's quantity by the configured factor", () => {
    const withoutOverride = computeRestockRecommendations(baseInput());
    const withOverride = computeRestockRecommendations(
      baseInput({ lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "reduzir_abastecimento", confianca: "media" })]) }),
    );
    expect(withOverride[0].acao).toBe("reduzir");
    expect(withOverride[0].quantidadeSugeridaIA).toBe(Math.round(withoutOverride[0].quantidadeSugeridaIA * DEFAULT_RESTOCK_PARAMETERS.lossIntegration.reduceFactor));
    expect(withOverride[0].confianca).toBe("media");
  });

  it("investigar adds a caveat and caps confidence at media without forcing the quantity to change", () => {
    const result = computeRestockRecommendations(
      baseInput({ lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "investigar" })]) }),
    );
    expect(result[0].limitacoes.some((l) => l.includes("Inteligência de Perdas"))).toBe(true);
    expect(["media", "baixa", "insuficiente"]).toContain(result[0].confianca);
  });

  it("suggests aumentar when the formula's quantity clearly exceeds the last restock", () => {
    const result = computeRestockRecommendations(baseInput({ salesByStoreMonth: salesFor([10, 12, 14, 20, 24, 28]), supplyByStoreMonth: supplyFor([15, 15, 15, 15, 15, 15]) }));
    expect(result[0].acao).toBe("aumentar");
  });

  it("suggests reduzir when the formula's quantity is clearly below the last restock, absent any loss signal", () => {
    const result = computeRestockRecommendations(baseInput({ salesByStoreMonth: salesFor([10, 8, 6, 4, 3, 2]), supplyByStoreMonth: supplyFor([30, 30, 30, 30, 30, 30]) }));
    expect(result[0].acao).toBe("reduzir");
  });

  it("skips a sku that has no matching entry in the products catalogue", () => {
    const result = computeRestockRecommendations(baseInput({ products: [] }));
    expect(result).toHaveLength(0);
  });

  it("always attaches a faixaEstimada and never a bare point estimate", () => {
    const result = computeRestockRecommendations(baseInput());
    expect(result[0].faixaEstimada.min).toBeLessThanOrEqual(result[0].faixaEstimada.max);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @agiliz/admin exec jest src/lib/commercial-intelligence/restock-mix/restock/engine.spec.ts`
Expected: FAIL — `Cannot find module './engine'`.

- [ ] **Step 3: Implement `computeRestockRecommendations`**

```ts
// src/lib/commercial-intelligence/restock-mix/restock/engine.ts
import type { Confidence, LossAction, LossIntelligenceParameters, LossIntelligenceResult } from "@/lib/loss-intelligence/types";
import { resolveAnalysisWindow } from "@/lib/loss-intelligence/temporal";
import type { Product } from "@/lib/api/products";
import type { Store } from "@/lib/api/stores";
import type { StoreMonthSales } from "@/lib/api/sales";
import type { StoreMonthSupply } from "@/lib/api/supply";
import type { PerStoreMonthlyTotal } from "@/lib/api/finance";
import { buildStoreSkuSeries } from "../series";
import { computeTrend } from "../trend";
import type { LossSignal, RestockAction, RestockRecommendation } from "../types";
import { computeRestockConfidence } from "./confidence";
import { RESTOCK_LOGIC_VERSION } from "./logic-version";
import type { RestockParameters } from "./parameters";

export interface RestockEngineInput {
  stores: Store[];
  products: Product[];
  salesByStoreMonth: StoreMonthSales[];
  supplyByStoreMonth: StoreMonthSupply[];
  reconciliationByStoreMonth: PerStoreMonthlyTotal[];
  lossResult: LossIntelligenceResult;
  /** YYYY-MM-DD — mesma janela do Loss Intelligence, resolvida por `resolveAnalysisWindow`. */
  today: string;
  lossParameters: LossIntelligenceParameters;
  restockParameters: RestockParameters;
}

const HARD_STOP_ACTIONS: LossAction[] = ["suspender_abastecimento", "avaliar_retirada_loja", "avaliar_retirada_rede"];
const CAVEAT_ACTIONS: LossAction[] = ["investigar", "avaliar_permanencia_loja", "avaliar_permanencia_rede"];

const LOSS_ACTION_LABEL: Partial<Record<LossAction, string>> = {
  suspender_abastecimento: "suspender abastecimento",
  avaliar_retirada_loja: "avaliar retirada da loja",
  avaliar_retirada_rede: "avaliar retirada da rede",
  reduzir_abastecimento: "reduzir abastecimento",
};

function lossSignalFor(result: LossIntelligenceResult, storeId: number, sku: string): LossSignal | null {
  const rec = result.recommendations.find((r) => r.storeId === storeId && r.sku === sku);
  if (!rec) return null;
  const diagnosis = rec.motivoDiagnosticoPrioritario ? rec.diagnosticosPorMotivo.find((d) => d.reason === rec.motivoDiagnosticoPrioritario) : undefined;
  return { acao: rec.acaoPrioritaria, prioridade: rec.prioridade, confianca: rec.confianca, escopoProblema: diagnosis?.escopoProblema ?? "indeterminado", limitacoesDosDados: rec.limitacoesDosDados };
}

function lastRestocked(meses: { abastecido: number }[]): number | null {
  for (let i = meses.length - 1; i >= 0; i--) if (meses[i].abastecido > 0) return meses[i].abastecido;
  return null;
}

function determineAction(quantidade: number, ultimoAbastecimento: number | null, parameters: RestockParameters["action"]): RestockAction {
  if (ultimoAbastecimento === null) return quantidade > 0 ? "manter" : "nao_abastecer";
  if (quantidade === 0) return "nao_abastecer";
  if (quantidade >= ultimoAbastecimento * (1 + parameters.increaseThresholdPct)) return "aumentar";
  if (quantidade <= ultimoAbastecimento * (1 - parameters.decreaseThresholdPct)) return "reduzir";
  return "manter";
}

const TREND_LABEL: Record<string, string> = { crescendo: "crescendo", estavel: "estável", caindo: "caindo", volatil: "volátil", indeterminada: "indeterminada" };

export function computeRestockRecommendations(input: RestockEngineInput): RestockRecommendation[] {
  const productBySku = new Map(input.products.map((p) => [p.sku, p]));
  const window = resolveAnalysisWindow({ storeId: 0, sku: "", today: input.today, allKnownRestockPeriods: [], parameters: input.lossParameters });
  const seriesList = buildStoreSkuSeries(input.stores, input.salesByStoreMonth, input.supplyByStoreMonth, input.reconciliationByStoreMonth, window.recurrenceLookbackPeriods);

  const recommendations: RestockRecommendation[] = [];

  for (const series of seriesList) {
    const product = productBySku.get(series.sku);
    if (!product) continue;

    const qtySeries = series.meses.map((m) => m.vendido);
    const mesesComVenda = qtySeries.filter((q) => q > 0).length;
    const mesesAnalisados = series.meses.length;
    const sinalPerdas = lossSignalFor(input.lossResult, series.storeId, series.sku);
    const vendasUltimoMes = qtySeries[qtySeries.length - 1] ?? 0;
    const ultimoAbastecimento = lastRestocked(series.meses);

    if (mesesComVenda < input.restockParameters.evidence.minMonthsWithSales) {
      recommendations.push({
        sku: series.sku, storeId: series.storeId, categoria: product.category, vendasUltimoMes, historicoMensal: series.meses,
        ultimoAbastecimento, mesesComVenda, mesesAnalisados, tendencia: "indeterminada", faixaEstimada: { min: 0, max: 0 },
        sinalPerdas, quantidadeSugeridaIA: 0, acao: "dados_insuficientes",
        motivo: `Evidência insuficiente: apenas ${mesesComVenda} ${mesesComVenda === 1 ? "mês" : "meses"} com venda nos últimos ${mesesAnalisados}.`,
        confianca: "insuficiente", limitacoes: sinalPerdas?.limitacoesDosDados ?? [], versaoMotor: RESTOCK_LOGIC_VERSION, versaoParametros: "provisional",
      });
      continue;
    }

    const trend = computeTrend(qtySeries, input.restockParameters.trend);
    const reconciliacaoLimpa = !sinalPerdas || sinalPerdas.limitacoesDosDados.length === 0;

    let quantidadeSugeridaIA = trend.estimativaCentral;
    let faixaEstimada = trend.faixaEstimada;
    let acao: RestockAction;
    let motivo: string;
    let confianca: Confidence;
    const limitacoes = [...(sinalPerdas?.limitacoesDosDados ?? [])];

    if (sinalPerdas && HARD_STOP_ACTIONS.includes(sinalPerdas.acao)) {
      quantidadeSugeridaIA = 0;
      faixaEstimada = { min: 0, max: 0 };
      acao = "nao_abastecer";
      confianca = sinalPerdas.confianca;
      motivo = `Recomendação ativa da Inteligência de Perdas: ${LOSS_ACTION_LABEL[sinalPerdas.acao]}.`;
    } else if (sinalPerdas?.acao === "reduzir_abastecimento") {
      const factor = input.restockParameters.lossIntegration.reduceFactor;
      quantidadeSugeridaIA = Math.round(trend.estimativaCentral * factor);
      faixaEstimada = { min: Math.round(trend.faixaEstimada.min * factor), max: Math.round(trend.faixaEstimada.max * factor) };
      acao = "reduzir";
      confianca = sinalPerdas.confianca;
      motivo = `Recomendação ativa da Inteligência de Perdas: ${LOSS_ACTION_LABEL.reduzir_abastecimento}.`;
    } else {
      acao = determineAction(quantidadeSugeridaIA, ultimoAbastecimento, input.restockParameters.action);
      motivo = `${vendasUltimoMes} vendidos no último mês analisado, tendência ${TREND_LABEL[trend.tendencia]} nos últimos ${mesesAnalisados} meses.`;
      confianca = computeRestockConfidence({ mesesComVenda, mesesAnalisados, tendencia: trend.tendencia, reconciliacaoLimpa }, input.restockParameters);
      if (sinalPerdas && CAVEAT_ACTIONS.includes(sinalPerdas.acao)) {
        limitacoes.push("Este produto está sob avaliação da Inteligência de Perdas — decisão estrutural pendente.");
        if (confianca === "alta") confianca = "media";
      }
    }

    recommendations.push({
      sku: series.sku, storeId: series.storeId, categoria: product.category, vendasUltimoMes, historicoMensal: series.meses,
      ultimoAbastecimento, mesesComVenda, mesesAnalisados, tendencia: trend.tendencia, faixaEstimada, sinalPerdas,
      quantidadeSugeridaIA, acao, motivo, confianca, limitacoes, versaoMotor: RESTOCK_LOGIC_VERSION, versaoParametros: "provisional",
    });
  }

  return recommendations;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @agiliz/admin exec jest src/lib/commercial-intelligence/restock-mix/restock/engine.spec.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/commercial-intelligence/restock-mix/restock/engine.ts src/lib/commercial-intelligence/restock-mix/restock/engine.spec.ts
git commit -m "feat(admin): add restock recommendation engine, consuming Loss Intelligence by precedence"
```

---

## Task 6: UI de Abastecimento — resumo e tabela

**Files:**
- Create: `src/components/commercial-intelligence/restock/restock-panel.tsx`
- Create: `src/components/commercial-intelligence/restock/restock-table.tsx`
- Test: `src/components/commercial-intelligence/restock/restock-panel.spec.tsx`
- Test: `src/components/commercial-intelligence/restock/restock-table.spec.tsx`

**Interfaces:**
- Consumes: `RestockRecommendation`, `MixOpportunity`, `RestockAction` (Task 1, `@/lib/commercial-intelligence/restock-mix/types`).
- Produces: `RestockDisplayRow` (union type, local to `restock-table.tsx`), `RestockPanel`, `RestockTable` — usados por Task 13.

**`RestockDisplayRow` une as duas fontes que aparecem juntas na mesma lista** (spec: a linha "Produto
X / Oportunidade de mix / Testar" vem do motor de Mix, injetada na tabela de Abastecimento — mesmo
padrão de `DecisionRowData` em `src/components/supply/loss-intelligence/decisions-table.tsx`, lido
como referência, onde o caller já resolve produto/loja em texto antes de passar pro componente):

```ts
export type RestockDisplayRow =
  | { kind: "recomendacao"; productLabel: string; storeName: string; data: RestockRecommendation }
  | { kind: "oportunidade"; productLabel: string; storeName: string; data: MixOpportunity };
```

- [ ] **Step 1: Write the failing test for `RestockPanel`**

```tsx
// src/components/commercial-intelligence/restock/restock-panel.spec.tsx
import { describe, it, expect } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { RestockPanel } from "./restock-panel";
import type { RestockDisplayRow } from "./restock-table";
import type { RestockRecommendation, MixOpportunity } from "@/lib/commercial-intelligence/restock-mix/types";

function recRow(acao: RestockRecommendation["acao"], quantidadeSugeridaIA: number): RestockDisplayRow {
  return {
    kind: "recomendacao",
    productLabel: "Produto",
    storeName: "Loja",
    data: { acao, quantidadeSugeridaIA } as RestockRecommendation,
  };
}

function opportunityRow(quantidadeTeste: number): RestockDisplayRow {
  return { kind: "oportunidade", productLabel: "Produto Novo", storeName: "Loja", data: { quantidadeTeste } as MixOpportunity };
}

describe("RestockPanel", () => {
  it("counts levar (aumentar+manter), reduzir, não levar and testar into separate, non-overlapping buckets", () => {
    const rows: RestockDisplayRow[] = [
      recRow("aumentar", 30), recRow("manter", 10), recRow("reduzir", 5), recRow("reduzir", 5),
      recRow("nao_abastecer", 0), recRow("dados_insuficientes", 0), opportunityRow(4),
    ];
    render(<RestockPanel rows={rows} />);

    expect(screen.getByText("2")).toBeInTheDocument(); // levar
    expect(screen.getByText("produtos para levar")).toBeInTheDocument();
    expect(screen.getAllByText("2")).toHaveLength(2); // levar e reduzir empatam em 2 — ambos existem no documento
    expect(screen.getByText("produtos para reduzir")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // não levar
    expect(screen.getByText("produtos para não abastecer")).toBeInTheDocument();
    expect(screen.getByText("oportunidades de teste")).toBeInTheDocument();
  });

  it("sums quantidadeSugeridaIA/quantidadeTeste of every row into 'unidades sugeridas', never fabricating an impact estimate", () => {
    const rows: RestockDisplayRow[] = [recRow("aumentar", 30), recRow("manter", 10), opportunityRow(4)];
    render(<RestockPanel rows={rows} />);
    expect(screen.getByText("44")).toBeInTheDocument(); // 30+10+4
    expect(screen.queryByText(/impacto/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @agiliz/admin exec jest src/components/commercial-intelligence/restock/restock-panel.spec.tsx`
Expected: FAIL — `Cannot find module './restock-panel'` (and `./restock-table`, not created yet either).

- [ ] **Step 3: Implement `restock-table.tsx` (types + component) and `restock-panel.tsx`**

```tsx
// src/components/commercial-intelligence/restock/restock-table.tsx
"use client";

import { useMemo, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MixOpportunity, ProductCategory, RestockAction, RestockRecommendation, Trend } from "@/lib/commercial-intelligence/restock-mix/types";

export type RestockDisplayRow =
  | { kind: "recomendacao"; productLabel: string; storeName: string; data: RestockRecommendation }
  | { kind: "oportunidade"; productLabel: string; storeName: string; data: MixOpportunity };

export const ACTION_LABELS: Record<RestockAction, string> = {
  aumentar: "Aumentar",
  manter: "Manter",
  reduzir: "Reduzir",
  nao_abastecer: "Não abastecer",
  testar: "Testar",
  dados_insuficientes: "Dados insuficientes",
};

export const ACTION_TONE: Record<RestockAction, "neutral" | "positive" | "attention" | "critical"> = {
  aumentar: "positive",
  manter: "positive",
  reduzir: "attention",
  nao_abastecer: "critical",
  testar: "attention",
  dados_insuficientes: "neutral",
};

const CATEGORY_LABELS: Record<ProductCategory, string> = { meal: "Refeição", snack: "Snack", beverage: "Bebida", essential: "Essencial" };

const TREND_ICON: Record<Trend, string> = { crescendo: "↑", estavel: "→", caindo: "↓", volatil: "↻", indeterminada: "—" };
const TREND_LABEL: Record<Trend, string> = { crescendo: "Crescendo", estavel: "Estável", caindo: "Caindo", volatil: "Volátil", indeterminada: "Indeterminada" };

const LOSS_OVERRIDE_ACTIONS = new Set(["suspender_abastecimento", "avaliar_retirada_loja", "avaliar_retirada_rede", "reduzir_abastecimento", "investigar", "avaliar_permanencia_loja", "avaliar_permanencia_rede"]);

function signalLabel(row: RestockDisplayRow): string {
  if (row.kind === "oportunidade") return "💎 Oportunidade de mix";
  const rec = row.data;
  if (rec.sinalPerdas && LOSS_OVERRIDE_ACTIONS.has(rec.sinalPerdas.acao)) return "⚠ Sinal de perdas ativo";
  return `${TREND_ICON[rec.tendencia]} ${TREND_LABEL[rec.tendencia]}`;
}

function rowKey(row: RestockDisplayRow): string {
  return row.kind === "recomendacao" ? `${row.data.storeId}:${row.data.sku}` : `${row.data.storeId}:${row.data.sku}:oportunidade`;
}

function effectiveAction(row: RestockDisplayRow): RestockAction {
  return row.kind === "oportunidade" ? "testar" : row.data.acao;
}

function suggestedQuantity(row: RestockDisplayRow): number {
  return row.kind === "oportunidade" ? row.data.quantidadeTeste : row.data.quantidadeSugeridaIA;
}

type RestockView = "todos" | "levar" | "reduzir" | "nao_levar" | "testar";
const VIEW_LABELS: Record<RestockView, string> = { todos: "Todos", levar: "Levar", reduzir: "Reduzir", nao_levar: "Não levar", testar: "Testar" };
const VIEW_FILTERS: Record<RestockView, (action: RestockAction) => boolean> = {
  todos: () => true,
  levar: (a) => a === "aumentar" || a === "manter",
  reduzir: (a) => a === "reduzir",
  nao_levar: (a) => a === "nao_abastecer",
  testar: (a) => a === "testar",
};

export function RestockTable({ rows, onSelect }: { rows: RestockDisplayRow[]; onSelect: (row: RestockDisplayRow) => void }) {
  const [view, setView] = useState<RestockView>("todos");
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [showGeneratedList, setShowGeneratedList] = useState(false);

  const filtered = useMemo(() => rows.filter((row) => VIEW_FILTERS[view](effectiveAction(row))), [rows, view]);

  function effectiveQuantity(row: RestockDisplayRow): number {
    return overrides[rowKey(row)] ?? suggestedQuantity(row);
  }

  const generated = useMemo(() => {
    const abastecer: RestockDisplayRow[] = [];
    const naoAbastecer: RestockDisplayRow[] = [];
    const testes: RestockDisplayRow[] = [];
    for (const row of rows) {
      const action = effectiveAction(row);
      if (action === "testar") testes.push(row);
      else if (action === "nao_abastecer" || effectiveQuantity(row) === 0) naoAbastecer.push(row);
      else abastecer.push(row);
    }
    return { abastecer, naoAbastecer, testes };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- overrides é lido via effectiveQuantity, recalcular junto com ele é intencional
  }, [rows, overrides]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={view} onValueChange={(v) => setView(v as RestockView)}>
          <TabsList>
            {(Object.entries(VIEW_LABELS) as [RestockView, string][]).map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button size="sm" onClick={() => setShowGeneratedList(true)}>
          Gerar lista de abastecimento
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produto</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead className="text-right">Vendas recentes</TableHead>
            <TableHead>Sinal</TableHead>
            <TableHead className="text-right">Último abastecimento</TableHead>
            <TableHead className="text-right">Sugestão IA</TableHead>
            <TableHead className="text-right">Quantidade final</TableHead>
            <TableHead>Ação</TableHead>
            <TableHead>Confiança</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((row) => {
            const key = rowKey(row);
            const isOpportunity = row.kind === "oportunidade";
            const categoria = isOpportunity ? null : row.data.categoria;
            const vendasRecentes = isOpportunity ? null : row.data.vendasUltimoMes;
            const ultimoAbastecimento = isOpportunity ? null : row.data.ultimoAbastecimento;
            const confianca = row.data.confianca;
            return (
              <TableRow key={key} className="cursor-pointer" onClick={() => onSelect(row)}>
                <TableCell className="font-medium">{row.productLabel}</TableCell>
                <TableCell>{categoria ? CATEGORY_LABELS[categoria] : "—"}</TableCell>
                <TableCell className="text-right tabular">{vendasRecentes ?? "—"}</TableCell>
                <TableCell>{signalLabel(row)}</TableCell>
                <TableCell className="text-right tabular">{ultimoAbastecimento ?? "—"}</TableCell>
                <TableCell className="text-right tabular">{suggestedQuantity(row)}</TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <Input
                    type="number"
                    min={0}
                    className="w-20 text-right"
                    value={effectiveQuantity(row)}
                    onChange={(e) => setOverrides((prev) => ({ ...prev, [key]: Math.max(0, Number(e.target.value) || 0) }))}
                    aria-label={`Quantidade final — ${row.productLabel}`}
                  />
                </TableCell>
                <TableCell>
                  <StatusBadge tone={ACTION_TONE[effectiveAction(row)]}>{ACTION_LABELS[effectiveAction(row)]}</StatusBadge>
                </TableCell>
                <TableCell className="capitalize">{confianca}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog open={showGeneratedList} onOpenChange={setShowGeneratedList}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lista de abastecimento gerada</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 text-sm">
            {([
              ["Abastecer", generated.abastecer],
              ["Não abastecer", generated.naoAbastecer],
              ["Testes", generated.testes],
            ] as const).map(([label, group]) => (
              <div key={label}>
                <p className="mb-1 font-medium">
                  {label} ({group.length})
                </p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {group.map((row) => (
                    <li key={rowKey(row)}>
                      {row.productLabel} — {row.storeName}: {effectiveQuantity(row)} un.
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

```tsx
// src/components/commercial-intelligence/restock/restock-panel.tsx
"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { RestockDisplayRow } from "./restock-table";

function effectiveAction(row: RestockDisplayRow): string {
  return row.kind === "oportunidade" ? "testar" : row.data.acao;
}

function suggestedQuantity(row: RestockDisplayRow): number {
  return row.kind === "oportunidade" ? row.data.quantidadeTeste : row.data.quantidadeSugeridaIA;
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="tabular text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/** Resumo estático — nunca um "impacto financeiro potencial" não calibrado (pedido do operador). */
export function RestockPanel({ rows }: { rows: RestockDisplayRow[] }) {
  const levar = rows.filter((r) => ["aumentar", "manter"].includes(effectiveAction(r))).length;
  const reduzir = rows.filter((r) => effectiveAction(r) === "reduzir").length;
  const naoLevar = rows.filter((r) => effectiveAction(r) === "nao_abastecer").length;
  const testar = rows.filter((r) => effectiveAction(r) === "testar").length;
  const unidadesSugeridas = rows.reduce((sum, r) => sum + suggestedQuantity(r), 0);

  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat value={levar} label="produtos para levar" />
        <Stat value={unidadesSugeridas} label="unidades sugeridas" />
        <Stat value={reduzir} label="produtos para reduzir" />
        <Stat value={naoLevar} label="produtos para não abastecer" />
        <Stat value={testar} label="oportunidades de teste" />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run the panel test to verify it passes**

Run: `pnpm --filter @agiliz/admin exec jest src/components/commercial-intelligence/restock/restock-panel.spec.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing tests for `RestockTable`**

```tsx
// src/components/commercial-intelligence/restock/restock-table.spec.tsx
import { describe, it, expect, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import { RestockTable, type RestockDisplayRow } from "./restock-table";
import type { RestockRecommendation, MixOpportunity } from "@/lib/commercial-intelligence/restock-mix/types";

function rec(overrides: Partial<RestockRecommendation> = {}): RestockRecommendation {
  return {
    sku: "SKU-1", storeId: 1, categoria: "beverage", vendasUltimoMes: 17, historicoMensal: [], ultimoAbastecimento: 24,
    mesesComVenda: 6, mesesAnalisados: 6, tendencia: "crescendo", faixaEstimada: { min: 25, max: 35 }, sinalPerdas: null,
    quantidadeSugeridaIA: 30, acao: "aumentar", motivo: "teste", confianca: "alta", limitacoes: [],
    versaoMotor: "test", versaoParametros: "test", ...overrides,
  };
}

function recRow(label: string, overrides: Partial<RestockRecommendation> = {}): RestockDisplayRow {
  return { kind: "recomendacao", productLabel: label, storeName: "Loja Centro", data: rec(overrides) };
}

function opportunityRow(label: string): RestockDisplayRow {
  return {
    kind: "oportunidade", productLabel: label, storeName: "Loja Centro",
    data: { sku: "SKU-9", storeId: 1, origem: "rede_inteira", evidencia: "bom desempenho na rede", quantidadeTeste: 4, confianca: "media", versaoMotor: "test", versaoParametros: "test" } as MixOpportunity,
  };
}

const ROWS: RestockDisplayRow[] = [
  recRow("Coca-Cola Zero", { acao: "aumentar", tendencia: "crescendo" }),
  recRow("Mentos", { sku: "SKU-2", acao: "manter", tendencia: "estavel" }),
  recRow("Ana Maria", { sku: "SKU-3", acao: "reduzir", tendencia: "caindo" }),
  recRow("Paçoquita", { sku: "SKU-4", acao: "nao_abastecer", quantidadeSugeridaIA: 0 }),
  opportunityRow("Produto X"),
];

describe("RestockTable", () => {
  it("shows every row by default (Todos)", () => {
    render(<RestockTable rows={ROWS} onSelect={jest.fn()} />);
    for (const row of ROWS) expect(screen.getByText(row.productLabel)).toBeInTheDocument();
  });

  it("'Levar' shows only aumentar/manter rows", () => {
    render(<RestockTable rows={ROWS} onSelect={jest.fn()} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Levar" }), { button: 0 });
    expect(screen.getByText("Coca-Cola Zero")).toBeInTheDocument();
    expect(screen.getByText("Mentos")).toBeInTheDocument();
    expect(screen.queryByText("Ana Maria")).not.toBeInTheDocument();
    expect(screen.queryByText("Produto X")).not.toBeInTheDocument();
  });

  it("'Testar' shows opportunity rows even though they have no RestockRecommendation behind them", () => {
    render(<RestockTable rows={ROWS} onSelect={jest.fn()} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Testar" }), { button: 0 });
    expect(screen.getByText("Produto X")).toBeInTheDocument();
    expect(screen.queryByText("Coca-Cola Zero")).not.toBeInTheDocument();
  });

  it("shows a 💎 signal for opportunity rows and a trend arrow for recommendation rows", () => {
    render(<RestockTable rows={ROWS} onSelect={jest.fn()} />);
    expect(screen.getByText("💎 Oportunidade de mix")).toBeInTheDocument();
    expect(screen.getByText("↑ Crescendo")).toBeInTheDocument();
  });

  it("calls onSelect with the exact row when a row is clicked", () => {
    const onSelect = jest.fn();
    render(<RestockTable rows={ROWS} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Mentos"));
    expect(onSelect).toHaveBeenCalledWith(ROWS[1]);
  });

  it("edits Quantidade final and reflects the edited value in the generated list, not the original suggestion", () => {
    render(<RestockTable rows={ROWS} onSelect={jest.fn()} />);

    const input = screen.getByLabelText("Quantidade final — Coca-Cola Zero");
    fireEvent.change(input, { target: { value: "36" } });
    expect(input).toHaveValue(36);

    fireEvent.click(screen.getByRole("button", { name: "Gerar lista de abastecimento" }));
    expect(screen.getByText(/Coca-Cola Zero — Loja Centro: 36 un\./)).toBeInTheDocument();
  });

  it("'Gerar lista' separates rows into Abastecer / Não abastecer / Testes", () => {
    render(<RestockTable rows={ROWS} onSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Gerar lista de abastecimento" }));

    expect(screen.getByText("Abastecer (2)")).toBeInTheDocument(); // Coca-Cola Zero, Mentos
    expect(screen.getByText("Não abastecer (2)")).toBeInTheDocument(); // Ana Maria (reduzir mas fora do grupo abastecer? não — reduzir entra em Abastecer)
    expect(screen.getByText("Testes (1)")).toBeInTheDocument(); // Produto X
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `pnpm --filter @agiliz/admin exec jest src/components/commercial-intelligence/restock/restock-table.spec.tsx`
Expected: FAIL — component not implemented yet in a way the last two tests expect (grouping), and `Cannot find module` before Step 3.

- [ ] **Step 7: Reconcile the 'Gerar lista' grouping test with the implementation, then run again**

`reduzir` (Ana Maria) has a non-zero effective quantity, so it belongs in **Abastecer** (you still bring it, just less), never in "Não abastecer" — only `nao_abastecer` action or an edited-down-to-zero quantity lands there. Fix the test's expectation before running again:

```ts
// src/components/commercial-intelligence/restock/restock-table.spec.tsx — replace the last assertion block
expect(screen.getByText("Abastecer (3)")).toBeInTheDocument(); // Coca-Cola Zero, Mentos, Ana Maria (reduzir ainda é abastecer, só que menos)
expect(screen.getByText("Não abastecer (1)")).toBeInTheDocument(); // Paçoquita
expect(screen.getByText("Testes (1)")).toBeInTheDocument(); // Produto X
```

Run: `pnpm --filter @agiliz/admin exec jest src/components/commercial-intelligence/restock/restock-table.spec.tsx`
Expected: PASS (7 tests).

- [ ] **Step 8: Commit**

```bash
git add src/components/commercial-intelligence/restock/restock-panel.tsx src/components/commercial-intelligence/restock/restock-table.tsx src/components/commercial-intelligence/restock/restock-panel.spec.tsx src/components/commercial-intelligence/restock/restock-table.spec.tsx
git commit -m "feat(admin): add restock summary panel and main table with editable quantities"
```

---

## Task 7: UI de Abastecimento — drill-down (drawer)

**Files:**
- Create: `src/components/commercial-intelligence/restock/restock-drawer.tsx`
- Test: `src/components/commercial-intelligence/restock/restock-drawer.spec.tsx`

**Interfaces:**
- Consumes: `RestockDisplayRow` (Task 6, `./restock-table`).
- Produces: `RestockDrawer` — usado por Task 13.

**Gap encontrado ao especificar este componente**: o mockup do operador pede uma coluna "Margem"
na tabela de Histórico do drawer — mas `StoreSkuMonth` (Task 1) só carrega `receitaCents` por mês,
nunca custo/margem por mês (o motor só resolve custo datado agregado sobre a janela inteira, não
mês a mês — mesma limitação que já existe no motor de Loss Intelligence). Mostrar uma "margem"
mensal exigiria inventar um número (ex.: aplicar a margem agregada da janela em cada mês
proporcionalmente) — o que a regra de "nunca criar falsa precisão" proíbe. A tabela de Histórico
mostra **Receita** por mês em vez de Margem (dado real, mês a mês); a margem agregada da janela
inteira já aparece na seção Quantidade/Diagnóstico, não linha a linha.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/commercial-intelligence/restock/restock-drawer.spec.tsx
import { describe, it, expect, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { RestockDrawer } from "./restock-drawer";
import type { RestockDisplayRow } from "./restock-table";
import type { MixOpportunity, RestockRecommendation } from "@/lib/commercial-intelligence/restock-mix/types";

const RECOMMENDATION_ROW: RestockDisplayRow = {
  kind: "recomendacao",
  productLabel: "Coca-Cola Zero",
  storeName: "Loja Centro",
  data: {
    sku: "SKU-1", storeId: 1, categoria: "beverage", vendasUltimoMes: 17,
    historicoMensal: [
      { period: "2026-07", vendido: 15, abastecido: 20, perdido: 1, receitaCents: 7500 },
      { period: "2026-08", vendido: 17, abastecido: 24, perdido: 0, receitaCents: 8500 },
    ],
    ultimoAbastecimento: 24, mesesComVenda: 6, mesesAnalisados: 6, tendencia: "crescendo",
    faixaEstimada: { min: 25, max: 35 },
    sinalPerdas: { acao: "investigar", prioridade: "media", confianca: "media", escopoProblema: "local", limitacoesDosDados: [] },
    quantidadeSugeridaIA: 30, acao: "aumentar", motivo: "17 vendidos no último mês analisado, tendência crescendo nos últimos 6 meses.",
    confianca: "media", limitacoes: ["Este produto está sob avaliação da Inteligência de Perdas — decisão estrutural pendente."],
    versaoMotor: "test", versaoParametros: "test",
  } satisfies RestockRecommendation,
};

const OPPORTUNITY_ROW: RestockDisplayRow = {
  kind: "oportunidade",
  productLabel: "Monster sabor X",
  storeName: "Ascenty - ADM",
  data: {
    sku: "SKU-9", storeId: 1, origem: "rede_inteira", evidencia: "Bom desempenho em 7 lojas da rede.",
    quantidadeTeste: 4, confianca: "media", versaoMotor: "test", versaoParametros: "test",
  } satisfies MixOpportunity,
};

const DEFAULT_PROPS = { open: true, onOpenChange: jest.fn() };

describe("RestockDrawer", () => {
  it("renders nothing when row is null", () => {
    const { container } = render(<RestockDrawer row={null} {...DEFAULT_PROPS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every section for a recomendacao row with the fixture's exact numbers", () => {
    render(<RestockDrawer row={RECOMMENDATION_ROW} {...DEFAULT_PROPS} />);

    expect(screen.getByText("Coca-Cola Zero — Loja Centro")).toBeInTheDocument();
    expect(screen.getByText("Sugestão: 30 unidades")).toBeInTheDocument();
    expect(screen.getByText(/17 vendidos no último mês analisado/)).toBeInTheDocument();
    expect(screen.getByText("2026-07")).toBeInTheDocument();
    expect(screen.getByText("2026-08")).toBeInTheDocument();
    expect(screen.getByText("Crescendo")).toBeInTheDocument();
    expect(screen.getByText("Faixa estimada: 25–35 unidades")).toBeInTheDocument();
    expect(screen.getByText("Sugestão operacional: 30 unidades")).toBeInTheDocument();
    expect(screen.getByText("Este produto está sob avaliação da Inteligência de Perdas — decisão estrutural pendente.")).toBeInTheDocument();
  });

  it("shows the Loss Intelligence signal without recomputing it — just reads acao/escopo already decided", () => {
    render(<RestockDrawer row={RECOMMENDATION_ROW} {...DEFAULT_PROPS} />);
    expect(screen.getByText(/Investigar/)).toBeInTheDocument();
    expect(screen.getByText(/Local/)).toBeInTheDocument();
  });

  it('shows "Nenhum sinal ativo" when sinalPerdas is null', () => {
    const row: RestockDisplayRow = { ...RECOMMENDATION_ROW, data: { ...RECOMMENDATION_ROW.data as RestockRecommendation, sinalPerdas: null } };
    render(<RestockDrawer row={row} {...DEFAULT_PROPS} />);
    expect(screen.getByText("Nenhum sinal ativo da Inteligência de Perdas.")).toBeInTheDocument();
  });

  it("renders a simpler drawer for an oportunidade row — no histórico/tendência, evidência instead", () => {
    render(<RestockDrawer row={OPPORTUNITY_ROW} {...DEFAULT_PROPS} />);

    expect(screen.getByText("Monster sabor X — Ascenty - ADM")).toBeInTheDocument();
    expect(screen.getByText("Sugestão: 4 unidades")).toBeInTheDocument();
    expect(screen.getByText("Bom desempenho em 7 lojas da rede.")).toBeInTheDocument();
    expect(screen.getByText(/candidato baseado em bom desempenho na rede/)).toBeInTheDocument();
    expect(screen.queryByText("Histórico")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @agiliz/admin exec jest src/components/commercial-intelligence/restock/restock-drawer.spec.tsx`
Expected: FAIL — `Cannot find module './restock-drawer'`.

- [ ] **Step 3: Implement `RestockDrawer`**

```tsx
// src/components/commercial-intelligence/restock/restock-drawer.tsx
"use client";

import { ConfidenceBadge } from "@/components/commercial-intelligence/confidence-badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Level } from "@/lib/commercial-intelligence/types";
import type { Confidence } from "@/lib/loss-intelligence/types";
import type { RestockDisplayRow } from "./restock-table";

const CONFIDENCE_TO_LEVEL: Record<Confidence, Level> = { alta: "high", media: "medium", baixa: "low", insuficiente: "insufficient" };

const TREND_LABEL: Record<string, string> = { crescendo: "Crescendo", estavel: "Estável", caindo: "Caindo", volatil: "Volátil", indeterminada: "Indeterminada" };
const ESCOPO_LABEL: Record<string, string> = { local: "Local", multiplas_lojas: "Múltiplas lojas", rede: "Rede", indeterminado: "Indeterminado" };
const LOSS_ACTION_LABEL: Record<string, string> = {
  manter: "Manter", manter_monitorar: "Manter e monitorar", reduzir_abastecimento: "Reduzir abastecimento", investigar: "Investigar",
  suspender_abastecimento: "Suspender abastecimento", avaliar_retirada_loja: "Avaliar retirada (loja)", avaliar_retirada_rede: "Avaliar retirada (rede)",
  avaliar_permanencia_loja: "Avaliar permanência (loja)", avaliar_permanencia_rede: "Avaliar permanência (rede)", dados_insuficientes: "Dados insuficientes",
};

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function RestockDrawer({ row, open, onOpenChange }: { row: RestockDisplayRow | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!row) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {row.productLabel} — {row.storeName}
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-6">{row.kind === "recomendacao" ? <RecommendationBody data={row.data} /> : <OpportunityBody data={row.data} />}</div>
      </SheetContent>
    </Sheet>
  );
}

function RecommendationBody({ data }: { data: Extract<RestockDisplayRow, { kind: "recomendacao" }>["data"] }) {
  return (
    <>
      <section>
        <h3 className="mb-1 text-sm font-medium">Ação recomendada</h3>
        <p className="text-sm">Sugestão: {data.quantidadeSugeridaIA} unidades</p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Por que?</h3>
        <p className="text-sm">{data.motivo}</p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Histórico</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Período</TableHead>
              <TableHead className="text-right">Abastecido</TableHead>
              <TableHead className="text-right">Vendido</TableHead>
              <TableHead className="text-right">Perdido</TableHead>
              <TableHead className="text-right">Receita</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.historicoMensal.map((m) => (
              <TableRow key={m.period}>
                <TableCell>{m.period}</TableCell>
                <TableCell className="text-right tabular">{m.abastecido}</TableCell>
                <TableCell className="text-right tabular">{m.vendido}</TableCell>
                <TableCell className="text-right tabular">{m.perdido}</TableCell>
                <TableCell className="text-right tabular">{formatCents(m.receitaCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Tendência</h3>
        <p className="text-sm">{TREND_LABEL[data.tendencia]}</p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Inteligência de Perdas</h3>
        {data.sinalPerdas ? (
          <p className="text-sm">
            {LOSS_ACTION_LABEL[data.sinalPerdas.acao]} — escopo: {ESCOPO_LABEL[data.sinalPerdas.escopoProblema]}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum sinal ativo da Inteligência de Perdas.</p>
        )}
      </section>

      {data.sinalPerdas && (
        <section>
          <h3 className="mb-1 text-sm font-medium">Comparação com a rede</h3>
          <p className="text-sm text-muted-foreground">Escopo do problema: {ESCOPO_LABEL[data.sinalPerdas.escopoProblema]}.</p>
        </section>
      )}

      <section>
        <h3 className="mb-1 text-sm font-medium">Quantidade</h3>
        <p className="text-sm">
          Faixa estimada: {data.faixaEstimada.min}–{data.faixaEstimada.max} unidades
        </p>
        <p className="text-sm">Sugestão operacional: {data.quantidadeSugeridaIA} unidades</p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Confiança</h3>
        <ConfidenceBadge level={CONFIDENCE_TO_LEVEL[data.confianca]} />
      </section>

      {data.limitacoes.length > 0 && (
        <section className="rounded-lg border border-warning/30 bg-warning/12 p-3 text-sm text-warning">
          <p className="font-medium">Limitações</p>
          <ul className="list-disc pl-4 text-xs">
            {data.limitacoes.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function OpportunityBody({ data }: { data: Extract<RestockDisplayRow, { kind: "oportunidade" }>["data"] }) {
  return (
    <>
      <section>
        <h3 className="mb-1 text-sm font-medium">Ação recomendada</h3>
        <p className="text-sm">Sugestão: {data.quantidadeTeste} unidades</p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Por que?</h3>
        <p className="text-sm">{data.evidencia}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          SKU ausente nesta loja — candidato baseado em bom desempenho na rede, não em histórico direto do par loja×produto.
        </p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Confiança</h3>
        <ConfidenceBadge level={CONFIDENCE_TO_LEVEL[data.confianca]} />
      </section>
    </>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @agiliz/admin exec jest src/components/commercial-intelligence/restock/restock-drawer.spec.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/commercial-intelligence/restock/restock-drawer.tsx src/components/commercial-intelligence/restock/restock-drawer.spec.tsx
git commit -m "feat(admin): add restock drill-down drawer for recommendation and opportunity rows"
```

---

**Checkpoint: Abastecimento Inteligente está completo e testável de ponta a ponta neste commit**
(motor + parâmetros + confiança + painel + tabela + drawer). Os Tasks 8-15 constroem Mix das Lojas
e a fiação da tela — podem ser feitos numa sessão separada sem perder trabalho, se necessário.

---

## Task 8: Parâmetros e calibração do motor de Mix

**Files:**
- Create: `src/lib/commercial-intelligence/restock-mix/mix/parameter-docs.ts`
- Create: `src/lib/commercial-intelligence/restock-mix/mix/parameters.ts`
- Create: `src/lib/commercial-intelligence/restock-mix/mix/env.ts`
- Create: `src/lib/commercial-intelligence/restock-mix/mix/parameter-rows.ts`
- Create: `src/lib/commercial-intelligence/restock-mix/mix/logic-version.ts`
- Test: `src/lib/commercial-intelligence/restock-mix/mix/parameters.spec.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `MixParameters`, `DEFAULT_MIX_PARAMETERS`, `RUNTIME_MIX_PARAMETERS`, `getMixParameter`, `formatMixParameterValue`, `mixParameterCatalogSections`, `mixBusinessRuleRows`, `MIX_LOGIC_VERSION` — usados por Task 9, Task 10 e Task 14.

Mesmo padrão do Task 3 (scaffolding mecânico, um único task), prefixo de env var `MIX_` em vez de
`RESTOCK_`. Único ajuste de forma: este motor tem parâmetros que são contagens puras (nº de lojas,
nº de unidades de teste), não meses nem proporção — ganham um `unit: "count"` próprio.

- [ ] **Step 1: Write `parameter-docs.ts`**

```ts
// src/lib/commercial-intelligence/restock-mix/mix/parameter-docs.ts
export type ParameterKind = "business" | "quality" | "analytic";
export type ParameterUnit = "share" | "months" | "number" | "count";

export interface ParameterDoc {
  label: string;
  kind: ParameterKind;
  unit: ParameterUnit;
  why: string;
  controls: string;
  up: string;
  down: string;
  min: number;
  max: number;
  integer: boolean;
}

const d = (doc: ParameterDoc): ParameterDoc => doc;

export const PARAMETER_DOCS = {
  "evidence.minMonthsWithSales": d({
    label: "Meses mínimos com venda",
    kind: "quality",
    unit: "months",
    why: "Menos de 2 meses com venda não sustenta uma classificação de mix — vira dados insuficientes.",
    controls: "Gate de entrada do motor (§7) — abaixo disso, classificação vira dados_insuficientes.",
    up: "Mais SKUs caem em dados insuficientes.",
    down: "Menos exigente para classificar.",
    min: 1,
    max: 6,
    integer: true,
  }),
  "trend.recentMonthsCount": d({
    label: "Quantos meses contam como 'recentes'",
    kind: "analytic",
    unit: "months",
    why: "Mesmo piso de julgamento do motor de Abastecimento (Task 2/3) — 3 dos 6 meses da janela pesarem mais.",
    controls: "Quantos meses do fim da série recebem o peso maior na tendência usada pela classificação (§7).",
    up: "Menos meses pesam mais — classificação reage mais rápido a mudanças recentes.",
    down: "Mais meses pesam igual — classificação mais estável.",
    min: 1,
    max: 6,
    integer: true,
  }),
  "trend.recentWeightMultiplier": d({
    label: "Quanto mais pesam os meses recentes",
    kind: "analytic",
    unit: "number",
    why: "Mesmo piso de julgamento do motor de Abastecimento — peso 2x.",
    controls: "Multiplicador de peso dos meses recentes na tendência usada pela classificação (§7).",
    up: "Meses recentes dominam ainda mais a leitura de tendência.",
    down: "Tendência se aproxima de uma média simples de todo o histórico.",
    min: 1,
    max: 5,
    integer: false,
  }),
  "trend.upThresholdPct": d({
    label: "Corte para considerar 'crescendo'",
    kind: "analytic",
    unit: "share",
    why: "Mesmo piso de julgamento do motor de Abastecimento — 20% de alta entre as duas metades recentes.",
    controls: "Compara os últimos 2 meses com os 2 anteriores para a classificação (§7).",
    up: "Mais difícil classificar como crescendo.",
    down: "Mais fácil classificar como crescendo.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "trend.downThresholdPct": d({
    label: "Corte para considerar 'caindo'",
    kind: "analytic",
    unit: "share",
    why: "Mesmo raciocínio do corte de alta, para o lado da queda.",
    controls: "Compara os últimos 2 meses com os 2 anteriores para a classificação (§7).",
    up: "Mais difícil classificar como caindo.",
    down: "Mais fácil classificar como caindo.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "trend.adjustPct": d({
    label: "Ajuste aplicado quando há tendência",
    kind: "business",
    unit: "share",
    why: "Mesmo piso de julgamento do motor de Abastecimento — não muda a classificação de Mix diretamente, mantido para as duas árvores usarem a mesma fórmula de tendência sem depender uma da outra.",
    controls: "Parte da fórmula de tendência compartilhada (Task 2), recalculada aqui com parâmetros próprios do Mix.",
    up: "N/A para classificação de Mix — afeta só a estimativa central interna do cálculo de tendência.",
    down: "N/A para classificação de Mix.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "trend.volatilityThreshold": d({
    label: "Corte de volatilidade",
    kind: "analytic",
    unit: "share",
    why: "Mesmo piso de julgamento do motor de Abastecimento — coeficiente de variação acima de 40%.",
    controls: "Sobrepõe a tendência para 'volátil' — a classificação cai em 'manter' cauteloso com confiança capada (§7).",
    up: "Menos séries são classificadas como voláteis.",
    down: "Mais séries são classificadas como voláteis.",
    min: 0,
    max: 2,
    integer: false,
  }),
  "classification.affinityExploreMin": d({
    label: "Afinidade mínima para 'explorar'",
    kind: "analytic",
    unit: "number",
    why: "1.2x a participação esperada na rede é o piso de julgamento para considerar o produto proporcionalmente mais importante nesta loja do que na média.",
    controls: "Combinado com tendência crescendo e margem saudável define 'explorar' (§7).",
    up: "Mais difícil classificar como explorar.",
    down: "Mais fácil classificar como explorar.",
    min: 1,
    max: 5,
    integer: false,
  }),
  "classification.affinityHealthyMin": d({
    label: "Afinidade mínima para 'saudável'",
    kind: "analytic",
    unit: "number",
    why: "Abaixo de 0.8x a participação esperada na rede, o produto já vende proporcionalmente menos aqui do que deveria.",
    controls: "Abaixo disso, entra como sinal de 'reduzir' junto com tendência caindo (§7).",
    up: "Mais produtos classificados como abaixo do esperado.",
    down: "Menos produtos classificados como abaixo do esperado.",
    min: 0,
    max: 2,
    integer: false,
  }),
  "classification.marginHealthyMinPct": d({
    label: "Margem mínima saudável",
    kind: "business",
    unit: "share",
    why: "Decisão de negócio: 15% de margem sobre a receita é o piso inicial de julgamento para considerar o produto rentável o suficiente para manter/explorar.",
    controls: "Uma das 3 condições de 'explorar'/'manter' em §7.",
    up: "Mais exigente — menos produtos contam como margem saudável.",
    down: "Menos exigente.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "opportunity.minNetworkStores": d({
    label: "Mínimo de lojas com bom desempenho para virar candidato",
    kind: "quality",
    unit: "count",
    why: "5 lojas com bom desempenho é o piso de julgamento para considerar um SKU ausente como candidato de mix, mesmo sem comparação por loja parecida (spec §8, v1 sem esse recorte).",
    controls: "Gate de `computeMixOpportunities` (§8).",
    up: "Menos SKUs viram candidatos a oportunidade.",
    down: "Mais SKUs viram candidatos, com evidência mais fraca cada um.",
    min: 1,
    max: 50,
    integer: true,
  }),
  "opportunity.testQuantity": d({
    label: "Quantidade de teste sugerida",
    kind: "business",
    unit: "count",
    why: "Decisão de negócio: 4 unidades é o tamanho de teste inicial — pequeno o bastante para não arriscar capital, grande o bastante para gerar sinal de venda.",
    controls: "Quantidade sugerida em toda `MixOpportunity` (§8).",
    up: "Testes maiores, mais capital em risco por produto testado.",
    down: "Testes menores, sinal de venda mais fraco.",
    min: 1,
    max: 50,
    integer: true,
  }),
  "confidence.highMin": d({
    label: "Pontuação mínima para confiança Alta",
    kind: "quality",
    unit: "number",
    why: "Mesmo piso de julgamento do motor de Abastecimento (Task 4) — 70 de 100 pontos possíveis.",
    controls: "Corte Alta vs Média na régua de confiança (Task 9). Nunca se aplica a oportunidades de novo mix — essas nunca chegam a 'alta' (decisão do operador, spec §8).",
    up: "Mais exigente para confiança Alta.",
    down: "Menos exigente.",
    min: 0,
    max: 100,
    integer: true,
  }),
  "confidence.mediumMin": d({
    label: "Pontuação mínima para confiança Média",
    kind: "quality",
    unit: "number",
    why: "Mesmo piso de julgamento do motor de Abastecimento (Task 4) — 40 de 100 pontos possíveis.",
    controls: "Corte Média vs Baixa na régua de confiança (Task 9).",
    up: "Mais exigente para confiança Média.",
    down: "Menos exigente.",
    min: 0,
    max: 100,
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
  quality: { title: "Critérios de qualidade dos dados", description: "Decidem se há evidência suficiente para uma classificação — nunca um ajuste de negócio." },
  analytic: { title: "Modelo analítico", description: "Como o motor de Mix classifica presença e identifica oportunidades." },
};

export const PARAMETER_GROUP_LABELS: Record<string, string> = {
  evidence: "Evidência mínima",
  trend: "Tendência",
  classification: "Classificação",
  opportunity: "Oportunidades de novo mix",
  confidence: "Confiança",
};
```

- [ ] **Step 2: Write the failing test for `parameters.ts`**

```ts
// src/lib/commercial-intelligence/restock-mix/mix/parameters.spec.ts
import { describe, it, expect } from "@jest/globals";
import { DEFAULT_MIX_PARAMETERS, envNameOf, formatMixParameterValue, getMixParameter, parametersFromEnv } from "./parameters";

describe("mix parameters", () => {
  it("reads a nested value by dotted path", () => {
    expect(getMixParameter(DEFAULT_MIX_PARAMETERS, "opportunity.testQuantity")).toBe(4);
  });

  it("derives the env var name from the path", () => {
    expect(envNameOf("opportunity.minNetworkStores")).toBe("NEXT_PUBLIC_MIX_OPPORTUNITY_MIN_NETWORK_STORES");
  });

  it("overrides a value from env when in bounds", () => {
    const { parameters, warnings } = parametersFromEnv({ NEXT_PUBLIC_MIX_OPPORTUNITY_TEST_QUANTITY: "6" });
    expect(getMixParameter(parameters, "opportunity.testQuantity")).toBe(6);
    expect(warnings).toEqual([]);
  });

  it("ignores and warns on an out-of-bounds env value, keeping the default", () => {
    const { parameters, warnings } = parametersFromEnv({ NEXT_PUBLIC_MIX_OPPORTUNITY_TEST_QUANTITY: "999" });
    expect(getMixParameter(parameters, "opportunity.testQuantity")).toBe(4);
    expect(warnings).toHaveLength(1);
  });

  it("formats a share as a percentage", () => {
    expect(formatMixParameterValue("classification.marginHealthyMinPct", 0.15)).toBe("15%");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @agiliz/admin exec jest src/lib/commercial-intelligence/restock-mix/mix/parameters.spec.ts`
Expected: FAIL — `Cannot find module './parameters'`.

- [ ] **Step 4: Implement `parameters.ts`, `env.ts`, `parameter-rows.ts`, `logic-version.ts`**

```ts
// src/lib/commercial-intelligence/restock-mix/mix/parameters.ts
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
```

```ts
// src/lib/commercial-intelligence/restock-mix/mix/env.ts
/** Único lugar que lê `process.env` para este motor — Next só inlina NEXT_PUBLIC_* escrito literal. */
export function readMixPublicEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_MIX_EVIDENCE_MIN_MONTHS_WITH_SALES: process.env.NEXT_PUBLIC_MIX_EVIDENCE_MIN_MONTHS_WITH_SALES,
    NEXT_PUBLIC_MIX_TREND_RECENT_MONTHS_COUNT: process.env.NEXT_PUBLIC_MIX_TREND_RECENT_MONTHS_COUNT,
    NEXT_PUBLIC_MIX_TREND_RECENT_WEIGHT_MULTIPLIER: process.env.NEXT_PUBLIC_MIX_TREND_RECENT_WEIGHT_MULTIPLIER,
    NEXT_PUBLIC_MIX_TREND_UP_THRESHOLD_PCT: process.env.NEXT_PUBLIC_MIX_TREND_UP_THRESHOLD_PCT,
    NEXT_PUBLIC_MIX_TREND_DOWN_THRESHOLD_PCT: process.env.NEXT_PUBLIC_MIX_TREND_DOWN_THRESHOLD_PCT,
    NEXT_PUBLIC_MIX_TREND_ADJUST_PCT: process.env.NEXT_PUBLIC_MIX_TREND_ADJUST_PCT,
    NEXT_PUBLIC_MIX_TREND_VOLATILITY_THRESHOLD: process.env.NEXT_PUBLIC_MIX_TREND_VOLATILITY_THRESHOLD,
    NEXT_PUBLIC_MIX_CLASSIFICATION_AFFINITY_EXPLORE_MIN: process.env.NEXT_PUBLIC_MIX_CLASSIFICATION_AFFINITY_EXPLORE_MIN,
    NEXT_PUBLIC_MIX_CLASSIFICATION_AFFINITY_HEALTHY_MIN: process.env.NEXT_PUBLIC_MIX_CLASSIFICATION_AFFINITY_HEALTHY_MIN,
    NEXT_PUBLIC_MIX_CLASSIFICATION_MARGIN_HEALTHY_MIN_PCT: process.env.NEXT_PUBLIC_MIX_CLASSIFICATION_MARGIN_HEALTHY_MIN_PCT,
    NEXT_PUBLIC_MIX_OPPORTUNITY_MIN_NETWORK_STORES: process.env.NEXT_PUBLIC_MIX_OPPORTUNITY_MIN_NETWORK_STORES,
    NEXT_PUBLIC_MIX_OPPORTUNITY_TEST_QUANTITY: process.env.NEXT_PUBLIC_MIX_OPPORTUNITY_TEST_QUANTITY,
    NEXT_PUBLIC_MIX_CONFIDENCE_HIGH_MIN: process.env.NEXT_PUBLIC_MIX_CONFIDENCE_HIGH_MIN,
    NEXT_PUBLIC_MIX_CONFIDENCE_MEDIUM_MIN: process.env.NEXT_PUBLIC_MIX_CONFIDENCE_MEDIUM_MIN,
  };
}
```

```ts
// src/lib/commercial-intelligence/restock-mix/mix/logic-version.ts
/** Anexada a toda MixRecommendation/MixOpportunity — incrementar (minor) sempre que a árvore de classificação ou a regra de oportunidade mudar. */
export const MIX_LOGIC_VERSION = "mix-logic/0.1.0-provisional";
```

```ts
// src/lib/commercial-intelligence/restock-mix/mix/parameter-rows.ts
import { KIND_LABELS, PARAMETER_DOCS, PARAMETER_GROUP_LABELS, PARAMETER_KINDS, PARAMETER_PATHS, type ParameterPath } from "./parameter-docs";
import { DEFAULT_MIX_PARAMETERS, envNameOf, formatMixParameterValue, getMixParameter, isProvisional, type MixParameters } from "./parameters";
import type { ParameterKindSection, ParameterRuleRow } from "@/components/parameter-catalog";
import type { BusinessRuleRow } from "@/components/business-rules-sheet";

const UNIT_LABELS: Record<string, string> = { share: "proporção (mostrada em %)", months: "meses", number: "número", count: "contagem" };

function toRow(path: ParameterPath, parameters: MixParameters, defaults: MixParameters): ParameterRuleRow {
  const doc = PARAMETER_DOCS[path];
  const value = getMixParameter(parameters, path);
  const fallback = getMixParameter(defaults, path);
  const group = path.split(".")[0];

  return {
    path,
    label: doc.label,
    group,
    groupLabel: PARAMETER_GROUP_LABELS[group] ?? group,
    kind: doc.kind,
    formattedValue: formatMixParameterValue(path, value),
    fallbackFormattedValue: formatMixParameterValue(path, fallback),
    isOverridden: value !== fallback,
    isProvisional: isProvisional(path),
    controls: doc.controls,
    formula: null,
    unitLabel: UNIT_LABELS[doc.unit] ?? doc.unit,
    minFormatted: formatMixParameterValue(path, doc.min),
    maxFormatted: formatMixParameterValue(path, doc.max),
    why: doc.why,
    usedIn: doc.controls,
    up: doc.up,
    down: doc.down,
    envName: envNameOf(path),
  };
}

export function mixParameterCatalogSections(parameters: MixParameters, defaults: MixParameters = DEFAULT_MIX_PARAMETERS): ParameterKindSection[] {
  return (["quality", "analytic", "business"] as const).map((kind) => ({
    kind,
    title: KIND_LABELS[kind].title,
    description: KIND_LABELS[kind].description,
    rows: PARAMETER_KINDS[kind].map((path) => toRow(path, parameters, defaults)),
  }));
}

export function mixBusinessRuleRows(parameters: MixParameters, defaults: MixParameters = DEFAULT_MIX_PARAMETERS): BusinessRuleRow[] {
  return PARAMETER_KINDS.business.map((path) => {
    const row = toRow(path, parameters, defaults);
    return { path: row.path, label: row.label, formattedValue: row.formattedValue, controls: row.controls, usedIn: row.usedIn };
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @agiliz/admin exec jest src/lib/commercial-intelligence/restock-mix/mix/parameters.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/commercial-intelligence/restock-mix/mix/parameter-docs.ts src/lib/commercial-intelligence/restock-mix/mix/parameters.ts src/lib/commercial-intelligence/restock-mix/mix/env.ts src/lib/commercial-intelligence/restock-mix/mix/parameter-rows.ts src/lib/commercial-intelligence/restock-mix/mix/logic-version.ts src/lib/commercial-intelligence/restock-mix/mix/parameters.spec.ts
git commit -m "feat(admin): add mix engine parameters, docs and calibration scaffolding"
```

---

## Task 9: Confiança do motor de Mix

**Files:**
- Create: `src/lib/commercial-intelligence/restock-mix/mix/confidence.ts`
- Test: `src/lib/commercial-intelligence/restock-mix/mix/confidence.spec.ts`

**Interfaces:**
- Consumes: `Trend` (Task 1), `MixParameters` (Task 8).
- Produces: `MixConfidenceInput`, `computeMixConfidence(input, parameters): Confidence`, `computeOpportunityConfidence(storesComBomDesempenho, parameters): Confidence` — usados por Task 10.

Mesma régua de `computeRestockConfidence` (Task 4) para classificações de SKU já presente na loja.
`computeOpportunityConfidence` é uma função separada e deliberadamente mais simples — **nunca
retorna `"alta"`** (Global Constraint, decisão do operador §8): é extrapolação de rede, não
histórico direto do par loja×SKU.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/commercial-intelligence/restock-mix/mix/confidence.spec.ts
import { describe, it, expect } from "@jest/globals";
import { computeMixConfidence, computeOpportunityConfidence, type MixConfidenceInput } from "./confidence";
import { DEFAULT_MIX_PARAMETERS } from "./parameters";

function input(overrides: Partial<MixConfidenceInput> = {}): MixConfidenceInput {
  return { mesesComVenda: 6, mesesAnalisados: 6, tendencia: "estavel", reconciliacaoLimpa: true, ...overrides };
}

describe("computeMixConfidence", () => {
  it("is insuficiente below the minimum months-with-sales gate", () => {
    expect(computeMixConfidence(input({ mesesComVenda: 1 }), DEFAULT_MIX_PARAMETERS)).toBe("insuficiente");
  });

  it("is alta with full evidence, stable trend and clean reconciliation", () => {
    expect(computeMixConfidence(input(), DEFAULT_MIX_PARAMETERS)).toBe("alta");
  });

  it("caps at media when the trend is volatil", () => {
    expect(computeMixConfidence(input({ tendencia: "volatil" }), DEFAULT_MIX_PARAMETERS)).toBe("media");
  });
});

describe("computeOpportunityConfidence", () => {
  it("never returns alta, no matter how many stores show good performance", () => {
    expect(computeOpportunityConfidence(5, DEFAULT_MIX_PARAMETERS)).not.toBe("alta");
    expect(computeOpportunityConfidence(500, DEFAULT_MIX_PARAMETERS)).not.toBe("alta");
  });

  it("is media with comfortably more stores than the minimum gate, baixa right at the gate", () => {
    expect(computeOpportunityConfidence(DEFAULT_MIX_PARAMETERS.opportunity.minNetworkStores * 2, DEFAULT_MIX_PARAMETERS)).toBe("media");
    expect(computeOpportunityConfidence(DEFAULT_MIX_PARAMETERS.opportunity.minNetworkStores, DEFAULT_MIX_PARAMETERS)).toBe("baixa");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @agiliz/admin exec jest src/lib/commercial-intelligence/restock-mix/mix/confidence.spec.ts`
Expected: FAIL — `Cannot find module './confidence'`.

- [ ] **Step 3: Implement `computeMixConfidence` and `computeOpportunityConfidence`**

```ts
// src/lib/commercial-intelligence/restock-mix/mix/confidence.ts
import type { Confidence } from "@/lib/loss-intelligence/types";
import type { Trend } from "../types";
import type { MixParameters } from "./parameters";

export interface MixConfidenceInput {
  mesesComVenda: number;
  mesesAnalisados: number;
  tendencia: Trend;
  reconciliacaoLimpa: boolean;
}

const MAX_POINTS = 70;

/** Mesma régua de restock/confidence.ts (Task 4) — gate duro, fatores aplicáveis, tetos que só reduzem. */
export function computeMixConfidence(input: MixConfidenceInput, parameters: MixParameters): Confidence {
  if (input.mesesComVenda < parameters.evidence.minMonthsWithSales) return "insuficiente";

  let points = 0;
  points += input.mesesComVenda >= input.mesesAnalisados ? 30 : input.mesesComVenda >= Math.ceil(input.mesesAnalisados / 2) ? 20 : 10;
  points += input.tendencia === "volatil" ? 0 : input.tendencia === "indeterminada" ? 5 : 20;
  points += input.reconciliacaoLimpa ? 20 : 5;

  const score = (points / MAX_POINTS) * 100;
  let confidence: Confidence = score >= parameters.confidence.highMin ? "alta" : score >= parameters.confidence.mediumMin ? "media" : "baixa";

  if (confidence === "alta" && input.tendencia === "volatil") confidence = "media";
  if (confidence === "alta" && !input.reconciliacaoLimpa) confidence = "media";

  return confidence;
}

/** Nunca "alta" (Global Constraint) — extrapolação de rede, não histórico direto do par loja×SKU. */
export function computeOpportunityConfidence(storesComBomDesempenho: number, parameters: MixParameters): Confidence {
  if (storesComBomDesempenho < parameters.opportunity.minNetworkStores) return "insuficiente";
  return storesComBomDesempenho >= parameters.opportunity.minNetworkStores * 2 ? "media" : "baixa";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @agiliz/admin exec jest src/lib/commercial-intelligence/restock-mix/mix/confidence.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/commercial-intelligence/restock-mix/mix/confidence.ts src/lib/commercial-intelligence/restock-mix/mix/confidence.spec.ts
git commit -m "feat(admin): add mix engine confidence scoring, opportunities capped below alta"
```

---

## Task 10: Motor de Mix — classificação e oportunidades

**Files:**
- Create: `src/lib/commercial-intelligence/restock-mix/mix/engine.ts`
- Test: `src/lib/commercial-intelligence/restock-mix/mix/engine.spec.ts`

**Interfaces:**
- Consumes: `buildStoreSkuSeries` (Task 1), `computeTrend` (Task 2), `MixParameters`/`RUNTIME_MIX_PARAMETERS` (Task 8), `computeMixConfidence`/`computeOpportunityConfidence` (Task 9), `resolveAnalysisWindow` (`@/lib/loss-intelligence/temporal`).
- Produces: `MixEngineInput`, `computeMixRecommendations(input): MixRecommendation[]`, `computeMixOpportunities(input): MixOpportunity[]` — usados por Task 11, Task 13 (a última também alimenta as linhas "Testar" da tabela de Abastecimento, Task 6).

**`computeNetworkAffinity` substitui a reutilização de `productAffinity` (`@/lib/sales-insights.ts`)
cogitada na spec** — achado ao especificar este task: `productAffinity` é calculada sobre
`SalesTransaction[]` (nível de transação, só 1 mês por vez, só lojas/meses no formato novo
ago/2026+ — `@/lib/api/sales.ts`), enquanto o motor de Mix precisa da série mensal confiável de 6
meses que já usa em todo o resto (`SalesRecord`, disponível em todo o histórico). Reimplementa a
mesma razão (participação do SKU na loja ÷ participação na rede) sobre `StoreSkuSeries`, sem
depender de detalhe de transação.

**Precedência do Loss Intelligence (spec §7, decisão do operador já aprovada):**
`suspender_abastecimento` → classificação `"suspender_abastecimento"`; `avaliar_retirada_loja`/
`avaliar_retirada_rede`/`avaliar_permanencia_loja`/`avaliar_permanencia_rede` → classificação
`"avaliar_retirada"`; `reduzir_abastecimento` → `"reduzir"`; `investigar` → segue a classificação
normal, com limitação e confiança capada em `"media"`; sem sinal → classificação normal.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/commercial-intelligence/restock-mix/mix/engine.spec.ts
import { describe, it, expect } from "@jest/globals";
import { computeMixOpportunities, computeMixRecommendations, type MixEngineInput } from "./engine";
import { DEFAULT_MIX_PARAMETERS } from "./parameters";
import { DEFAULT_PARAMETERS as DEFAULT_LOSS_PARAMETERS } from "@/lib/loss-intelligence/parameters";
import type { LossIntelligenceRecommendation, LossIntelligenceResult } from "@/lib/loss-intelligence/types";
import type { Store } from "@/lib/api/stores";
import type { Product } from "@/lib/api/products";
import type { StoreMonthSales } from "@/lib/api/sales";

const TODAY = "2026-09-01";
const MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
const PRODUCTS: Product[] = [{ id: 1, sku: "SKU-1", name: "Produto 1", category: "beverage" } as Product];

function salesFor(storeId: number, sku: string, qty: number[], unitPriceCents = 500): StoreMonthSales[] {
  return MONTHS.map((period, i) => ({ storeId, period, bySku: qty[i] > 0 ? [{ store_id: storeId, period, sku, quantity_sold: qty[i], revenue_cents: qty[i] * unitPriceCents, ingestion_id: "x" }] : [] }));
}

function mergeSales(...groups: StoreMonthSales[][]): StoreMonthSales[] {
  const byKey = new Map<string, StoreMonthSales>();
  for (const group of groups) {
    for (const month of group) {
      const key = `${month.storeId}:${month.period}`;
      const existing = byKey.get(key);
      if (existing) existing.bySku.push(...month.bySku);
      else byKey.set(key, { ...month, bySku: [...month.bySku] });
    }
  }
  return [...byKey.values()];
}

function lossResult(recommendations: LossIntelligenceRecommendation[] = []): LossIntelligenceResult {
  return { recommendations, countsByAction: {} as LossIntelligenceResult["countsByAction"], valueLostInPrioritizedCasesCents: 0, impactEstimateCents: { conservative: 0, expected: 0, optimistic: 0 } };
}

function buildLossRecommendation(overrides: Partial<LossIntelligenceRecommendation> = {}): LossIntelligenceRecommendation {
  return {
    sku: "SKU-1", storeId: 1,
    janelaAnalisada: { primaryMonths: MONTHS.slice(3), recurrenceLookbackMonths: MONTHS },
    metricasObservadas: {
      qtyRestocked: 0, qtySold: 0, revenueCents: 0, grossMarginCents: null, netMarginAfterLossCents: null, saleToSupplyRatio: null,
      monthsWithRestock: 0, monthsWithSales: 0, monthsAnalyzed: 6, firstSeenPeriod: null, monthsSinceFirstSeen: null,
      byReason: {
        expired: { qtyLost: 0, valueLostCents: 0, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null },
        damaged_product: { qtyLost: 0, valueLostCents: 0, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null },
        other_reason: { qtyLost: 0, valueLostCents: 0, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null },
      },
    },
    diagnosticosPorMotivo: [
      { reason: "other_reason", metrics: { qtyLost: 0, valueLostCents: 0, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null }, sinaisDetectados: [], regrasAcionadas: [], acao: "investigar", potencialIntervencao: "medio", hipoteses: [], escopoProblema: "indeterminado" },
    ],
    historico: [], maiorImpactoFinanceiroMotivo: null, maiorImpactoFinanceiroValueCents: 0, motivoDiagnosticoPrioritario: "other_reason",
    motivosSecundarios: [], acaoPrioritaria: "investigar", acoesSecundarias: [], sinaisTransversais: [], prioridade: "media", confianca: "alta",
    comparacaoRede: { expired: "dado_insuficiente", damaged_product: "dado_insuficiente", other_reason: "dado_insuficiente" },
    limitacoesDosDados: [], firstSeenRecently: false, versaoMotor: "test", versaoParametros: "test",
    ...overrides,
  };
}

const STORES: Store[] = [{ id: 1, name: "Loja A" } as Store];

function baseInput(overrides: Partial<MixEngineInput> = {}): MixEngineInput {
  return {
    stores: STORES,
    products: PRODUCTS,
    salesByStoreMonth: salesFor(1, "SKU-1", [10, 10, 10, 10, 10, 10]),
    supplyByStoreMonth: [],
    reconciliationByStoreMonth: [],
    lossResult: lossResult(),
    today: TODAY,
    lossParameters: DEFAULT_LOSS_PARAMETERS,
    mixParameters: DEFAULT_MIX_PARAMETERS,
    costsBySkuAsOf: () => 200,
    ...overrides,
  };
}

describe("computeMixRecommendations", () => {
  it("passes through suspender_abastecimento from Loss Intelligence directly", () => {
    const result = computeMixRecommendations(baseInput({ lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "suspender_abastecimento" })]) }));
    expect(result[0].classificacao).toBe("suspender_abastecimento");
  });

  it("maps both avaliar_retirada_* and avaliar_permanencia_* to the single 'avaliar_retirada' classification", () => {
    const retirada = computeMixRecommendations(baseInput({ lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "avaliar_retirada_loja" })]) }));
    const permanencia = computeMixRecommendations(baseInput({ lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "avaliar_permanencia_rede" })]) }));
    expect(retirada[0].classificacao).toBe("avaliar_retirada");
    expect(permanencia[0].classificacao).toBe("avaliar_retirada");
  });

  it("maps reduzir_abastecimento to 'reduzir'", () => {
    const result = computeMixRecommendations(baseInput({ lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "reduzir_abastecimento" })]) }));
    expect(result[0].classificacao).toBe("reduzir");
  });

  it("classifies dados_insuficientes below the evidence gate, absent any loss signal", () => {
    const result = computeMixRecommendations(baseInput({ salesByStoreMonth: salesFor(1, "SKU-1", [0, 0, 0, 0, 0, 10]) }));
    expect(result[0].classificacao).toBe("dados_insuficientes");
  });

  it("classifies explorar for a growing, high-affinity, margin-healthy product with no loss signal", () => {
    // única loja da rede -> affinity = 1 (storeShare = networkShare sempre); ajustado no teste seguinte para >1
    const result = computeMixRecommendations(baseInput({ salesByStoreMonth: salesFor(1, "SKU-1", [10, 12, 14, 20, 24, 28]) }));
    expect(result[0].tendencia).toBe("crescendo");
    expect(result[0].classificacao).toBe("explorar");
  });

  it("classifies reduzir for a declining product with no loss signal", () => {
    const result = computeMixRecommendations(baseInput({ salesByStoreMonth: salesFor(1, "SKU-1", [10, 8, 6, 4, 3, 2]) }));
    expect(result[0].classificacao).toBe("reduzir");
  });

  it("skips a sku with no matching product", () => {
    expect(computeMixRecommendations(baseInput({ products: [] }))).toHaveLength(0);
  });
});

describe("computeMixOpportunities", () => {
  const MANY_STORES: Store[] = [1, 2, 3].map((id) => ({ id, name: `Loja ${id}` }) as Store);
  const TIGHT_PARAMETERS = { ...DEFAULT_MIX_PARAMETERS, opportunity: { ...DEFAULT_MIX_PARAMETERS.opportunity, minNetworkStores: 2 } };

  it("surfaces a sku absent from a store as an opportunity when enough other stores show good performance", () => {
    const sales = mergeSales(salesFor(2, "SKU-1", [10, 12, 14, 20, 24, 28]), salesFor(3, "SKU-1", [10, 12, 14, 20, 24, 28]));
    const result = computeMixOpportunities(baseInput({ stores: MANY_STORES, salesByStoreMonth: sales, mixParameters: TIGHT_PARAMETERS }));
    expect(result.some((o) => o.storeId === 1 && o.sku === "SKU-1")).toBe(true);
  });

  it("never surfaces a sku already present in that store", () => {
    const sales = mergeSales(salesFor(1, "SKU-1", [10, 12, 14, 20, 24, 28]), salesFor(2, "SKU-1", [10, 12, 14, 20, 24, 28]), salesFor(3, "SKU-1", [10, 12, 14, 20, 24, 28]));
    const result = computeMixOpportunities(baseInput({ stores: MANY_STORES, salesByStoreMonth: sales, mixParameters: TIGHT_PARAMETERS }));
    expect(result.some((o) => o.storeId === 1)).toBe(false);
  });

  it("never surfaces an opportunity below the minimum store count", () => {
    const sales = salesFor(2, "SKU-1", [10, 12, 14, 20, 24, 28]); // só 1 outra loja com bom desempenho, mínimo é 2
    const result = computeMixOpportunities(baseInput({ stores: MANY_STORES, salesByStoreMonth: sales, mixParameters: TIGHT_PARAMETERS }));
    expect(result).toHaveLength(0);
  });

  it("never returns confianca alta for an opportunity", () => {
    const sales = mergeSales(salesFor(2, "SKU-1", [10, 12, 14, 20, 24, 28]), salesFor(3, "SKU-1", [10, 12, 14, 20, 24, 28]));
    const result = computeMixOpportunities(baseInput({ stores: MANY_STORES, salesByStoreMonth: sales, mixParameters: TIGHT_PARAMETERS }));
    expect(result.every((o) => o.confianca !== "alta")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @agiliz/admin exec jest src/lib/commercial-intelligence/restock-mix/mix/engine.spec.ts`
Expected: FAIL — `Cannot find module './engine'`.

- [ ] **Step 3: Implement `computeMixRecommendations` and `computeMixOpportunities`**

```ts
// src/lib/commercial-intelligence/restock-mix/mix/engine.ts
import type { Confidence, LossIntelligenceParameters, LossIntelligenceResult } from "@/lib/loss-intelligence/types";
import { resolveAnalysisWindow } from "@/lib/loss-intelligence/temporal";
import type { Product } from "@/lib/api/products";
import type { Store } from "@/lib/api/stores";
import type { StoreMonthSales } from "@/lib/api/sales";
import type { StoreMonthSupply } from "@/lib/api/supply";
import type { PerStoreMonthlyTotal } from "@/lib/api/finance";
import { buildStoreSkuSeries } from "../series";
import { computeTrend } from "../trend";
import type { LossSignal, MixClassification, MixOpportunity, MixRecommendation, StoreSkuSeries, Trend } from "../types";
import { computeMixConfidence, computeOpportunityConfidence } from "./confidence";
import { MIX_LOGIC_VERSION } from "./logic-version";
import type { MixParameters } from "./parameters";

export interface MixEngineInput {
  stores: Store[];
  products: Product[];
  salesByStoreMonth: StoreMonthSales[];
  supplyByStoreMonth: StoreMonthSupply[];
  reconciliationByStoreMonth: PerStoreMonthlyTotal[];
  lossResult: LossIntelligenceResult;
  today: string;
  lossParameters: LossIntelligenceParameters;
  mixParameters: MixParameters;
  costsBySkuAsOf: (sku: string) => number | null;
}

const RETIRADA_ACTIONS = new Set(["avaliar_retirada_loja", "avaliar_retirada_rede", "avaliar_permanencia_loja", "avaliar_permanencia_rede"]);
const LOSS_ACTION_LABEL: Record<string, string> = {
  suspender_abastecimento: "suspender abastecimento", avaliar_retirada_loja: "avaliar retirada da loja", avaliar_retirada_rede: "avaliar retirada da rede",
  avaliar_permanencia_loja: "avaliar permanência na loja", avaliar_permanencia_rede: "avaliar permanência na rede", reduzir_abastecimento: "reduzir abastecimento",
};

function lossSignalFor(result: LossIntelligenceResult, storeId: number, sku: string): LossSignal | null {
  const rec = result.recommendations.find((r) => r.storeId === storeId && r.sku === sku);
  if (!rec) return null;
  const diagnosis = rec.motivoDiagnosticoPrioritario ? rec.diagnosticosPorMotivo.find((d) => d.reason === rec.motivoDiagnosticoPrioritario) : undefined;
  return { acao: rec.acaoPrioritaria, prioridade: rec.prioridade, confianca: rec.confianca, escopoProblema: diagnosis?.escopoProblema ?? "indeterminado", limitacoesDosDados: rec.limitacoesDosDados };
}

function buildSeries(input: MixEngineInput): StoreSkuSeries[] {
  const window = resolveAnalysisWindow({ storeId: 0, sku: "", today: input.today, allKnownRestockPeriods: [], parameters: input.lossParameters });
  return buildStoreSkuSeries(input.stores, input.salesByStoreMonth, input.supplyByStoreMonth, input.reconciliationByStoreMonth, window.recurrenceLookbackPeriods);
}

/** Participação do SKU na loja ÷ participação na rede, sobre a mesma série mensal confiável usada em todo o motor (nunca SalesTransaction — ver nota do Task 10). */
function computeNetworkAffinity(seriesList: StoreSkuSeries[], storeId: number, sku: string): number {
  let storeRevenue = 0, storeTotalRevenue = 0, networkRevenue = 0, networkTotalRevenue = 0;
  for (const s of seriesList) {
    const revenue = s.meses.reduce((sum, m) => sum + m.receitaCents, 0);
    networkTotalRevenue += revenue;
    if (s.sku === sku) networkRevenue += revenue;
    if (s.storeId === storeId) {
      storeTotalRevenue += revenue;
      if (s.sku === sku) storeRevenue += revenue;
    }
  }
  const storeShare = storeTotalRevenue > 0 ? storeRevenue / storeTotalRevenue : 0;
  const networkShare = networkTotalRevenue > 0 ? networkRevenue / networkTotalRevenue : 0;
  return networkShare > 0 ? storeShare / networkShare : storeShare > 0 ? Infinity : 0;
}

function computeMarginPct(series: StoreSkuSeries, costsBySkuAsOf: (sku: string) => number | null): number | null {
  const cost = costsBySkuAsOf(series.sku);
  if (cost === null) return null;
  const totalRevenue = series.meses.reduce((sum, m) => sum + m.receitaCents, 0);
  const totalSold = series.meses.reduce((sum, m) => sum + m.vendido, 0);
  if (totalRevenue === 0) return null;
  return (totalRevenue - cost * totalSold) / totalRevenue;
}

function pushRecommendation(
  list: MixRecommendation[],
  series: StoreSkuSeries,
  product: Product,
  fields: { classificacao: MixClassification; evidencia: string; confianca: Confidence; sinalPerdas: LossSignal | null; limitacoes: string[]; tendencia: Trend; affinity: number | null; margemPct: number | null },
) {
  list.push({
    sku: series.sku, storeId: series.storeId, categoria: product.category, classificacao: fields.classificacao, evidencia: fields.evidencia,
    tendencia: fields.tendencia, affinity: fields.affinity, margemPct: fields.margemPct, sinalPerdas: fields.sinalPerdas, confianca: fields.confianca,
    limitacoes: fields.limitacoes, versaoMotor: MIX_LOGIC_VERSION, versaoParametros: "provisional",
  });
}

export function computeMixRecommendations(input: MixEngineInput): MixRecommendation[] {
  const productBySku = new Map(input.products.map((p) => [p.sku, p]));
  const seriesList = buildSeries(input);
  const recommendations: MixRecommendation[] = [];

  for (const series of seriesList) {
    const product = productBySku.get(series.sku);
    if (!product) continue;

    const sinalPerdas = lossSignalFor(input.lossResult, series.storeId, series.sku);
    const limitacoes = [...(sinalPerdas?.limitacoesDosDados ?? [])];

    if (sinalPerdas?.acao === "suspender_abastecimento") {
      pushRecommendation(recommendations, series, product, { classificacao: "suspender_abastecimento", evidencia: `Recomendação ativa da Inteligência de Perdas: ${LOSS_ACTION_LABEL.suspender_abastecimento}.`, confianca: sinalPerdas.confianca, sinalPerdas, limitacoes, tendencia: "indeterminada", affinity: null, margemPct: null });
      continue;
    }
    if (sinalPerdas && RETIRADA_ACTIONS.has(sinalPerdas.acao)) {
      pushRecommendation(recommendations, series, product, { classificacao: "avaliar_retirada", evidencia: `Recomendação ativa da Inteligência de Perdas: ${LOSS_ACTION_LABEL[sinalPerdas.acao]}.`, confianca: sinalPerdas.confianca, sinalPerdas, limitacoes, tendencia: "indeterminada", affinity: null, margemPct: null });
      continue;
    }
    if (sinalPerdas?.acao === "reduzir_abastecimento") {
      pushRecommendation(recommendations, series, product, { classificacao: "reduzir", evidencia: `Recomendação ativa da Inteligência de Perdas: ${LOSS_ACTION_LABEL.reduzir_abastecimento}.`, confianca: sinalPerdas.confianca, sinalPerdas, limitacoes, tendencia: "indeterminada", affinity: null, margemPct: null });
      continue;
    }

    const qtySeries = series.meses.map((m) => m.vendido);
    const mesesComVenda = qtySeries.filter((q) => q > 0).length;

    if (mesesComVenda < input.mixParameters.evidence.minMonthsWithSales) {
      pushRecommendation(recommendations, series, product, { classificacao: "dados_insuficientes", evidencia: `Evidência insuficiente: apenas ${mesesComVenda} ${mesesComVenda === 1 ? "mês" : "meses"} com venda.`, confianca: "insuficiente", sinalPerdas, limitacoes, tendencia: "indeterminada", affinity: null, margemPct: null });
      continue;
    }

    const trend = computeTrend(qtySeries, input.mixParameters.trend);
    const affinity = computeNetworkAffinity(seriesList, series.storeId, series.sku);
    const margemPct = computeMarginPct(series, input.costsBySkuAsOf);
    const marginHealthy = margemPct !== null && margemPct >= input.mixParameters.classification.marginHealthyMinPct;
    const reconciliacaoLimpa = !sinalPerdas || sinalPerdas.limitacoesDosDados.length === 0;

    let classificacao: MixClassification;
    let evidencia: string;
    if (trend.tendencia === "crescendo" && affinity >= input.mixParameters.classification.affinityExploreMin && marginHealthy) {
      classificacao = "explorar";
      evidencia = "Tendência de crescimento, participação acima da esperada pela rede, margem saudável.";
    } else if (trend.tendencia === "caindo" || affinity < input.mixParameters.classification.affinityHealthyMin) {
      classificacao = "reduzir";
      evidencia = trend.tendencia === "caindo" ? "Tendência de queda nas vendas." : "Participação abaixo do esperado pela rede.";
    } else {
      classificacao = "manter";
      evidencia = "Sem sinal de crescimento nem de queda — presença estável.";
    }

    let confianca = computeMixConfidence({ mesesComVenda, mesesAnalisados: series.meses.length, tendencia: trend.tendencia, reconciliacaoLimpa }, input.mixParameters);
    if (sinalPerdas?.acao === "investigar") {
      limitacoes.push("Este produto está sob investigação da Inteligência de Perdas.");
      if (confianca === "alta") confianca = "media";
    }

    pushRecommendation(recommendations, series, product, { classificacao, evidencia, confianca, sinalPerdas, limitacoes, tendencia: trend.tendencia, affinity, margemPct });
  }

  return recommendations;
}

export function computeMixOpportunities(input: MixEngineInput): MixOpportunity[] {
  const productBySku = new Map(input.products.map((p) => [p.sku, p]));
  const seriesList = buildSeries(input);

  const presentByStore = new Map<number, Set<string>>();
  const allSkus = new Set<string>();
  for (const s of seriesList) {
    allSkus.add(s.sku);
    if (!presentByStore.has(s.storeId)) presentByStore.set(s.storeId, new Set());
    presentByStore.get(s.storeId)!.add(s.sku);
  }

  const opportunities: MixOpportunity[] = [];
  for (const store of input.stores) {
    const present = presentByStore.get(store.id) ?? new Set<string>();
    for (const sku of allSkus) {
      if (present.has(sku) || !productBySku.has(sku)) continue;

      let storesComBomDesempenho = 0;
      for (const s of seriesList) {
        if (s.sku !== sku || s.storeId === store.id) continue;
        const qtySeries = s.meses.map((m) => m.vendido);
        if (qtySeries.filter((q) => q > 0).length < input.mixParameters.evidence.minMonthsWithSales) continue;
        const trend = computeTrend(qtySeries, input.mixParameters.trend);
        const margemPct = computeMarginPct(s, input.costsBySkuAsOf);
        const marginHealthy = margemPct !== null && margemPct >= input.mixParameters.classification.marginHealthyMinPct;
        if (trend.tendencia !== "caindo" && marginHealthy) storesComBomDesempenho++;
      }

      if (storesComBomDesempenho >= input.mixParameters.opportunity.minNetworkStores) {
        opportunities.push({
          sku, storeId: store.id, origem: "rede_inteira", evidencia: `Bom desempenho em ${storesComBomDesempenho} lojas da rede.`,
          quantidadeTeste: input.mixParameters.opportunity.testQuantity, confianca: computeOpportunityConfidence(storesComBomDesempenho, input.mixParameters),
          versaoMotor: MIX_LOGIC_VERSION, versaoParametros: "provisional",
        });
      }
    }
  }

  return opportunities;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @agiliz/admin exec jest src/lib/commercial-intelligence/restock-mix/mix/engine.spec.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/commercial-intelligence/restock-mix/mix/engine.ts src/lib/commercial-intelligence/restock-mix/mix/engine.spec.ts
git commit -m "feat(admin): add mix classification and opportunity engines"
```

---

## Task 11: UI de Mix — resumo, tabela e oportunidades de novo mix

**Files:**
- Create: `src/components/commercial-intelligence/mix/mix-table.tsx`
- Test: `src/components/commercial-intelligence/mix/mix-table.spec.tsx`

**Interfaces:**
- Consumes: `MixRecommendation`, `MixOpportunity`, `MixClassification` (Task 1, `@/lib/commercial-intelligence/restock-mix/types`).
- Produces: `MixDisplayRow` (union, local — mesmo padrão de `RestockDisplayRow`, Task 6), `MixTable` — usado por Task 13.

Um único arquivo para resumo + lista + oportunidades (ao contrário de Abastecimento, que separou
painel e tabela em dois arquivos): Mix não tem estado de edição nem "Gerar lista" — o resumo aqui é
puramente derivado das mesmas linhas da tabela, sem justificar um segundo componente (File
Structure, "prefira arquivos focados, mas não fragmente demais").

```ts
export type MixDisplayRow = { productLabel: string; storeName: string; data: MixRecommendation };
export type MixOpportunityRow = { productLabel: string; storeName: string; data: MixOpportunity };
```

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/commercial-intelligence/mix/mix-table.spec.tsx
import { describe, it, expect, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { MixTable } from "./mix-table";
import type { MixDisplayRow, MixOpportunityRow } from "./mix-table";
import type { MixRecommendation, MixOpportunity } from "@/lib/commercial-intelligence/restock-mix/types";

function rec(overrides: Partial<MixRecommendation> = {}): MixRecommendation {
  return {
    sku: "SKU-1", storeId: 1, categoria: "beverage", classificacao: "manter", evidencia: "Presença estável.",
    tendencia: "estavel", affinity: 1, margemPct: 0.2, sinalPerdas: null, confianca: "alta", limitacoes: [],
    versaoMotor: "test", versaoParametros: "test", ...overrides,
  };
}

function row(label: string, overrides: Partial<MixRecommendation> = {}): MixDisplayRow {
  return { productLabel: label, storeName: "Ascenty - ADM", data: rec(overrides) };
}

const ROWS: MixDisplayRow[] = [
  row("Coca-Cola Zero", { sku: "SKU-1", classificacao: "explorar", tendencia: "crescendo" }),
  row("Mentos", { sku: "SKU-2", classificacao: "manter", tendencia: "estavel" }),
  row("Ana Maria", { sku: "SKU-3", classificacao: "reduzir", tendencia: "caindo" }),
  row("Paçoquita", { sku: "SKU-4", classificacao: "avaliar_retirada", tendencia: "indeterminada" }),
];

const OPPORTUNITIES: MixOpportunityRow[] = [
  {
    productLabel: "Monster sabor X", storeName: "Ascenty - ADM",
    data: { sku: "SKU-9", storeId: 1, origem: "rede_inteira", evidencia: "Bom desempenho em 7 lojas da rede.", quantidadeTeste: 4, confianca: "media", versaoMotor: "test", versaoParametros: "test" } as MixOpportunity,
  },
];

describe("MixTable", () => {
  it("shows the resumo with one non-overlapping count per classificacao", () => {
    render(<MixTable rows={ROWS} opportunities={OPPORTUNITIES} onSelect={jest.fn()} onSelectOpportunity={jest.fn()} />);
    expect(screen.getByText("1")).toBeInTheDocument(); // qualquer um dos 4 contadores de 1 — checagem detalhada abaixo
    expect(screen.getByText("manter")).toBeInTheDocument();
    expect(screen.getByText("explorar")).toBeInTheDocument();
    expect(screen.getByText("reduzir")).toBeInTheDocument();
    expect(screen.getByText("avaliar retirada")).toBeInTheDocument();
    expect(screen.getByText("oportunidades de teste")).toBeInTheDocument();
  });

  it("renders Situação (tendência) and Recomendação (classificação) as two separate columns", () => {
    render(<MixTable rows={ROWS} opportunities={[]} onSelect={jest.fn()} onSelectOpportunity={jest.fn()} />);
    const rowEl = screen.getByText("Coca-Cola Zero").closest("tr");
    expect(rowEl).not.toBeNull();
    expect(rowEl!.textContent).toContain("Crescendo");
    expect(rowEl!.textContent).toContain("Explorar");
  });

  it("calls onSelect with the exact row when a main-table row is clicked", () => {
    const onSelect = jest.fn();
    render(<MixTable rows={ROWS} opportunities={[]} onSelect={onSelect} onSelectOpportunity={jest.fn()} />);
    screen.getByText("Mentos").click();
    expect(onSelect).toHaveBeenCalledWith(ROWS[1]);
  });

  it("renders opportunities in their own section, separate from the main table", () => {
    render(<MixTable rows={ROWS} opportunities={OPPORTUNITIES} onSelect={jest.fn()} onSelectOpportunity={jest.fn()} />);
    expect(screen.getByText("Oportunidades de novo mix")).toBeInTheDocument();
    expect(screen.getByText("Monster sabor X")).toBeInTheDocument();
    expect(screen.getByText("Bom desempenho em 7 lojas da rede.")).toBeInTheDocument();
  });

  it("calls onSelectOpportunity with the exact opportunity when clicked", () => {
    const onSelectOpportunity = jest.fn();
    render(<MixTable rows={[]} opportunities={OPPORTUNITIES} onSelect={jest.fn()} onSelectOpportunity={onSelectOpportunity} />);
    screen.getByText("Monster sabor X").click();
    expect(onSelectOpportunity).toHaveBeenCalledWith(OPPORTUNITIES[0]);
  });

  it('never shows "Oportunidades de novo mix" when there are none', () => {
    render(<MixTable rows={ROWS} opportunities={[]} onSelect={jest.fn()} onSelectOpportunity={jest.fn()} />);
    expect(screen.queryByText("Oportunidades de novo mix")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @agiliz/admin exec jest src/components/commercial-intelligence/mix/mix-table.spec.tsx`
Expected: FAIL — `Cannot find module './mix-table'`.

- [ ] **Step 3: Implement `MixTable`**

```tsx
// src/components/commercial-intelligence/mix/mix-table.tsx
"use client";

import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MixClassification, MixOpportunity, MixRecommendation, ProductCategory, Trend } from "@/lib/commercial-intelligence/restock-mix/types";

export type MixDisplayRow = { productLabel: string; storeName: string; data: MixRecommendation };
export type MixOpportunityRow = { productLabel: string; storeName: string; data: MixOpportunity };

const CLASSIFICATION_LABELS: Record<MixClassification, string> = {
  manter: "manter",
  explorar: "explorar",
  reduzir: "reduzir",
  suspender_abastecimento: "suspender abastecimento",
  avaliar_retirada: "avaliar retirada",
  dados_insuficientes: "dados insuficientes",
};

const CLASSIFICATION_TONE: Record<MixClassification, "neutral" | "positive" | "attention" | "critical"> = {
  manter: "positive",
  explorar: "positive",
  reduzir: "attention",
  suspender_abastecimento: "critical",
  avaliar_retirada: "critical",
  dados_insuficientes: "neutral",
};

const CATEGORY_LABELS: Record<ProductCategory, string> = { meal: "Refeição", snack: "Snack", beverage: "Bebida", essential: "Essencial" };
const TREND_LABEL: Record<Trend, string> = { crescendo: "Crescendo", estavel: "Estável", caindo: "Caindo", volatil: "Volátil", indeterminada: "Indeterminada" };

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="tabular text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function MixTable({
  rows,
  opportunities,
  onSelect,
  onSelectOpportunity,
}: {
  rows: MixDisplayRow[];
  opportunities: MixOpportunityRow[];
  onSelect: (row: MixDisplayRow) => void;
  onSelectOpportunity: (row: MixOpportunityRow) => void;
}) {
  const manter = rows.filter((r) => r.data.classificacao === "manter").length;
  const explorar = rows.filter((r) => r.data.classificacao === "explorar").length;
  const reduzir = rows.filter((r) => r.data.classificacao === "reduzir").length;
  const avaliarRetirada = rows.filter((r) => r.data.classificacao === "avaliar_retirada" || r.data.classificacao === "suspender_abastecimento").length;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat value={manter} label="manter" />
          <Stat value={explorar} label="explorar" />
          <Stat value={reduzir} label="reduzir" />
          <Stat value={avaliarRetirada} label="avaliar retirada" />
          <Stat value={opportunities.length} label="oportunidades de teste" />
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produto</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>Evidência</TableHead>
            <TableHead>Recomendação</TableHead>
            <TableHead>Confiança</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.data.storeId}:${row.data.sku}`} className="cursor-pointer" onClick={() => onSelect(row)}>
              <TableCell className="font-medium">{row.productLabel}</TableCell>
              <TableCell>{CATEGORY_LABELS[row.data.categoria]}</TableCell>
              <TableCell>{TREND_LABEL[row.data.tendencia]}</TableCell>
              <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{row.data.evidencia}</TableCell>
              <TableCell>
                <StatusBadge tone={CLASSIFICATION_TONE[row.data.classificacao]}>{CLASSIFICATION_LABELS[row.data.classificacao]}</StatusBadge>
              </TableCell>
              <TableCell className="capitalize">{row.data.confianca}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {opportunities.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">Oportunidades de novo mix</h3>
          <div className="flex flex-col gap-2">
            {opportunities.map((row) => (
              <button
                key={`${row.data.storeId}:${row.data.sku}`}
                type="button"
                onClick={() => onSelectOpportunity(row)}
                className="rounded-lg border p-3 text-left text-sm hover:bg-muted"
              >
                <p className="font-medium">{row.productLabel}</p>
                <p className="text-muted-foreground">Não vendido atualmente em {row.storeName}.</p>
                <p className="text-muted-foreground">{row.data.evidencia}</p>
                <p className="mt-1">
                  Teste recomendado: {row.data.quantidadeTeste} unidades — Confiança: <span className="capitalize">{row.data.confianca}</span>
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @agiliz/admin exec jest src/components/commercial-intelligence/mix/mix-table.spec.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/commercial-intelligence/mix/mix-table.tsx src/components/commercial-intelligence/mix/mix-table.spec.tsx
git commit -m "feat(admin): add mix summary, main table and new-mix opportunities section"
```

---

## Task 12: UI de Mix — drill-down (drawer)

**Files:**
- Create: `src/components/commercial-intelligence/mix/mix-drawer.tsx`
- Test: `src/components/commercial-intelligence/mix/mix-drawer.spec.tsx`

**Interfaces:**
- Consumes: `MixDisplayRow`, `MixOpportunityRow` (Task 11, `./mix-table`).
- Produces: `MixDrawer` — usado por Task 13.

Mesmo padrão dual-body de `restock-drawer.tsx` (Task 7): a prop aceita `MixDisplayRow |
MixOpportunityRow | null`, distinguidos por um campo `variant` que o caller (Task 13) já resolve.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/commercial-intelligence/mix/mix-drawer.spec.tsx
import { describe, it, expect, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { MixDrawer } from "./mix-drawer";
import type { MixDisplayRow, MixOpportunityRow } from "./mix-table";
import type { MixRecommendation, MixOpportunity } from "@/lib/commercial-intelligence/restock-mix/types";

const RECOMMENDATION_ROW: MixDisplayRow = {
  productLabel: "Coca-Cola Zero",
  storeName: "Ascenty - ADM",
  data: {
    sku: "SKU-1", storeId: 1, categoria: "beverage", classificacao: "explorar", evidencia: "Tendência de crescimento, participação acima da esperada pela rede, margem saudável.",
    tendencia: "crescendo", affinity: 1.4, margemPct: 0.22, sinalPerdas: null, confianca: "alta", limitacoes: [],
    versaoMotor: "test", versaoParametros: "test",
  } satisfies MixRecommendation,
};

const OPPORTUNITY_ROW: MixOpportunityRow = {
  productLabel: "Monster sabor X",
  storeName: "Ascenty - ADM",
  data: {
    sku: "SKU-9", storeId: 1, origem: "rede_inteira", evidencia: "Bom desempenho em 7 lojas da rede.",
    quantidadeTeste: 4, confianca: "media", versaoMotor: "test", versaoParametros: "test",
  } satisfies MixOpportunity,
};

const DEFAULT_PROPS = { open: true, onOpenChange: jest.fn() };

describe("MixDrawer", () => {
  it("renders nothing when row is null", () => {
    const { container } = render(<MixDrawer row={null} {...DEFAULT_PROPS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every section for a MixDisplayRow with the fixture's exact numbers", () => {
    render(<MixDrawer row={{ variant: "recomendacao", ...RECOMMENDATION_ROW }} {...DEFAULT_PROPS} />);

    expect(screen.getByText("Coca-Cola Zero — Ascenty - ADM")).toBeInTheDocument();
    expect(screen.getByText(/Tendência de crescimento/)).toBeInTheDocument();
    expect(screen.getByText("Crescendo")).toBeInTheDocument();
    expect(screen.getByText("1.4x a participação esperada pela rede")).toBeInTheDocument();
    expect(screen.getByText("22% de margem sobre a receita")).toBeInTheDocument();
    expect(screen.getByText("Nenhum sinal ativo da Inteligência de Perdas.")).toBeInTheDocument();
  });

  it("renders a simpler drawer for a MixOpportunityRow — no situação/indicadores, evidência e quantidade de teste", () => {
    render(<MixDrawer row={{ variant: "oportunidade", ...OPPORTUNITY_ROW }} {...DEFAULT_PROPS} />);

    expect(screen.getByText("Monster sabor X — Ascenty - ADM")).toBeInTheDocument();
    expect(screen.getByText("Bom desempenho em 7 lojas da rede.")).toBeInTheDocument();
    expect(screen.getByText("Quantidade de teste: 4 unidades")).toBeInTheDocument();
    expect(screen.queryByText("Situação")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @agiliz/admin exec jest src/components/commercial-intelligence/mix/mix-drawer.spec.tsx`
Expected: FAIL — `Cannot find module './mix-drawer'`.

- [ ] **Step 3: Implement `MixDrawer`**

```tsx
// src/components/commercial-intelligence/mix/mix-drawer.tsx
"use client";

import { ConfidenceBadge } from "@/components/commercial-intelligence/confidence-badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Level } from "@/lib/commercial-intelligence/types";
import type { Confidence } from "@/lib/loss-intelligence/types";
import type { MixDisplayRow, MixOpportunityRow } from "./mix-table";

const CONFIDENCE_TO_LEVEL: Record<Confidence, Level> = { alta: "high", media: "medium", baixa: "low", insuficiente: "insufficient" };
const TREND_LABEL: Record<string, string> = { crescendo: "Crescendo", estavel: "Estável", caindo: "Caindo", volatil: "Volátil", indeterminada: "Indeterminada" };
const ESCOPO_LABEL: Record<string, string> = { local: "Local", multiplas_lojas: "Múltiplas lojas", rede: "Rede", indeterminado: "Indeterminado" };
const LOSS_ACTION_LABEL: Record<string, string> = {
  manter: "Manter", manter_monitorar: "Manter e monitorar", reduzir_abastecimento: "Reduzir abastecimento", investigar: "Investigar",
  suspender_abastecimento: "Suspender abastecimento", avaliar_retirada_loja: "Avaliar retirada (loja)", avaliar_retirada_rede: "Avaliar retirada (rede)",
  avaliar_permanencia_loja: "Avaliar permanência (loja)", avaliar_permanencia_rede: "Avaliar permanência (rede)", dados_insuficientes: "Dados insuficientes",
};

export type MixDrawerRow = ({ variant: "recomendacao" } & MixDisplayRow) | ({ variant: "oportunidade" } & MixOpportunityRow);

export function MixDrawer({ row, open, onOpenChange }: { row: MixDrawerRow | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!row) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {row.productLabel} — {row.storeName}
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-6">{row.variant === "recomendacao" ? <RecommendationBody data={row.data} /> : <OpportunityBody data={row.data} />}</div>
      </SheetContent>
    </Sheet>
  );
}

function RecommendationBody({ data }: { data: MixDisplayRow["data"] }) {
  return (
    <>
      <section>
        <h3 className="mb-1 text-sm font-medium">Evidência</h3>
        <p className="text-sm">{data.evidencia}</p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Situação</h3>
        <p className="text-sm">{TREND_LABEL[data.tendencia]}</p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Indicadores</h3>
        <dl className="grid grid-cols-2 gap-1 text-sm">
          <dt className="text-muted-foreground">Afinidade com a rede</dt>
          <dd className="tabular">{data.affinity !== null ? `${data.affinity.toFixed(1)}x a participação esperada pela rede` : "desconhecida"}</dd>
          <dt className="text-muted-foreground">Margem</dt>
          <dd className="tabular">{data.margemPct !== null ? `${Math.round(data.margemPct * 100)}% de margem sobre a receita` : "desconhecida"}</dd>
        </dl>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Inteligência de Perdas</h3>
        {data.sinalPerdas ? (
          <p className="text-sm">
            {LOSS_ACTION_LABEL[data.sinalPerdas.acao]} — escopo: {ESCOPO_LABEL[data.sinalPerdas.escopoProblema]}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum sinal ativo da Inteligência de Perdas.</p>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Confiança</h3>
        <ConfidenceBadge level={CONFIDENCE_TO_LEVEL[data.confianca]} />
      </section>

      {data.limitacoes.length > 0 && (
        <section className="rounded-lg border border-warning/30 bg-warning/12 p-3 text-sm text-warning">
          <p className="font-medium">Limitações</p>
          <ul className="list-disc pl-4 text-xs">
            {data.limitacoes.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function OpportunityBody({ data }: { data: MixOpportunityRow["data"] }) {
  return (
    <>
      <section>
        <h3 className="mb-1 text-sm font-medium">Por que?</h3>
        <p className="text-sm">{data.evidencia}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          SKU ausente nesta loja — candidato baseado em bom desempenho na rede, não em histórico direto do par loja×produto.
        </p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Quantidade</h3>
        <p className="text-sm">Quantidade de teste: {data.quantidadeTeste} unidades</p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Confiança</h3>
        <ConfidenceBadge level={CONFIDENCE_TO_LEVEL[data.confianca]} />
      </section>
    </>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @agiliz/admin exec jest src/components/commercial-intelligence/mix/mix-drawer.spec.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/commercial-intelligence/mix/mix-drawer.tsx src/components/commercial-intelligence/mix/mix-drawer.spec.tsx
git commit -m "feat(admin): add mix drill-down drawer for recommendation and opportunity rows"
```

---

**Checkpoint: Mix das Lojas está completo e testável de ponta a ponta neste commit.** Os Tasks 13-15
fazem a fiação final — a tela de `/commercial-intelligence` em si, a página de calibração, e a
verificação de ponta a ponta.

---

## Task 13: Reescrever `page.tsx` — 2 abas, dado real de ponta a ponta

**Files:**
- Modify: `src/app/(app)/commercial-intelligence/page.tsx` (reescrita completa)

**Interfaces:**
- Consumes: tudo dos Tasks 1-12 — `computeRestockRecommendations` (Task 5), `RUNTIME_RESTOCK_PARAMETERS` (Task 3), `computeMixRecommendations`/`computeMixOpportunities` (Task 10), `RUNTIME_MIX_PARAMETERS` (Task 8), `RestockPanel`/`RestockTable`/`RestockDrawer` (Tasks 6-7), `MixTable`/`MixDrawer` (Tasks 11-12); `analyzeLossIntelligence`, `RUNTIME_PARAMETERS` (`@/lib/loss-intelligence/engine`, `@/lib/loss-intelligence/parameters`) — mesmo padrão de orquestração já usado em `src/components/supply/loss-tab.tsx` (lido como referência).
- Produces: a página em si — fim da cadeia de consumo deste plano.

**Sem teste Jest para este task** — mesma convenção já estabelecida no app para arquivos de
orquestração de página (`loss-tab.tsx` também não tem `.spec.tsx` próprio; o `CLAUDE.md` do app
documenta explicitamente "Sem suíte de testes automatizados" para o nível de página, verificado ao
vivo). A verificação deste task acontece no Task 15 (tsc/lint/build + navegador real).

**Decisão de fetch**: a tela sempre busca a rede inteira (mesmo padrão de `/sales`'s `page.tsx` —
"trocar de loja no seletor nunca dispara uma nova requisição", `CLAUDE.md` do app) — a loja
selecionada é só um filtro client-side sobre o resultado já calculado dos dois motores, nunca uma
nova busca. Isso é necessário mesmo tecnicamente: `computeMixOpportunities` precisa dos dados de
TODAS as lojas para saber quais SKUs têm bom desempenho na rede antes de sugerir uma oportunidade
pra loja selecionada.

- [ ] **Step 1: Read `src/components/supply/loss-tab.tsx` (linhas do fetch em diante) para confirmar os nomes exatos dos hooks e do formato de range antes de escrever este arquivo — não adivinhar**

Este é um passo de leitura, não de código — confirme contra o arquivo real do repositório (pode ter
mudado desde a escrita deste plano) os nomes exatos de: `useGetNetworkSalesByStoreMonthQuery`,
`useGetNetworkSupplyByStoreMonthQuery`, `useGetNetworkReconciliationRangeQuery`,
`useGetCostsAsOfQuery`, `lastCompleteMonth`, `addMonths`, `type PeriodRange` — e a forma exata do
objeto que `analyzeLossIntelligence` espera (`LossIntelligenceInput`).

- [ ] **Step 2: Write `page.tsx`**

```tsx
// src/app/(app)/commercial-intelligence/page.tsx
"use client";

import { useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MixDrawer, type MixDrawerRow } from "@/components/commercial-intelligence/mix/mix-drawer";
import { MixTable, type MixDisplayRow, type MixOpportunityRow } from "@/components/commercial-intelligence/mix/mix-table";
import { RestockDrawer } from "@/components/commercial-intelligence/restock/restock-drawer";
import { RestockPanel } from "@/components/commercial-intelligence/restock/restock-panel";
import { RestockTable, type RestockDisplayRow } from "@/components/commercial-intelligence/restock/restock-table";
import { useGetCostsAsOfQuery, useGetProductsQuery } from "@/lib/api/products";
import { useGetNetworkReconciliationRangeQuery } from "@/lib/api/finance";
import { useGetNetworkSalesByStoreMonthQuery } from "@/lib/api/sales";
import { useGetNetworkSupplyByStoreMonthQuery } from "@/lib/api/supply";
import { useGetStoresQuery } from "@/lib/api/stores";
import { computeMixOpportunities, computeMixRecommendations, type MixEngineInput } from "@/lib/commercial-intelligence/restock-mix/mix/engine";
import { RUNTIME_MIX_PARAMETERS } from "@/lib/commercial-intelligence/restock-mix/mix/parameters";
import { computeRestockRecommendations, type RestockEngineInput } from "@/lib/commercial-intelligence/restock-mix/restock/engine";
import { RUNTIME_RESTOCK_PARAMETERS } from "@/lib/commercial-intelligence/restock-mix/restock/parameters";
import { analyzeLossIntelligence } from "@/lib/loss-intelligence/engine";
import { RUNTIME_PARAMETERS } from "@/lib/loss-intelligence/parameters";
import type { LossIntelligenceInput } from "@/lib/loss-intelligence/types";
import { addMonths, lastCompleteMonth, type PeriodRange } from "@/lib/period-range";

export default function CommercialIntelligencePage() {
  const { data: stores } = useGetStoresQuery();
  const { data: products } = useGetProductsQuery();
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);

  const scopedStores = stores ?? [];
  const skip = scopedStores.length === 0;

  // Mesma janela do Loss Intelligence (Global Constraint) — nunca uma janela própria.
  const engineAsOfPeriod = lastCompleteMonth();
  const lookbackMonths = RUNTIME_PARAMETERS.parameters.window.recurrenceLookbackMonths;
  const engineRange = useMemo<PeriodRange>(() => ({ start: addMonths(engineAsOfPeriod, -(lookbackMonths - 1)), end: engineAsOfPeriod }), [engineAsOfPeriod, lookbackMonths]);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const {
    data: reconciliationRange,
    isLoading: loadingReconciliation,
    error,
    refetch,
  } = useGetNetworkReconciliationRangeQuery({ stores: scopedStores, range: engineRange }, { skip });
  const { data: salesByStoreMonth, isLoading: loadingSales } = useGetNetworkSalesByStoreMonthQuery({ stores: scopedStores, range: engineRange }, { skip });
  const { data: supplyByStoreMonth, isLoading: loadingSupply } = useGetNetworkSupplyByStoreMonthQuery({ stores: scopedStores, range: engineRange }, { skip });

  const allSkusForCost = useMemo(() => [...new Set((salesByStoreMonth ?? []).flatMap((month) => month.bySku.map((row) => row.sku)))], [salesByStoreMonth]);
  const { data: costsResult } = useGetCostsAsOfQuery({ skus: allSkusForCost, asOf: `${engineAsOfPeriod}-01` }, { skip: allSkusForCost.length === 0 });
  const costsBySkuAsOf = useMemo(() => {
    if (!costsResult) return null;
    const bySku = new Map(costsResult.resolved.map((r) => [r.sku, r.cost_cents]));
    return (sku: string) => bySku.get(sku) ?? null;
  }, [costsResult]);

  const reconciliationByStoreMonth = reconciliationRange?.perStoreMonthly;

  const lossIntelligenceInput = useMemo<LossIntelligenceInput | null>(() => {
    if (!reconciliationByStoreMonth || !salesByStoreMonth || !supplyByStoreMonth || !costsBySkuAsOf || scopedStores.length === 0) return null;
    return {
      reconciliations: reconciliationByStoreMonth.map((row) => ({
        store_id: row.storeId,
        period: row.period,
        loss_by_reason_sku: row.totals.loss_by_reason_sku.map((entry) => ({ reason: entry.reason, sku: entry.sku, quantity: entry.quantity, value_cents: entry.value_cents })),
      })),
      salesByStorePeriodSku: salesByStoreMonth.flatMap((month) => month.bySku.map((row) => ({ store_id: month.storeId, period: month.period, sku: row.sku, quantity_sold: row.quantity_sold, revenue_cents: row.revenue_cents }))),
      supplyByStorePeriodSku: supplyByStoreMonth.flatMap((month) => month.restocks.map((row) => ({ store_id: month.storeId, period: month.period, sku: row.sku, quantity_restocked: row.quantity_restocked }))),
      costsBySkuAsOf,
      stores: scopedStores.map((s) => ({ id: s.id, name: s.name })),
      today,
      parameters: RUNTIME_PARAMETERS.parameters,
    };
  }, [reconciliationByStoreMonth, salesByStoreMonth, supplyByStoreMonth, costsBySkuAsOf, scopedStores, today]);

  const lossResult = useMemo(() => (lossIntelligenceInput ? analyzeLossIntelligence(lossIntelligenceInput) : null), [lossIntelligenceInput]);

  const restockRecommendations = useMemo(() => {
    if (!lossResult || !products || !salesByStoreMonth || !supplyByStoreMonth || !reconciliationByStoreMonth) return [];
    const input: RestockEngineInput = {
      stores: scopedStores, products, salesByStoreMonth, supplyByStoreMonth, reconciliationByStoreMonth, lossResult, today,
      lossParameters: RUNTIME_PARAMETERS.parameters, restockParameters: RUNTIME_RESTOCK_PARAMETERS.parameters,
    };
    return computeRestockRecommendations(input);
  }, [lossResult, products, salesByStoreMonth, supplyByStoreMonth, reconciliationByStoreMonth, scopedStores, today]);

  const mixEngineInput = useMemo<MixEngineInput | null>(() => {
    if (!lossResult || !products || !salesByStoreMonth || !supplyByStoreMonth || !reconciliationByStoreMonth || !costsBySkuAsOf) return null;
    return {
      stores: scopedStores, products, salesByStoreMonth, supplyByStoreMonth, reconciliationByStoreMonth, lossResult, today,
      lossParameters: RUNTIME_PARAMETERS.parameters, mixParameters: RUNTIME_MIX_PARAMETERS.parameters, costsBySkuAsOf,
    };
  }, [lossResult, products, salesByStoreMonth, supplyByStoreMonth, reconciliationByStoreMonth, costsBySkuAsOf, scopedStores, today]);

  const mixRecommendations = useMemo(() => (mixEngineInput ? computeMixRecommendations(mixEngineInput) : []), [mixEngineInput]);
  const mixOpportunities = useMemo(() => (mixEngineInput ? computeMixOpportunities(mixEngineInput) : []), [mixEngineInput]);

  const nameBySku = useMemo(() => new Map((products ?? []).map((p) => [p.sku, p.name])), [products]);
  const storeById = useMemo(() => new Map(scopedStores.map((s) => [s.id, s])), [scopedStores]);
  const storeName = (id: number) => storeById.get(id)?.name ?? String(id);

  const restockDisplayRows: RestockDisplayRow[] = useMemo(() => {
    if (selectedStoreId === null) return [];
    const recomendacoes: RestockDisplayRow[] = restockRecommendations
      .filter((r) => r.storeId === selectedStoreId)
      .map((r) => ({ kind: "recomendacao", productLabel: nameBySku.get(r.sku) ?? r.sku, storeName: storeName(r.storeId), data: r }));
    const oportunidades: RestockDisplayRow[] = mixOpportunities
      .filter((o) => o.storeId === selectedStoreId)
      .map((o) => ({ kind: "oportunidade", productLabel: nameBySku.get(o.sku) ?? o.sku, storeName: storeName(o.storeId), data: o }));
    return [...recomendacoes, ...oportunidades];
  }, [restockRecommendations, mixOpportunities, selectedStoreId, nameBySku, storeById]);

  const mixDisplayRows: MixDisplayRow[] = useMemo(() => {
    if (selectedStoreId === null) return [];
    return mixRecommendations.filter((r) => r.storeId === selectedStoreId).map((r) => ({ productLabel: nameBySku.get(r.sku) ?? r.sku, storeName: storeName(r.storeId), data: r }));
  }, [mixRecommendations, selectedStoreId, nameBySku, storeById]);

  const mixOpportunityRows: MixOpportunityRow[] = useMemo(() => {
    if (selectedStoreId === null) return [];
    return mixOpportunities.filter((o) => o.storeId === selectedStoreId).map((o) => ({ productLabel: nameBySku.get(o.sku) ?? o.sku, storeName: storeName(o.storeId), data: o }));
  }, [mixOpportunities, selectedStoreId, nameBySku, storeById]);

  const [selectedRestockRow, setSelectedRestockRow] = useState<RestockDisplayRow | null>(null);
  const [selectedMixRow, setSelectedMixRow] = useState<MixDrawerRow | null>(null);

  const isLoading = loadingReconciliation || loadingSales || loadingSupply;
  const isEmpty = !isLoading && !error && selectedStoreId !== null && restockDisplayRows.length === 0 && mixDisplayRows.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inteligência Comercial"
        description="A IA analisa vendas, abastecimentos, margem e perdas para sugerir o que levar para cada loja e quais produtos deveriam existir nela."
      />

      <Select value={selectedStoreId === null ? undefined : String(selectedStoreId)} onValueChange={(value) => setSelectedStoreId(Number(value))}>
        <SelectTrigger className="w-64">
          <SelectValue placeholder="Selecione a loja" />
        </SelectTrigger>
        <SelectContent>
          {scopedStores.map((s) => (
            <SelectItem key={s.id} value={String(s.id)}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedStoreId === null ? (
        <p className="text-sm text-muted-foreground">Selecione uma loja para ver as recomendações de abastecimento e mix.</p>
      ) : (
        <RequestState isLoading={isLoading} error={error} isEmpty={isEmpty} emptyMessage="Sem dados suficientes nesta loja para calcular recomendações." onRetry={refetch}>
          <Tabs defaultValue="abastecimento" className="gap-6">
            <TabsList>
              <TabsTrigger value="abastecimento">Abastecimento Inteligente</TabsTrigger>
              <TabsTrigger value="mix">Mix das Lojas</TabsTrigger>
            </TabsList>

            <TabsContent value="abastecimento" className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">A IA analisa vendas, abastecimentos, margem e perdas para sugerir o que levar para cada loja.</p>
              <RestockPanel rows={restockDisplayRows} />
              <RestockTable rows={restockDisplayRows} onSelect={setSelectedRestockRow} />
              <RestockDrawer row={selectedRestockRow} open={selectedRestockRow !== null} onOpenChange={(open) => !open && setSelectedRestockRow(null)} />
            </TabsContent>

            <TabsContent value="mix" className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">Quais produtos deveriam existir nesta loja, com base em tendência, participação na rede e margem.</p>
              <MixTable
                rows={mixDisplayRows}
                opportunities={mixOpportunityRows}
                onSelect={(row) => setSelectedMixRow({ variant: "recomendacao", ...row })}
                onSelectOpportunity={(row) => setSelectedMixRow({ variant: "oportunidade", ...row })}
              />
              <MixDrawer row={selectedMixRow} open={selectedMixRow !== null} onOpenChange={(open) => !open && setSelectedMixRow(null)} />
            </TabsContent>
          </Tabs>
        </RequestState>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @agiliz/admin exec tsc --noEmit`
Expected: no errors. Fix any hook name / field name mismatch found against the real repository (Step 1) before moving on.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/commercial-intelligence/page.tsx
git commit -m "feat(admin): replace the 6-tab Inteligência Comercial UX with Abastecimento Inteligente + Mix das Lojas"
```

---

## Task 14: Página de calibração — seções Abastecimento e Mix

**Files:**
- Modify: `src/app/(app)/commercial-intelligence/calibration/page.tsx` (reescrita completa)

**Interfaces:**
- Consumes: `RUNTIME_RESTOCK_PARAMETERS`, `restockParameterCatalogSections` (Task 3); `RUNTIME_MIX_PARAMETERS`, `mixParameterCatalogSections` (Task 8); `ParameterCatalog` (`@/components/parameter-catalog`, reaproveitado como está).

**Decisão deste task**: a página passa a mostrar os parâmetros dos 2 motores novos, não mais o
catálogo de 95 parâmetros de combo/cupom da fase anterior — consistente com a decisão já aprovada
de que a experiência principal (§10, decisão do operador) usa uma única página com seções por
motor. Os 95 parâmetros antigos continuam existindo em código (`src/lib/commercial-intelligence/
{parameters,parameter-docs,parameter-rows}.ts`, intocados — Global Constraint) — só deixam de
aparecer nesta página específica, a mesma relação que os 6 módulos antigos têm com a tela principal
(preservados, não exibidos).

- [ ] **Step 1: Write `calibration/page.tsx`**

```tsx
// src/app/(app)/commercial-intelligence/calibration/page.tsx
"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { ParameterCatalog } from "@/components/parameter-catalog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mixParameterCatalogSections } from "@/lib/commercial-intelligence/restock-mix/mix/parameter-rows";
import { RUNTIME_MIX_PARAMETERS } from "@/lib/commercial-intelligence/restock-mix/mix/parameters";
import { restockParameterCatalogSections } from "@/lib/commercial-intelligence/restock-mix/restock/parameter-rows";
import { RUNTIME_RESTOCK_PARAMETERS } from "@/lib/commercial-intelligence/restock-mix/restock/parameters";

function WarningsBanner({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <section className="rounded-lg border border-warning/30 bg-warning/12 p-3 text-sm text-warning" role="status">
      <p className="font-medium">Valores do ambiente ignorados</p>
      <ul className="mt-1 list-disc pl-4 text-xs">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </section>
  );
}

export default function CommercialIntelligenceCalibrationPage() {
  const restock = RUNTIME_RESTOCK_PARAMETERS;
  const mix = RUNTIME_MIX_PARAMETERS;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Configurações avançadas / calibração — Inteligência Comercial"
        description="Os parâmetros provisórios dos motores de Abastecimento Inteligente e Mix das Lojas, com a documentação de cada um. Não é a experiência principal: aqui se revisa, não se decide o negócio."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/commercial-intelligence">
              <ArrowLeft aria-hidden />
              Voltar
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
          <CardDescription>Escritos antes de ver meses reais de uso — guardrails, não regras definitivas. Nunca ajustados para fazer aparecer resultado.</CardDescription>
        </CardHeader>
      </Card>

      <Tabs defaultValue="restock" className="gap-4">
        <TabsList>
          <TabsTrigger value="restock">Abastecimento Inteligente</TabsTrigger>
          <TabsTrigger value="mix">Mix das Lojas</TabsTrigger>
        </TabsList>

        <TabsContent value="restock" className="flex flex-col gap-4">
          <WarningsBanner warnings={restock.warnings} />
          <ParameterCatalog sections={restockParameterCatalogSections(restock.parameters)} />
        </TabsContent>

        <TabsContent value="mix" className="flex flex-col gap-4">
          <WarningsBanner warnings={mix.warnings} />
          <ParameterCatalog sections={mixParameterCatalogSections(mix.parameters)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @agiliz/admin exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/commercial-intelligence/calibration/page.tsx
git commit -m "feat(admin): point Inteligência Comercial's calibration page at the new restock/mix engines"
```

---

## Task 15: Verificação final

**Files:** nenhum arquivo novo — só comandos.

- [ ] **Step 1: Typecheck o app inteiro**

Run: `pnpm --filter @agiliz/admin exec tsc --noEmit`
Expected: sem erros. Um erro aqui geralmente significa um nome de hook/campo que mudou desde a
escrita deste plano (Task 13, Step 1 já pedia conferir isso) — corrija contra o arquivo real, nunca
ajuste o tipo para calar o erro.

- [ ] **Step 2: Lint o app inteiro**

Run: `pnpm --filter @agiliz/admin exec eslint src`
Expected: sem erros.

- [ ] **Step 3: Suíte de testes completa**

Run: `pnpm --filter @agiliz/admin exec jest`
Expected: todos os testes passam, incluindo os novos (Tasks 1-2: ~12 testes; Task 3: 6; Task 4: 6;
Task 5: 8; Task 6: 8; Task 7: 5; Task 8: 5; Task 9: 5; Task 10: 11; Task 11: 6; Task 12: 3 — soma
~75 testes novos) **e** os já existentes no app (nenhum deveria quebrar — nada fora de
`restock-mix/`, `restock/`, `mix/` e as duas páginas foi tocado).

- [ ] **Step 4: Build de produção**

Run: `pnpm --filter @agiliz/admin exec next build`
Expected: build conclui sem erro. Confirma que o Next resolve corretamente os 95 imports de env var
novos (`env.ts` de cada motor) e que a página `/commercial-intelligence` e sua calibração compilam
como rotas estáticas.

- [ ] **Step 5: Verificação ao vivo contra dado real**

Mesmo padrão já usado nesta sessão para Loss Intelligence (documentado no histórico do app): parar
o container `agiliz-admin-dev`, checar/corrigir dono de `.next` se necessário, subir um `next dev`
temporário com `NEXT_PUBLIC_GATEWAY_URL`/`ADMIN_ALLOWED_DEV_ORIGINS` apontando para o IP da LAN,
criar um usuário QA descartável (nunca reusar a senha do usuário real), navegar até
`/commercial-intelligence`, selecionar uma loja com histórico de vendas real, e confirmar:

- A aba **Abastecimento Inteligente** abre por padrão, mostra o resumo (5 números) e a tabela com
  as colunas certas; a visão "Todos" mostra tudo; "Levar"/"Reduzir"/"Não levar"/"Testar" filtram
  corretamente; editar "Quantidade final" e clicar "Gerar lista de abastecimento" reflete o valor
  editado nos 3 grupos.
- Clicar num produto abre o drawer com Ação/Por que?/Histórico/Tendência/Inteligência de
  Perdas/Quantidade/Confiança/Limitações preenchidos com número real, nunca "undefined" nem "NaN".
- A aba **Mix das Lojas** mostra o resumo, a tabela (Produto/Categoria/Situação/Evidência/
  Recomendação/Confiança) e, quando existir, a seção "Oportunidades de novo mix" — nenhuma
  oportunidade com confiança "Alta" (Global Constraint).
- A página de calibração (`/commercial-intelligence/calibration`) mostra as 2 abas com os
  parâmetros novos, badge "provisório" em todos.
- Nenhum erro novo no console do navegador além dos 404 já esperados e documentados
  (`/sales/:storeId?period=`, `/supply/:storeId?period=` para loja/mês nunca ingerido).

Depois: excluir o usuário QA, derrubar o `next dev` temporário, `docker start agiliz-admin-dev`.

- [ ] **Step 6: Commit final, se a verificação ao vivo revelar algum ajuste**

```bash
git add -A
git commit -m "fix(admin): address findings from live verification of restock/mix engines"
```

(Só necessário se o Step 5 encontrar algo — se tudo passar de primeira, não há o que commitar aqui.)

---

## Self-Review

**Cobertura da spec**: §1 (escopo) → Tasks 13 (2 abas, sem rota nova); §2 (reaproveitamento) →
notas de arquitetura em cada task citam explicitamente o que é reaproveitado vs. novo; §3 (dados) →
Global Constraints + granularidade mensal respeitada em `series.ts` (Task 1); §4 (integração Loss
Intelligence) → Tasks 5 e 10 (precedência implementada e testada); §5 (contrato Abastecimento) →
`RestockRecommendation` em Task 1, produzido por Task 5; §6 (fórmula) → Tasks 2 e 5; §7 (Mix SKUs
existentes) → Task 10; §8 (oportunidades) → Task 10, com o gap de `productAffinity` resolvido via
`computeNetworkAffinity`; §9 (estrutura da tela) → Tasks 6, 7, 11, 12, 13; §10 (calibração) → Task
14; §11 (decisões) → todas as 4 arquiteturais incorporadas nos tasks correspondentes, as 3 menores
como defaults explícitos nos parâmetros (Tasks 3, 8); §12 (fora de escopo) → Global Constraints
("nada apagado"), nenhum task toca `src/lib/commercial-intelligence/*` fora de `restock-mix/`.

**Placeholders**: nenhum "TODO"/"implementar depois" — toda função tem corpo completo, todo teste
tem asserção concreta com número calculado à mão (ex.: Task 5's `reduceFactor` test compara contra
`Math.round(withoutOverride[0].quantidadeSugeridaIA * DEFAULT_RESTOCK_PARAMETERS.lossIntegration.reduceFactor)`,
nunca um número mágico solto).

**Consistência de tipos**: `RestockRecommendation`/`MixRecommendation`/`MixOpportunity`/
`StoreSkuSeries`/`TrendResult` definidos uma única vez (Task 1) e importados, nunca redeclarados,
por todos os tasks seguintes. `MixParameters` foi corrigido durante a escrita deste plano (Task 8)
para incluir o grupo `trend` que Task 10 precisa — conferido depois de escrever Task 10, antes de
finalizar.

---

## Execution Handoff

Plano completo, salvo em `docs/superpowers/plans/2026-09-23-commercial-intelligence-restock-mix.md`.
Dois checkpoints seguros no meio do caminho (depois do Task 7 e depois do Task 12), caso a sessão
precise parar e retomar depois. Duas opções de execução:

**1. Subagent-Driven (recomendado)** — dispatco um subagent novo por task, revisando entre eles,
iteração rápida.

**2. Inline Execution** — executo os tasks nesta sessão usando `executing-plans`, em lote com
checkpoints pra revisão.

Qual abordagem?
