"use client";

import { useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { StorePeriodPicker, currentPeriod, type StoreSelection } from "@/components/store-period-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetSalesPeriodQuery, useGetSalesTotalsQuery } from "@/lib/api/sales";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function SalesPage() {
  const [storeId, setStoreId] = useState<StoreSelection>(null);
  const [period, setPeriod] = useState(currentPeriod());
  const [search, setSearch] = useState("");

  const { data: products } = useGetProductsQuery();
  const nameBySku = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products ?? []) map.set(product.sku, product.name);
    return map;
  }, [products]);

  const query = typeof storeId === "number" ? { storeId, period } : undefined;
  const {
    data: sales,
    isLoading,
    error,
    refetch,
  } = useGetSalesPeriodQuery(query ?? { storeId: 0, period }, { skip: !query });
  const { data: totals } = useGetSalesTotalsQuery(query ?? { storeId: 0, period }, { skip: !query });

  // A store/period that was never ingested is a 404, deliberately distinct
  // from an empty array (sales-service's own contract) — this reads as "no
  // data yet", not as a failure.
  const neverIngested = error && "status" in error && error.status === 404;

  const filtered = useMemo(() => {
    if (!sales) return [];
    const term = search.toLowerCase();
    return sales.filter(
      (row) => row.sku.toLowerCase().includes(term) || (nameBySku.get(row.sku) ?? "").toLowerCase().includes(term),
    );
  }, [sales, search, nameBySku]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Vendas" description="Quantidade vendida e receita por SKU, por loja e mês." />

      <StorePeriodPicker storeId={storeId} onStoreIdChange={setStoreId} period={period} onPeriodChange={setPeriod} />

      {storeId === null ? (
        <p className="text-sm text-muted-foreground">Selecione uma loja para ver as vendas do período.</p>
      ) : (
        <>
          {totals && !neverIngested && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm font-normal text-muted-foreground">Unidades vendidas</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">{totals.total_quantity_sold}</CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm font-normal text-muted-foreground">Receita</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">
                  {currency.format(totals.total_revenue_cents / 100)}
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm font-normal text-muted-foreground">SKUs vendidos</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">{totals.sku_count}</CardContent>
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
              error={neverIngested ? undefined : error}
              isEmpty={neverIngested || filtered.length === 0}
              emptyMessage={
                neverIngested ? "Nenhuma venda foi importada para esta loja neste período." : "Nenhuma venda encontrada."
              }
              onRetry={refetch}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Qtd. vendida</TableHead>
                    <TableHead className="text-right">Receita</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => (
                    <TableRow key={row.sku}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{row.sku}</TableCell>
                      <TableCell className="font-medium">{nameBySku.get(row.sku) ?? row.sku}</TableCell>
                      <TableCell className="text-right">{row.quantity_sold}</TableCell>
                      <TableCell className="text-right">{currency.format(row.revenue_cents / 100)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </RequestState>
          </div>
        </>
      )}
    </div>
  );
}
