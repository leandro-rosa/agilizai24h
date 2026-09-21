"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, XAxis, YAxis } from "recharts";

import { LossTab } from "@/components/supply/loss-tab";
import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { NETWORK, StorePeriodPicker, type StoreSelection } from "@/components/store-period-picker";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useGetNetworkReconciliationRangeQuery,
  useGetReconciliationSeriesQuery,
  type NetworkMonthlyTotal,
  type NetworkReconciliationRangeRow,
  type Reconciliation,
} from "@/lib/api/finance";
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetNetworkSalesRangeQuery, useGetSalesRangeQuery } from "@/lib/api/sales";
import { useGetNetworkSupplyRangeQuery, useGetSupplyRangeQuery } from "@/lib/api/supply";
import { useGetStoresQuery } from "@/lib/api/stores";
import { formatPct, grossMarginPct, shrinkagePctOfCost, shrinkagePctOfRevenue } from "@/lib/financial-kpis";
import { defaultRange, monthsInRange, type PeriodRange } from "@/lib/period-range";
import { aggregateAcrossStores, sumReconciliations, type ReconciliationTotals } from "@/lib/reconciliation-aggregate";
import { LOSS_COUNTING_REASONS, reasonLabel } from "@/lib/removal-reasons";
import { unvaluedReasonLabel } from "@/lib/unvalued-reasons";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compactCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact" });

function Figure({ label, cents, incomplete }: { label: string; cents: number; incomplete?: boolean }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="tabular flex items-baseline gap-2 text-2xl font-semibold">
        {currency.format(cents / 100)}
        {incomplete && (
          <span title="Calculado a partir de uma reconciliação incompleta — não é uma cifra final.">
            <AlertTriangle className="size-4 text-warning" />
          </span>
        )}
      </CardContent>
    </Card>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xl font-semibold">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

// Loss gets `--destructive` rather than a chart slot: it is the one figure
// that has to read as "bad" on sight, and the chart ramp carries no such
// meaning. chart-4/chart-5 exist for categorical separation only (see
// DESIGN.md) — they are not semantic and must not be used for loss.
const trendConfig: ChartConfig = {
  restocked_value_cents: { label: "Abastecido", color: "var(--chart-1)" },
  cogs_cents: { label: "CMV", color: "var(--chart-2)" },
  remaining_value_cents: { label: "Sobra", color: "var(--chart-3)" },
  loss_value_cents: { label: "Perda", color: "var(--destructive)" },
};

function FinanceTrendChart({ series }: { series: Reconciliation[] }) {
  const data = series.map((r) => ({
    period: r.period,
    restocked_value_cents: r.restocked_value_cents / 100,
    cogs_cents: r.cogs_cents / 100,
    remaining_value_cents: r.remaining_value_cents / 100,
    loss_value_cents: r.loss_value_cents / 100,
  }));

  return (
    <ChartContainer config={trendConfig} className="h-64 w-full">
      <LineChart data={data} margin={{ left: 8, right: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value: number) => compactCurrency.format(value)}
        />
        <ChartTooltip content={<ChartTooltipContent formatter={(value) => currency.format(Number(value))} />} />
        {Object.entries(trendConfig).map(([key, cfg]) => (
          <Line key={key} type="monotone" dataKey={key} stroke={cfg.color} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

const networkMonthlyTrendConfig: ChartConfig = {
  restocked_value_cents: { label: "Abastecido", color: "var(--chart-1)" },
  cogs_cents: { label: "CMV", color: "var(--chart-2)" },
  loss_pct: { label: "Perda %", color: "var(--destructive)" },
};

function NetworkMonthlyTrendChart({ monthlyTotals }: { monthlyTotals: NetworkMonthlyTotal[] }) {
  const data = monthlyTotals.map((m) => ({
    period: m.period,
    restocked_value_cents: m.restocked_value_cents / 100,
    cogs_cents: m.cogs_cents / 100,
    loss_pct: (shrinkagePctOfCost(m.loss_value_cents, m.restocked_value_cents) ?? 0) * 100,
  }));

  return (
    <ChartContainer config={networkMonthlyTrendConfig} className="h-72 w-full">
      <ComposedChart data={data} margin={{ left: 8, right: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          yAxisId="value"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value: number) => compactCurrency.format(value)}
        />
        <YAxis
          yAxisId="pct"
          orientation="right"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value: number) => `${value.toFixed(0)}%`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) =>
                name === "loss_pct" ? `${Number(value).toFixed(1)}%` : currency.format(Number(value))
              }
            />
          }
        />
        <Bar yAxisId="value" dataKey="restocked_value_cents" fill="var(--color-restocked_value_cents)" radius={4} />
        <Bar yAxisId="value" dataKey="cogs_cents" fill="var(--color-cogs_cents)" radius={4} />
        <Line yAxisId="pct" type="monotone" dataKey="loss_pct" stroke="var(--color-loss_pct)" strokeWidth={2} dot />
      </ComposedChart>
    </ChartContainer>
  );
}

function IncompleteBanner({ totals, subject }: { totals: ReconciliationTotals; subject: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/15 px-3 py-2 text-sm text-warning">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-medium">{subject} incompleto(a) — as cifras abaixo não são finais.</p>
        {totals.monthsMissing.length > 0 && (
          <p>{totals.monthsMissing.length} mês(es) do intervalo sem reconciliação: {totals.monthsMissing.join(", ")}</p>
        )}
        {totals.unvalued.length > 0 && (
          <div>
            <p>{totals.unvalued.length} SKU(s) sem custo:</p>
            <ul className="ml-4 list-disc">
              {totals.unvalued.map((u, index) => (
                <li key={`${u.sku}-${index}`}>{`${u.sku} — ${unvaluedReasonLabel(u.reason)}`}</li>
              ))}
            </ul>
          </div>
        )}
        {totals.inconsistent_stock.length > 0 && (
          <p>
            {totals.inconsistent_stock.length} SKU(s) com saldo inconsistente — estoque derivado ficou negativo, sinal
            de movimento perdido ou dobrado no dado de origem: {totals.inconsistent_stock.join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}

function StoreReconciliationView({ storeId, range }: { storeId: number; range: PeriodRange }) {
  const { data: series, isLoading, error, refetch } = useGetReconciliationSeriesQuery({ storeId });
  const { data: salesRange } = useGetSalesRangeQuery({ storeId, range });

  const totals = useMemo(() => (series ? sumReconciliations(series, range) : null), [series, range]);
  const revenueCents = salesRange?.totalRevenueCents ?? 0;
  const seriesInRange = useMemo(
    () => (series ?? []).filter((r) => monthsInRange(range).includes(r.period)),
    [series, range],
  );

  const isEmpty = !isLoading && !error && (totals?.monthsWithData ?? 0) === 0;

  return (
    <RequestState
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="Esta loja não tem reconciliação em nenhum mês do intervalo selecionado."
      onRetry={refetch}
    >
      {totals && !isEmpty && (
        <div className="flex flex-col gap-6">
          {!totals.complete && <IncompleteBanner totals={totals} subject="Reconciliação" />}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Figure label="Valor abastecido" cents={totals.restocked_value_cents} incomplete={!totals.complete} />
            <Figure label="CMV" cents={totals.cogs_cents} incomplete={!totals.complete} />
            <Figure label="Valor da sobra" cents={totals.remaining_value_cents} incomplete={!totals.complete} />
            <Figure label="Perda real" cents={totals.loss_value_cents} incomplete={!totals.complete} />
            <Figure
              label="Ajuste de inventário"
              cents={totals.unclassified_stock_adjustment_value_cents}
              incomplete={!totals.complete}
            />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-medium">Indicadores</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Receita líquida" value={currency.format(revenueCents / 100)} hint="Fonte: vendas do período" />
              <KpiCard
                label="Margem bruta"
                value={formatPct(grossMarginPct(revenueCents, totals.cogs_cents))}
                hint="(Receita − CMV) / Receita"
              />
              <KpiCard
                label="Perda sobre receita"
                value={formatPct(shrinkagePctOfRevenue(totals.loss_value_cents, revenueCents))}
                hint="Visão de P&L"
              />
              <KpiCard
                label="Perda sobre custo abastecido"
                value={formatPct(shrinkagePctOfCost(totals.loss_value_cents, totals.restocked_value_cents))}
                hint="Visão operacional — comparável entre lojas com tickets diferentes"
              />
            </div>
          </div>

          {seriesInRange.length > 1 && (
            <div>
              <h2 className="mb-2 text-sm font-medium">Evolução mensal</h2>
              <FinanceTrendChart series={seriesInRange} />
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            Perda por motivo, por produto e a investigação detalhada estão na aba{" "}
            <span className="font-medium text-foreground">Perdas</span>.
          </p>
        </div>
      )}
    </RequestState>
  );
}

type NetworkSortKey = "store" | "revenue" | "restocked" | "cogs" | "remaining" | "loss" | "lossPct";

function sortValueFor(
  row: NetworkReconciliationRangeRow,
  revenueByStore: Map<number, number>,
  key: NetworkSortKey,
): number | string {
  switch (key) {
    case "store":
      return row.store.name;
    case "revenue":
      return revenueByStore.get(row.store.id) ?? 0;
    case "restocked":
      return row.totals.restocked_value_cents;
    case "cogs":
      return row.totals.cogs_cents;
    case "remaining":
      return row.totals.remaining_value_cents;
    case "loss":
      return row.totals.loss_value_cents;
    case "lossPct":
      return shrinkagePctOfCost(row.totals.loss_value_cents, row.totals.restocked_value_cents) ?? -1;
  }
}

function SortableHead({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: NetworkSortKey;
  activeKey: NetworkSortKey;
  dir: "asc" | "desc";
  onSort: (key: NetworkSortKey) => void;
  className?: string;
}) {
  const isActive = sortKey === activeKey;
  return (
    <TableHead className={className}>
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        {isActive && <span className="text-xs">{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </TableHead>
  );
}

function NetworkReconciliationView({ range }: { range: PeriodRange }) {
  const { data: stores, isLoading: loadingStores } = useGetStoresQuery();
  const { data, isLoading: loadingRows, error, refetch } = useGetNetworkReconciliationRangeQuery(
    { stores: stores ?? [], range },
    { skip: !stores },
  );
  const rows = data?.rows;
  const monthlyTotals = data?.monthlyTotals;
  const { data: salesRows } = useGetNetworkSalesRangeQuery({ stores: stores ?? [], range }, { skip: !stores });

  const [sortKey, setSortKey] = useState<NetworkSortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const revenueByStore = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of salesRows ?? []) map.set(row.storeId, row.totalRevenueCents);
    return map;
  }, [salesRows]);

  const rowsWithData = useMemo(() => (rows ?? []).filter((row) => row.totals.monthsWithData > 0), [rows]);

  const sortedRows = useMemo(() => {
    const withValue = rowsWithData.map((row) => ({ row, value: sortValueFor(row, revenueByStore, sortKey) }));
    withValue.sort((a, b) =>
      typeof a.value === "string" || typeof b.value === "string"
        ? String(a.value).localeCompare(String(b.value))
        : (a.value as number) - (b.value as number),
    );
    if (sortDir === "desc") withValue.reverse();
    return withValue.map((entry) => entry.row);
  }, [rowsWithData, revenueByStore, sortKey, sortDir]);

  function toggleSort(key: NetworkSortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "store" ? "asc" : "desc");
    }
  }

  const networkTotals = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    return rows.reduce<{
      restocked_value_cents: number;
      cogs_cents: number;
      remaining_value_cents: number;
      loss_value_cents: number;
      unclassified_stock_adjustment_value_cents: number;
      complete: boolean;
      incompleteStores: { id: number; name: string }[];
      reconciledStores: number;
    }>(
      (acc, row) => {
        const hasData = row.totals.monthsWithData > 0;
        return {
          restocked_value_cents: acc.restocked_value_cents + row.totals.restocked_value_cents,
          cogs_cents: acc.cogs_cents + row.totals.cogs_cents,
          remaining_value_cents: acc.remaining_value_cents + row.totals.remaining_value_cents,
          loss_value_cents: acc.loss_value_cents + row.totals.loss_value_cents,
          unclassified_stock_adjustment_value_cents:
            acc.unclassified_stock_adjustment_value_cents + row.totals.unclassified_stock_adjustment_value_cents,
          complete: acc.complete && (!hasData || row.totals.complete),
          incompleteStores:
            hasData && !row.totals.complete ? [...acc.incompleteStores, { id: row.store.id, name: row.store.name }] : acc.incompleteStores,
          reconciledStores: acc.reconciledStores + (hasData ? 1 : 0),
        };
      },
      {
        restocked_value_cents: 0,
        cogs_cents: 0,
        remaining_value_cents: 0,
        loss_value_cents: 0,
        unclassified_stock_adjustment_value_cents: 0,
        complete: true,
        incompleteStores: [],
        reconciledStores: 0,
      },
    );
  }, [rows]);

  const networkRevenueCents = useMemo(
    () => (salesRows ?? []).reduce((sum, row) => sum + row.totalRevenueCents, 0),
    [salesRows],
  );

  const isEmpty = !loadingStores && !loadingRows && !error && (networkTotals?.reconciledStores ?? 0) === 0;

  return (
    <RequestState
      isLoading={loadingStores || loadingRows}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="Nenhuma loja foi reconciliada em nenhum mês do intervalo selecionado."
      onRetry={refetch}
    >
      {networkTotals && !isEmpty && (
        <div className="flex flex-col gap-6">
          {!networkTotals.complete && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/15 px-3 py-2 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">
                  Total da rede incompleto — {networkTotals.incompleteStores.length} loja(s) com pendência.
                </p>
                <p>Uma cifra que soma uma loja sem preço ou com saldo inconsistente não é uma cifra final.</p>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Figure label="Valor abastecido" cents={networkTotals.restocked_value_cents} incomplete={!networkTotals.complete} />
            <Figure label="CMV" cents={networkTotals.cogs_cents} incomplete={!networkTotals.complete} />
            <Figure label="Valor da sobra" cents={networkTotals.remaining_value_cents} incomplete={!networkTotals.complete} />
            <Figure label="Perda real" cents={networkTotals.loss_value_cents} incomplete={!networkTotals.complete} />
            <Figure
              label="Ajuste de inventário"
              cents={networkTotals.unclassified_stock_adjustment_value_cents}
              incomplete={!networkTotals.complete}
            />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-medium">Indicadores da rede</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Receita líquida"
                value={currency.format(networkRevenueCents / 100)}
                hint={`${networkTotals.reconciledStores} loja(s) reconciliada(s)`}
              />
              <KpiCard label="Margem bruta" value={formatPct(grossMarginPct(networkRevenueCents, networkTotals.cogs_cents))} />
              <KpiCard
                label="Perda sobre receita"
                value={formatPct(shrinkagePctOfRevenue(networkTotals.loss_value_cents, networkRevenueCents))}
              />
              <KpiCard
                label="Perda sobre custo abastecido"
                value={formatPct(shrinkagePctOfCost(networkTotals.loss_value_cents, networkTotals.restocked_value_cents))}
              />
            </div>
          </div>

          {monthlyTotals && monthlyTotals.length > 1 && (
            <div>
              <h2 className="mb-2 text-sm font-medium">Evolução mensal da rede</h2>
              <NetworkMonthlyTrendChart monthlyTotals={monthlyTotals} />
            </div>
          )}

          <div>
            <h2 className="mb-2 text-sm font-medium">Lojas</h2>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead label="Loja" sortKey="store" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortableHead label="Receita" sortKey="revenue" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="tabular text-right" />
                    <SortableHead label="Abastecido" sortKey="restocked" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="tabular text-right" />
                    <SortableHead label="CMV" sortKey="cogs" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="tabular text-right" />
                    <SortableHead label="Sobra" sortKey="remaining" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="tabular text-right" />
                    <SortableHead label="Perda" sortKey="loss" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="tabular text-right" />
                    <SortableHead label="Perda %" sortKey="lossPct" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="tabular text-right" />
                    <TableHead>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.map(({ store, totals }) => {
                    const lossPct = shrinkagePctOfCost(totals.loss_value_cents, totals.restocked_value_cents);
                    const barPct = Math.min((lossPct ?? 0) / 0.2, 1) * 100;
                    return (
                      <TableRow key={store.id}>
                        <TableCell className="font-medium">{store.name}</TableCell>
                        <TableCell className="tabular text-right">{currency.format((revenueByStore.get(store.id) ?? 0) / 100)}</TableCell>
                        <TableCell className="tabular text-right">{currency.format(totals.restocked_value_cents / 100)}</TableCell>
                        <TableCell className="tabular text-right">{currency.format(totals.cogs_cents / 100)}</TableCell>
                        <TableCell className="tabular text-right">{currency.format(totals.remaining_value_cents / 100)}</TableCell>
                        <TableCell className="tabular text-right">{currency.format(totals.loss_value_cents / 100)}</TableCell>
                        <TableCell className="tabular text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-destructive"
                                style={{ width: `${barPct}%`, opacity: 0.3 + 0.7 * (barPct / 100) }}
                              />
                            </div>
                            {formatPct(lossPct)}
                          </div>
                        </TableCell>
                        <TableCell>
                          {totals.complete ? (
                            <StatusBadge tone="positive">Completo</StatusBadge>
                          ) : (
                            <StatusBadge tone="attention">Pendente</StatusBadge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Perda por motivo, por produto e a investigação detalhada por loja estão na aba{" "}
            <span className="font-medium text-foreground">Perdas</span>.
          </p>
        </div>
      )}
    </RequestState>
  );
}

function StoreSupplyMovementsView({ storeId, range }: { storeId: number; range: PeriodRange }) {
  const { data: products } = useGetProductsQuery();
  const nameBySku = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products ?? []) map.set(product.sku, product.name);
    return map;
  }, [products]);

  const { data, isLoading, error, refetch } = useGetSupplyRangeQuery({ storeId, range });

  const isEmpty = !data || (data.restocks.length === 0 && data.removals.length === 0 && data.adjustments.length === 0);

  return (
    <RequestState
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="Sem movimentos de abastecimento no período selecionado."
      onRetry={refetch}
    >
      {data && data.monthsWithNoData.length > 0 && (
        <p className="mb-3 text-xs text-muted-foreground">Sem abastecimento importado para: {data.monthsWithNoData.join(", ")}.</p>
      )}
      <Tabs defaultValue="restocks">
        <TabsList>
          <TabsTrigger value="restocks">Abastecido ({data?.restocks.length ?? 0})</TabsTrigger>
          <TabsTrigger value="removals">Remoções ({data?.removals.length ?? 0})</TabsTrigger>
          <TabsTrigger value="adjustments">Ajustes ({data?.adjustments.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="restocks">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="tabular text-right">Qtd. abastecida</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.restocks.map((row) => (
                  <TableRow key={row.sku}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.sku}</TableCell>
                    <TableCell className="font-medium">{nameBySku.get(row.sku) ?? row.sku}</TableCell>
                    <TableCell className="tabular text-right">{row.quantity_restocked}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="removals">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Conta como perda?</TableHead>
                  <TableHead className="tabular text-right">Qtd. removida</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.removals.map((row, index) => (
                  <TableRow key={`${row.sku}-${row.reason}-${index}`}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.sku}</TableCell>
                    <TableCell className="font-medium">{nameBySku.get(row.sku) ?? row.sku}</TableCell>
                    <TableCell>{row.reason_label}</TableCell>
                    <TableCell>
                      {row.counts_as_loss ? (
                        <Badge className="border border-destructive/30 bg-destructive/10 text-destructive">Sim</Badge>
                      ) : (
                        <Badge variant="secondary">Não</Badge>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">{row.quantity_removed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="adjustments">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="tabular text-right">Ajuste</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.adjustments.map((row) => (
                  <TableRow key={row.sku}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.sku}</TableCell>
                    <TableCell className="font-medium">{nameBySku.get(row.sku) ?? row.sku}</TableCell>
                    <TableCell className={`text-right ${row.quantity < 0 ? "text-destructive" : ""}`}>
                      {row.quantity > 0 ? `+${row.quantity}` : row.quantity}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </RequestState>
  );
}

const supplyComparisonConfig: ChartConfig = { restocked: { label: "Abastecido (qtd.)", color: "var(--chart-1)" } };

function NetworkSupplyMovementsView({ range }: { range: PeriodRange }) {
  const { data: stores, isLoading: loadingStores } = useGetStoresQuery();
  const { data: rows, isLoading: loadingRows, error, refetch } = useGetNetworkSupplyRangeQuery(
    { stores: stores ?? [], range },
    { skip: !stores },
  );

  const rowsWithData = useMemo(
    () => (rows ?? []).filter((row) => row.restocks.length > 0 || row.removals.length > 0 || row.adjustments.length > 0),
    [rows],
  );

  const totals = useMemo(() => {
    let restocked = 0;
    let removedLoss = 0;
    for (const row of rowsWithData) {
      restocked += row.restocks.reduce((sum, r) => sum + r.quantity_restocked, 0);
      removedLoss += row.removals
        .filter((r) => LOSS_COUNTING_REASONS.has(r.reason))
        .reduce((sum, r) => sum + r.quantity_removed, 0);
    }
    return { restocked, removedLoss };
  }, [rowsWithData]);

  const byReasonNetwork = useMemo(() => {
    const map = new Map<string, { reason: string; quantity: number }>();
    for (const row of rowsWithData) {
      for (const removal of row.removals) {
        const existing = map.get(removal.reason);
        if (existing) existing.quantity += removal.quantity_removed;
        else map.set(removal.reason, { reason: removal.reason, quantity: removal.quantity_removed });
      }
    }
    return [...map.values()].sort((a, b) => b.quantity - a.quantity);
  }, [rowsWithData]);

  const chartData = useMemo(
    () =>
      rowsWithData
        .map((row) => {
          const store = (stores ?? []).find((s) => s.id === row.storeId);
          return { store: store?.name ?? String(row.storeId), restocked: row.restocks.reduce((sum, r) => sum + r.quantity_restocked, 0) };
        })
        .sort((a, b) => b.restocked - a.restocked),
    [rowsWithData, stores],
  );

  const isEmpty = !loadingStores && !loadingRows && !error && rowsWithData.length === 0;

  return (
    <RequestState
      isLoading={loadingStores || loadingRows}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="Nenhum movimento de abastecimento foi importado em nenhuma loja no período selecionado."
      onRetry={refetch}
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">Total abastecido (rede)</CardTitle>
            </CardHeader>
            <CardContent className="tabular text-2xl font-semibold">{totals.restocked} un.</CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">Total removido por perda (rede)</CardTitle>
            </CardHeader>
            <CardContent className="tabular text-2xl font-semibold">{totals.removedLoss} un.</CardContent>
          </Card>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium">Abastecido por loja</h2>
          <ChartContainer config={supplyComparisonConfig} className="h-80 w-full">
            <BarChart data={chartData} margin={{ left: 8, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="store" tickLine={false} axisLine={false} tickMargin={8} interval={0} angle={-40} textAnchor="end" height={80} />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="restocked" fill="var(--color-restocked)" radius={4} />
            </BarChart>
          </ChartContainer>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium">Remoções por motivo — rede</h2>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Motivo</TableHead>
                  <TableHead className="tabular text-right">Qtd. removida</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byReasonNetwork.map((entry) => (
                  <TableRow key={entry.reason}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {reasonLabel(entry.reason)}
                        {LOSS_COUNTING_REASONS.has(entry.reason) && (
                          <Badge className="border border-destructive/30 bg-destructive/10 text-destructive">Perda</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-right">{entry.quantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </RequestState>
  );
}

function OverviewView({ storeId, range }: { storeId: StoreSelection; range: PeriodRange }) {
  const { data: stores } = useGetStoresQuery();
  const scopedStores = useMemo(() => {
    if (!stores) return [];
    return storeId === NETWORK ? stores : stores.filter((s) => s.id === storeId);
  }, [stores, storeId]);
  const skip = scopedStores.length === 0;

  const {
    data: reconciliation,
    isLoading: loadingRecon,
    error,
    refetch,
  } = useGetNetworkReconciliationRangeQuery({ stores: scopedStores, range }, { skip });
  const { data: salesRows, isLoading: loadingSales } = useGetNetworkSalesRangeQuery({ stores: scopedStores, range }, { skip });
  const { data: supplyRows, isLoading: loadingSupply } = useGetNetworkSupplyRangeQuery({ stores: scopedStores, range }, { skip });

  const rowsWithData = useMemo(
    () => (reconciliation?.rows ?? []).filter((row) => row.totals.monthsWithData > 0),
    [reconciliation],
  );
  const totals = useMemo(() => aggregateAcrossStores(rowsWithData.map((row) => row.totals)), [rowsWithData]);
  const revenueCents = useMemo(() => (salesRows ?? []).reduce((sum, row) => sum + row.totalRevenueCents, 0), [salesRows]);
  const restockedUnits = useMemo(
    () => (supplyRows ?? []).reduce((sum, row) => sum + row.restocks.reduce((s, r) => s + r.quantity_restocked, 0), 0),
    [supplyRows],
  );
  const reconciliationStatus =
    rowsWithData.length === 0 ? "Sem dados" : rowsWithData.every((row) => row.totals.complete) ? "Completa" : "Pendente";

  const isLoading = loadingRecon || loadingSales || loadingSupply;
  const isEmpty = !isLoading && !error && rowsWithData.length === 0 && restockedUnits === 0;

  return (
    <RequestState
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="Sem abastecimento ou reconciliação no período selecionado."
      onRetry={refetch}
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Receita líquida" value={currency.format(revenueCents / 100)} hint="Fonte: vendas do período" />
          <KpiCard label="Total abastecido" value={`${restockedUnits} un.`} />
          <KpiCard
            label="Perda no período"
            value={currency.format(totals.loss_value_cents / 100)}
            hint={revenueCents > 0 ? `${formatPct(shrinkagePctOfRevenue(totals.loss_value_cents, revenueCents))} das vendas` : undefined}
          />
          <KpiCard label="Reconciliação" value={reconciliationStatus} />
        </div>
        <p className="text-sm text-muted-foreground">
          Veja o movimento bruto em <span className="font-medium text-foreground">Reposição</span>, a investigação de perda em{" "}
          <span className="font-medium text-foreground">Perdas</span>, e o fechamento mensal (abastecido, CMV, sobra e perda
          real) em <span className="font-medium text-foreground">Reconciliação</span>.
        </p>
      </div>
    </RequestState>
  );
}

export default function SupplyPage() {
  const [storeId, setStoreId] = useState<StoreSelection>(null);
  const [range, setRange] = useState<PeriodRange>(defaultRange());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Abastecimento"
        description="Reposição, investigação de perdas e a reconciliação mensal (valor abastecido, CMV, sobra e perda real), por loja e período."
      />

      <StorePeriodPicker storeId={storeId} onStoreIdChange={setStoreId} range={range} onRangeChange={setRange} allowNetwork />

      {storeId === null ? (
        <p className="text-sm text-muted-foreground">
          Selecione uma loja, ou &ldquo;Rede (todas as lojas)&rdquo;, para ver o abastecimento do período.
        </p>
      ) : (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Visão geral</TabsTrigger>
            <TabsTrigger value="restock">Reposição</TabsTrigger>
            <TabsTrigger value="losses">Perdas</TabsTrigger>
            <TabsTrigger value="reconciliation">Reconciliação</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewView storeId={storeId} range={range} />
          </TabsContent>

          <TabsContent value="restock">
            {storeId === NETWORK ? <NetworkSupplyMovementsView range={range} /> : <StoreSupplyMovementsView storeId={storeId} range={range} />}
          </TabsContent>

          <TabsContent value="losses">
            <LossTab storeId={storeId} range={range} />
          </TabsContent>

          <TabsContent value="reconciliation">
            {storeId === NETWORK ? <NetworkReconciliationView range={range} /> : <StoreReconciliationView storeId={storeId} range={range} />}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
