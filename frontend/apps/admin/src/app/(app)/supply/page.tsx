"use client";

import { useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { StorePeriodPicker, currentPeriod } from "@/components/store-period-picker";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetSupplyPeriodQuery } from "@/lib/api/supply";

export default function SupplyPage() {
  const [storeId, setStoreId] = useState<number | null>(null);
  const [period, setPeriod] = useState(currentPeriod());

  const { data: products } = useGetProductsQuery();
  const nameBySku = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products ?? []) map.set(product.sku, product.name);
    return map;
  }, [products]);

  const query = storeId === null ? undefined : { storeId, period };
  const { data, isLoading, error, refetch } = useGetSupplyPeriodQuery(query ?? { storeId: 0, period }, {
    skip: !query,
  });

  const notIngested = error && "status" in error && error.status === 404;
  const isEmpty = !data || (data.restocks.length === 0 && data.removals.length === 0 && data.adjustments.length === 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Abastecimento" description="Reposição, remoções e ajustes de estoque, por loja e mês." />

      <StorePeriodPicker storeId={storeId} onStoreIdChange={setStoreId} period={period} onPeriodChange={setPeriod} />

      {storeId === null ? (
        <p className="text-sm text-muted-foreground">Selecione uma loja para ver o abastecimento do período.</p>
      ) : (
        <RequestState
          isLoading={isLoading}
          error={notIngested ? undefined : error}
          isEmpty={notIngested || isEmpty}
          emptyMessage={notIngested ? "Nenhum abastecimento foi importado para esta loja neste período." : "Sem movimentos neste período."}
          onRetry={refetch}
        >
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
                      <TableHead className="text-right">Qtd. abastecida</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data?.restocks.map((row) => (
                      <TableRow key={row.sku}>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.sku}</TableCell>
                        <TableCell className="font-medium">{nameBySku.get(row.sku) ?? row.sku}</TableCell>
                        <TableCell className="text-right">{row.quantity_restocked}</TableCell>
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
                      <TableHead className="text-right">Qtd. removida</TableHead>
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
                            <Badge className="border border-destructive/30 bg-destructive/10 text-destructive">
                              Sim
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Não</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{row.quantity_removed}</TableCell>
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
                      <TableHead className="text-right">Ajuste</TableHead>
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
      )}
    </div>
  );
}
