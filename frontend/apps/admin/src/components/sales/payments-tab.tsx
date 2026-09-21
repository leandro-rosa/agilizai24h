"use client";

import { useMemo, useState } from "react";
import { Cell, Pie, PieChart } from "recharts";

import { RequestState } from "@/components/request-state";
import { currency, SimpleKpiCard, type SalesTabProps } from "@/components/sales/shared";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPct } from "@/lib/financial-kpis";
import {
  approvalRate,
  discountStats,
  failureBreakdown,
  paymentMethodBreakdown,
  resultBreakdown,
  type FailureDimension,
} from "@/lib/sales-insights";

const METHOD_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function PaymentMethodSection({ okTransactions }: { okTransactions: SalesTabProps["okCurrent"] }) {
  const [dimension, setDimension] = useState<"method" | "acquirer" | "card_brand">("method");
  const rows = useMemo(() => paymentMethodBreakdown(okTransactions, dimension), [okTransactions, dimension]);
  const config: ChartConfig = Object.fromEntries(rows.map((r, i) => [r.method, { label: r.method, color: METHOD_COLORS[i % METHOD_COLORS.length] }]));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Meios de pagamento</h3>
        <Tabs value={dimension} onValueChange={(v) => setDimension(v as typeof dimension)}>
          <TabsList className="h-8">
            <TabsTrigger value="method" className="text-xs">
              Método
            </TabsTrigger>
            <TabsTrigger value="acquirer" className="text-xs">
              Adquirente
            </TabsTrigger>
            <TabsTrigger value="card_brand" className="text-xs">
              Bandeira
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem transações no período.</p>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row">
          <ChartContainer config={config} className="aspect-square h-56 shrink-0">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent formatter={(value) => currency.format(Number(value) / 100)} />} />
              <Pie data={rows} dataKey="revenueCents" nameKey="method" innerRadius={50} outerRadius={80} strokeWidth={2}>
                {rows.map((r, i) => (
                  <Cell key={r.method} fill={METHOD_COLORS[i % METHOD_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="flex-1 rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{dimension === "method" ? "Método" : dimension === "acquirer" ? "Adquirente" : "Bandeira"}</TableHead>
                  <TableHead className="tabular text-right">Transações</TableHead>
                  <TableHead className="tabular text-right">% Transações</TableHead>
                  <TableHead className="tabular text-right">Receita</TableHead>
                  <TableHead className="tabular text-right">% Receita</TableHead>
                  <TableHead className="tabular text-right">Ticket médio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.method}>
                    <TableCell>{row.method}</TableCell>
                    <TableCell className="tabular text-right">{row.basketCount}</TableCell>
                    <TableCell className="tabular text-right">{formatPct(row.pctOfBaskets)}</TableCell>
                    <TableCell className="tabular text-right">{currency.format(row.revenueCents / 100)}</TableCell>
                    <TableCell className="tabular text-right">{formatPct(row.pctOfRevenue)}</TableCell>
                    <TableCell className="tabular text-right">{row.ticketAvgCents === null ? "—" : currency.format(row.ticketAvgCents / 100)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

const FAILURE_DIMENSIONS: { key: FailureDimension; label: string }[] = [
  { key: "storeName", label: "Loja" },
  { key: "machine_model", label: "Máquina" },
  { key: "pos_id", label: "PDV" },
  { key: "method", label: "Método" },
  { key: "acquirer", label: "Adquirente" },
];

function TransactionResultSection({ allTransactions, scopedStores }: { allTransactions: SalesTabProps["allCurrent"]; scopedStores: SalesTabProps["scopedStores"] }) {
  const [dimension, setDimension] = useState<FailureDimension>("storeName");

  const storeNameById = useMemo(() => new Map(scopedStores.map((s) => [s.id, s.name])), [scopedStores]);
  const withStoreName = useMemo(
    () => allTransactions.map((t) => ({ ...t, storeName: storeNameById.get(t.store_id) ?? String(t.store_id) })),
    [allTransactions, storeNameById],
  );

  const results = useMemo(() => resultBreakdown(withStoreName), [withStoreName]);
  const rate = useMemo(() => approvalRate(withStoreName), [withStoreName]);
  const failures = useMemo(() => failureBreakdown(withStoreName, dimension), [withStoreName, dimension]);
  const failedCount = withStoreName.length - (results.find((r) => r.result.toUpperCase() === "OK")?.count ?? 0);
  const failedValueCents = results.filter((r) => r.result.toUpperCase() !== "OK").reduce((sum, r) => sum + r.potentialValueCents, 0);

  if (allTransactions.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem transações no período.</p>;
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-medium">Resultado das transações</h3>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <SimpleKpiCard label="Taxa de aprovação" value={rate === null ? "—" : formatPct(rate)} />
        <SimpleKpiCard label="Transações não concluídas" value={String(failedCount)} />
        <SimpleKpiCard label="Valor potencial não concluído" value={currency.format(failedValueCents / 100)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">Por resultado</h4>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resultado</TableHead>
                  <TableHead className="tabular text-right">Qtd.</TableHead>
                  <TableHead className="tabular text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((row) => (
                  <TableRow key={row.result}>
                    <TableCell>{row.result || "(em branco)"}</TableCell>
                    <TableCell className="tabular text-right">{row.count}</TableCell>
                    <TableCell className="tabular text-right">{formatPct(row.pctOfTotal)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-medium text-muted-foreground">Falhas por</h4>
            <Tabs value={dimension} onValueChange={(v) => setDimension(v as FailureDimension)}>
              <TabsList className="h-7">
                {FAILURE_DIMENSIONS.map((d) => (
                  <TabsTrigger key={d.key} value={d.key} className="text-xs">
                    {d.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{FAILURE_DIMENSIONS.find((d) => d.key === dimension)?.label}</TableHead>
                  <TableHead className="tabular text-right">Falhas</TableHead>
                  <TableHead className="tabular text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failures.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      Sem falhas no período.
                    </TableCell>
                  </TableRow>
                ) : (
                  failures.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell>{row.key}</TableCell>
                      <TableCell className="tabular text-right">{row.count}</TableCell>
                      <TableCell className="tabular text-right">{formatPct(row.pctOfFailures)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}

function DiscountSection({ okTransactions }: { okTransactions: SalesTabProps["okCurrent"] }) {
  const stats = useMemo(() => discountStats(okTransactions), [okTransactions]);

  return (
    <div>
      <h3 className="mb-3 text-sm font-medium">Descontos</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SimpleKpiCard label="Total concedido" value={currency.format(stats.totalDiscountCents / 100)} />
        <SimpleKpiCard label="% do valor original" value={stats.pctOfOriginal === null ? "—" : formatPct(stats.pctOfOriginal)} />
        <SimpleKpiCard label="Compras com desconto" value={String(stats.basketsWithDiscount)} />
        <SimpleKpiCard label="% das compras com desconto" value={formatPct(stats.pctOfBasketsWithDiscount)} />
      </div>
    </div>
  );
}

export function PaymentsTab(props: SalesTabProps) {
  const { okCurrent, allCurrent, scopedStores, isLoading, error, isEmpty, onRetry } = props;

  return (
    <RequestState isLoading={isLoading} error={error} isEmpty={isEmpty} emptyMessage="Sem detalhe de transação para este período." onRetry={onRetry}>
      <div className="flex flex-col gap-8">
        <PaymentMethodSection okTransactions={okCurrent} />
        <TransactionResultSection allTransactions={allCurrent} scopedStores={scopedStores} />
        <DiscountSection okTransactions={okCurrent} />
      </div>
    </RequestState>
  );
}
