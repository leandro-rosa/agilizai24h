"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, ChevronRight, Equal, Landmark, Scale, Wallet } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Line, Pie, PieChart, XAxis, YAxis } from "recharts";

import { DateRangePicker, type DayRange } from "@/components/date-range-picker";
import { CashFlowMovementsTable } from "@/components/cash-flow-movements-table";
import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { SummaryCard } from "@/components/summary-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { date, money, moneyCompact } from "@/lib/format";
import {
  useGetAccountsQuery,
  useGetCashFlowSummaryQuery,
  useGetTransactionSummaryQuery,
  useGetTransactionsQuery,
} from "@/lib/api/treasury";

const dailyChartConfig: ChartConfig = {
  inflow_cents: { label: "Entradas", color: "var(--success)" },
  outflow_cents: { label: "Saídas", color: "var(--destructive)" },
  balance_cents: { label: "Saldo do dia", color: "var(--chart-1)" },
};

const CATEGORY_DONUT_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/** Quantas categorias mostrar na lista antes do "Ver todas" expandir o resto. */
const CATEGORY_LIST_COLLAPSED_COUNT = 5;

/** Primeiro e último dia do mês corrente, em "YYYY-MM-DD" — o range padrão ao abrir a tela. */
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: toIso(from), to: toIso(to) };
}

export default function CashFlowDashboardPage() {
  const [range, setRange] = useState<DayRange>(currentMonthRange());
  const [accountId, setAccountId] = useState<string>("all");
  const [categoryListExpanded, setCategoryListExpanded] = useState(false);

  const { data: accounts } = useGetAccountsQuery();
  const accountById = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a])), [accounts]);

  const filter = {
    occurred_from: range.from ?? currentMonthRange().from,
    occurred_to: range.to ?? currentMonthRange().to,
    ...(accountId === "all" ? {} : { account_id: Number(accountId) }),
  };

  const {
    data: summary,
    isLoading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useGetCashFlowSummaryQuery(filter);

  // "Despesa por categoria" reaproveita o `summary()` de Lançamentos — mesma
  // regra de by_category (só kind: expense), só que por occurred_on em vez
  // de period. Nenhum código novo no backend para isso (ver spec).
  const { data: categorySummary } = useGetTransactionSummaryQuery(filter);

  const { data: movements, isLoading: movementsLoading, error: movementsError, refetch: refetchMovements } = useGetTransactionsQuery(
    filter,
  );

  const dailyChartData = (summary?.daily ?? []).map((d) => ({
    ...d,
    inflow_cents: d.inflow_cents / 100,
    outflow_cents: d.outflow_cents / 100,
    balance_cents: d.balance_cents / 100,
    label: date(d.date),
  }));

  // Já vem ordenado por valor decrescente (mesma regra do `summary()` que
  // Lançamentos usa) — a lista e o "Ver todas" reaproveitam essa ordem.
  const categoryTotalCents = (categorySummary?.by_category ?? []).reduce((sum, row) => sum + row.outflow_cents, 0);

  const donutData = (categorySummary?.by_category ?? []).map((row, i) => ({
    name: row.category,
    cents: row.outflow_cents,
    value: row.outflow_cents / 100,
    percent: categoryTotalCents > 0 ? (row.outflow_cents / categoryTotalCents) * 100 : 0,
    fill: CATEGORY_DONUT_COLORS[i % CATEGORY_DONUT_COLORS.length],
  }));

  // Normalmente fecha exatamente, mas uma transferência/fatura com uma
  // perna fora do range abre um residual conhecido, por design — ver
  // "Gap conhecido" na spec e o CLAUDE.md deste app.
  const closingResidualCents = summary
    ? summary.closing_balance_cents - (summary.opening_balance_cents + summary.inflow_cents - summary.outflow_cents)
    : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fluxo de caixa"
        description="Trajetória de caixa em regime de caixa — data real de pagamento/recebimento, nunca competência."
        actions={
          <Button variant="outline" asChild>
            <Link href="/finance/cash-flow/premises">Premissas mensais</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <DateRangePicker value={range} onChange={setRange} />
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as contas</SelectItem>
            {(accounts ?? []).map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <RequestState
        isLoading={summaryLoading}
        error={summaryError}
        isEmpty={!summary}
        emptyMessage="Sem dado de fluxo de caixa para este período."
        onRetry={refetchSummary}
        loadingRows={2}
      >
        {summary && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <SummaryCard
                label="Saldo inicial"
                value={money(summary.opening_balance_cents)}
                icon={Wallet}
                tone="muted"
                hint="Soma do extrato importado antes desta data — contas com lacuna de importação conhecida (ver CLAUDE.md) ficam incorretas aqui."
              />
              <SummaryCard label="Entradas" value={money(summary.inflow_cents)} icon={ArrowUpCircle} tone="positive" />
              <SummaryCard label="Saídas" value={money(summary.outflow_cents)} icon={ArrowDownCircle} tone="critical" />
              <SummaryCard
                label="Saldo do período"
                value={money(summary.inflow_cents - summary.outflow_cents)}
                icon={Equal}
                tone={summary.inflow_cents - summary.outflow_cents >= 0 ? "positive" : "critical"}
                hint="Entradas − saídas"
              />
              <SummaryCard
                label="Saldo final"
                value={money(summary.closing_balance_cents)}
                icon={Scale}
                tone={summary.closing_balance_cents >= 0 ? "positive" : "critical"}
                hint={
                  closingResidualCents === 0
                    ? "Saldo inicial + entradas − saídas"
                    : `Saldo inicial + entradas − saídas, com ${money(closingResidualCents)} de diferença não explicada (perna de transferência ou fatura fora do período — ver CLAUDE.md)`
                }
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">Fluxo de caixa diário</CardTitle>
                </CardHeader>
                <CardContent>
                  {dailyChartData.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">Nenhuma movimentação neste período.</p>
                  ) : (
                    <ChartContainer config={dailyChartConfig} className="h-64 w-full">
                      <ComposedChart data={dailyChartData} margin={{ top: 24 }}>
                        <CartesianGrid vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)" }} />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: "var(--muted-foreground)" }}
                          tickFormatter={(value: number) => moneyCompact(value * 100)}
                        />
                        <ChartTooltip content={<ChartTooltipContent formatter={(value) => money(Number(value) * 100)} />} />
                        <Bar dataKey="inflow_cents" fill="var(--color-inflow_cents)" radius={4} />
                        <Bar dataKey="outflow_cents" fill="var(--color-outflow_cents)" radius={4} />
                        <Line type="monotone" dataKey="balance_cents" stroke="var(--color-balance_cents)" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Despesas por categoria</CardTitle>
                  {donutData.length > CATEGORY_LIST_COLLAPSED_COUNT && (
                    <Button variant="ghost" size="sm" onClick={() => setCategoryListExpanded((v) => !v)}>
                      {categoryListExpanded ? "Ver menos" : "Ver todas"}
                      <ChevronRight className={`size-4 transition-transform ${categoryListExpanded ? "rotate-90" : ""}`} />
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {donutData.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">Nenhuma despesa classificada neste período.</p>
                  ) : (
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                      <ChartContainer config={{}} className="h-40 w-full shrink-0 sm:w-40">
                        <PieChart>
                          <ChartTooltip content={<ChartTooltipContent formatter={(value) => money(Number(value) * 100)} />} />
                          <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70} />
                        </PieChart>
                      </ChartContainer>
                      <ul className="flex min-w-0 flex-1 flex-col gap-2.5">
                        {(categoryListExpanded ? donutData : donutData.slice(0, CATEGORY_LIST_COLLAPSED_COUNT)).map((row) => (
                          <li key={row.name} className="flex items-center justify-between gap-3 text-sm">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.fill }} />
                              <span className="truncate" title={row.name}>
                                {row.name}
                              </span>
                            </span>
                            <span className="tabular flex shrink-0 items-center gap-2">
                              <span className="text-xs text-muted-foreground">{row.percent.toFixed(1)}%</span>
                              <span className="font-medium">{money(row.cents)}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">Contas</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {(accounts ?? []).map((a) => {
                  const lastMovement = (movements ?? [])
                    .filter((t) => t.account_id === a.id)
                    .sort((x, y) => y.occurred_on.localeCompare(x.occurred_on))[0];
                  return (
                    <div key={a.id} className="flex items-center justify-between border-b py-2 last:border-b-0">
                      <span className="flex items-center gap-2">
                        <Landmark className="size-4 text-muted-foreground" />
                        {a.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {lastMovement
                          ? `Extrato importado até ${date(lastMovement.occurred_on)}`
                          : "Sem movimentação neste período"}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        )}
      </RequestState>

      <RequestState
        isLoading={movementsLoading}
        error={movementsError}
        isEmpty={(movements ?? []).length === 0}
        emptyMessage="Nenhuma movimentação neste período."
        onRetry={refetchMovements}
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Movimentações</CardTitle>
          </CardHeader>
          <CardContent>
            <CashFlowMovementsTable transactions={movements ?? []} accountById={accountById} />
          </CardContent>
        </Card>
      </RequestState>
    </div>
  );
}
