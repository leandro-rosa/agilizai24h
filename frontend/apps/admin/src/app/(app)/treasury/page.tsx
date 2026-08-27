"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight, Info, Pencil, Plus, Trash2, Upload, Wand2 } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { z } from "zod";

import { DateRangePicker, type DayRange } from "@/components/date-range-picker";
import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { ResourceFormDialog, fromCents, toCents, type FieldSpec } from "@/components/resource-form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { currentPeriod, date, money, moneyCompact, period as fmtPeriod } from "@/lib/format";
import {
  KIND_LABELS,
  KINDS,
  NATURE_LABELS,
  NATURES,
  TREASURY_SOURCE_LABELS,
  normalizeCounterpartyForGrouping,
  useApplyMappingsMutation,
  useCreateTransactionMutation,
  useDeleteTransactionMutation,
  useGetAccountsQuery,
  useGetMappingsQuery,
  useGetPendingImportsQuery,
  useGetTransactionSummaryQuery,
  useGetTransactionsQuery,
  useUpdateTransactionMutation,
  type BankTransaction,
  type Nature,
} from "@/lib/api/treasury";
import { useHasPermission } from "@/lib/auth/use-permission";

/** Mesmos tons semânticos dos 4 SummaryCard logo acima, por `kind` — o gráfico não introduz paleta nova. */
const kindChartConfig: ChartConfig = {
  revenue: { label: "Receita", color: "var(--success)" },
  expense: { label: "Despesa", color: "var(--destructive)" },
  movement: { label: "Movimentação", color: "var(--muted-foreground)" },
  pending: { label: "Pendente", color: "var(--warning)" },
};

// `nature` (cogs/operating/administrative/investment) não tem precedente de
// cor em nenhuma outra tela (nem o DRE colore por natureza) — usa a paleta
// de dataviz dedicada (--chart-1..5) em vez de inventar tom semântico novo.
const NATURE_BUCKETS = [...NATURES, "sem_natureza"] as const;
type NatureBucket = (typeof NATURE_BUCKETS)[number];
const natureChartConfig: ChartConfig = {
  cogs: { label: NATURE_LABELS.cogs, color: "var(--chart-1)" },
  operating: { label: NATURE_LABELS.operating, color: "var(--chart-2)" },
  administrative: { label: NATURE_LABELS.administrative, color: "var(--chart-3)" },
  investment: { label: NATURE_LABELS.investment, color: "var(--chart-4)" },
  sem_natureza: { label: "Sem natureza", color: "var(--chart-5)" },
};

const transactionSchema = z
  .object({
    account_id: z.string().min(1, "Escolha a conta"),
    occurred_on: z.string().min(1, "Informe a data"),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use "AAAA-MM"'),
    direction: z.enum(["inflow", "outflow"]),
    amount: z.string().min(1, "Informe o valor"),
    counterparty_raw: z.string().min(1, "Informe o favorecido"),
    entry_type: z.string().min(1, "Informe o tipo"),
    category: z.string().min(1, "Informe a categoria"),
    kind: z.enum(KINDS),
    // Só obrigatória para kind "expense" — é o que liga o lançamento ao
    // DRE, e movimentação/receita/pendente nunca carregam natureza.
    nature: z.enum(NATURES).optional(),
  })
  .refine((values) => values.kind !== "expense" || values.nature !== undefined, {
    message: "Informe a natureza para despesa",
    path: ["nature"],
  });

type TransactionForm = z.infer<typeof transactionSchema>;

export default function TreasuryPage() {
  const searchParams = useSearchParams();
  const [period, setPeriod] = useState(searchParams.get("period") ?? currentPeriod());
  const [nature, setNature] = useState<Nature | "all">("all");
  // Só afeta a tabela principal (nunca `periodTransactions`, os gráficos, o
  // resumo ou os imports) — resetado ao trocar de período para não deixar
  // um range de um mês combinado com o período de outro, o que voltaria a
  // tabela vazia sem nenhuma explicação.
  const [dateRange, setDateRange] = useState<DayRange>({});
  const [editing, setEditing] = useState<BankTransaction | null>(null);
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);

  const filter = {
    period,
    ...(nature === "all" ? {} : { nature }),
    ...(dateRange.from ? { occurred_from: dateRange.from } : {}),
    ...(dateRange.to ? { occurred_to: dateRange.to } : {}),
  };
  const { data: transactions, isLoading, error, refetch } = useGetTransactionsQuery(filter);
  // Desacoplado do filtro de natureza da tabela — o resumo do mês é sempre
  // do período inteiro, não do recorte que o operador escolheu para navegar
  // a lista abaixo. Quando `nature` é "all" isto é a mesma chave de cache
  // de `filter`, então o RTK Query não duplica a requisição.
  const {
    data: summary,
    isLoading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useGetTransactionSummaryQuery({ period });
  const {
    data: periodTransactions,
    isLoading: periodLoading,
    error: periodError,
    refetch: refetchPeriod,
  } = useGetTransactionsQuery({ period });
  const { data: accounts } = useGetAccountsQuery();
  // Só para resolver rótulo de vínculo (regra de-para / extrato de origem) na
  // tabela abaixo — volume pequeno (dezenas de regra, poucos imports por
  // período), não justifica incluir o relacionamento em `listTransactions`.
  const { data: mappings } = useGetMappingsQuery();
  const { data: importsForPeriod } = useGetPendingImportsQuery({ period });
  const [createTransaction] = useCreateTransactionMutation();
  const [updateTransaction] = useUpdateTransactionMutation();
  const [deleteTransaction] = useDeleteTransactionMutation();
  const [applyMappings, { isLoading: applying }] = useApplyMappingsMutation();
  const canWrite = useHasPermission("treasury:write");

  const mappingById = new Map((mappings ?? []).map((m) => [m.id, m]));
  const importById = new Map((importsForPeriod ?? []).map((i) => [i.id, i]));

  function provenanceLabel(t: BankTransaction): string {
    if (t.pending_import_id === null) return "Lançamento manual";
    const source = importById.get(t.pending_import_id);
    const originText = source ? `Extrato: ${TREASURY_SOURCE_LABELS[source.source]} · ${fmtPeriod(source.period)}` : "Extrato";
    if (t.mapping_rule_id !== null) {
      const rule = mappingById.get(t.mapping_rule_id);
      return `${originText} — Classificado pela regra: ${rule?.display_name ?? "(regra removida)"}`;
    }
    if (t.kind === "pending") return `${originText} — Ainda sem classificação`;
    return `${originText} — Classificado pelo formato do arquivo`;
  }

  const fields: FieldSpec<TransactionForm>[] = [
    {
      name: "account_id",
      label: "Conta",
      kind: "select",
      options: (accounts ?? []).map((a) => ({ value: String(a.id), label: a.name })),
    },
    { name: "occurred_on", label: "Data", kind: "date" },
    { name: "period", label: "Competência", kind: "text", placeholder: "2026-07" },
    {
      name: "direction",
      label: "Sentido",
      kind: "select",
      options: [
        { value: "outflow", label: "Saída" },
        { value: "inflow", label: "Entrada" },
      ],
      hint: "O valor é sempre positivo — o sinal está aqui.",
    },
    { name: "amount", label: "Valor (R$)", kind: "number" },
    { name: "counterparty_raw", label: "Favorecido", kind: "text", placeholder: "ASSAÍ ATACADISTA LJ49" },
    { name: "entry_type", label: "Tipo", kind: "text", placeholder: "estoque" },
    { name: "category", label: "Categoria", kind: "text", placeholder: "estoque geral" },
    {
      name: "kind",
      label: "Tipo de lançamento",
      kind: "select",
      options: KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] })),
      hint: "Receita/despesa contam no resultado; movimentação e pendente não.",
    },
    {
      name: "nature",
      label: "Natureza",
      kind: "select",
      options: NATURES.map((n) => ({ value: n, label: NATURE_LABELS[n] })),
      hint: "Só se aplica quando o tipo é Despesa — é o que leva o lançamento para a linha certa do DRE.",
    },
  ];

  function submitValues({ amount, account_id, kind, nature: formNature }: TransactionForm) {
    return {
      kind,
      // Movimentação/receita/pendente nunca carregam natureza — mesma regra
      // do backend (natureFor), reforçada aqui para não mandar um valor
      // órfão de um kind anterior no form.
      nature: kind === "expense" ? formNature : undefined,
      account_id: Number(account_id),
      amount_cents: toCents(amount),
    };
  }

  async function handleApply() {
    const result = await applyMappings(period).unwrap().catch(() => null);
    if (result) {
      toast.success(`${result.classified} de ${result.examined} lançamento(s) classificado(s).`);
    }
  }

  const pendentes = (periodTransactions ?? []).filter((t) => t.kind === "pending");
  const porFornecedor = groupBySupplier((periodTransactions ?? []).filter((t) => t.kind === "expense"));
  // Ordem fixa (não por valor): é uma comparação categórica entre os 4
  // `kind`, não um ranking — barras não devem trocar de posição mês a mês.
  const porTipo = KINDS.map((kind) => {
    const rows = (periodTransactions ?? []).filter((t) => t.kind === kind);
    return {
      kind,
      label: KIND_LABELS[kind],
      amount: rows.reduce((sum, t) => sum + t.amount_cents, 0) / 100,
      count: rows.length,
    };
  });
  // `nature` só existe para `kind: expense` — os outros 3 `kind` nunca
  // entram aqui. "sem_natureza" é o catch-all defensivo para uma despesa
  // ainda não classificada até o fim (mesma filosofia de `porTipo` mostrar
  // R$0,00 em vez de esconder um `kind` sem linha nenhuma no mês).
  const porNatureza: { nature: NatureBucket; label: string; amount: number; count: number }[] = NATURE_BUCKETS.map(
    (bucket) => {
      const rows = (periodTransactions ?? []).filter(
        (t) => t.kind === "expense" && (bucket === "sem_natureza" ? t.nature === null : t.nature === bucket),
      );
      return {
        nature: bucket,
        label: bucket === "sem_natureza" ? "Sem natureza" : NATURE_LABELS[bucket],
        amount: rows.reduce((sum, t) => sum + t.amount_cents, 0) / 100,
        count: rows.length,
      };
    },
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Lançamentos"
        description="Extrato bancário e fatura de cartão, classificados para o DRE."
        actions={
          canWrite ? (
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link href="/treasury/imports/upload">
                  <Upload /> Importar extratos
                </Link>
              </Button>
              <Button variant="outline" onClick={handleApply} disabled={applying}>
                <Wand2 /> {applying ? "Aplicando..." : "Aplicar de-para"}
              </Button>
              <ResourceFormDialog
                title="Novo lançamento"
                trigger={
                  <Button>
                    <Plus /> Novo lançamento
                  </Button>
                }
                schema={transactionSchema}
                fields={fields}
                defaultValues={
                  {
                    period,
                    direction: "outflow",
                    kind: "expense",
                    nature: "cogs",
                    occurred_on: new Date().toISOString().slice(0, 10),
                  } as TransactionForm
                }
                onSubmit={(values) => createTransaction({ ...values, ...submitValues(values) }).unwrap()}
              />
            </div>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2">
        <Select
          value={period}
          onValueChange={(p) => {
            setPeriod(p);
            setDateRange({});
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {lastPeriods(18).map((p) => (
              <SelectItem key={p} value={p}>
                {fmtPeriod(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={nature} onValueChange={(value) => setNature(value as Nature | "all")}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as naturezas</SelectItem>
            {NATURES.map((n) => (
              <SelectItem key={n} value={n}>
                {NATURE_LABELS[n]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      <RequestState
        isLoading={summaryLoading}
        error={summaryError}
        isEmpty={!summary}
        emptyMessage="Sem dado de resumo para este período."
        onRetry={refetchSummary}
        loadingRows={2}
      >
        {summary && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard label="Entrada consolidada" value={money(summary.inflow_cents)} tone="positive" />
              <SummaryCard label="Despesa confirmada" value={money(summary.outflow_cents)} tone="critical" />
              <SummaryCard label="Pendente" value={money(summary.pending_cents)} tone="attention" hint={`${summary.pending_count} lançamento(s)`} />
              <SummaryCard
                label="Movimentação"
                value={money(summary.movement_cents)}
                tone="muted"
                hint="Não entra no resultado"
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">Despesa por categoria</CardTitle>
              </CardHeader>
              <CardContent>
                {summary.by_category.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">Nenhuma despesa classificada neste período.</p>
                ) : (
                  <div className="flex flex-wrap gap-4">
                    {summary.by_category.map((row) => (
                      <div key={row.category}>
                        <p className="text-xs text-muted-foreground">{row.category}</p>
                        <p className="tabular text-lg font-semibold">{money(row.outflow_cents)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </RequestState>

      <RequestState
        isLoading={periodLoading}
        error={periodError}
        isEmpty={false}
        onRetry={refetchPeriod}
        loadingRows={2}
      >
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Classificação por tipo</CardTitle>
          </CardHeader>
          <CardContent>
            {(periodTransactions ?? []).length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Nenhum lançamento neste período.</p>
            ) : (
              <ChartContainer config={kindChartConfig} className="h-64 w-full">
                <BarChart data={porTipo} margin={{ top: 24 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)" }} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--muted-foreground)" }}
                    tickFormatter={(value: number) => moneyCompact(value * 100)}
                  />
                  <ChartTooltip
                    content={<ChartTooltipContent formatter={(value) => money(Number(value) * 100)} />}
                  />
                  <Bar dataKey="amount" radius={4}>
                    {porTipo.map((row) => (
                      <Cell key={row.kind} fill={`var(--color-${row.kind})`} />
                    ))}
                    <LabelList dataKey="amount" position="top" formatter={(value: unknown) => moneyCompact(Number(value) * 100)} fontSize={11} />
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Despesa por natureza</CardTitle>
          </CardHeader>
          <CardContent>
            {(periodTransactions ?? []).length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Nenhum lançamento neste período.</p>
            ) : (
              <ChartContainer config={natureChartConfig} className="h-64 w-full">
                <BarChart data={porNatureza} margin={{ top: 24 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)" }} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--muted-foreground)" }}
                    tickFormatter={(value: number) => moneyCompact(value * 100)}
                  />
                  <ChartTooltip
                    content={<ChartTooltipContent formatter={(value) => money(Number(value) * 100)} />}
                  />
                  <Bar dataKey="amount" radius={4}>
                    {porNatureza.map((row) => (
                      <Cell key={row.nature} fill={`var(--color-${row.nature})`} />
                    ))}
                    <LabelList dataKey="amount" position="top" formatter={(value: unknown) => moneyCompact(Number(value) * 100)} fontSize={11} />
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Despesa por fornecedor</CardTitle>
            </CardHeader>
            <CardContent>
              {porFornecedor.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">Nenhuma despesa classificada neste período.</p>
              ) : (
                <div className="flex flex-col">
                  {porFornecedor.map((group) => (
                    <div key={group.key} className="border-b py-2 last:border-b-0">
                      <button
                        className="flex w-full items-center justify-between text-left"
                        onClick={() => setExpandedSupplier(expandedSupplier === group.key ? null : group.key)}
                      >
                        <span className="flex items-center gap-1 font-medium">
                          {expandedSupplier === group.key ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          {group.label}
                        </span>
                        <span className="tabular">{money(group.total)}</span>
                      </button>
                      {expandedSupplier === group.key && (
                        <div className="mt-2 flex flex-col gap-1 pl-5">
                          {group.items.map((t) => (
                            <div key={t.id} className="flex justify-between text-sm text-muted-foreground">
                              <span>{date(t.occurred_on)}</span>
                              <span className="tabular">{money(t.amount_cents)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Pendentes</CardTitle>
            </CardHeader>
            <CardContent>
              {pendentes.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">Nenhum lançamento pendente neste período.</p>
              ) : (
                <Table>
                  <TableBody>
                    {pendentes.map((t) => (
                      <TableRow key={t.id} className={canWrite ? "cursor-pointer" : undefined} onClick={() => canWrite && setEditing(t)}>
                        <TableCell className="tabular">{date(t.occurred_on)}</TableCell>
                        <TableCell>{t.counterparty_raw}</TableCell>
                        <TableCell className="tabular text-right">{money(t.amount_cents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </RequestState>

      <RequestState
        isLoading={isLoading}
        error={error}
        isEmpty={(transactions ?? []).length === 0}
        emptyMessage="Nenhum lançamento neste período."
        onRetry={refetch}
      >
        {summary && summary.unresolved_count > 0 && (
          <p className="mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            <AlertTriangle className="size-4 shrink-0" />
            {summary.unresolved_count} lançamento(s) sem fornecedor cadastrado vinculado.
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Favorecido</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="tabular text-right">Valor</TableHead>
              {canWrite && <TableHead className="w-20" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(transactions ?? []).map((transaction) => (
              <TableRow key={transaction.id}>
                <TableCell className="tabular">{date(transaction.occurred_on)}</TableCell>
                <TableCell>
                  <span className="font-medium">{transaction.counterparty_raw}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="ml-1.5 inline size-3.5 shrink-0 text-muted-foreground align-text-top" />
                    </TooltipTrigger>
                    <TooltipContent>{provenanceLabel(transaction)}</TooltipContent>
                  </Tooltip>
                  {transaction.supplier_id === null && (
                    <StatusBadge tone="attention" className="ml-2">
                      Sem fornecedor
                    </StatusBadge>
                  )}
                  {transaction.installment_total && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {transaction.installment_index}/{transaction.installment_total}
                    </span>
                  )}
                </TableCell>
                <TableCell>{transaction.category}</TableCell>
                <TableCell>
                  {KIND_LABELS[transaction.kind] ?? transaction.kind}
                  {transaction.nature && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({NATURE_LABELS[transaction.nature] ?? transaction.nature})
                    </span>
                  )}
                </TableCell>
                <TableCell
                  className={`tabular text-right ${transaction.direction === "inflow" ? "text-success" : ""}`}
                >
                  {transaction.direction === "inflow" ? "+" : "−"}
                  {money(transaction.amount_cents)}
                </TableCell>
                {canWrite && (
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" title="Editar" onClick={() => setEditing(transaction)}>
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Excluir"
                      onClick={() => deleteTransaction(transaction.id)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </RequestState>

      {editing && (
        <ResourceFormDialog
          key={editing.id}
          title="Editar lançamento"
          schema={transactionSchema}
          fields={fields}
          defaultValues={
            {
              account_id: String(editing.account_id),
              occurred_on: editing.occurred_on.slice(0, 10),
              period: editing.period,
              direction: editing.direction,
              amount: fromCents(editing.amount_cents),
              counterparty_raw: editing.counterparty_raw,
              entry_type: editing.entry_type,
              category: editing.category,
              kind: editing.kind,
              nature: editing.nature ?? undefined,
            } as TransactionForm
          }
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onSubmit={(values) => updateTransaction({ id: editing.id, ...values, ...submitValues(values) }).unwrap()}
        />
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "positive" | "critical" | "attention" | "muted";
  hint?: string;
}) {
  const color =
    tone === "positive" ? "text-success" : tone === "critical" ? "text-destructive" : tone === "attention" ? "text-warning" : "";
  return (
    <Card className={tone === "muted" ? "border-dashed" : undefined}>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`tabular text-2xl font-semibold ${tone === "muted" ? "text-muted-foreground" : color}`}>{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * `supplier_id` nunca é preenchido hoje — nem a classificação automática
 * nem este formulário o setam (gap documentado em CLAUDE.md) — então o
 * agrupamento por fornecedor usa o favorecido normalizado, não o FK de
 * `suppliers-service`. Mesmo mecanismo do de-para (`normalizeCounterparty`).
 */
function groupBySupplier(transactions: BankTransaction[]) {
  const map = new Map<string, BankTransaction[]>();
  for (const t of transactions) {
    const key = normalizeCounterpartyForGrouping(t.counterparty_raw);
    const list = map.get(key) ?? [];
    list.push(t);
    map.set(key, list);
  }
  return Array.from(map, ([key, items]) => ({
    key,
    label: items[0].counterparty_raw,
    items,
    total: items.reduce((sum, t) => sum + t.amount_cents, 0),
  })).sort((a, b) => b.total - a.total);
}

/** Os N períodos até o mês corrente, do mais recente para o mais antigo. */
function lastPeriods(n: number): string[] {
  const out: string[] = [];
  const cursor = new Date();
  for (let i = 0; i < n; i += 1) {
    out.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return out;
}
