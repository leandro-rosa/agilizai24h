"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Bar, BarChart, XAxis, YAxis } from "recharts";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { NETWORK, StorePeriodPicker, type StoreSelection } from "@/components/store-period-picker";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetNetworkSupplyRangeQuery, useGetSupplyRangeQuery } from "@/lib/api/supply";
import { useGetStoresQuery } from "@/lib/api/stores";
import { defaultRange, type PeriodRange } from "@/lib/period-range";
import { LOSS_COUNTING_REASONS, reasonLabel } from "@/lib/removal-reasons";

function StoreSupplyView({ storeId, range }: { storeId: number; range: PeriodRange }) {
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
                        <Badge className="border border-destructive/30 bg-destructive/10 text-destructive">Sim</Badge>
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
  );
}

const supplyComparisonConfig: ChartConfig = { restocked: { label: "Abastecido (qtd.)", color: "var(--chart-1)" } };

function NetworkSupplyView({ range }: { range: PeriodRange }) {
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
            <CardContent className="text-2xl font-semibold">{totals.restocked} un.</CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">Total removido por perda (rede)</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{totals.removedLoss} un.</CardContent>
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
                  <TableHead className="text-right">Qtd. removida</TableHead>
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
                    <TableCell className="text-right">{entry.quantity}</TableCell>
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

export default function SupplyPage() {
  const [storeId, setStoreId] = useState<StoreSelection>(null);
  const [range, setRange] = useState<PeriodRange>(defaultRange());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Abastecimento" description="Reposição, remoções e ajustes de estoque, por loja e período." />

      <StorePeriodPicker storeId={storeId} onStoreIdChange={setStoreId} range={range} onRangeChange={setRange} allowNetwork />

      {storeId === null ? (
        <p className="text-sm text-muted-foreground">
          Selecione uma loja, ou &ldquo;Rede (todas as lojas)&rdquo;, para ver o abastecimento do período.
        </p>
      ) : storeId === NETWORK ? (
        <NetworkSupplyView range={range} />
      ) : (
        <StoreSupplyView storeId={storeId} range={range} />
      )}
    </div>
  );
}
