"use client";

import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { ResourceFormDialog, toCents, type FieldSpec } from "@/components/resource-form-dialog";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  INVOICE_KIND_LABELS,
  INVOICE_KINDS,
  INVOICE_STATUS_LABELS,
  useCreateInvoiceMutation,
  useGetAgingQuery,
  useGetClientsQuery,
  useGetContractsQuery,
  useGetInvoicesQuery,
  usePayInvoiceMutation,
  type Invoice,
} from "@/lib/api/billing";
import { useHasPermission } from "@/lib/auth/use-permission";
import { count, date, money, period as fmtPeriod } from "@/lib/format";

const invoiceSchema = z.object({
  client_id: z.string().min(1, "Escolha o cliente"),
  contract_id: z.string().optional(),
  number: z.string().min(1, "Informe o número"),
  purchase_order: z.string().optional(),
  kind: z.enum(INVOICE_KINDS),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use "AAAA-MM"'),
  amount: z.string().min(1, "Informe o valor"),
  issued_on: z.string().min(1, "Informe a emissão"),
});

type InvoiceForm = z.infer<typeof invoiceSchema>;

export default function InvoicesPage() {
  const [status, setStatus] = useState<string>("all");
  const filter = status === "all" ? undefined : { status };

  const { data: invoices, isLoading, error, refetch } = useGetInvoicesQuery(filter);
  const { data: aging } = useGetAgingQuery();
  const { data: clients } = useGetClientsQuery();
  const { data: contracts } = useGetContractsQuery();
  const [createInvoice] = useCreateInvoiceMutation();
  const [payInvoice] = usePayInvoiceMutation();
  const canWrite = useHasPermission("billing:write");

  const fields: FieldSpec<InvoiceForm>[] = [
    {
      name: "client_id",
      label: "Cliente",
      kind: "select",
      options: (clients ?? []).map((c) => ({ value: String(c.id), label: c.name })),
    },
    {
      name: "contract_id",
      label: "Contrato",
      kind: "select",
      options: (contracts ?? []).map((c) => ({ value: String(c.id), label: c.reference })),
      hint: "Sem contrato, o prazo cai para 30 dias.",
    },
    { name: "number", label: "Número da NF", kind: "text" },
    { name: "purchase_order", label: "PO", kind: "text" },
    {
      name: "kind",
      label: "Tipo",
      kind: "select",
      options: INVOICE_KINDS.map((k) => ({ value: k, label: INVOICE_KIND_LABELS[k] })),
    },
    { name: "period", label: "Competência", kind: "text", placeholder: "2026-07" },
    { name: "amount", label: "Valor (R$)", kind: "number" },
    { name: "issued_on", label: "Emissão", kind: "date", hint: "O vencimento é derivado da emissão + prazo." },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notas fiscais"
        description="Emissão, vencimento e o que está a receber."
        actions={
          canWrite ? (
            <ResourceFormDialog
              title="Nova nota fiscal"
              trigger={
                <Button>
                  <Plus /> Nova nota
                </Button>
              }
              schema={invoiceSchema}
              fields={fields}
              defaultValues={{ kind: "monthly_fee", issued_on: new Date().toISOString().slice(0, 10) } as InvoiceForm}
              onSubmit={({ amount, client_id, contract_id, ...values }) =>
                createInvoice({
                  ...values,
                  client_id: Number(client_id),
                  contract_id: contract_id ? Number(contract_id) : undefined,
                  amount_cents: toCents(amount),
                }).unwrap()
              }
            />
          ) : null
        }
      />

      {aging && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {aging.buckets.map((bucket) => (
            <Card key={bucket.key}>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">{bucket.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p
                  className={`tabular text-2xl font-semibold ${
                    bucket.key === "d60_plus" && bucket.amount_cents > 0
                      ? "text-destructive"
                      : bucket.key.startsWith("d") && bucket.amount_cents > 0
                        ? "text-warning"
                        : ""
                  }`}
                >
                  {money(bucket.amount_cents)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{count(bucket.invoice_count)} nota(s)</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas as situações</SelectItem>
          <SelectItem value="issued">Emitida</SelectItem>
          <SelectItem value="paid">Paga</SelectItem>
          <SelectItem value="cancelled">Cancelada</SelectItem>
        </SelectContent>
      </Select>

      <RequestState
        isLoading={isLoading}
        error={error}
        isEmpty={(invoices ?? []).length === 0}
        emptyMessage="Nenhuma nota fiscal."
        onRetry={refetch}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>NF</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Competência</TableHead>
              <TableHead>Emissão</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="tabular text-right">Valor</TableHead>
              <TableHead>Situação</TableHead>
              {canWrite && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(invoices ?? []).map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell className="tabular font-medium">{invoice.number}</TableCell>
                <TableCell>{invoice.client?.name ?? `#${invoice.client_id}`}</TableCell>
                <TableCell>{fmtPeriod(invoice.period)}</TableCell>
                <TableCell className="tabular">{date(invoice.issued_on)}</TableCell>
                <TableCell className="tabular">{date(invoice.due_on)}</TableCell>
                <TableCell className="tabular text-right">{money(invoice.amount_cents)}</TableCell>
                <TableCell>
                  <StatusBadge tone={toneOf(invoice)}>{labelOf(invoice)}</StatusBadge>
                </TableCell>
                {canWrite && (
                  <TableCell className="text-right">
                    {invoice.status === "issued" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Marcar como paga"
                        onClick={() =>
                          payInvoice({ id: invoice.id, paid_on: new Date().toISOString().slice(0, 10) })
                        }
                      >
                        <Check />
                      </Button>
                    )}
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

/**
 * "Vencida" é derivada aqui e no serviço, nunca lida de uma coluna: como
 * status persistido precisaria de um job diário, e a planilha, que só tem
 * PAGO/CANCELADA, é justamente por isso que não enxerga o vencido.
 */
function isOverdue(invoice: Invoice): boolean {
  return invoice.status === "issued" && !invoice.paid_on && invoice.due_on.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

function toneOf(invoice: Invoice): StatusTone {
  if (invoice.status === "paid") return "positive";
  if (invoice.status === "cancelled") return "neutral";
  return isOverdue(invoice) ? "critical" : "attention";
}

function labelOf(invoice: Invoice): string {
  if (invoice.status === "issued" && isOverdue(invoice)) return "Vencida";
  return INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status;
}
