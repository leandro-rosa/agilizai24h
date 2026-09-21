"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, ChevronRight, Equal, Landmark, Lightbulb, Scale, Wallet } from "lucide-react";
import { Pie, PieChart } from "recharts";

import { DateRangePicker, type DayRange } from "@/components/date-range-picker";
import { CashFlowMovementsTable } from "@/components/cash-flow-movements-table";
import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { SummaryCard } from "@/components/summary-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetPnlQuery } from "@/lib/api/accounting";
import { date, money, period as fmtPeriod } from "@/lib/format";
import {
  useGetAccountsQuery,
  useGetCashFlowSummaryQuery,
  useGetTransactionSummaryQuery,
  useGetTransactionsQuery,
  type BankTransaction,
} from "@/lib/api/treasury";

const CATEGORY_DONUT_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/** Quantas categorias mostrar na lista antes do "Ver todas" expandir o resto. */
const CATEGORY_LIST_COLLAPSED_COUNT = 5;

/** Abaixo disso (R$50) uma diferença não vira insight — é ruído de arredondamento/centavo de conciliação. */
const MATERIALITY_CENTS = 5_000;

/** Primeiro e último dia do mês corrente, em "YYYY-MM-DD" — o range padrão ao abrir a tela. */
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: toIso(from), to: toIso(to) };
}

/** "2026-08-01" a "2026-08-31" -> "2026-08" — só quando o range é exatamente um mês de calendário inteiro, senão null (a comparação com o DRE não faz sentido pra um recorte parcial). */
function fullCalendarMonthOf(range: DayRange): string | null {
  if (!range.from || !range.to) return null;
  const from = new Date(`${range.from}T00:00:00`);
  const to = new Date(`${range.to}T00:00:00`);
  const isFirstDay = from.getDate() === 1;
  const lastDayOfMonth = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
  const isLastDay = to.getDate() === lastDayOfMonth && to.getMonth() === from.getMonth() && to.getFullYear() === from.getFullYear();
  if (!isFirstDay || !isLastDay) return null;
  return `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}`;
}

/** O período imediatamente anterior, com a mesma duração — pra comparar "vs. período anterior" mesmo quando o range não é um mês fechado. */
function previousRange(range: DayRange): DayRange {
  if (!range.from || !range.to) return {};
  const from = new Date(`${range.from}T00:00:00`);
  const to = new Date(`${range.to}T00:00:00`);
  const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const prevTo = new Date(from.getTime() - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - (spanDays - 1) * 86_400_000);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: toIso(prevFrom), to: toIso(prevTo) };
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

  // Comparação com o DRE só faz sentido pra um mês de calendário inteiro
  // (o DRE é sempre por `period` "YYYY-MM") e pra "Todas as contas" (o DRE
  // é de rede, não de uma conta bancária isolada).
  const fullMonth = fullCalendarMonthOf(range);
  const bridgeScopeOk = fullMonth !== null && accountId === "all";
  const { data: dre } = useGetPnlQuery({ period: fullMonth ?? "" }, { skip: !bridgeScopeOk });

  const prevFilter = useMemo(() => {
    const prev = previousRange(range);
    return {
      occurred_from: prev.from ?? "",
      occurred_to: prev.to ?? "",
      ...(accountId === "all" ? {} : { account_id: Number(accountId) }),
    };
  }, [range, accountId]);
  const { data: prevCategorySummary } = useGetTransactionSummaryQuery(prevFilter, { skip: !prevFilter.occurred_from });

  // `summary()` (kind: expense) nunca inclui `kind: movement` — sócios,
  // fatura de cartão pessoal, empréstimo, CDB, transferência entre contas.
  // É exatamente o dinheiro que sai/entra do caixa sem nunca passar pelo
  // DRE, então é recalculado aqui direto de `movements` (já carregado),
  // não existe endpoint pra isso.
  const movementByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of (movements ?? []) as BankTransaction[]) {
      if (m.kind !== "movement") continue;
      const signed = m.direction === "outflow" ? m.amount_cents : -m.amount_cents;
      map.set(m.category, (map.get(m.category) ?? 0) + signed);
    }
    return [...map.entries()]
      .map(([category, net_cents]) => ({ category, net_cents }))
      .sort((a, b) => Math.abs(b.net_cents) - Math.abs(a.net_cents));
  }, [movements]);
  const netMovementCents = movementByCategory.reduce((sum, r) => sum + r.net_cents, 0);

  const resultadoDreCents = dre?.totals.operating_profit_cents ?? null;
  const saldoCaixaCents = summary ? summary.inflow_cents - summary.outflow_cents : null;
  const bridgeAvailable = bridgeScopeOk && resultadoDreCents !== null && saldoCaixaCents !== null;
  const gapCents = bridgeAvailable ? resultadoDreCents! - saldoCaixaCents! : 0;
  // gap = (dinheiro que sai por movimentação, nunca vista pelo DRE) + (o
  // que sobra: diferença de tempo entre competência e caixa) — as duas
  // parcelas sempre somam o gap inteiro, por construção.
  const residualCents = bridgeAvailable ? gapCents - netMovementCents : 0;

  // Frase de abertura em linguagem simples — qual das duas parcelas pesa
  // mais decide o que vira a explicação principal, pra não obrigar o
  // operador a somar os números da ponte pra entender o resumo. Cada
  // parcela pode ir em qualquer direção (ex.: sócio aportando em vez de
  // retirando), então a frase segue o sinal real, nunca assume um lado.
  const bridgeHeadline = (() => {
    if (!bridgeAvailable) return "";
    if (Math.abs(gapCents) <= MATERIALITY_CENTS) {
      return "O caixa do período bateu com o resultado do DRE — sem diferença relevante pra explicar.";
    }
    const direction = gapCents > 0 ? "menos" : "mais";
    const movementDominates = Math.abs(netMovementCents) >= Math.abs(residualCents);
    const mainCause = movementDominates
      ? netMovementCents > 0
        ? "principalmente porque saiu dinheiro do caixa que nunca aparece no DRE (retirada de sócio, fatura de cartão pessoal, parcela de empréstimo etc.)"
        : "principalmente porque entrou dinheiro no caixa que nunca aparece no DRE (ex.: aporte de sócio ou repasse entre contas)"
      : residualCents > 0
        ? "principalmente por diferença de tempo — o DRE já reconheceu uma receita ou despesa que ainda não virou dinheiro de verdade no caixa"
        : "principalmente por diferença de tempo — dinheiro que já entrou ou saiu do caixa antes de o DRE reconhecer";
    return `O caixa fechou ${money(Math.abs(gapCents))} ${direction} do que o DRE registrou de resultado, ${mainCause}.`;
  })();

  /** (−)/(+) segue o sinal real de cada parcela — uma parcela negativa (ex.: sócio aportando) nunca aparece com prefixo "(−)" enganoso. */
  function signedBridgeRow(baseLabel: string, cents: number) {
    return { label: `(${cents >= 0 ? "−" : "+"}) ${baseLabel}`, value: money(Math.abs(cents)) };
  }

  const categoryTrend = useMemo(() => {
    const prevMap = new Map((prevCategorySummary?.by_category ?? []).map((r) => [r.category, r.outflow_cents]));
    const seen = new Set<string>();
    const deltas = (categorySummary?.by_category ?? []).map((r) => {
      seen.add(r.category);
      const prev = prevMap.get(r.category) ?? 0;
      return { category: r.category, current: r.outflow_cents, prev, delta: r.outflow_cents - prev };
    });
    for (const [category, prev] of prevMap) {
      if (!seen.has(category)) deltas.push({ category, current: 0, prev, delta: -prev });
    }
    const material = deltas.filter((d) => Math.abs(d.delta) > MATERIALITY_CENTS);
    return {
      increases: [...material].filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3),
      decreases: [...material].filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3),
    };
  }, [categorySummary, prevCategorySummary]);

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

            <Card className="border-l-4 border-l-primary">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                  <Lightbulb className="size-4" /> Análise do período
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {bridgeAvailable ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm">{bridgeHeadline}</p>

                    <div className="rounded-lg border">
                      <BridgeRow label={`Resultado do DRE (${fmtPeriod(fullMonth!)})`} value={money(resultadoDreCents!)} />
                      {Math.abs(netMovementCents) > MATERIALITY_CENTS && (
                        <BridgeRow {...signedBridgeRow("Fora do DRE (sócios, cartão, empréstimo...)", netMovementCents)} muted />
                      )}
                      {Math.abs(residualCents) > MATERIALITY_CENTS && (
                        <BridgeRow {...signedBridgeRow("Diferença de tempo (estimado)", residualCents)} muted />
                      )}
                      <BridgeRow label="= Caixa do período" value={money(saldoCaixaCents!)} bold />
                    </div>

                    {movementByCategory.some((r) => Math.abs(r.net_cents) > MATERIALITY_CENTS) && (
                      <div className="flex flex-col gap-1">
                        <p className="text-xs font-medium text-muted-foreground">Maiores itens fora do DRE</p>
                        {movementByCategory
                          .filter((r) => Math.abs(r.net_cents) > MATERIALITY_CENTS)
                          .slice(0, 4)
                          .map((r) => (
                            <InsightRow
                              key={r.category}
                              icon={r.net_cents > 0 ? ArrowDownCircle : ArrowUpCircle}
                              tone={r.net_cents > 0 ? "critical" : "positive"}
                              label={r.category}
                              value={money(Math.abs(r.net_cents))}
                            />
                          ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Selecione um mês de calendário inteiro e &ldquo;Todas as contas&rdquo; pra comparar o caixa do
                    período com o resultado do DRE.
                  </p>
                )}

                {(categoryTrend.increases.length > 0 || categoryTrend.decreases.length > 0) && (
                  <div className="flex flex-col gap-1 border-t pt-4">
                    <p className="text-xs font-medium text-muted-foreground">Maiores variações vs. período anterior</p>
                    {categoryTrend.decreases.map((d) => (
                      <InsightRow
                        key={d.category}
                        icon={ArrowDownCircle}
                        tone="positive"
                        label={d.category}
                        value={`− ${money(Math.abs(d.delta))}${d.prev > 0 ? ` (${((Math.abs(d.delta) / d.prev) * 100).toFixed(0)}%)` : ""}`}
                      />
                    ))}
                    {categoryTrend.increases.map((d) => (
                      <InsightRow
                        key={d.category}
                        icon={ArrowUpCircle}
                        tone="critical"
                        label={d.category}
                        value={`+ ${money(d.delta)}${d.prev > 0 ? ` (${((d.delta / d.prev) * 100).toFixed(0)}%)` : " (nova)"}`}
                      />
                    ))}
                  </div>
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

/** Uma linha da "ponte" DRE × caixa — visual de tabela, não frase corrida, pra dar pra seguir o cálculo de cima a baixo sem ter que somar de cabeça. */
function BridgeRow({ label, value, muted, bold }: { label: string; value: string; muted?: boolean; bold?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${bold ? "border-t font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`}
    >
      <span>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}

/** Uma linha de insight (ícone + rótulo + valor) — mesmo formato pros itens fora do DRE e pras variações de categoria, pra não misturar prosa com número. */
function InsightRow({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: "positive" | "critical";
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      <Icon className={`size-4 shrink-0 ${tone === "positive" ? "text-success" : "text-destructive"}`} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="tabular shrink-0 font-medium">{value}</span>
    </div>
  );
}
