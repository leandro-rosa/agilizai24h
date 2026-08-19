"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { StorePeriodPicker, currentPeriod } from "@/components/store-period-picker";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetStockQuery } from "@/lib/api/inventory";

export default function InventoryPage() {
  const [storeId, setStoreId] = useState<number | null>(null);
  const [period, setPeriod] = useState(currentPeriod());
  const [search, setSearch] = useState("");

  const { data: products } = useGetProductsQuery();
  const nameBySku = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products ?? []) map.set(product.sku, product.name);
    return map;
  }, [products]);

  const query = storeId === null ? undefined : { storeId, period };
  const { data: stock, isLoading, error, refetch } = useGetStockQuery(query ?? { storeId: 0 }, { skip: !query });

  const notDerivedYet = error && "status" in error && error.status === 404;

  const filtered = useMemo(() => {
    if (!stock) return [];
    const term = search.toLowerCase();
    return stock.items.filter(
      (item) => item.sku.toLowerCase().includes(term) || (nameBySku.get(item.sku) ?? "").toLowerCase().includes(term),
    );
  }, [stock, search, nameBySku]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Estoque" description="Saldo derivado dos movimentos registrados, por loja e SKU." />

      <StorePeriodPicker storeId={storeId} onStoreIdChange={setStoreId} period={period} onPeriodChange={setPeriod} />

      {storeId === null ? (
        <p className="text-sm text-muted-foreground">Selecione uma loja para ver o estoque.</p>
      ) : (
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
              error={notDerivedYet ? undefined : error}
              isEmpty={notDerivedYet || filtered.length === 0}
              emptyMessage={notDerivedYet ? "Nenhum estoque foi derivado para esta loja ainda." : "Nenhum item encontrado."}
              onRetry={refetch}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Abastecido</TableHead>
                    <TableHead className="text-right">Vendido</TableHead>
                    <TableHead className="text-right">Removido</TableHead>
                    <TableHead className="text-right">Ajuste</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((item) => (
                    <TableRow key={item.sku}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{item.sku}</TableCell>
                      <TableCell className="font-medium">{nameBySku.get(item.sku) ?? item.sku}</TableCell>
                      <TableCell className="text-right">{item.restocked}</TableCell>
                      <TableCell className="text-right">{item.sold}</TableCell>
                      <TableCell className="text-right">{item.removed}</TableCell>
                      <TableCell className="text-right">{item.adjustment}</TableCell>
                      {/* Negative stock is shown as-is, never clamped to zero — it is
                          the evidence of the inconsistency, not a display bug. */}
                      <TableCell className={`text-right font-medium ${item.inconsistent ? "text-destructive" : ""}`}>
                        {item.closing_stock}
                      </TableCell>
                      <TableCell>
                        {item.inconsistent ? (
                          <Badge className="border border-destructive/30 bg-destructive/10 text-destructive">
                            Inconsistente
                          </Badge>
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
      )}
    </div>
  );
}
