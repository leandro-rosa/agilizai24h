"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { CartesianGrid, Line, LineChart, Bar, BarChart, XAxis, YAxis } from "recharts";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { NETWORK, StorePeriodPicker, currentPeriod, type StoreSelection } from "@/components/store-period-picker";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useGetNetworkReconciliationsQuery,
  useGetReconciliationQuery,
  useGetReconciliationSeriesQuery,
  useGetRollupQuery,
  type Reconciliation,
} from "@/lib/api/finance";
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetNetworkSalesTotalsQuery, useGetSalesTotalsQuery } from "@/lib/api/sales";
import { useGetStoresQuery } from "@/lib/api/stores";
import { formatPct, grossMarginPct, shrinkagePctOfCost, shrinkagePctOfRevenue } from "@/lib/financial-kpis";
import { LOSS_COUNTING_REASONS, reasonLabel } from "@/lib/removal-reasons";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compactCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact" });

function Figure({ label, cents, incomplete }: { label: string; cents: number; incomplete?: boolean }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-baseline gap-2 text-2xl font-semibold">
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

// chart-4/chart-5 are near-zero-chroma greys in this theme (meant for
// de-emphasized series) — loss gets `--destructive` instead so the one
// figure that should read as "bad" doesn't blend into the background.
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

function StoreFinanceView({ storeId, period }: { storeId: number; period: string }) {
  const { data: products } = useGetProductsQuery();
  const nameBySku = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products ?? []) map.set(product.sku, product.name);
    return map;
  }, [products]);

  const { data: reconciliation, isLoading, error, refetch } = useGetReconciliationQuery({ storeId, period });
  const { data: salesTotals } = useGetSalesTotalsQuery({ storeId, period });
  const { data: series } = useGetReconciliationSeriesQuery({ storeId });

  const notComputed = error && "status" in error && error.status === 404;
  const revenueCents = salesTotals?.total_revenue_cents ?? 0;

  return (
    <RequestState
      isLoading={isLoading}
      error={notComputed ? undefined : error}
      isEmpty={notComputed}
      emptyMessage="Esta loja ainda não tem reconciliação para este período."
      onRetry={refetch}
    >
      {reconciliation && (
        <div className="flex flex-col gap-6">
          {!reconciliation.complete && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/15 px-3 py-2 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Reconciliação incompleta — as cifras abaixo não são finais.</p>
                {reconciliation.unvalued.length > 0 && (
                  <p>
                    {reconciliation.unvalued.length} SKU(s) sem custo: {reconciliation.unvalued.map((u) => u.sku).join(", ")}
                  </p>
                )}
                {reconciliation.inconsistent_stock.length > 0 && (
                  <p>
                    {reconciliation.inconsistent_stock.length} SKU(s) com saldo inconsistente — estoque derivado ficou
                    negativo, sinal de movimento perdido ou dobrado no dado de origem:{" "}
                    {reconciliation.inconsistent_stock.join(", ")}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Figure label="Valor abastecido" cents={reconciliation.restocked_value_cents} incomplete={!reconciliation.complete} />
            <Figure label="CMV" cents={reconciliation.cogs_cents} incomplete={!reconciliation.complete} />
            <Figure label="Valor da sobra" cents={reconciliation.remaining_value_cents} incomplete={!reconciliation.complete} />
            <Figure label="Perda real" cents={reconciliation.loss_value_cents} incomplete={!reconciliation.complete} />
            <Figure
              label="Ajuste de inventário"
              cents={reconciliation.unclassified_stock_adjustment_value_cents}
              incomplete={!reconciliation.complete}
            />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-medium">Indicadores</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Receita líquida" value={currency.format(revenueCents / 100)} hint="Fonte: vendas do período" />
              <KpiCard
                label="Margem bruta"
                value={formatPct(grossMarginPct(revenueCents, reconciliation.cogs_cents))}
                hint="(Receita − CMV) / Receita"
              />
              <KpiCard
                label="Perda sobre receita"
                value={formatPct(shrinkagePctOfRevenue(reconciliation.loss_value_cents, revenueCents))}
                hint="Visão de P&L"
              />
              <KpiCard
                label="Perda sobre custo abastecido"
                value={formatPct(shrinkagePctOfCost(reconciliation.loss_value_cents, reconciliation.restocked_value_cents))}
                hint="Visão operacional — comparável entre lojas com tickets diferentes"
              />
            </div>
          </div>

          {series && series.length > 1 && (
            <div>
              <h2 className="mb-2 text-sm font-medium">Evolução mensal</h2>
              <FinanceTrendChart series={series} />
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h2 className="mb-2 text-sm font-medium">Perda por motivo</h2>
              <p className="mb-2 text-xs text-muted-foreground">
                Só Validade vencida, Produto danificado e Outro motivo contam como perda — Devolução, Transferência e
                Uso e consumo tiram o produto da prateleira, mas não são perda.
              </p>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Motivo</TableHead>
                      <TableHead className="text-right">Qtd.</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reconciliation.loss_by_reason.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground">
                          Sem perda registrada no período.
                        </TableCell>
                      </TableRow>
                    ) : (
                      reconciliation.loss_by_reason.map((entry) => (
                        <TableRow key={entry.reason}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {reasonLabel(entry.reason)}
                              {LOSS_COUNTING_REASONS.has(entry.reason) && (
                                <Badge className="border border-destructive/30 bg-destructive/10 text-destructive">Perda</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{entry.quantity}</TableCell>
                          <TableCell className="text-right">{currency.format(entry.value_cents / 100)}</TableCell>
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
                      <TableHead className="text-right">Qtd.</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reconciliation.loss_by_sku.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground">
                          Sem perda registrada no período.
                        </TableCell>
                      </TableRow>
                    ) : (
                      reconciliation.loss_by_sku.map((entry) => (
                        <TableRow key={entry.sku}>
                          <TableCell>{nameBySku.get(entry.sku) ?? entry.sku}</TableCell>
                          <TableCell className="text-right">{entry.quantity}</TableCell>
                          <TableCell className="text-right">{currency.format(entry.value_cents / 100)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </div>
      )}
    </RequestState>
  );
}

const comparisonConfig: ChartConfig = {
  revenue: { label: "Receita", color: "var(--chart-1)" },
  loss: { label: "Perda", color: "var(--destructive)" },
};

function NetworkFinanceView({ period }: { period: string }) {
  const { data: stores, isLoading: loadingStores } = useGetStoresQuery();
  const { data: rollup, isLoading: loadingRollup, error: rollupError, refetch: refetchRollup } = useGetRollupQuery(
    { period },
    { skip: !stores },
  );
  const { data: rows, isLoading: loadingRows } = useGetNetworkReconciliationsQuery(
    { stores: stores ?? [], period },
    { skip: !stores },
  );
  const { data: salesTotals } = useGetNetworkSalesTotalsQuery({ stores: stores ?? [], period }, { skip: !stores });

  const revenueByStore = useMemo(() => {
    const map = new Map<number, number>();
    for (const t of salesTotals ?? []) map.set(t.store_id, t.total_revenue_cents);
    return map;
  }, [salesTotals]);

  const networkRevenueCents = useMemo(
    () => (salesTotals ?? []).reduce((sum, t) => sum + t.total_revenue_cents, 0),
    [salesTotals],
  );

  const notComputed = rollupError && "status" in rollupError && rollupError.status === 404;

  const comparisonData = useMemo(
    () =>
      (rows ?? [])
        .filter((row) => row.reconciliation !== null)
        .map((row) => ({
          store: row.store.name,
          revenue: (revenueByStore.get(row.store.id) ?? 0) / 100,
          loss: (row.reconciliation!.loss_value_cents ?? 0) / 100,
        }))
        .sort((a, b) => b.revenue - a.revenue),
    [rows, revenueByStore],
  );

  return (
    <RequestState
      isLoading={loadingStores || loadingRollup}
      error={notComputed ? undefined : rollupError}
      isEmpty={notComputed}
      emptyMessage="Nenhuma loja foi reconciliada para este período."
      onRetry={refetchRollup}
    >
      {rollup && (
        <div className="flex flex-col gap-6">
          {!rollup.complete && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/15 px-3 py-2 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Total da rede incompleto — {rollup.incomplete_stores.length} loja(s) com pendência.</p>
                <p>Uma cifra que soma uma loja sem preço ou com saldo inconsistente não é uma cifra final.</p>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Figure label="Valor abastecido" cents={rollup.restocked_value_cents} incomplete={!rollup.complete} />
            <Figure label="CMV" cents={rollup.cogs_cents} incomplete={!rollup.complete} />
            <Figure label="Valor da sobra" cents={rollup.remaining_value_cents} incomplete={!rollup.complete} />
            <Figure label="Perda real" cents={rollup.loss_value_cents} incomplete={!rollup.complete} />
            <Figure label="Ajuste de inventário" cents={rollup.unclassified_stock_adjustment_value_cents} incomplete={!rollup.complete} />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-medium">Indicadores da rede</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Receita líquida" value={currency.format(networkRevenueCents / 100)} hint={`${rollup.store_count} loja(s) reconciliada(s)`} />
              <KpiCard label="Margem bruta" value={formatPct(grossMarginPct(networkRevenueCents, rollup.cogs_cents))} />
              <KpiCard label="Perda sobre receita" value={formatPct(shrinkagePctOfRevenue(rollup.loss_value_cents, networkRevenueCents))} />
              <KpiCard
                label="Perda sobre custo abastecido"
                value={formatPct(shrinkagePctOfCost(rollup.loss_value_cents, rollup.restocked_value_cents))}
              />
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-medium">Receita e perda por loja</h2>
            {loadingRows ? (
              <p className="text-sm text-muted-foreground">Carregando comparação por loja...</p>
            ) : (
              <ChartContainer config={comparisonConfig} className="h-80 w-full">
                <BarChart data={comparisonData} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="store" tickLine={false} axisLine={false} tickMargin={8} interval={0} angle={-40} textAnchor="end" height={80} />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(value: number) => compactCurrency.format(value)} />
                  <ChartTooltip content={<ChartTooltipContent formatter={(value) => currency.format(Number(value))} />} />
                  <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} />
                  <Bar dataKey="loss" fill="var(--color-loss)" radius={4} />
                </BarChart>
              </ChartContainer>
            )}
          </div>

          {rollup.incomplete_stores.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-medium">Lojas com pendência</h2>
              <div className="flex flex-wrap gap-2">
                {rollup.incomplete_stores.map((id) => {
                  const store = (stores ?? []).find((s) => s.id === id);
                  return (
                    <Badge key={id} className="border border-warning/30 bg-warning/15 text-warning">
                      {store?.name ?? `Loja ${id}`}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </RequestState>
  );
}

export default function FinancePage() {
  const [storeId, setStoreId] = useState<StoreSelection>(null);
  const [period, setPeriod] = useState(currentPeriod());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Financeiro" description="A reconciliação mensal: valor abastecido, CMV, sobra e perda real." />

      <StorePeriodPicker storeId={storeId} onStoreIdChange={setStoreId} period={period} onPeriodChange={setPeriod} allowNetwork />

      {storeId === null ? (
        <p className="text-sm text-muted-foreground">
          Selecione uma loja, ou &ldquo;Rede (todas as lojas)&rdquo;, para ver a reconciliação do período.
        </p>
      ) : storeId === NETWORK ? (
        <NetworkFinanceView period={period} />
      ) : (
        <StoreFinanceView storeId={storeId} period={period} />
      )}
    </div>
  );
}
