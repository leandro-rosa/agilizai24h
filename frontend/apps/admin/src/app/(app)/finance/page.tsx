"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { CartesianGrid, ComposedChart, Line, LineChart, Bar, XAxis, YAxis } from "recharts";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { NETWORK, StorePeriodPicker, type StoreSelection } from "@/components/store-period-picker";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useGetNetworkReconciliationRangeQuery,
  useGetReconciliationSeriesQuery,
  type NetworkMonthlyTotal,
  type NetworkReconciliationRangeRow,
  type Reconciliation,
} from "@/lib/api/finance";
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetNetworkSalesRangeQuery, useGetSalesRangeQuery } from "@/lib/api/sales";
import { useGetStoresQuery, type Store } from "@/lib/api/stores";
import { formatPct, grossMarginPct, shrinkagePctOfCost, shrinkagePctOfRevenue } from "@/lib/financial-kpis";
import { defaultRange, monthsInRange, type PeriodRange } from "@/lib/period-range";
import { sumReconciliations, type ReconciliationTotals } from "@/lib/reconciliation-aggregate";
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

function LossTables({ totals, nameBySku }: { totals: ReconciliationTotals; nameBySku: Map<string, string> }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h2 className="mb-2 text-sm font-medium">Perda por motivo</h2>
        <p className="mb-2 text-xs text-muted-foreground">
          Só Validade vencida, Produto danificado e Outro motivo contam como perda — Devolução, Transferência e Uso e
          consumo tiram o produto da prateleira, mas não são perda.
        </p>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Motivo</TableHead>
                <TableHead className="tabular text-right">Qtd.</TableHead>
                <TableHead className="tabular text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {totals.loss_by_reason.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    Sem perda registrada no período.
                  </TableCell>
                </TableRow>
              ) : (
                totals.loss_by_reason.map((entry) => (
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
                    <TableCell className="tabular text-right">{currency.format(entry.value_cents / 100)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Perda por produto</h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="tabular text-right">Qtd.</TableHead>
                <TableHead className="tabular text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {totals.loss_by_sku.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    Sem perda registrada no período.
                  </TableCell>
                </TableRow>
              ) : (
                totals.loss_by_sku.map((entry) => (
                  <TableRow key={entry.sku}>
                    <TableCell>{nameBySku.get(entry.sku) ?? entry.sku}</TableCell>
                    <TableCell className="tabular text-right">{entry.quantity}</TableCell>
                    <TableCell className="tabular text-right">{currency.format(entry.value_cents / 100)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function ReasonSkuBreakdown({ totals, nameBySku }: { totals: ReconciliationTotals; nameBySku: Map<string, string> }) {
  const reasons = totals.loss_by_reason
    .filter((entry) => LOSS_COUNTING_REASONS.has(entry.reason))
    .sort((a, b) => b.value_cents - a.value_cents);

  if (reasons.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem perda registrada no período.</p>;
  }

  const maxReasonValue = Math.max(...reasons.map((r) => r.value_cents), 1);

  return (
    <div className="flex flex-col gap-4">
      {reasons.map((reason) => {
        const skus = totals.loss_by_reason_sku
          .filter((entry) => entry.reason === reason.reason)
          .sort((a, b) => b.value_cents - a.value_cents)
          .slice(0, 5);
        const maxSkuValue = Math.max(...skus.map((s) => s.value_cents), 1);
        const widthPct = Math.max(4, (reason.value_cents / maxReasonValue) * 100);

        return (
          <div key={reason.reason}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">{reasonLabel(reason.reason)}</span>
              <span className="text-muted-foreground">
                {currency.format(reason.value_cents / 100)} · {reason.quantity} un.
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-destructive" style={{ width: `${widthPct}%` }} />
            </div>

            <div className="mt-2 ml-4 flex flex-col gap-1.5 border-l pl-3">
              {skus.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem produto identificado.</p>
              ) : (
                skus.map((sku) => {
                  const skuWidthPct = Math.max(4, (sku.value_cents / maxSkuValue) * 100);
                  return (
                    <div key={sku.sku}>
                      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                        <span className="max-w-[70%] truncate">{nameBySku.get(sku.sku) ?? sku.sku}</span>
                        <span>
                          {currency.format(sku.value_cents / 100)} · {sku.quantity} un.
                        </span>
                      </div>
                      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-muted-foreground/50" style={{ width: `${skuWidthPct}%` }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StoreFinanceView({ storeId, range }: { storeId: number; range: PeriodRange }) {
  const { data: products } = useGetProductsQuery();
  const nameBySku = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products ?? []) map.set(product.sku, product.name);
    return map;
  }, [products]);

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

          <LossTables totals={totals} nameBySku={nameBySku} />
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

function NetworkStoreDetail({
  store,
  totals,
  nameBySku,
}: {
  store: Store;
  totals: ReconciliationTotals;
  nameBySku: Map<string, string>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-sm font-medium">Detalhe da perda — {store.name}</h2>

      {!totals.complete && <IncompleteBanner totals={totals} subject="Reconciliação desta loja" />}

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
        <h3 className="mb-2 text-sm font-medium">Perda por motivo — top produtos</h3>
        <ReasonSkuBreakdown totals={totals} nameBySku={nameBySku} />
      </div>
    </div>
  );
}

function NetworkFinanceView({ range }: { range: PeriodRange }) {
  const { data: stores, isLoading: loadingStores } = useGetStoresQuery();
  const { data, isLoading: loadingRows, error, refetch } = useGetNetworkReconciliationRangeQuery(
    { stores: stores ?? [], range },
    { skip: !stores },
  );
  const rows = data?.rows;
  const monthlyTotals = data?.monthlyTotals;
  const { data: salesRows } = useGetNetworkSalesRangeQuery({ stores: stores ?? [], range }, { skip: !stores });
  const { data: products } = useGetProductsQuery();

  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<NetworkSortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const nameBySku = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products ?? []) map.set(product.sku, product.name);
    return map;
  }, [products]);

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

  // Default selection: the store with the highest loss% of restocked value
  // among stores with data — surfaces the worst automatically, the same
  // "clique numa loja ou eu escolho a pior" behavior as the reference.
  const defaultStoreId = useMemo(() => {
    if (rowsWithData.length === 0) return null;
    const worst = [...rowsWithData].sort((a, b) => {
      const pctA = shrinkagePctOfCost(a.totals.loss_value_cents, a.totals.restocked_value_cents) ?? -1;
      const pctB = shrinkagePctOfCost(b.totals.loss_value_cents, b.totals.restocked_value_cents) ?? -1;
      return pctB - pctA;
    })[0];
    return worst.store.id;
  }, [rowsWithData]);

  const activeStoreId =
    selectedStoreId !== null && rowsWithData.some((row) => row.store.id === selectedStoreId)
      ? selectedStoreId
      : defaultStoreId;
  const activeRow = rowsWithData.find((row) => row.store.id === activeStoreId) ?? null;

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
                      <TableRow
                        key={store.id}
                        data-state={store.id === activeStoreId ? "selected" : undefined}
                        className="cursor-pointer"
                        onClick={() => setSelectedStoreId(store.id)}
                      >
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
                            <Badge variant="secondary">Completo</Badge>
                          ) : (
                            <Badge className="border border-warning/30 bg-warning/15 text-warning">Pendente</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {activeRow && <NetworkStoreDetail store={activeRow.store} totals={activeRow.totals} nameBySku={nameBySku} />}
        </div>
      )}
    </RequestState>
  );
}

export default function FinancePage() {
  const [storeId, setStoreId] = useState<StoreSelection>(null);
  const [range, setRange] = useState<PeriodRange>(defaultRange());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Financeiro" description="A reconciliação mensal: valor abastecido, CMV, sobra e perda real." />

      <StorePeriodPicker storeId={storeId} onStoreIdChange={setStoreId} range={range} onRangeChange={setRange} allowNetwork />

      {storeId === null ? (
        <p className="text-sm text-muted-foreground">
          Selecione uma loja, ou &ldquo;Rede (todas as lojas)&rdquo;, para ver a reconciliação do período.
        </p>
      ) : storeId === NETWORK ? (
        <NetworkFinanceView range={range} />
      ) : (
        <StoreFinanceView storeId={storeId} range={range} />
      )}
    </div>
  );
}
