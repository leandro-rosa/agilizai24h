"use client";

import { AlertTriangle, Plus, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { ResourceFormDialog, toCents, type FieldSpec } from "@/components/resource-form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currentPeriod, date, money, period as fmtPeriod } from "@/lib/format";
import {
  NATURE_LABELS,
  NATURES,
  useApplyMappingsMutation,
  useCreateTransactionMutation,
  useDeleteTransactionMutation,
  useGetAccountsQuery,
  useGetTransactionSummaryQuery,
  useGetTransactionsQuery,
  type Nature,
} from "@/lib/api/treasury";
import { useHasPermission } from "@/lib/auth/use-permission";

const transactionSchema = z.object({
  account_id: z.string().min(1, "Escolha a conta"),
  occurred_on: z.string().min(1, "Informe a data"),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use "AAAA-MM"'),
  direction: z.enum(["inflow", "outflow"]),
  amount: z.string().min(1, "Informe o valor"),
  counterparty_raw: z.string().min(1, "Informe o favorecido"),
  entry_type: z.string().min(1, "Informe o tipo"),
  category: z.string().min(1, "Informe a categoria"),
  nature: z.enum(NATURES),
});

type TransactionForm = z.infer<typeof transactionSchema>;

export default function TreasuryPage() {
  const [period, setPeriod] = useState(currentPeriod());
  const [nature, setNature] = useState<Nature | "all">("all");

  const filter = { period, ...(nature === "all" ? {} : { nature }) };
  const { data: transactions, isLoading, error, refetch } = useGetTransactionsQuery(filter);
  const { data: summary } = useGetTransactionSummaryQuery(filter);
  const { data: accounts } = useGetAccountsQuery();
  const [createTransaction] = useCreateTransactionMutation();
  const [deleteTransaction] = useDeleteTransactionMutation();
  const [applyMappings, { isLoading: applying }] = useApplyMappingsMutation();
  const canWrite = useHasPermission("treasury:write");

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
      name: "nature",
      label: "Natureza",
      kind: "select",
      options: NATURES.map((n) => ({ value: n, label: NATURE_LABELS[n] })),
      hint: "É o eixo que leva o lançamento para a linha certa do DRE.",
    },
  ];

  async function handleApply() {
    const result = await applyMappings(period).unwrap().catch(() => null);
    if (result) {
      toast.success(`${result.classified} de ${result.examined} lançamento(s) classificado(s).`);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Lançamentos"
        description="Extrato bancário e fatura de cartão, classificados para o DRE."
        actions={
          canWrite ? (
            <div className="flex gap-2">
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
                    nature: "cogs",
                    occurred_on: new Date().toISOString().slice(0, 10),
                  } as TransactionForm
                }
                onSubmit={({ amount, account_id, ...values }) =>
                  createTransaction({
                    ...values,
                    account_id: Number(account_id),
                    amount_cents: toCents(amount),
                  }).unwrap()
                }
              />
            </div>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2">
        <Select value={period} onValueChange={setPeriod}>
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
      </div>

      {summary && (
        <>
          {summary.unresolved_count > 0 && (
            <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              <AlertTriangle className="size-4 shrink-0" />
              {summary.unresolved_count} lançamento(s) sem fornecedor resolvido — a soma por fornecedor está
              incompleta até classificá-los.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryCard label="Entradas" value={money(summary.inflow_cents)} tone="positive" />
            <SummaryCard label="Saídas" value={money(summary.outflow_cents)} tone="critical" />
            <SummaryCard label="Saldo do período" value={money(summary.net_cents)} />
          </div>

          {summary.by_nature.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">Saída por natureza</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-4">
                {summary.by_nature.map((row) => (
                  <div key={row.nature}>
                    <p className="text-xs text-muted-foreground">{NATURE_LABELS[row.nature as Nature] ?? row.nature}</p>
                    <p className="tabular text-lg font-semibold">{money(row.outflow_cents)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <RequestState
        isLoading={isLoading}
        error={error}
        isEmpty={(transactions ?? []).length === 0}
        emptyMessage="Nenhum lançamento neste período."
        onRetry={refetch}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Favorecido</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Natureza</TableHead>
              <TableHead className="tabular text-right">Valor</TableHead>
              {canWrite && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(transactions ?? []).map((transaction) => (
              <TableRow key={transaction.id}>
                <TableCell className="tabular">{date(transaction.occurred_on)}</TableCell>
                <TableCell>
                  <span className="font-medium">{transaction.counterparty_raw}</span>
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
                <TableCell>{NATURE_LABELS[transaction.nature] ?? transaction.nature}</TableCell>
                <TableCell
                  className={`tabular text-right ${transaction.direction === "inflow" ? "text-success" : ""}`}
                >
                  {transaction.direction === "inflow" ? "+" : "−"}
                  {money(transaction.amount_cents)}
                </TableCell>
                {canWrite && (
                  <TableCell className="text-right">
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
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: "positive" | "critical" }) {
  const color = tone === "positive" ? "text-success" : tone === "critical" ? "text-destructive" : "";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`tabular text-2xl font-semibold ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
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
