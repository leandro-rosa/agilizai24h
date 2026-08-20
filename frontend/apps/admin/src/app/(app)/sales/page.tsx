"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Bar, BarChart, XAxis, YAxis } from "recharts";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { NETWORK, StorePeriodPicker, type StoreSelection } from "@/components/store-period-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetNetworkSalesRangeQuery, useGetSalesRangeQuery } from "@/lib/api/sales";
import { useGetStoresQuery } from "@/lib/api/stores";
import { defaultRange, type PeriodRange } from "@/lib/period-range";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function useNameBySku() {
  const { data: products } = useGetProductsQuery();
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products ?? []) map.set(product.sku, product.name);
    return map;
  }, [products]);
}

function StoreSalesView({ storeId, range }: { storeId: number; range: PeriodRange }) {
  const [search, setSearch] = useState("");
  const nameBySku = useNameBySku();
  const { data: result, isLoading, error, refetch } = useGetSalesRangeQuery({ storeId, range });

  const noDataAtAll = result && result.bySku.length === 0;

  const filtered = useMemo(() => {
    if (!result) return [];
    const term = search.toLowerCase();
    return result.bySku.filter(
      (row) => row.sku.toLowerCase().includes(term) || (nameBySku.get(row.sku) ?? "").toLowerCase().includes(term),
    );
  }, [result, search, nameBySku]);

  return (
    <>
      {result && result.monthsWithNoData.length > 0 && (
        <p className="text-xs text-muted-foreground">Sem venda importada para: {result.monthsWithNoData.join(", ")}.</p>
      )}

      {result && !noDataAtAll && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">Unidades vendidas</CardTitle>
            </CardHeader>
            <CardContent className="tabular text-2xl font-semibold">{result.totalQuantitySold}</CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">Receita</CardTitle>
            </CardHeader>
            <CardContent className="tabular text-2xl font-semibold">{currency.format(result.totalRevenueCents / 100)}</CardContent>
          </Card>
        </div>
      )}

      <Input
        placeholder="Buscar por nome ou SKU..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="sm:max-w-xs"
      />

      <div className="rounded-lg border">
        <RequestState
          isLoading={isLoading}
          error={error}
          isEmpty={noDataAtAll || filtered.length === 0}
          emptyMessage={noDataAtAll ? "Nenhuma venda foi importada para esta loja no período selecionado." : "Nenhuma venda encontrada."}
          onRetry={refetch}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="tabular text-right">Qtd. vendida</TableHead>
                <TableHead className="tabular text-right">Receita</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.sku}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{row.sku}</TableCell>
                  <TableCell className="font-medium">{nameBySku.get(row.sku) ?? row.sku}</TableCell>
                  <TableCell className="tabular text-right">{row.quantity_sold}</TableCell>
                  <TableCell className="tabular text-right">{currency.format(row.revenue_cents / 100)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </RequestState>
      </div>
    </>
  );
}

const salesComparisonConfig: ChartConfig = { revenue: { label: "Receita", color: "var(--chart-1)" } };

function NetworkSalesView({ range }: { range: PeriodRange }) {
  const { data: stores, isLoading: loadingStores } = useGetStoresQuery();
  const { data: rows, isLoading: loadingRows, error, refetch } = useGetNetworkSalesRangeQuery(
    { stores: stores ?? [], range },
    { skip: !stores },
  );
  const nameBySku = useNameBySku();

  const rowsWithData = useMemo(() => (rows ?? []).filter((row) => row.bySku.length > 0), [rows]);

  const totals = useMemo(
    () =>
      rowsWithData.reduce(
        (acc, row) => ({
          totalQuantitySold: acc.totalQuantitySold + row.totalQuantitySold,
          totalRevenueCents: acc.totalRevenueCents + row.totalRevenueCents,
        }),
        { totalQuantitySold: 0, totalRevenueCents: 0 },
      ),
    [rowsWithData],
  );

  const bySkuNetwork = useMemo(() => {
    const map = new Map<string, { sku: string; quantity_sold: number; revenue_cents: number }>();
    for (const row of rowsWithData) {
      for (const item of row.bySku) {
        const existing = map.get(item.sku);
        if (existing) {
          existing.quantity_sold += item.quantity_sold;
          existing.revenue_cents += item.revenue_cents;
        } else {
          map.set(item.sku, { sku: item.sku, quantity_sold: item.quantity_sold, revenue_cents: item.revenue_cents });
        }
      }
    }
    return [...map.values()].sort((a, b) => b.revenue_cents - a.revenue_cents);
  }, [rowsWithData]);

  const chartData = useMemo(
    () =>
      rowsWithData
        .map((row) => {
          const store = (stores ?? []).find((s) => s.id === row.storeId);
          return { store: store?.name ?? String(row.storeId), revenue: row.totalRevenueCents / 100 };
        })
        .sort((a, b) => b.revenue - a.revenue),
    [rowsWithData, stores],
  );

  const isEmpty = !loadingStores && !loadingRows && !error && rowsWithData.length === 0;

  return (
    <RequestState
      isLoading={loadingStores || loadingRows}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="Nenhuma venda foi importada em nenhuma loja no período selecionado."
      onRetry={refetch}
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">Unidades vendidas</CardTitle>
            </CardHeader>
            <CardContent className="tabular text-2xl font-semibold">{totals.totalQuantitySold}</CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">Receita</CardTitle>
            </CardHeader>
            <CardContent className="tabular text-2xl font-semibold">{currency.format(totals.totalRevenueCents / 100)}</CardContent>
          </Card>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium">Receita por loja</h2>
          <ChartContainer config={salesComparisonConfig} className="h-80 w-full">
            <BarChart data={chartData} margin={{ left: 8, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="store" tickLine={false} axisLine={false} tickMargin={8} interval={0} angle={-40} textAnchor="end" height={80} />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(value: number) => currency.format(value)} />
              <ChartTooltip content={<ChartTooltipContent formatter={(value) => currency.format(Number(value))} />} />
              <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} />
            </BarChart>
          </ChartContainer>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium">Top produtos na rede</h2>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="tabular text-right">Qtd. vendida</TableHead>
                  <TableHead className="tabular text-right">Receita</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bySkuNetwork.slice(0, 20).map((row) => (
                  <TableRow key={row.sku}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.sku}</TableCell>
                    <TableCell className="font-medium">{nameBySku.get(row.sku) ?? row.sku}</TableCell>
                    <TableCell className="tabular text-right">{row.quantity_sold}</TableCell>
                    <TableCell className="tabular text-right">{currency.format(row.revenue_cents / 100)}</TableCell>
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

export default function SalesPage() {
  const [storeId, setStoreId] = useState<StoreSelection>(null);
  const [range, setRange] = useState<PeriodRange>(defaultRange());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Vendas" description="Quantidade vendida e receita por SKU, por loja e período." />

      <StorePeriodPicker storeId={storeId} onStoreIdChange={setStoreId} range={range} onRangeChange={setRange} allowNetwork />

      {storeId === null ? (
        <p className="text-sm text-muted-foreground">
          Selecione uma loja, ou &ldquo;Rede (todas as lojas)&rdquo;, para ver as vendas do período.
        </p>
      ) : storeId === NETWORK ? (
        <NetworkSalesView range={range} />
      ) : (
        <StoreSalesView storeId={storeId} range={range} />
      )}
    </div>
  );
}
