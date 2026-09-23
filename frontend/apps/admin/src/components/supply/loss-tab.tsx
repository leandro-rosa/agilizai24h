"use client";

import Link from "next/link";
import { AlertTriangle, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";

import { BusinessRulesSheet } from "@/components/business-rules-sheet";
import { ColumnValueFilter } from "@/components/column-value-filter";
import { RequestState } from "@/components/request-state";
import { NETWORK, type StoreSelection } from "@/components/store-period-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AgentSummaryPanel } from "./loss-intelligence/agent-summary-panel";
import { ACTION_LABELS, LossDecisionsTable, type DecisionRowData } from "./loss-intelligence/decisions-table";
import { LossDecisionDrawer } from "./loss-intelligence/decision-drawer";
import {
  useGetNetworkReconciliationRangeQuery,
  type NetworkReconciliationRangeRow,
  type PerStoreMonthlyTotal,
} from "@/lib/api/finance";
import { useGetCostsAsOfQuery, useGetProductsQuery } from "@/lib/api/products";
import { useGetNetworkSalesByStoreMonthQuery, useGetNetworkSalesRangeQuery } from "@/lib/api/sales";
import { useGetNetworkSupplyByStoreMonthQuery, useGetNetworkSupplyRangeQuery } from "@/lib/api/supply";
import { useGetStoresQuery, type Store } from "@/lib/api/stores";
import { formatPct } from "@/lib/financial-kpis";
import {
  aggregateSalesBySku,
  computeLossKpis,
  generateLossInsights,
  productStoreMatrix,
  reasonDonutData,
  restockSoldLostRows,
  skuLossRows,
  skuStoreBreakdown,
  storeLossRows,
  storesAffectedBySku,
  type InsightSeverity,
  type SkuLossRow,
  type SkuStoreBreakdownRow,
} from "@/lib/loss-insights";
import { analyzeLossIntelligence } from "@/lib/loss-intelligence/engine";
import { explainRecommendation } from "@/lib/loss-intelligence/explain";
import { lossBusinessRuleRows } from "@/lib/loss-intelligence/parameter-rows";
import { RUNTIME_PARAMETERS } from "@/lib/loss-intelligence/parameters";
import type { LossAction, LossIntelligenceInput, LossIntelligenceRecommendation } from "@/lib/loss-intelligence/types";
import { addMonths, lastCompleteMonth, monthsInRange, type PeriodRange } from "@/lib/period-range";
import { aggregateAcrossStores } from "@/lib/reconciliation-aggregate";
import { reasonLabel } from "@/lib/removal-reasons";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compactCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact" });

/** Slices `perStoreMonthly` (already fetched for the whole trend range) down to one month, joined with `Store` for display. */
function rowsForMonth(
  trend: { perStoreMonthly: PerStoreMonthlyTotal[] } | undefined,
  storeById: Map<number, Store>,
  month: string,
): NetworkReconciliationRangeRow[] {
  if (!trend) return [];
  const rows: NetworkReconciliationRangeRow[] = [];
  for (const m of trend.perStoreMonthly) {
    if (m.period !== month || m.totals.monthsWithData === 0) continue;
    const store = storeById.get(m.storeId);
    if (store) rows.push({ store, totals: m.totals });
  }
  return rows;
}

const REASON_TABS: { value: string; label: string }[] = [
  { value: "all", label: "Geral" },
  { value: "expired", label: "Validade" },
  { value: "damaged_product", label: "Avaria" },
  { value: "other_reason", label: "Outros" },
];

function DeltaTag({ deltaPct, deltaIsBad }: { deltaPct: number | null; deltaIsBad: boolean | null }) {
  if (deltaPct === null || deltaIsBad === null) {
    return <span className="text-xs text-muted-foreground">sem período de comparação</span>;
  }
  if (Math.abs(deltaPct) < 0.005) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="size-3" /> estável
      </span>
    );
  }
  const Icon = deltaPct > 0 ? TrendingUp : TrendingDown;
  const tone = deltaIsBad ? "text-destructive" : "text-success";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${tone}`}>
      <Icon className="size-3" />
      {`${deltaPct > 0 ? "+" : ""}${(deltaPct * 100).toFixed(1)}%`}
    </span>
  );
}

function LossKpiCard({
  label,
  valueLabel,
  secondaryLabel,
  hint,
  deltaPct,
  deltaIsBad,
}: {
  label: string;
  valueLabel: string;
  secondaryLabel?: string;
  hint?: string;
  deltaPct: number | null;
  deltaIsBad: boolean | null;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-1 text-sm font-normal text-muted-foreground">
          {label}
          {hint && (
            <span title={hint}>
              <AlertTriangle className="size-3.5" />
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="tabular text-xl font-semibold">{valueLabel}</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          {secondaryLabel && <span className="text-xs text-muted-foreground">{secondaryLabel}</span>}
          <DeltaTag deltaPct={deltaPct} deltaIsBad={deltaIsBad} />
        </div>
      </CardContent>
    </Card>
  );
}

type ChartMetric = "value" | "pct" | "units";

const storeChartConfig: ChartConfig = { metric: { label: "Perda", color: "var(--destructive)" } };

function StoreLossChart({
  rows,
  metric,
  onMetricChange,
}: {
  rows: ReturnType<typeof storeLossRows>;
  metric: ChartMetric;
  onMetricChange: (m: ChartMetric) => void;
}) {
  const data = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      if (metric === "value") return b.lossCents - a.lossCents;
      if (metric === "units") return b.lossQuantity - a.lossQuantity;
      return (b.lossPctOfRevenue ?? -1) - (a.lossPctOfRevenue ?? -1);
    });
    return sorted.map((r) => ({
      store: r.storeName,
      metric: metric === "value" ? r.lossCents / 100 : metric === "units" ? r.lossQuantity : (r.lossPctOfRevenue ?? 0) * 100,
    }));
  }, [rows, metric]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Perda por loja</h3>
        <Tabs value={metric} onValueChange={(v) => onMetricChange(v as ChartMetric)}>
          <TabsList className="h-8">
            <TabsTrigger value="value" className="text-xs">
              R$
            </TabsTrigger>
            <TabsTrigger value="pct" className="text-xs">
              Perda %
            </TabsTrigger>
            <TabsTrigger value="units" className="text-xs">
              Unidades
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        {metric === "value"
          ? "R$ favorece lojas grandes — use Perda % ou Unidades para comparar lojas de porte diferente."
          : metric === "pct"
            ? "Perda sobre a receita da própria loja — comparável entre lojas de porte diferente."
            : "Unidades perdidas, sem relação com o preço do item."}
      </p>
      <ChartContainer config={storeChartConfig} className="h-72 w-full">
        <BarChart data={data} margin={{ left: 8, right: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="store" tickLine={false} axisLine={false} tickMargin={8} interval={0} angle={-40} textAnchor="end" height={80} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(v: number) => (metric === "value" ? compactCurrency.format(v) : metric === "pct" ? `${v.toFixed(0)}%` : String(v))}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) => (metric === "value" ? currency.format(Number(value)) : metric === "pct" ? `${Number(value).toFixed(1)}%` : `${value} un.`)}
              />
            }
          />
          <Bar dataKey="metric" fill="var(--color-metric)" radius={4} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}

const REASON_COLORS: Record<string, string> = {
  expired: "var(--chart-2)",
  damaged_product: "var(--chart-4)",
  other_reason: "var(--chart-5)",
};

function ReasonDonut({ slices }: { slices: ReturnType<typeof reasonDonutData> }) {
  const config: ChartConfig = Object.fromEntries(
    slices.map((s) => [s.reason, { label: s.label, color: REASON_COLORS[s.reason] ?? "var(--chart-1)" }]),
  );
  const total = slices.reduce((sum, s) => sum + s.valueCents, 0);

  if (slices.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem perda por motivo no período.</p>;
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-medium">Perda por motivo</h3>
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <ChartContainer config={config} className="aspect-square h-56">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent formatter={(value) => currency.format(Number(value) / 100)} />} />
            <Pie data={slices} dataKey="valueCents" nameKey="label" innerRadius={50} outerRadius={80} strokeWidth={2}>
              {slices.map((s) => (
                <Cell key={s.reason} fill={REASON_COLORS[s.reason] ?? "var(--chart-1)"} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="flex flex-1 flex-col gap-2">
          {slices.map((s) => (
            <div key={s.reason} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: REASON_COLORS[s.reason] ?? "var(--chart-1)" }} />
                {s.label}
              </div>
              <span className="tabular text-muted-foreground">
                {currency.format(s.valueCents / 100)} · {total > 0 ? formatPct(s.valueCents / total) : "—"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const trendChartConfig: ChartConfig = {
  expired: { label: "Validade", color: "var(--chart-2)" },
  damaged_product: { label: "Avaria", color: "var(--chart-4)" },
  other_reason: { label: "Outros", color: "var(--chart-5)" },
};

function LossTrendChart({ monthlyLossByReason, months }: { monthlyLossByReason: { period: string; reason: string; value_cents: number }[]; months: string[] }) {
  const data = useMemo(
    () =>
      months.map((period) => {
        const row: Record<string, number | string> = { period };
        for (const reason of ["expired", "damaged_product", "other_reason"]) {
          const match = monthlyLossByReason.find((m) => m.period === period && m.reason === reason);
          row[reason] = (match?.value_cents ?? 0) / 100;
        }
        return row;
      }),
    [monthlyLossByReason, months],
  );

  return (
    <div>
      <h3 className="mb-3 text-sm font-medium">Evolução das perdas</h3>
      <ChartContainer config={trendChartConfig} className="h-64 w-full">
        <LineChart data={data} margin={{ left: 8, right: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(v: number) => compactCurrency.format(v)} />
          <ChartTooltip content={<ChartTooltipContent formatter={(value) => currency.format(Number(value))} />} />
          {Object.entries(trendChartConfig).map(([key, cfg]) => (
            <Line key={key} type="monotone" dataKey={key} stroke={cfg.color} strokeWidth={2} dot={false} />
          ))}
        </LineChart>
      </ChartContainer>
    </div>
  );
}

const SEVERITY_TONE: Record<InsightSeverity, "critical" | "attention" | "neutral"> = {
  critical: "critical",
  warning: "attention",
  info: "neutral",
};
const SEVERITY_LABEL: Record<InsightSeverity, string> = { critical: "Atenção", warning: "Observação", info: "Contexto" };

function InsightsCard({ insights }: { insights: ReturnType<typeof generateLossInsights> }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-medium">Principais insights</h3>
      <div className="flex flex-col gap-3">
        {insights.map((insight) => (
          <div key={insight.key} className="rounded-lg border p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <StatusBadge tone={SEVERITY_TONE[insight.severity]}>{SEVERITY_LABEL[insight.severity]}</StatusBadge>
            </div>
            <p className="text-sm">{insight.evidence}</p>
            {insight.recommendation && (
              <p className="mt-1.5 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Recomendação: </span>
                {insight.recommendation}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SkuStoreBreakdownTable({ rows }: { rows: SkuStoreBreakdownRow[] }) {
  if (rows.length === 0) {
    return <p className="p-3 text-xs text-muted-foreground">Sem lojas com perda deste produto.</p>;
  }
  return (
    <div className="border-t bg-muted/30 p-3">
      <p className="mb-2 text-xs text-muted-foreground">
        Perda por loja e motivo, ao lado da venda desta loja para o mesmo produto — um motivo concentrado numa loja só
        aponta para aquela loja; espalhado por todas, aponta para o produto.
      </p>
      <div className="overflow-x-auto rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Loja</TableHead>
              <TableHead>Motivo(s)</TableHead>
              <TableHead className="tabular text-right">Qtd. perdida</TableHead>
              <TableHead className="tabular text-right">Valor perdido</TableHead>
              <TableHead className="tabular text-right">Vendas da loja (un.)</TableHead>
              <TableHead className="tabular text-right">Vendas da loja (R$)</TableHead>
              <TableHead className="tabular text-right">Perda / venda</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.storeId}>
                <TableCell className="font-medium">{row.storeName}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {row.reasons.map((r) => (
                      <span key={r.reason} className="rounded bg-muted px-1.5 py-0.5 text-xs whitespace-nowrap">
                        {reasonLabel(r.reason)} ({r.quantity})
                      </span>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="tabular text-right">{row.totalQuantity}</TableCell>
                <TableCell className="tabular text-right">{currency.format(row.totalValueCents / 100)}</TableCell>
                <TableCell className="tabular text-right">{row.salesQuantity}</TableCell>
                <TableCell className="tabular text-right">{currency.format(row.salesRevenueCents / 100)}</TableCell>
                <TableCell className="tabular text-right">{row.pctOfSales === null ? "—" : formatPct(row.pctOfSales)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SkuLossTable({
  rows,
  reasonTab,
  onReasonTabChange,
  expandedSku,
  onToggleExpand,
  expandedBreakdown,
}: {
  rows: SkuLossRow[];
  reasonTab: string;
  onReasonTabChange: (v: string) => void;
  expandedSku: string | null;
  onToggleExpand: (sku: string) => void;
  expandedBreakdown: SkuStoreBreakdownRow[];
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Produtos com maior perda</h3>
        <Tabs value={reasonTab} onValueChange={onReasonTabChange}>
          <TabsList className="h-8">
            {REASON_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">Clique num produto para ver a perda por loja, os motivos e a venda daquela loja.</p>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="tabular text-right">Qtd.</TableHead>
              <TableHead className="tabular text-right">Valor</TableHead>
              <TableHead className="tabular text-right">% das vendas do SKU</TableHead>
              <TableHead className="tabular text-right">Lojas afetadas</TableHead>
              <TableHead>Motivo principal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Sem perda registrada para este filtro.
                </TableCell>
              </TableRow>
            ) : (
              rows.slice(0, 20).map((row) => (
                <Fragment key={row.sku}>
                  <TableRow
                    className="cursor-pointer"
                    data-state={row.sku === expandedSku ? "selected" : undefined}
                    onClick={() => onToggleExpand(row.sku)}
                  >
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="tabular text-right">{row.quantity}</TableCell>
                    <TableCell className="tabular text-right">{currency.format(row.valueCents / 100)}</TableCell>
                    <TableCell className="tabular text-right">
                      {row.pctOfSkuSales === null ? "—" : formatPct(row.pctOfSkuSales)}
                    </TableCell>
                    <TableCell className="tabular text-right">{row.storesAffected}</TableCell>
                    <TableCell>{row.topReason ? reasonLabel(row.topReason) : "—"}</TableCell>
                  </TableRow>
                  {row.sku === expandedSku && (
                    <TableRow>
                      <TableCell colSpan={6} className="p-0">
                        <SkuStoreBreakdownTable rows={expandedBreakdown} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** Ícone por ação — mesmo vocabulário visual do painel do Agente (`AgentSummaryPanel`'s ACTION_ROWS), §15.5 adenda 2026-09-23. */
const MATRIX_ACTION_ICON: Record<LossAction, string> = {
  manter: "🟢",
  manter_monitorar: "🟢",
  reduzir_abastecimento: "🟡",
  investigar: "🟠",
  suspender_abastecimento: "🔴",
  avaliar_retirada_loja: "🔴",
  avaliar_retirada_rede: "⚫",
  avaliar_permanencia_loja: "🔴",
  avaliar_permanencia_rede: "⚫",
  dados_insuficientes: "—",
};

function ProductStoreMatrixView({
  matrix,
  recommendations,
  onSelectRecommendation,
}: {
  matrix: ReturnType<typeof productStoreMatrix>;
  /** Undefined enquanto o motor ainda não calculou — o modo "Decisão IA" fica desabilitado até então. */
  recommendations: LossIntelligenceRecommendation[] | undefined;
  onSelectRecommendation: (recommendation: LossIntelligenceRecommendation) => void;
}) {
  const [mode, setMode] = useState<"perdas" | "decisao">("perdas");

  const stores = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of matrix) for (const cell of row.cells) map.set(cell.storeId, cell.storeName);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [matrix]);

  const maxQuantity = Math.max(1, ...matrix.flatMap((row) => row.cells.map((c) => c.quantity)));

  // §15.5 — troca o que a célula codifica (nunca os dois ao mesmo tempo, para não prejudicar a legibilidade da matriz de Perdas).
  const recommendationByKey = useMemo(() => {
    const map = new Map<string, LossIntelligenceRecommendation>();
    for (const rec of recommendations ?? []) map.set(`${rec.storeId}:${rec.sku}`, rec);
    return map;
  }, [recommendations]);

  if (matrix.length === 0 || stores.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem produtos com perda em mais de uma loja para comparar.</p>;
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Produto × Loja</h3>
        <Tabs value={mode} onValueChange={(v) => setMode(v as "perdas" | "decisao")}>
          <TabsList>
            <TabsTrigger value="perdas">Perdas</TabsTrigger>
            <TabsTrigger value="decisao" disabled={!recommendations}>
              Decisão IA
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        {mode === "perdas"
          ? "Unidades perdidas. Um produto que some em toda loja é um problema do produto; vários produtos sumindo só numa loja é um problema daquela loja."
          : "Status da recomendação do Agente de Perdas por produto e loja. Clique numa célula para ver a análise completa."}
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              {stores.map((s) => (
                <TableHead key={s.id} className="tabular text-center text-xs whitespace-nowrap">
                  {s.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {matrix.map((row) => (
              <TableRow key={row.sku}>
                <TableCell className="max-w-[180px] truncate font-medium">{row.name}</TableCell>
                {stores.map((s) => {
                  const cell = row.cells.find((c) => c.storeId === s.id);
                  if (mode === "perdas") {
                    const intensity = cell ? Math.max(0.12, cell.quantity / maxQuantity) : 0;
                    return (
                      <TableCell key={s.id} className="tabular text-center text-xs">
                        {cell ? (
                          <span
                            className="inline-flex min-w-8 justify-center rounded px-1.5 py-0.5"
                            style={{ backgroundColor: `color-mix(in oklch, var(--destructive) ${intensity * 100}%, transparent)` }}
                          >
                            {cell.quantity}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    );
                  }

                  const rec = recommendationByKey.get(`${s.id}:${row.sku}`);
                  return (
                    <TableCell key={s.id} className="tabular text-center text-xs">
                      {rec ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex min-w-8 cursor-pointer justify-center rounded px-1.5 py-0.5 hover:bg-muted"
                              onClick={() => onSelectRecommendation(rec)}
                            >
                              {MATRIX_ACTION_ICON[rec.acaoPrioritaria]}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>{ACTION_LABELS[rec.acaoPrioritaria]}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function RestockSoldLostTable({ rows }: { rows: ReturnType<typeof restockSoldLostRows> }) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div>
      <h3 className="mb-1 text-sm font-medium">Abastecido × Vendido × Perdido por validade</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        O problema pode não ser o produto — pode ser excesso de abastecimento naquela loja para o ritmo real de venda.
      </p>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead>Loja</TableHead>
              <TableHead className="tabular text-right">Abastecido</TableHead>
              <TableHead className="tabular text-right">Vendido</TableHead>
              <TableHead className="tabular text-right">Venceu</TableHead>
              <TableHead className="tabular text-right">% do abastecido</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 15).map((row) => (
              <TableRow key={`${row.storeId}-${row.sku}`}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>{row.storeName}</TableCell>
                <TableCell className="tabular text-right">{row.restocked}</TableCell>
                <TableCell className="tabular text-right">{row.sold}</TableCell>
                <TableCell className="tabular text-right text-destructive">{row.expiredLoss}</TableCell>
                <TableCell className="tabular text-right">
                  {row.pctExpiredOfRestocked === null ? "—" : formatPct(row.pctExpiredOfRestocked)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function LossTab({ storeId, range }: { storeId: StoreSelection; range: PeriodRange }) {
  const { data: stores } = useGetStoresQuery();
  const { data: products } = useGetProductsQuery();
  const nameBySku = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products ?? []) map.set(product.sku, product.name);
    return map;
  }, [products]);

  const scopedStores = useMemo(() => {
    if (!stores) return [];
    return storeId === NETWORK ? stores : stores.filter((s) => s.id === storeId);
  }, [stores, storeId]);
  const isNetworkScope = storeId === NETWORK;

  const months = monthsInRange(range);
  const [period, setPeriod] = useState(months[months.length - 1]);
  const comparePeriod = addMonths(period, -1);
  const trendRange = useMemo<PeriodRange>(() => ({ start: addMonths(period, -5), end: period }), [period]);
  // Independent of the page-level range picker above (which can be a
  // single month) — Perdas has its own period, so the dropdown always
  // offers the last 24 months regardless of what's selected up top.
  const periodOptions = useMemo(() => {
    const anchor = period > lastCompleteMonth() ? period : lastCompleteMonth();
    return monthsInRange({ start: addMonths(anchor, -23), end: anchor }).slice().reverse();
  }, [period]);

  const [metric, setMetric] = useState<ChartMetric>("value");
  const [reasonTab, setReasonTab] = useState("all");
  const [productSelected, setProductSelected] = useState<Set<string>>(new Set());

  const currentRangeArg = useMemo<PeriodRange>(() => ({ start: period, end: period }), [period]);

  const skip = scopedStores.length === 0;
  // `trendRange` always covers both `period` and `comparePeriod` (it starts
  // 5 months before `period`, and comparePeriod is only 1 month before) —
  // one range query, sliced three ways client-side via `perStoreMonthly`,
  // instead of three range queries each re-fetching the same store series
  // (`/finance/:storeId` already returns full history — see finance.ts).
  const {
    data: trend,
    isLoading: loadingTrend,
    error,
    refetch,
  } = useGetNetworkReconciliationRangeQuery({ stores: scopedStores, range: trendRange }, { skip });
  const { data: salesRows, isLoading: loadingSales } = useGetNetworkSalesRangeQuery(
    { stores: scopedStores, range: currentRangeArg },
    { skip },
  );
  const { data: supplyRows, isLoading: loadingSupply } = useGetNetworkSupplyRangeQuery(
    { stores: scopedStores, range: currentRangeArg },
    { skip },
  );

  const storeById = useMemo(() => new Map(scopedStores.map((s) => [s.id, s])), [scopedStores]);
  const currentRows = useMemo(() => rowsForMonth(trend, storeById, period), [trend, storeById, period]);
  const previousRows = useMemo(() => rowsForMonth(trend, storeById, comparePeriod), [trend, storeById, comparePeriod]);

  const currentAggregate = useMemo(() => aggregateAcrossStores(currentRows.map((r) => r.totals)), [currentRows]);
  const previousAggregate = useMemo(
    () => (previousRows.length > 0 ? aggregateAcrossStores(previousRows.map((r) => r.totals)) : null),
    [previousRows],
  );
  const currentAdjustmentCents = useMemo(
    () => currentRows.reduce((sum, r) => sum + r.totals.unclassified_stock_adjustment_value_cents, 0),
    [currentRows],
  );
  const previousAdjustmentCents = useMemo(
    () => (previousRows.length > 0 ? previousRows.reduce((sum, r) => sum + r.totals.unclassified_stock_adjustment_value_cents, 0) : null),
    [previousRows],
  );

  const revenueByStore = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of salesRows ?? []) map.set(row.storeId, row.totalRevenueCents);
    return map;
  }, [salesRows]);
  const currentRevenueCents = useMemo(() => (salesRows ?? []).reduce((sum, r) => sum + r.totalRevenueCents, 0), [salesRows]);

  const salesBySku = useMemo(() => aggregateSalesBySku(salesRows ?? []), [salesRows]);
  const storesAffected = useMemo(() => storesAffectedBySku(currentRows), [currentRows]);

  // A selected produto narrows every widget to that SKU's own numbers —
  // the "Furto por loja × produto" investigation flow from the brief.
  const productOptions = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const row of currentRows) {
      for (const entry of row.totals.loss_by_sku) {
        if (entry.quantity <= 0) continue;
        const existing = map.get(entry.sku);
        map.set(entry.sku, { label: nameBySku.get(entry.sku) ?? entry.sku, count: (existing?.count ?? 0) + entry.quantity });
      }
    }
    return map;
  }, [currentRows, nameBySku]);

  const filteredRows = useMemo(() => {
    if (productSelected.size === 0) return currentRows;
    return currentRows.map((row) => ({
      ...row,
      totals: {
        ...row.totals,
        loss_value_cents: row.totals.loss_by_sku.filter((e) => productSelected.has(e.sku)).reduce((s, e) => s + e.value_cents, 0),
        loss_quantity: row.totals.loss_by_sku.filter((e) => productSelected.has(e.sku)).reduce((s, e) => s + e.quantity, 0),
        loss_by_sku: row.totals.loss_by_sku.filter((e) => productSelected.has(e.sku)),
        loss_by_reason: (() => {
          const map = new Map<string, { reason: string; quantity: number; value_cents: number }>();
          for (const e of row.totals.loss_by_reason_sku) {
            if (!productSelected.has(e.sku)) continue;
            const ex = map.get(e.reason);
            if (ex) {
              ex.quantity += e.quantity;
              ex.value_cents += e.value_cents;
            } else {
              map.set(e.reason, { reason: e.reason, quantity: e.quantity, value_cents: e.value_cents });
            }
          }
          return [...map.values()];
        })(),
        loss_by_reason_sku: row.totals.loss_by_reason_sku.filter((e) => productSelected.has(e.sku)),
      },
    }));
  }, [currentRows, productSelected]);

  const scopedAggregate = useMemo(() => aggregateAcrossStores(filteredRows.map((r) => r.totals)), [filteredRows]);

  const kpis = useMemo(
    () => computeLossKpis(currentAggregate, previousAggregate, currentRevenueCents, currentAdjustmentCents, previousAdjustmentCents),
    [currentAggregate, previousAggregate, currentRevenueCents, currentAdjustmentCents, previousAdjustmentCents],
  );
  const storeRows = useMemo(() => storeLossRows(filteredRows, revenueByStore), [filteredRows, revenueByStore]);
  const reasonSlices = useMemo(() => reasonDonutData(scopedAggregate.loss_by_reason), [scopedAggregate]);
  const skuRows = useMemo(
    () => skuLossRows(scopedAggregate, reasonTab, salesBySku, storesAffected, nameBySku),
    [scopedAggregate, reasonTab, salesBySku, storesAffected, nameBySku],
  );
  // Reason-aware on purpose: switching the ranked table to "Outros" (where
  // an operator's "outro motivo" often records suspected furto) narrows the
  // matrix to that reason's per-store pattern too, so both stay in sync.
  const topSkus = useMemo(() => skuRows.slice(0, 8).map((r) => r.sku), [skuRows]);
  const matrix = useMemo(
    () => productStoreMatrix(filteredRows, topSkus, nameBySku, reasonTab),
    [filteredRows, topSkus, nameBySku, reasonTab],
  );

  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const expandedBreakdown = useMemo<SkuStoreBreakdownRow[]>(
    () => (expandedSku ? skuStoreBreakdown(expandedSku, currentRows, salesRows ?? []) : []),
    [expandedSku, currentRows, salesRows],
  );
  const restockSoldLost = useMemo(
    () => restockSoldLostRows(filteredRows, supplyRows ?? [], salesRows ?? [], nameBySku),
    [filteredRows, supplyRows, salesRows, nameBySku],
  );
  const insights = useMemo(
    () =>
      generateLossInsights({
        current: scopedAggregate,
        previous: previousAggregate,
        storeRows,
        skuRows,
        restockSoldLost,
        matrix,
        currentAdjustmentCents,
        isNetworkScope,
      }),
    [scopedAggregate, previousAggregate, storeRows, skuRows, restockSoldLost, matrix, currentAdjustmentCents, isNetworkScope],
  );

  const isLoading = loadingTrend || loadingSales || loadingSupply;
  const isEmpty = !isLoading && !error && currentRows.length === 0;

  // ---- Agente de Perdas (Fase 1, spec §15) ----
  // A janela do motor é fixa a partir de hoje, não do "Período" escolhido acima:
  // resolveAnalysisWindow (temporal.ts) calcula primaryClosedPeriods/recurrenceLookbackPeriods
  // só a partir de `today`, então existe uma única janela de análise por carregamento de tela,
  // independente do período que o operador está navegando manualmente nos widgets acima.
  // A largura da busca acompanha window.recurrenceLookbackMonths (6 por padrão) para cobrir
  // tanto a janela principal quanto o lookback de recorrência com uma única busca.
  const [selectedRecommendation, setSelectedRecommendation] = useState<LossIntelligenceRecommendation | null>(null);

  const engineAsOfPeriod = lastCompleteMonth();
  const lookbackMonths = RUNTIME_PARAMETERS.parameters.window.recurrenceLookbackMonths;
  const engineRange = useMemo<PeriodRange>(
    () => ({ start: addMonths(engineAsOfPeriod, -(lookbackMonths - 1)), end: engineAsOfPeriod }),
    [engineAsOfPeriod, lookbackMonths],
  );

  // perStoreMonthly já existe em getNetworkReconciliationRange (mesmo padrão usado para
  // currentRows/previousRows acima) — reaproveitado aqui, só com um range próprio (engineRange,
  // não trendRange) porque a janela do motor não depende do período escolhido no dropdown.
  const { data: agentReconciliation } = useGetNetworkReconciliationRangeQuery({ stores: scopedStores, range: engineRange }, { skip });
  // getNetworkSalesRange/getNetworkSupplyRange somam todos os meses do range num total só por
  // SKU (sumSales/sumSupply) — útil pros widgets acima, mas o motor precisa do período real por
  // linha para resolver janela e recorrência. Os hooks *ByStoreMonth (novos, mesmos endpoints
  // REST) devolvem o mesmo fan-out sem essa soma final.
  const { data: salesByStoreMonth } = useGetNetworkSalesByStoreMonthQuery({ stores: scopedStores, range: engineRange }, { skip });
  const { data: supplyByStoreMonth } = useGetNetworkSupplyByStoreMonthQuery({ stores: scopedStores, range: engineRange }, { skip });

  // computeLossMetrics (metrics.ts) só resolve custo para um SKU que aparece em vendas
  // (grossMarginCents soma só sobre salesInWindow) — o universo certo de SKUs para o custo
  // datado é o das vendas buscadas acima para a janela do motor, não o de reposição/reconciliação.
  const allSkusForCost = useMemo(
    () => [...new Set((salesByStoreMonth ?? []).flatMap((month) => month.bySku.map((row) => row.sku)))],
    [salesByStoreMonth],
  );
  const { data: costsResult } = useGetCostsAsOfQuery(
    { skus: allSkusForCost, asOf: `${engineAsOfPeriod}-01` },
    { skip: allSkusForCost.length === 0 },
  );
  const costsBySkuAsOf = useMemo(() => {
    if (!costsResult) return null;
    const bySku = new Map(costsResult.resolved.map((r) => [r.sku, r.cost_cents]));
    return (sku: string) => bySku.get(sku) ?? null;
  }, [costsResult]);

  const categoryBySku = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products ?? []) map.set(product.sku, product.category);
    return map;
  }, [products]);

  const lossIntelligenceInput = useMemo<LossIntelligenceInput | null>(() => {
    if (!agentReconciliation || !salesByStoreMonth || !supplyByStoreMonth || !costsBySkuAsOf || scopedStores.length === 0) return null;

    const reconciliations: LossIntelligenceInput["reconciliations"] = agentReconciliation.perStoreMonthly.map((row) => ({
      store_id: row.storeId,
      period: row.period,
      loss_by_reason_sku: row.totals.loss_by_reason_sku.map((entry) => ({
        reason: entry.reason,
        sku: entry.sku,
        quantity: entry.quantity,
        value_cents: entry.value_cents,
      })),
    }));

    const salesByStorePeriodSku: LossIntelligenceInput["salesByStorePeriodSku"] = salesByStoreMonth.flatMap((month) =>
      month.bySku.map((row) => ({
        store_id: month.storeId,
        period: month.period,
        sku: row.sku,
        quantity_sold: row.quantity_sold,
        revenue_cents: row.revenue_cents,
      })),
    );

    // store_id/period vêm de `month` (StoreMonthSupply, do hook *ByStoreMonth), nunca de
    // RestockRow — que só tem sku/quantity_restocked (supply.ts).
    const supplyByStorePeriodSku: LossIntelligenceInput["supplyByStorePeriodSku"] = supplyByStoreMonth.flatMap((month) =>
      month.restocks.map((row) => ({
        store_id: month.storeId,
        period: month.period,
        sku: row.sku,
        quantity_restocked: row.quantity_restocked,
      })),
    );

    return {
      reconciliations,
      salesByStorePeriodSku,
      supplyByStorePeriodSku,
      costsBySkuAsOf,
      stores: scopedStores.map((s) => ({ id: s.id, name: s.name })),
      today: new Date().toISOString().slice(0, 10),
      parameters: RUNTIME_PARAMETERS.parameters,
    };
  }, [agentReconciliation, salesByStoreMonth, supplyByStoreMonth, costsBySkuAsOf, scopedStores]);

  const lossIntelligenceResult = useMemo(
    () => (lossIntelligenceInput ? analyzeLossIntelligence(lossIntelligenceInput) : null),
    [lossIntelligenceInput],
  );

  const decisionRows = useMemo<DecisionRowData[]>(() => {
    if (!lossIntelligenceResult) return [];
    return lossIntelligenceResult.recommendations
      .filter((r) => r.acaoPrioritaria !== "manter") // tabela de decisão não precisa listar "sem problema" — mantém o foco em quem exige atenção
      .map((r) => ({
        recommendation: r,
        productLabel: nameBySku.get(r.sku) ?? r.sku,
        storeName: storeById.get(r.storeId)?.name ?? String(r.storeId),
        category: categoryBySku.get(r.sku) ?? null,
        diagnosticoResumo: explainRecommendation(r).split(".")[0] + ".", // primeira frase só, para a célula da tabela
      }));
  }, [lossIntelligenceResult, nameBySku, storeById, categoryBySku]);

  const selectedProductLabel = selectedRecommendation ? (nameBySku.get(selectedRecommendation.sku) ?? selectedRecommendation.sku) : "";
  const selectedStoreName = selectedRecommendation
    ? (storeById.get(selectedRecommendation.storeId)?.name ?? String(selectedRecommendation.storeId))
    : "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Período</span>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periodOptions.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="pb-2 text-xs text-muted-foreground">Comparado a {comparePeriod}</p>
        <div className="ml-auto">
          <ColumnValueFilter
            label="Produto"
            options={productOptions}
            selected={productSelected}
            onChange={setProductSelected}
          />
        </div>
      </div>

      <RequestState
        isLoading={isLoading}
        error={error}
        isEmpty={isEmpty}
        emptyMessage="Sem reconciliação no período selecionado para calcular perdas."
        onRetry={refetch}
      >
        <div className="flex flex-col gap-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {kpis.map((kpi) => (
              <LossKpiCard
                key={kpi.key}
                label={kpi.label}
                valueLabel={kpi.displayValue ?? currency.format(kpi.valueCents / 100)}
                secondaryLabel={kpi.secondaryLabel}
                hint={kpi.hint}
                deltaPct={kpi.deltaPct}
                deltaIsBad={kpi.deltaIsBad}
              />
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {storeRows.length > 1 ? (
              <StoreLossChart rows={storeRows} metric={metric} onMetricChange={setMetric} />
            ) : (
              <div className="text-sm text-muted-foreground">Comparação entre lojas exige mais de uma loja no escopo.</div>
            )}
            <ReasonDonut slices={reasonSlices} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {trend && trend.monthlyLossByReason.length > 0 && (
              <LossTrendChart monthlyLossByReason={trend.monthlyLossByReason} months={monthsInRange(trendRange)} />
            )}
            <InsightsCard insights={insights} />
          </div>

          <SkuLossTable
            rows={skuRows}
            reasonTab={reasonTab}
            onReasonTabChange={setReasonTab}
            expandedSku={expandedSku}
            onToggleExpand={(sku) => setExpandedSku((prev) => (prev === sku ? null : sku))}
            expandedBreakdown={expandedBreakdown}
          />

          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">Agente de Perdas</h3>
                <p className="text-xs text-muted-foreground">
                  Recomendações automáticas por produto e loja, com evidência e confiança — nunca aplicadas sozinhas.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <BusinessRulesSheet
                  description="Decisões da empresa que mudam o que o Agente de Perdas recomenda. Valem para toda a operação: não são ajustes deste navegador."
                  rows={lossBusinessRuleRows(RUNTIME_PARAMETERS.parameters)}
                  calibrationHref="/supply/loss-intelligence/calibration"
                />
                <Button asChild variant="ghost" size="sm">
                  <Link href="/supply/loss-intelligence/calibration">Configurações avançadas / calibração</Link>
                </Button>
              </div>
            </div>

            {lossIntelligenceResult && (
              <>
                <AgentSummaryPanel
                  result={lossIntelligenceResult}
                  scope={isNetworkScope ? { kind: "network" } : { kind: "store", storeName: scopedStores[0]?.name ?? String(storeId) }}
                  onSeeAll={() => document.getElementById("loss-intelligence-table")?.scrollIntoView({ behavior: "smooth" })}
                />
                <div id="loss-intelligence-table">
                  <LossDecisionsTable rows={decisionRows} onSelect={setSelectedRecommendation} />
                </div>
              </>
            )}
          </div>

          <LossDecisionDrawer
            recommendation={selectedRecommendation}
            productLabel={selectedProductLabel}
            storeName={selectedStoreName}
            open={selectedRecommendation !== null}
            onOpenChange={(open) => !open && setSelectedRecommendation(null)}
          />

          {isNetworkScope && (
            <ProductStoreMatrixView
              matrix={matrix}
              recommendations={lossIntelligenceResult?.recommendations}
              onSelectRecommendation={setSelectedRecommendation}
            />
          )}

          <RestockSoldLostTable rows={restockSoldLost} />
        </div>
      </RequestState>
    </div>
  );
}
