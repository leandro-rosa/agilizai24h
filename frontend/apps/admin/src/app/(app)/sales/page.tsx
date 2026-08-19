"use client";

import { useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { StorePeriodPicker, type StoreSelection } from "@/components/store-period-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetSalesRangeQuery } from "@/lib/api/sales";
import { defaultRange, type PeriodRange } from "@/lib/period-range";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function SalesPage() {
  const [storeId, setStoreId] = useState<StoreSelection>(null);
  const [range, setRange] = useState<PeriodRange>(defaultRange());
  const [search, setSearch] = useState("");

  const { data: products } = useGetProductsQuery();
  const nameBySku = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products ?? []) map.set(product.sku, product.name);
    return map;
  }, [products]);

  const query = typeof storeId === "number" ? { storeId, range } : undefined;
  const { data: result, isLoading, error, refetch } = useGetSalesRangeQuery(query ?? { storeId: 0, range }, {
    skip: !query,
  });

  const noDataAtAll = result && result.bySku.length === 0;

  const filtered = useMemo(() => {
    if (!result) return [];
    const term = search.toLowerCase();
    return result.bySku.filter(
      (row) => row.sku.toLowerCase().includes(term) || (nameBySku.get(row.sku) ?? "").toLowerCase().includes(term),
    );
  }, [result, search, nameBySku]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Vendas" description="Quantidade vendida e receita por SKU, por loja e período." />

      <StorePeriodPicker storeId={storeId} onStoreIdChange={setStoreId} range={range} onRangeChange={setRange} />

      {storeId === null ? (
        <p className="text-sm text-muted-foreground">Selecione uma loja para ver as vendas do período.</p>
      ) : (
        <>
          {result && result.monthsWithNoData.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Sem venda importada para: {result.monthsWithNoData.join(", ")}.
            </p>
          )}

          {result && !noDataAtAll && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm font-normal text-muted-foreground">Unidades vendidas</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">{result.totalQuantitySold}</CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm font-normal text-muted-foreground">Receita</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">{currency.format(result.totalRevenueCents / 100)}</CardContent>
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
              emptyMessage={
                noDataAtAll ? "Nenhuma venda foi importada para esta loja no período selecionado." : "Nenhuma venda encontrada."
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
