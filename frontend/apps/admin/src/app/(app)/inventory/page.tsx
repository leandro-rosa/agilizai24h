"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { NETWORK, StorePeriodPicker, type StoreSelection } from "@/components/store-period-picker";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetNetworkStockRangeQuery, useGetStockRangeQuery } from "@/lib/api/inventory";
import { useGetStoresQuery } from "@/lib/api/stores";
import { defaultRange, type PeriodRange } from "@/lib/period-range";

function StoreInventoryView({ storeId, range }: { storeId: number; range: PeriodRange }) {
  const [search, setSearch] = useState("");
  const { data: products } = useGetProductsQuery();
  const nameBySku = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products ?? []) map.set(product.sku, product.name);
    return map;
  }, [products]);

  const { data: stock, isLoading, error, refetch } = useGetStockRangeQuery({ storeId, range });

  const filtered = useMemo(() => {
    if (!stock) return [];
    const term = search.toLowerCase();
    return stock.items.filter(
      (item) => item.sku.toLowerCase().includes(term) || (nameBySku.get(item.sku) ?? "").toLowerCase().includes(term),
    );
  }, [stock, search, nameBySku]);

  return (
    <>
      {stock?.has_inconsistencies && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          Um ou mais SKUs têm saldo negativo — dado de movimento inconsistente. Veja os itens marcados abaixo.
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
          isEmpty={filtered.length === 0}
          emptyMessage="Nenhum item encontrado no período selecionado."
          onRetry={refetch}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="tabular text-right">Abastecido</TableHead>
                <TableHead className="tabular text-right">Vendido</TableHead>
                <TableHead className="tabular text-right">Removido</TableHead>
                <TableHead className="tabular text-right">Ajuste</TableHead>
                <TableHead className="tabular text-right">Saldo</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.sku}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{item.sku}</TableCell>
                  <TableCell className="font-medium">{nameBySku.get(item.sku) ?? item.sku}</TableCell>
                  <TableCell className="tabular text-right">{item.restocked}</TableCell>
                  <TableCell className="tabular text-right">{item.sold}</TableCell>
                  <TableCell className="tabular text-right">{item.removed}</TableCell>
                  <TableCell className="tabular text-right">{item.adjustment}</TableCell>
                  <TableCell className={`text-right font-medium ${item.inconsistent ? "text-destructive" : ""}`}>
                    {item.closing_stock}
                  </TableCell>
                  <TableCell>
                    {item.inconsistent ? (
                      <Badge className="border border-destructive/30 bg-destructive/10 text-destructive">Inconsistente</Badge>
                    ) : item.below_minimum ? (
                      <Badge className="border border-warning/30 bg-warning/15 text-warning">Abaixo do mínimo</Badge>
                    ) : (
                      <Badge variant="secondary">Normal</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </RequestState>
      </div>
    </>
  );
}

function NetworkInventoryView({ range }: { range: PeriodRange }) {
  const { data: stores, isLoading: loadingStores } = useGetStoresQuery();
  const { data: rows, isLoading: loadingRows, error, refetch } = useGetNetworkStockRangeQuery(
    { stores: stores ?? [], range },
    { skip: !stores },
  );

  const rowsWithData = useMemo(() => (rows ?? []).filter((row) => row.items.length > 0), [rows]);

  const tableRows = useMemo(
    () =>
      rowsWithData
        .map((row) => {
          const store = (stores ?? []).find((s) => s.id === row.storeId);
          return {
            storeId: row.storeId,
            storeName: store?.name ?? String(row.storeId),
            itemCount: row.items.length,
            inconsistentCount: row.items.filter((item) => item.inconsistent).length,
            belowMinimumCount: row.items.filter((item) => item.below_minimum).length,
          };
        })
        .sort((a, b) => b.inconsistentCount - a.inconsistentCount || b.belowMinimumCount - a.belowMinimumCount),
    [rowsWithData, stores],
  );

  const isEmpty = !loadingStores && !loadingRows && !error && rowsWithData.length === 0;

  return (
    <RequestState
      isLoading={loadingStores || loadingRows}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="Nenhum estoque foi calculado em nenhuma loja no período selecionado."
      onRetry={refetch}
    >
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Loja</TableHead>
              <TableHead className="tabular text-right">SKUs</TableHead>
              <TableHead className="tabular text-right">Inconsistentes</TableHead>
              <TableHead className="tabular text-right">Abaixo do mínimo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableRows.map((row) => (
              <TableRow key={row.storeId}>
                <TableCell className="font-medium">{row.storeName}</TableCell>
                <TableCell className="tabular text-right">{row.itemCount}</TableCell>
                <TableCell className="tabular text-right">
                  {row.inconsistentCount > 0 ? (
                    <Badge className="border border-destructive/30 bg-destructive/10 text-destructive">{row.inconsistentCount}</Badge>
                  ) : (
                    row.inconsistentCount
                  )}
                </TableCell>
                <TableCell className="tabular text-right">
                  {row.belowMinimumCount > 0 ? (
                    <Badge className="border border-warning/30 bg-warning/15 text-warning">{row.belowMinimumCount}</Badge>
                  ) : (
                    row.belowMinimumCount
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </RequestState>
  );
}

export default function InventoryPage() {
  const [storeId, setStoreId] = useState<StoreSelection>(null);
  const [range, setRange] = useState<PeriodRange>(defaultRange());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Estoque"
        description="Saldo derivado dos movimentos registrados, por loja e SKU — saldo ao final do período."
      />

      <StorePeriodPicker storeId={storeId} onStoreIdChange={setStoreId} range={range} onRangeChange={setRange} allowNetwork />

      {storeId === null ? (
        <p className="text-sm text-muted-foreground">Selecione uma loja, ou &ldquo;Rede (todas as lojas)&rdquo;, para ver o estoque.</p>
      ) : storeId === NETWORK ? (
        <NetworkInventoryView range={range} />
      ) : (
        <StoreInventoryView storeId={storeId} range={range} />
      )}
    </div>
  );
}
