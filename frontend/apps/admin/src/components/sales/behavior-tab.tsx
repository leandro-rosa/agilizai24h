"use client";

import { useMemo, useState } from "react";

import { RequestState } from "@/components/request-state";
import { currency, SimpleKpiCard, type SalesTabProps } from "@/components/sales/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPct } from "@/lib/financial-kpis";
import { computePeriodStats, groupBaskets, heatmapData, onlyOk, summarizeHeatmap, WEEKDAY_LABELS, type HeatmapMetric } from "@/lib/sales-insights";

const HEATMAP_LABELS: Record<HeatmapMetric, string> = { revenue: "Receita", baskets: "Transações", quantity: "Quantidade" };

function TicketDecomposition({ props }: { props: SalesTabProps }) {
  const { okCurrent, networkCurrentByStore, costBySku, isNetworkScope } = props;

  const storeStats = useMemo(() => computePeriodStats(okCurrent, costBySku), [okCurrent, costBySku]);
  const networkStats = useMemo(() => computePeriodStats(onlyOk(networkCurrentByStore.flatMap((r) => r.transactions)), costBySku), [networkCurrentByStore, costBySku]);

  return (
    <div>
      <h3 className="mb-1 text-sm font-medium">Decomposição do ticket médio</h3>
      <p className="mb-3 text-xs text-muted-foreground">Ticket médio = itens por compra × preço médio por item — duas lojas com o mesmo ticket podem ter perfis opostos.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <SimpleKpiCard label={isNetworkScope ? "Ticket médio (rede)" : "Ticket médio (loja)"} value={storeStats.ticketAvgCents === null ? "—" : currency.format(storeStats.ticketAvgCents / 100)} />
        <SimpleKpiCard label="Itens por compra" value={storeStats.itemsPerBasket === null ? "—" : storeStats.itemsPerBasket.toFixed(2)} />
        <SimpleKpiCard label="Preço médio por item" value={storeStats.avgItemPriceCents === null ? "—" : currency.format(storeStats.avgItemPriceCents / 100)} />
      </div>
      {!isNetworkScope && (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <SimpleKpiCard label="Ticket médio (rede)" value={networkStats.ticketAvgCents === null ? "—" : currency.format(networkStats.ticketAvgCents / 100)} />
          <SimpleKpiCard label="Itens por compra (rede)" value={networkStats.itemsPerBasket === null ? "—" : networkStats.itemsPerBasket.toFixed(2)} />
          <SimpleKpiCard label="Preço médio por item (rede)" value={networkStats.avgItemPriceCents === null ? "—" : currency.format(networkStats.avgItemPriceCents / 100)} />
        </div>
      )}
    </div>
  );
}

function BehaviorHeatmap({ okTransactions }: { okTransactions: SalesTabProps["okCurrent"] }) {
  const [metric, setMetric] = useState<HeatmapMetric>("revenue");
  const cells = useMemo(() => heatmapData(okTransactions, metric), [okTransactions, metric]);
  const summary = useMemo(() => summarizeHeatmap(cells), [cells]);
  const maxValue = Math.max(1, ...cells.map((c) => c.value));
  const hours = Array.from({ length: 24 }, (_, i) => i);

  if (okTransactions.every((t) => !t.occurred_at)) {
    return <p className="text-sm text-muted-foreground">Sem horário de transação disponível para este período.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Vendas por dia da semana e horário</h3>
        <Tabs value={metric} onValueChange={(v) => setMetric(v as HeatmapMetric)}>
          <TabsList className="h-8">
            {(Object.keys(HEATMAP_LABELS) as HeatmapMetric[]).map((key) => (
              <TabsTrigger key={key} value={key} className="text-xs">
                {HEATMAP_LABELS[key]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex flex-col gap-4">
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-1 text-xs">
            <thead>
              <tr>
                <th className="w-8" />
                {hours.map((h) => (
                  <th key={h} className="w-6 text-center font-normal text-muted-foreground">
                    {h % 2 === 0 ? h : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAY_LABELS.map((label, weekday) => (
                <tr key={label}>
                  <td className="text-right font-normal text-muted-foreground">{label}</td>
                  {hours.map((h) => {
                    const cell = cells.find((c) => c.weekday === weekday && c.hour === h);
                    const intensity = cell ? cell.value / maxValue : 0;
                    return (
                      <td key={h}>
                        <div
                          className="size-5 rounded"
                          title={cell ? `${label} ${h}h: ${cell.value}` : undefined}
                          style={{ backgroundColor: `color-mix(in oklch, var(--chart-1) ${Math.max(8, intensity * 100)}%, transparent)` }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-6 text-sm">
          <div>
            <span className="text-xs text-muted-foreground">Horário de pico: </span>
            <span className="font-medium">{summary.peakHour !== null ? `${String(summary.peakHour).padStart(2, "0")}h` : "—"}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Dia mais forte: </span>
            <span className="font-medium">{summary.strongestDay !== null ? WEEKDAY_LABELS[summary.strongestDay] : "—"}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Dia mais fraco: </span>
            <span className="font-medium">{summary.weakestDay !== null ? WEEKDAY_LABELS[summary.weakestDay] : "—"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const FREQUENCY_BUCKETS: { label: string; test: (n: number) => boolean }[] = [
  { label: "1 compra", test: (n) => n === 1 },
  { label: "2–3 compras", test: (n) => n >= 2 && n <= 3 },
  { label: "4–8 compras", test: (n) => n >= 4 && n <= 8 },
  { label: "9+ compras", test: (n) => n >= 9 },
];

function BuyerFrequency({ okTransactions }: { okTransactions: SalesTabProps["okCurrent"] }) {
  const baskets = useMemo(() => groupBaskets(okTransactions), [okTransactions]);
  const hasBuyerNumber = okTransactions.some((t) => t.buyer_number);

  const byBuyer = useMemo(() => {
    const map = new Map<string, { count: number; revenueCents: number }>();
    for (const basket of baskets) {
      if (!basket.buyerNumber) continue;
      const existing = map.get(basket.buyerNumber) ?? { count: 0, revenueCents: 0 };
      existing.count += 1;
      existing.revenueCents += basket.totalCents;
      map.set(basket.buyerNumber, existing);
    }
    return map;
  }, [baskets]);

  const uniqueBuyers = byBuyer.size;
  const totalPurchases = [...byBuyer.values()].reduce((sum, b) => sum + b.count, 0);
  const totalRevenue = [...byBuyer.values()].reduce((sum, b) => sum + b.revenueCents, 0);
  const purchasesPerBuyer = uniqueBuyers > 0 ? totalPurchases / uniqueBuyers : null;
  const revenuePerBuyer = uniqueBuyers > 0 ? totalRevenue / uniqueBuyers : null;
  const ticketPerBuyer = totalPurchases > 0 ? totalRevenue / totalPurchases : null;

  const distribution = useMemo(
    () =>
      FREQUENCY_BUCKETS.map((bucket) => {
        const count = [...byBuyer.values()].filter((b) => bucket.test(b.count)).length;
        return { label: bucket.label, count, pct: uniqueBuyers > 0 ? count / uniqueBuyers : 0 };
      }),
    [byBuyer, uniqueBuyers],
  );

  if (!hasBuyerNumber) {
    return (
      <div>
        <h3 className="mb-1 text-sm font-medium">Compradores e frequência</h3>
        <p className="text-sm text-muted-foreground">Número comprador não informado nas transações deste período.</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-medium">Compradores e frequência</h3>
      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SimpleKpiCard label="Compradores únicos" value={String(uniqueBuyers)} />
        <SimpleKpiCard label="Compras por comprador" value={purchasesPerBuyer === null ? "—" : purchasesPerBuyer.toFixed(2)} />
        <SimpleKpiCard label="Receita média por comprador" value={revenuePerBuyer === null ? "—" : currency.format(revenuePerBuyer / 100)} />
        <SimpleKpiCard label="Ticket médio por comprador" value={ticketPerBuyer === null ? "—" : currency.format(ticketPerBuyer / 100)} />
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Frequência</TableHead>
              <TableHead className="tabular text-right">Compradores</TableHead>
              <TableHead className="tabular text-right">% do total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {distribution.map((row) => (
              <TableRow key={row.label}>
                <TableCell>{row.label}</TableCell>
                <TableCell className="tabular text-right">{row.count}</TableCell>
                <TableCell className="tabular text-right">{formatPct(row.pct)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function BehaviorTab(props: SalesTabProps) {
  const { okCurrent, isLoading, error, isEmpty, onRetry } = props;

  return (
    <RequestState isLoading={isLoading} error={error} isEmpty={isEmpty} emptyMessage="Sem detalhe de transação para este período." onRetry={onRetry}>
      <div className="flex flex-col gap-8">
        <TicketDecomposition props={props} />
        <BehaviorHeatmap okTransactions={okCurrent} />
        <BuyerFrequency okTransactions={okCurrent} />
      </div>
    </RequestState>
  );
}
