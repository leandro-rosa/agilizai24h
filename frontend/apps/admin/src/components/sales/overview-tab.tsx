"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";

import { RequestState } from "@/components/request-state";
import { currency, compactCurrency, SalesKpiCard, type SalesTabProps } from "@/components/sales/shared";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPct } from "@/lib/financial-kpis";
import {
  categoryMix,
  computePeriodStats,
  computeSalesKpis,
  dailySeries,
  generateSalesInsights,
  heatmapData,
  productAffinity,
  productSalesRows,
  storePerformanceRows,
  summarizeHeatmap,
  WEEKDAY_LABELS,
  type EvolutionMetric,
  type InsightSeverity,
} from "@/lib/sales-insights";

const SEVERITY_TONE: Record<InsightSeverity, "critical" | "attention" | "neutral"> = {
  critical: "critical",
  warning: "attention",
  info: "neutral",
};
const SEVERITY_LABEL: Record<InsightSeverity, string> = { critical: "Atenção", warning: "Observação", info: "Contexto" };

const EVOLUTION_LABELS: Record<EvolutionMetric, string> = { revenue: "Receita", baskets: "Transações", quantity: "Quantidade", margin: "Margem" };

function EvolutionChart({
  current,
  previous,
  metric,
  onMetricChange,
}: {
  current: ReturnType<typeof dailySeries>;
  previous: ReturnType<typeof dailySeries>;
  metric: EvolutionMetric;
  onMetricChange: (m: EvolutionMetric) => void;
}) {
  const config: ChartConfig = {
    current: { label: EVOLUTION_LABELS[metric] + " (atual)", color: "var(--chart-1)" },
    previous: { label: EVOLUTION_LABELS[metric] + " (período anterior)", color: "var(--muted-foreground)" },
  };

  const data = useMemo(() => {
    const days = new Set([...current.map((p) => p.dayOfMonth), ...previous.map((p) => p.dayOfMonth)]);
    return [...days].sort((a, b) => a - b).map((day) => ({
      day,
      current: current.find((p) => p.dayOfMonth === day)?.value ?? 0,
      previous: previous.find((p) => p.dayOfMonth === day)?.value ?? 0,
    }));
  }, [current, previous]);

  const isMoney = metric === "revenue" || metric === "margin";

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Evolução das vendas</h3>
        <Tabs value={metric} onValueChange={(v) => onMetricChange(v as EvolutionMetric)}>
          <TabsList className="h-8">
            {(Object.keys(EVOLUTION_LABELS) as EvolutionMetric[]).map((key) => (
              <TabsTrigger key={key} value={key} className="text-xs">
                {EVOLUTION_LABELS[key]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <ChartContainer config={config} className="h-72 w-full">
        <LineChart data={data} margin={{ left: 8, right: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(v: number) => (isMoney ? compactCurrency.format(v) : String(v))} />
          <ChartTooltip content={<ChartTooltipContent formatter={(value) => (isMoney ? currency.format(Number(value)) : String(value))} />} />
          <Line type="monotone" dataKey="current" stroke="var(--color-current)" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="previous" stroke="var(--color-previous)" strokeWidth={2} strokeDasharray="4 4" dot={false} />
        </LineChart>
      </ChartContainer>
    </div>
  );
}

type StoreMetric = "revenue" | "baskets" | "quantity" | "ticket" | "marginCents" | "marginPct";
const STORE_METRIC_LABELS: Record<StoreMetric, string> = {
  revenue: "Receita",
  baskets: "Transações",
  quantity: "Unidades",
  ticket: "Ticket médio",
  marginCents: "Margem R$",
  marginPct: "Margem %",
};

const storeChartConfig: ChartConfig = { value: { label: "Valor", color: "var(--chart-1)" } };

function StorePerformanceChart({
  rows,
  metric,
  onMetricChange,
}: {
  rows: ReturnType<typeof storePerformanceRows>;
  metric: StoreMetric;
  onMetricChange: (m: StoreMetric) => void;
}) {
  const data = useMemo(() => {
    const withValue = rows.map((r) => {
      let value = 0;
      if (metric === "revenue") value = r.revenueCents / 100;
      else if (metric === "baskets") value = r.basketCount;
      else if (metric === "quantity") value = r.quantitySold;
      else if (metric === "ticket") value = (r.ticketAvgCents ?? 0) / 100;
      else if (metric === "marginCents") value = (r.margin.marginCents ?? 0) / 100;
      else if (metric === "marginPct") value = (r.margin.marginPct ?? 0) * 100;
      return { store: r.storeName, value };
    });
    return withValue.sort((a, b) => b.value - a.value);
  }, [rows, metric]);

  const isMoney = metric === "revenue" || metric === "ticket" || metric === "marginCents";
  const isPct = metric === "marginPct";

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Performance por loja</h3>
        <Tabs value={metric} onValueChange={(v) => onMetricChange(v as StoreMetric)}>
          <TabsList className="h-8 flex-wrap">
            {(Object.keys(STORE_METRIC_LABELS) as StoreMetric[]).map((key) => (
              <TabsTrigger key={key} value={key} className="text-xs">
                {STORE_METRIC_LABELS[key]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <ChartContainer config={storeChartConfig} className="h-80 w-full">
        <BarChart data={data} margin={{ left: 8, right: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="store" tickLine={false} axisLine={false} tickMargin={8} interval={0} angle={-40} textAnchor="end" height={90} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(v: number) => (isMoney ? compactCurrency.format(v) : isPct ? `${v.toFixed(0)}%` : String(v))}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) => (isMoney ? currency.format(Number(value)) : isPct ? `${Number(value).toFixed(1)}%` : String(value))}
              />
            }
          />
          <Bar dataKey="value" fill="var(--color-value)" radius={4} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}

type HeatmapMetric = "revenue" | "baskets" | "quantity";
const HEATMAP_LABELS: Record<HeatmapMetric, string> = { revenue: "Receita", baskets: "Transações", quantity: "Quantidade" };

function SalesHeatmap({ okTransactions, metric, onMetricChange }: { okTransactions: SalesTabProps["okCurrent"]; metric: HeatmapMetric; onMetricChange: (m: HeatmapMetric) => void }) {
  const cells = useMemo(() => heatmapData(okTransactions, metric), [okTransactions, metric]);
  const summary = useMemo(() => summarizeHeatmap(cells), [cells]);
  const maxValue = Math.max(1, ...cells.map((c) => c.value));

  const hours = [6, 8, 10, 12, 14, 16, 18, 20, 22];

  if (okTransactions.every((t) => !t.occurred_at)) {
    return <p className="text-sm text-muted-foreground">Sem horário de transação disponível para este período.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Vendas por dia da semana e horário</h3>
        <Tabs value={metric} onValueChange={(v) => onMetricChange(v as HeatmapMetric)}>
          <TabsList className="h-8">
            {(Object.keys(HEATMAP_LABELS) as HeatmapMetric[]).map((key) => (
              <TabsTrigger key={key} value={key} className="text-xs">
                {HEATMAP_LABELS[key]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-1 text-xs">
            <thead>
              <tr>
                <th className="w-8" />
                {hours.map((h) => (
                  <th key={h} className="w-9 text-center font-normal text-muted-foreground">
                    {String(h).padStart(2, "0")}h
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAY_LABELS.map((label, weekday) => (
                <tr key={label}>
                  <td className="text-right font-normal text-muted-foreground">{label}</td>
                  {hours.map((h) => {
                    const cell = cells.find((c) => c.weekday === weekday && c.hour === h);
                    const intensity = cell ? cell.value / maxValue : 0;
                    return (
                      <td key={h}>
                        <div
                          className="size-8 rounded"
                          title={cell ? `${label} ${h}h: ${cell.value}` : undefined}
                          style={{ backgroundColor: `color-mix(in oklch, var(--chart-1) ${Math.max(8, intensity * 100)}%, transparent)` }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Horário de pico</p>
            <p className="text-base font-semibold">{summary.peakHour !== null ? `${String(summary.peakHour).padStart(2, "0")}h` : "—"}</p>
            {summary.peakHourShare !== null && <p className="text-xs text-muted-foreground">{formatPct(summary.peakHourShare)} do total</p>}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Dia mais forte</p>
            <p className="text-base font-semibold">{summary.strongestDay !== null ? WEEKDAY_LABELS[summary.strongestDay] : "—"}</p>
            {summary.strongestDayShare !== null && <p className="text-xs text-muted-foreground">{formatPct(summary.strongestDayShare)} do total</p>}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Dia mais fraco</p>
            <p className="text-base font-semibold">{summary.weakestDay !== null ? WEEKDAY_LABELS[summary.weakestDay] : "—"}</p>
            {summary.weakestDayShare !== null && <p className="text-xs text-muted-foreground">{formatPct(summary.weakestDayShare)} do total</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

const CATEGORY_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function CategoryMixDonut({ rows }: { rows: ReturnType<typeof categoryMix> }) {
  const config: ChartConfig = Object.fromEntries(rows.map((r, i) => [r.category, { label: r.label, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }]));

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem vendas por categoria no período.</p>;
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-medium">Mix por categoria</h3>
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <ChartContainer config={config} className="aspect-square h-56">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent formatter={(value) => currency.format(Number(value) / 100)} />} />
            <Pie data={rows} dataKey="revenueCents" nameKey="label" innerRadius={50} outerRadius={80} strokeWidth={2}>
              {rows.map((r, i) => (
                <Cell key={r.category} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="flex flex-1 flex-col gap-2">
          {rows.map((r, i) => (
            <div key={r.category} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                {r.label}
              </div>
              <span className="tabular text-muted-foreground">
                {currency.format(r.revenueCents / 100)} · {formatPct(r.shareOfRevenue)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function OverviewTab(props: SalesTabProps) {
  const { okCurrent, okPrevious, costBySku, costBySkuPrevious, currentByStore, isNetworkScope, productBySku, isLoading, error, isEmpty, onRetry } = props;

  const [evolutionMetric, setEvolutionMetric] = useState<EvolutionMetric>("revenue");
  const [storeMetric, setStoreMetric] = useState<StoreMetric>("revenue");
  const [heatmapMetric, setHeatmapMetric] = useState<HeatmapMetric>("revenue");

  const currentStats = useMemo(() => computePeriodStats(okCurrent, costBySku), [okCurrent, costBySku]);
  const previousStats = useMemo(() => computePeriodStats(okPrevious, costBySkuPrevious), [okPrevious, costBySkuPrevious]);
  const kpis = useMemo(() => computeSalesKpis(currentStats, previousStats), [currentStats, previousStats]);

  const currentEvolution = useMemo(() => dailySeries(okCurrent, evolutionMetric, costBySku), [okCurrent, evolutionMetric, costBySku]);
  const previousEvolution = useMemo(() => dailySeries(okPrevious, evolutionMetric, costBySkuPrevious), [okPrevious, evolutionMetric, costBySkuPrevious]);

  const storeRows = useMemo(() => storePerformanceRows(currentByStore, costBySku), [currentByStore, costBySku]);
  const mix = useMemo(() => categoryMix(okCurrent, productBySku), [okCurrent, productBySku]);
  const topProducts = useMemo(() => productSalesRows(okCurrent, productBySku, costBySku).sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 10), [okCurrent, productBySku, costBySku]);

  const categoryMixByStore = useMemo(() => {
    if (!isNetworkScope) return [];
    const networkMix = mix;
    return currentByStore
      .filter((row) => row.transactions.length > 0)
      .map((row) => {
        const storeMix = categoryMix(row.transactions.filter((t) => t.result.toUpperCase() === "OK"), productBySku);
        const comparison = storeMix.map((m) => {
          const networkShare = networkMix.find((n) => n.category === m.category)?.shareOfRevenue ?? 0;
          return { category: m.category, label: m.label, storeShare: m.shareOfRevenue, networkShare, diffPp: m.shareOfRevenue - networkShare };
        });
        comparison.sort((a, b) => Math.abs(b.diffPp) - Math.abs(a.diffPp));
        return { storeId: row.store.id, storeName: row.store.name, comparison };
      });
  }, [isNetworkScope, currentByStore, mix, productBySku]);

  const affinityByStore = useMemo(() => {
    if (!isNetworkScope) return [];
    const networkRows = productSalesRows(okCurrent, productBySku, costBySku);
    return currentByStore
      .filter((row) => row.transactions.length > 0)
      .map((row) => {
        const storeRows2 = productSalesRows(row.transactions.filter((t) => t.result.toUpperCase() === "OK"), productBySku, costBySku);
        const affinity = productAffinity(storeRows2, networkRows);
        return { storeId: row.store.id, storeName: row.store.name, top: affinity[0] ?? null };
      });
  }, [isNetworkScope, currentByStore, okCurrent, productBySku, costBySku]);

  const insights = useMemo(
    () =>
      generateSalesInsights({
        current: currentStats,
        previous: previousStats,
        storeRows,
        categoryMixByStore,
        affinityByStore,
        isNetworkScope,
      }),
    [currentStats, previousStats, storeRows, categoryMixByStore, affinityByStore, isNetworkScope],
  );

  return (
    <RequestState isLoading={isLoading} error={error} isEmpty={isEmpty} emptyMessage="Sem detalhe de transação para este período — provavelmente um mês anterior ao formato de vendas por rede (ago/2026)." onRetry={onRetry}>
      <div className="flex flex-col gap-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <SalesKpiCard key={kpi.key} kpi={kpi} />
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <EvolutionChart current={currentEvolution} previous={previousEvolution} metric={evolutionMetric} onMetricChange={setEvolutionMetric} />
          {isNetworkScope && storeRows.length > 1 ? (
            <StorePerformanceChart rows={storeRows} metric={storeMetric} onMetricChange={setStoreMetric} />
          ) : (
            <CategoryMixDonut rows={mix} />
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <SalesHeatmap okTransactions={okCurrent} metric={heatmapMetric} onMetricChange={setHeatmapMetric} />
          {isNetworkScope && storeRows.length > 1 ? <CategoryMixDonut rows={mix} /> : null}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 text-sm font-medium">Top produtos</h3>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="tabular text-right">Qtd.</TableHead>
                    <TableHead className="tabular text-right">Receita</TableHead>
                    <TableHead className="tabular text-right">Margem %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topProducts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        Sem vendas no período.
                      </TableCell>
                    </TableRow>
                  ) : (
                    topProducts.map((row) => (
                      <TableRow key={row.sku}>
                        <TableCell className="max-w-[220px] truncate font-medium">{row.name}</TableCell>
                        <TableCell className="tabular text-right">{row.quantity}</TableCell>
                        <TableCell className="tabular text-right">{currency.format(row.revenueCents / 100)}</TableCell>
                        <TableCell className="tabular text-right">{row.margin.marginPct === null ? "—" : formatPct(row.margin.marginPct)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-medium">Insights do período</h3>
            <div className="flex flex-col gap-3">
              {insights.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem variações relevantes no período.</p>
              ) : (
                insights.map((insight) => (
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
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </RequestState>
  );
}
