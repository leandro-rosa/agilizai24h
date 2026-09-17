"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Calculator,
  Camera,
  Car,
  Cherry,
  ChevronDown,
  ChevronRight,
  Clock,
  Cloud,
  Coffee,
  CreditCard,
  FlaskConical,
  Fuel,
  HandCoins,
  Info,
  Landmark,
  Megaphone,
  MonitorSmartphone,
  Package,
  PackageOpen,
  Palette,
  Pencil,
  Percent,
  Plus,
  Receipt,
  SquareParking,
  Trash2,
  Truck,
  Undo2,
  Upload,
  UtensilsCrossed,
  Users,
  Wand2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { z } from "zod";

import { DateRangePicker, type DayRange } from "@/components/date-range-picker";
import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { ResourceFormDialog, fromCents, toCents, type FieldSpec } from "@/components/resource-form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { SummaryCard } from "@/components/summary-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
  useApplyMappingsMutation,
  useBulkUpdateTransactionsMutation,
  useCreateTransactionMutation,
  useDeleteTransactionMutation,
  useGetAccountsQuery,
  useGetCategoriesQuery,
  useGetMappingsQuery,
  useGetPendingImportsQuery,
  useGetTransactionSummaryQuery,
  useGetTransactionsQuery,
  useUpdateTransactionMutation,
  type BankTransaction,
  type Nature,
} from "@/lib/api/treasury";
import { useGetSuppliersQuery, type Supplier } from "@/lib/api/suppliers";
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
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);
  const [pendingDialogOpen, setPendingDialogOpen] = useState(false);
  const [categoryGridExpanded, setCategoryGridExpanded] = useState(false);

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
  // Só para o "vs período anterior" dos cards de Entrada/Despesa — mesmo
  // endpoint, um mês antes; `skip` deixa de buscar sem período resolvido.
  const { data: previousSummary } = useGetTransactionSummaryQuery(
    { period: shiftPeriod(period, -1) },
    { skip: !period },
  );
  const {
    data: periodTransactions,
    isLoading: periodLoading,
    error: periodError,
    refetch: refetchPeriod,
  } = useGetTransactionsQuery({ period });
  const { data: accounts } = useGetAccountsQuery();
  // Fornecedor real (suppliers-service) — usado só para resolver nome/categoria
  // no agrupamento "Despesa por fornecedor" abaixo, não para o formulário de
  // lançamento (que continua um texto livre em `counterparty_raw`).
  const { data: suppliers } = useGetSuppliersQuery();
  const supplierById = useMemo(() => new Map((suppliers ?? []).map((s) => [s.id, s])), [suppliers]);
  const accountById = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a])), [accounts]);
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

  const mappingById = useMemo(() => new Map((mappings ?? []).map((m) => [m.id, m])), [mappings]);
  const importById = useMemo(() => new Map((importsForPeriod ?? []).map((i) => [i.id, i])), [importsForPeriod]);

  // `useCallback` (não só uma função comum) é o que mantém a referência
  // estável entre renders — necessário para o `React.memo` de
  // `TransactionsTable` conseguir pular o re-render quando só um estado
  // não relacionado (ex: `expandedCategory`) muda na página.
  const provenanceLabel = useCallback(
    (t: BankTransaction): string => {
      if (t.pending_import_id === null) return "Lançamento manual";
      const source = importById.get(t.pending_import_id);
      const originText = source ? `Extrato: ${TREASURY_SOURCE_LABELS[source.source]} · ${fmtPeriod(source.period)}` : "Extrato";
      if (t.mapping_rule_id !== null) {
        const rule = mappingById.get(t.mapping_rule_id);
        return `${originText} — Classificado pela regra: ${rule?.display_name ?? "(regra removida)"}`;
      }
      if (t.kind === "pending") return `${originText} — Ainda sem classificação`;
      return `${originText} — Classificado pelo formato do arquivo`;
    },
    [importById, mappingById],
  );

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

  const pendentes = useMemo(() => (periodTransactions ?? []).filter((t) => t.kind === "pending"), [periodTransactions]);
  // Despesa de verdade (kind: expense) + o único bucket de `movement` que
  // entra aqui de propósito — empréstimo de sócio não é resultado (não soma
  // ao DRE), mas o operador quer acompanhar Josias/Gerson no mesmo painel;
  // o grupo "Empréstimos" abaixo deixa isso visualmente separado do resto.
  const porGrupo = useMemo(
    () =>
      groupByExpenseGroupThenSupplier(
        (periodTransactions ?? []).filter(
          (t) => t.kind === "expense" || (t.kind === "movement" && t.category === "Financiamento/empréstimo"),
        ),
        supplierById,
      ),
    [periodTransactions, supplierById],
  );
  // Só Entrada/Despesa — Movimentação e Pendente saíram do gráfico (pedido
  // do operador): pendente já é o card "Pendente", movimentação passa a
  // viver na tela de Fluxo de caixa (lente de caixa, não de classificação).
  // Ordem fixa (não por valor): comparação categórica entre 2 `kind`, não
  // ranking — barras não devem trocar de posição mês a mês.
  const porTipo = useMemo(
    () =>
      (["revenue", "expense"] as const).map((kind) => {
        const rows = (periodTransactions ?? []).filter((t) => t.kind === kind);
        return {
          kind,
          label: KIND_LABELS[kind],
          amount: rows.reduce((sum, t) => sum + t.amount_cents, 0) / 100,
          count: rows.length,
        };
      }),
    [periodTransactions],
  );
  // `nature` só existe para `kind: expense` — os outros 3 `kind` nunca
  // entram aqui. "sem_natureza" é o catch-all defensivo para uma despesa
  // ainda não classificada até o fim (mesma filosofia de `porTipo` mostrar
  // R$0,00 em vez de esconder um `kind` sem linha nenhuma no mês).
  const porNatureza: { nature: NatureBucket; label: string; amount: number; count: number }[] = useMemo(
    () =>
      NATURE_BUCKETS.map((bucket) => {
        const rows = (periodTransactions ?? []).filter(
          (t) => t.kind === "expense" && (bucket === "sem_natureza" ? t.nature === null : t.nature === bucket),
        );
        return {
          nature: bucket,
          label: bucket === "sem_natureza" ? "Sem natureza" : NATURE_LABELS[bucket],
          amount: rows.reduce((sum, t) => sum + t.amount_cents, 0) / 100,
          count: rows.length,
        };
      }),
    [periodTransactions],
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SummaryCard
                label="Entrada consolidada"
                value={money(summary.inflow_cents)}
                tone="positive"
                icon={ArrowUpCircle}
                trend={previousSummary ? trendPercent(summary.inflow_cents, previousSummary.inflow_cents) : undefined}
              />
              <SummaryCard
                label="Despesa confirmada"
                value={money(summary.outflow_cents)}
                tone="critical"
                icon={ArrowDownCircle}
                trend={previousSummary ? trendPercent(summary.outflow_cents, previousSummary.outflow_cents) : undefined}
              />
              <SummaryCard
                label="Pendente"
                value={money(summary.pending_cents)}
                tone="attention"
                icon={Clock}
                hint={`${summary.pending_count} lançamento(s) — clique para ver`}
                onClick={summary.pending_count > 0 ? () => setPendingDialogOpen(true) : undefined}
              />
            </div>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">Despesa por categoria</CardTitle>
                {summary.by_category.length > CATEGORY_GRID_COLLAPSED_COUNT && (
                  <Button variant="ghost" size="sm" onClick={() => setCategoryGridExpanded((v) => !v)}>
                    {categoryGridExpanded ? "Ver menos" : "Ver detalhes"}
                    <ChevronRight className={`size-4 transition-transform ${categoryGridExpanded ? "rotate-90" : ""}`} />
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {summary.by_category.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">Nenhuma despesa classificada neste período.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                    {(categoryGridExpanded ? summary.by_category : summary.by_category.slice(0, CATEGORY_GRID_COLLAPSED_COUNT)).map(
                      (row) => {
                        const Icon = CATEGORY_ICONS[row.category] ?? Receipt;
                        return (
                          <div key={row.category} className="flex items-center gap-2.5 rounded-lg border p-3">
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                              <Icon className="size-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-xs text-muted-foreground" title={row.category}>
                                {row.category}
                              </p>
                              <p className="tabular text-sm font-semibold">{money(row.outflow_cents)}</p>
                            </div>
                          </div>
                        );
                      },
                    )}
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
              {porGrupo.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">Nenhuma despesa classificada neste período.</p>
              ) : (
                <div className="flex flex-col">
                  {porGrupo.map((cat) => (
                    <div key={cat.key} className="border-b py-2 last:border-b-0">
                      <button
                        className="flex w-full items-center justify-between text-left"
                        onClick={() => setExpandedCategory(expandedCategory === cat.key ? null : cat.key)}
                      >
                        <span className="flex items-center gap-1.5 font-medium">
                          {expandedCategory === cat.key ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          {cat.label}
                        </span>
                        <span className="tabular">{money(cat.total)}</span>
                      </button>
                      {expandedCategory === cat.key && (
                        <div className="mt-2 flex flex-col gap-1 pl-5">
                          {cat.suppliers.map((group) => (
                            <div key={group.key} className="border-b py-1.5 last:border-b-0">
                              <button
                                className="flex w-full items-center justify-between text-left"
                                onClick={() => setExpandedSupplier(expandedSupplier === group.key ? null : group.key)}
                              >
                                <span className="flex items-center gap-1.5">
                                  {expandedSupplier === group.key ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                                  {group.label}
                                </span>
                                <span className="tabular">{money(group.total)}</span>
                              </button>
                              {expandedSupplier === group.key && (
                                <div className="mt-1.5 flex flex-col gap-1 pl-5">
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
            <CardContent className="max-h-96 overflow-y-auto">
              <PendingTable
                pendentes={pendentes}
                accountById={accountById}
                canWrite={canWrite}
                onSelect={setEditing}
                emptyMessage="Nenhum lançamento pendente neste período."
              />
            </CardContent>
          </Card>
        </div>
      </RequestState>

      <Dialog open={pendingDialogOpen} onOpenChange={setPendingDialogOpen}>
        <DialogContent className="max-h-[85vh] w-full max-w-3xl overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Lançamentos pendentes — {fmtPeriod(period)}</DialogTitle>
          </DialogHeader>
          <PendingTable
            pendentes={pendentes}
            accountById={accountById}
            canWrite={canWrite}
            onSelect={(t) => {
              setPendingDialogOpen(false);
              setEditing(t);
            }}
            emptyMessage="Nenhum lançamento pendente neste período."
          />
        </DialogContent>
      </Dialog>

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
        <TransactionsTable
          transactions={transactions ?? []}
          accountById={accountById}
          canWrite={canWrite}
          onEdit={setEditing}
          onDelete={deleteTransaction}
          provenanceLabel={provenanceLabel}
        />
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

/**
 * Lista de pendentes com o contexto necessário para identificar o
 * lançamento sem abrir mais nada — banco (via `accountById`, resolvido no
 * cliente pelo mesmo motivo de `mappingById`/`importById` acima: poucas
 * dezenas de contas, não justifica incluir o relacionamento na API), data e
 * direção (entrada/saída), igual à tabela principal de "Lançamentos" mais
 * abaixo. Clicar na linha abre o mesmo formulário de edição de
 * "Novo lançamento"/"Editar lançamento" — é onde o kind/categoria/natureza
 * são corrigidos, não há um formulário de classificação em separado.
 */
function PendingTable({
  pendentes,
  accountById,
  canWrite,
  onSelect,
  emptyMessage,
}: {
  pendentes: BankTransaction[];
  accountById: Map<number, { name: string }>;
  canWrite: boolean;
  onSelect: (t: BankTransaction) => void;
  emptyMessage: string;
}) {
  if (pendentes.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data</TableHead>
          <TableHead>Banco</TableHead>
          <TableHead>Favorecido</TableHead>
          <TableHead>Direção</TableHead>
          <TableHead className="tabular text-right">Valor</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pendentes.map((t) => (
          <TableRow key={t.id} className={canWrite ? "cursor-pointer" : undefined} onClick={() => canWrite && onSelect(t)}>
            <TableCell className="tabular whitespace-nowrap">{date(t.occurred_on)}</TableCell>
            <TableCell className="whitespace-nowrap">{accountById.get(t.account_id)?.name ?? `Conta ${t.account_id}`}</TableCell>
            <TableCell>{t.counterparty_raw}</TableCell>
            <TableCell className={t.direction === "inflow" ? "text-success" : undefined}>
              {t.direction === "inflow" ? "Entrada" : "Saída"}
            </TableCell>
            <TableCell className="tabular text-right whitespace-nowrap">{money(t.amount_cents)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Extraída da página principal e envolvida em `memo` de propósito: um
 * período cheio passa de 2 mil lançamentos, e antes desse componente existir
 * essa tabela inteira (com `Tooltip` do Radix por linha) era recriada e
 * reconciliada a cada clique em QUALQUER outro lugar da página — expandir
 * uma categoria em "Despesa por fornecedor", abrir o modal de pendentes,
 * etc. — porque todo o estado de `TreasuryPage` vive num componente só. Sem
 * o `memo` aqui (e sem `provenanceLabel` ser `useCallback` lá em cima), isso
 * media consistentemente 1-4s por clique, escalando com o número de linhas
 * (medido: ~1s com 226 linhas, ~4,3s com 2272) — era a maior fatia da
 * lentidão relatada, maior que o custo dos `useMemo` de `porGrupo`/
 * `porTipo`/etc. sozinhos.
 */
/**
 * Seleção múltipla e o mutation de bulk-update vivem AQUI DENTRO, não no
 * componente pai — se `selected` fosse estado de `TreasuryPage`, marcar uma
 * única linha re-renderizaria a página inteira (e, com ela, esta mesma
 * tabela de novo, o problema que o `memo` acima existe pra evitar). Cada
 * clique de seleção fica contido neste componente.
 */
const TransactionsTable = memo(function TransactionsTable({
  transactions,
  accountById,
  canWrite,
  onEdit,
  onDelete,
  provenanceLabel,
}: {
  transactions: BankTransaction[];
  accountById: Map<number, { name: string }>;
  canWrite: boolean;
  onEdit: (t: BankTransaction) => void;
  onDelete: (id: number) => void;
  provenanceLabel: (t: BankTransaction) => string;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkNature, setBulkNature] = useState<Nature | "">("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [updateTransaction] = useUpdateTransactionMutation();
  const [bulkUpdateTransactions, { isLoading: bulkApplying }] = useBulkUpdateTransactionsMutation();
  const { data: categories } = useGetCategoriesQuery();

  const allSelected = transactions.length > 0 && transactions.every((t) => selected.has(t.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(transactions.map((t) => t.id)));
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulk() {
    if (!bulkNature && !bulkCategory) return;
    const result = await bulkUpdateTransactions({
      ids: Array.from(selected),
      ...(bulkNature ? { nature: bulkNature } : {}),
      ...(bulkCategory ? { category: bulkCategory } : {}),
    })
      .unwrap()
      .catch(() => null);
    if (result) {
      toast.success(`${result.updated} lançamento(s) atualizado(s).`);
      setSelected(new Set());
      setBulkNature("");
      setBulkCategory("");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {canWrite && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selecionado(s)</span>
          <Select value={bulkNature} onValueChange={(value) => setBulkNature(value as Nature)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Aplicar natureza" />
            </SelectTrigger>
            <SelectContent>
              {NATURES.map((n) => (
                <SelectItem key={n} value={n}>
                  {NATURE_LABELS[n]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Aplicar categoria"
            value={bulkCategory}
            onChange={(e) => setBulkCategory(e.target.value)}
            list="treasury-categories"
            className="w-48"
          />
          <Button size="sm" onClick={applyBulk} disabled={bulkApplying || (!bulkNature && !bulkCategory)}>
            {bulkApplying ? "Aplicando..." : "Aplicar"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </Button>
        </div>
      )}
      <datalist id="treasury-categories">
        {(categories ?? []).map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <Table>
        <TableHeader>
          <TableRow>
            {canWrite && (
              <TableHead className="w-10">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Selecionar todos" />
              </TableHead>
            )}
            <TableHead>Data</TableHead>
            <TableHead>Descrição/Origem</TableHead>
            <TableHead>Natureza</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead className="tabular text-right">Valor</TableHead>
            <TableHead>Status</TableHead>
            {canWrite && <TableHead className="w-20" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((transaction) => (
            <TableRow key={transaction.id}>
              {canWrite && (
                <TableCell>
                  <Checkbox
                    checked={selected.has(transaction.id)}
                    onCheckedChange={() => toggleOne(transaction.id)}
                    aria-label={`Selecionar lançamento de ${date(transaction.occurred_on)}`}
                  />
                </TableCell>
              )}
              <TableCell className="tabular whitespace-nowrap">{date(transaction.occurred_on)}</TableCell>
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
                <div className="text-xs text-muted-foreground">
                  {accountById.get(transaction.account_id)?.name ?? `Conta ${transaction.account_id}`}
                </div>
              </TableCell>
              <TableCell>
                {transaction.kind !== "expense" ? (
                  <span className="text-muted-foreground">—</span>
                ) : canWrite ? (
                  <Select
                    value={transaction.nature ?? undefined}
                    onValueChange={(value) => updateTransaction({ id: transaction.id, nature: value as Nature })}
                  >
                    <SelectTrigger className="w-36" data-size="sm">
                      <SelectValue placeholder="Definir" />
                    </SelectTrigger>
                    <SelectContent>
                      {NATURES.map((n) => (
                        <SelectItem key={n} value={n}>
                          {NATURE_LABELS[n]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  (transaction.nature && NATURE_LABELS[transaction.nature]) || "—"
                )}
              </TableCell>
              <TableCell>
                {canWrite ? (
                  <Input
                    defaultValue={transaction.category}
                    list="treasury-categories"
                    className="w-40"
                    onBlur={(e) => {
                      const value = e.target.value.trim();
                      if (value && value !== transaction.category) {
                        updateTransaction({ id: transaction.id, category: value });
                      }
                    }}
                  />
                ) : (
                  transaction.category
                )}
              </TableCell>
              <TableCell className={`tabular text-right ${transaction.direction === "inflow" ? "text-success" : ""}`}>
                {transaction.direction === "inflow" ? "+" : "−"}
                {money(transaction.amount_cents)}
              </TableCell>
              <TableCell>
                <StatusBadge tone={transaction.kind === "pending" ? "attention" : "positive"}>
                  {transaction.kind === "pending" ? "Pendente de classificação" : "Confirmado"}
                </StatusBadge>
              </TableCell>
              {canWrite && (
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" title="Editar" onClick={() => onEdit(transaction)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon" title="Excluir" onClick={() => onDelete(transaction.id)}>
                    <Trash2 />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
});

/** Sentinela de chave para despesa sem `supplier_id` — mantém o grupo visível
 * em vez de escondê-lo, mesma filosofia de "sem_natureza" em `porNatureza`. */
const SEM_FORNECEDOR_KEY = "sem-fornecedor";

function groupBySupplier(transactions: BankTransaction[], supplierById: Map<number, Supplier>) {
  const map = new Map<string, BankTransaction[]>();
  for (const t of transactions) {
    const key = t.supplier_id === null ? SEM_FORNECEDOR_KEY : String(t.supplier_id);
    const list = map.get(key) ?? [];
    list.push(t);
    map.set(key, list);
  }
  return Array.from(map, ([key, items]) => {
    const supplier = key === SEM_FORNECEDOR_KEY ? null : supplierById.get(Number(key));
    return {
      key,
      label: supplier?.name ?? "Sem fornecedor",
      items,
      total: items.reduce((sum, t) => sum + t.amount_cents, 0),
    };
  }).sort((a, b) => b.total - a.total);
}

/**
 * Grupo por `bank_transaction.category` (texto livre do de-para — ex.
 * "Combustível", "Estoque", "Financiamento/empréstimo" — não o vocabulário
 * fechado de `Supplier.category` em `suppliers-service`). Um fornecedor só
 * tem UMA categoria própria, mas o mesmo fornecedor pode gerar lançamentos
 * de tipos diferentes (Josias: "Pró-labore" num mês, "Financiamento/
 * empréstimo" — o valor certinho de R$3.852,44 — noutro), então agrupar
 * pela categoria do lançamento em vez da do fornecedor é o que mantém os
 * R$3.852,44 do Josias dentro de "Empréstimos" mesmo o resto do que ele
 * recebe caindo em "Despesas fixas" (pró-labore) — pedido explícito do
 * operador. Categoria sem grupo mapeado cai em "Outras despesas" — nunca
 * some, mesma filosofia de "sem_natureza"/"Sem fornecedor".
 */
/** Quantas categorias mostrar antes do "Ver detalhes" expandir o resto. */
const CATEGORY_GRID_COLLAPSED_COUNT = 12;

/** Ícone por `bank_transaction.category` (texto livre) só de apoio visual
 * no card-grid de "Despesa por categoria" — categoria sem ícone mapeado usa
 * `Receipt` (genérico), nunca quebra por categoria nova/imprevista. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Estoque: Package,
  Frutas: Cherry,
  "Investimento (cartão sócio)": CreditCard,
  "Pró-labore": Users,
  "Financeiro/Tributos": Landmark,
  "Juros de conta": Percent,
  Combustível: Fuel,
  "Sistema Touchpay": MonitorSmartphone,
  "Sistema (câmeras)": Camera,
  "Repasse de receita (Plena Saúde)": HandCoins,
  Equipamento: Wrench,
  "Equipamento/móveis/manutenção": Wrench,
  "Coffee break": Coffee,
  Contador: Calculator,
  Alimentação: UtensilsCrossed,
  "Decoração de loja nova": Palette,
  "Manutenção de veículo": Car,
  Estacionamento: SquareParking,
  "Cloud/Apple": Cloud,
  Frete: Truck,
  "Frete e envelopamento (loja nova)": PackageOpen,
  "Consumo interno/teste": FlaskConical,
  Marketing: Megaphone,
  "Perdas/devoluções": Undo2,
};

const EXPENSE_GROUPS: { label: string; categories: string[] }[] = [
  { label: "Despesas variáveis", categories: ["Combustível", "Estacionamento", "Alimentação", "Manutenção de veículo", "Coffee break", "Frete"] },
  { label: "Despesas fixas", categories: ["Sistema Touchpay", "Sistema (câmeras)", "Cloud/Apple", "Contador", "Pró-labore", "Marketing"] },
  { label: "Despesas financeiras", categories: ["Financeiro/Tributos", "Juros de conta"] },
  { label: "Frutas", categories: ["Frutas"] },
  { label: "Despesas operacionais", categories: ["Estoque"] },
  { label: "Investimento loja", categories: ["Equipamento", "Equipamento/móveis/manutenção", "Decoração de loja nova", "Frete e envelopamento (loja nova)", "Investimento (cartão sócio)"] },
  { label: "Empréstimos", categories: ["Financiamento/empréstimo"] },
];
const OUTRAS_DESPESAS_LABEL = "Outras despesas";
const categoryToGroupLabel = new Map(EXPENSE_GROUPS.flatMap((g) => g.categories.map((c) => [c, g.label])));

function groupByExpenseGroupThenSupplier(transactions: BankTransaction[], supplierById: Map<number, Supplier>) {
  const byGroup = new Map<string, BankTransaction[]>();
  for (const t of transactions) {
    const key = categoryToGroupLabel.get(t.category) ?? OUTRAS_DESPESAS_LABEL;
    const list = byGroup.get(key) ?? [];
    list.push(t);
    byGroup.set(key, list);
  }
  return Array.from(byGroup, ([key, items]) => ({
    key,
    label: key,
    suppliers: groupBySupplier(items, supplierById),
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

/** "2026-08" deslocado N meses (negativo = pra trás) — usado só para achar
 * o período anterior do "vs período anterior" dos cards de resumo. */
function shiftPeriod(period: string, deltaMonths: number): string {
  const [year, month] = period.split("-").map(Number);
  const d = new Date(year, month - 1 + deltaMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * `null` quando o período anterior não tem base pra comparar (0 lançamento
 * ou 0 absoluto) — vira "sem comparação" na UI em vez de um "+∞%"/"-100%"
 * sem sentido, mesma filosofia de "vazio honesto" do resto do painel.
 */
function trendPercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
