"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { ResourceFormDialog, fromCents, toCents, type FieldSpec } from "@/components/resource-form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CONTRACT_KIND_LABELS,
  CONTRACT_KINDS,
  useCreateContractMutation,
  useGetClientsQuery,
  useGetContractsQuery,
  useUpdateContractMutation,
  type Contract,
} from "@/lib/api/billing";
import { useHasPermission } from "@/lib/auth/use-permission";
import { bps, date, money } from "@/lib/format";

const contractSchema = z.object({
  client_id: z.string().min(1, "Escolha o cliente"),
  reference: z.string().min(1, "Informe a referência"),
  kind: z.enum(CONTRACT_KINDS),
  monthly_fee: z.string().optional(),
  revenue_share_pct: z.string().optional(),
  convenience_fee_pct: z.string().optional(),
  payment_term_days: z.string().optional(),
  starts_on: z.string().min(1, "Informe o início"),
  ends_on: z.string().optional(),
  store_ids: z.string().optional(),
});

type ContractForm = z.infer<typeof contractSchema>;

/** Percentual do formulário (5 = 5%) → basis points (500). */
function pctToBps(value: string | undefined): number {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function parseStoreIds(value: string | undefined): number[] {
  return String(value ?? "")
    .split(/[,\s]+/)
    .map((part) => Number(part))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export default function ContractsPage() {
  const { data: contracts, isLoading, error, refetch } = useGetContractsQuery();
  const { data: clients } = useGetClientsQuery();
  const [createContract] = useCreateContractMutation();
  const [updateContract] = useUpdateContractMutation();
  const canWrite = useHasPermission("billing:write");
  const [editing, setEditing] = useState<Contract | null>(null);

  const fields: FieldSpec<ContractForm>[] = [
    {
      name: "client_id",
      label: "Cliente",
      kind: "select",
      options: (clients ?? []).map((c) => ({ value: String(c.id), label: c.name })),
    },
    { name: "reference", label: "Referência", kind: "text", placeholder: "Contrato de parceria Agiliz.ai & Ascenty" },
    {
      name: "kind",
      label: "Tipo",
      kind: "select",
      options: CONTRACT_KINDS.map((k) => ({ value: k, label: CONTRACT_KIND_LABELS[k] })),
    },
    { name: "monthly_fee", label: "Mensalidade (R$)", kind: "number" },
    { name: "revenue_share_pct", label: "Repasse (%)", kind: "number", placeholder: "5" },
    { name: "convenience_fee_pct", label: "Taxa de conveniência (%)", kind: "number" },
    { name: "payment_term_days", label: "Prazo de pagamento (dias)", kind: "number", placeholder: "30" },
    { name: "starts_on", label: "Início", kind: "date" },
    { name: "ends_on", label: "Fim", kind: "date" },
    {
      name: "store_ids",
      label: "Lojas cobertas (ids)",
      kind: "text",
      placeholder: "1, 2, 3",
      hint: "Ao editar, esta lista SUBSTITUI a cobertura inteira.",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contratos"
        description="Mensalidade, repasse e taxa de conveniência negociados com cada cliente."
        actions={
          canWrite ? (
            <ResourceFormDialog
              title="Novo contrato"
              trigger={
                <Button>
                  <Plus /> Novo contrato
                </Button>
              }
              schema={contractSchema}
              fields={fields}
              defaultValues={{ kind: "partnership", payment_term_days: "30" } as ContractForm}
              onSubmit={(values) =>
                createContract({
                  client_id: Number(values.client_id),
                  reference: values.reference,
                  kind: values.kind,
                  monthly_fee_cents: toCents(values.monthly_fee ?? "0"),
                  revenue_share_bps: pctToBps(values.revenue_share_pct),
                  convenience_fee_bps: pctToBps(values.convenience_fee_pct),
                  payment_term_days: Number(values.payment_term_days || 30),
                  starts_on: values.starts_on,
                  ends_on: values.ends_on || undefined,
                  store_ids: parseStoreIds(values.store_ids),
                }).unwrap()
              }
            />
          ) : null
        }
      />

      <RequestState
        isLoading={isLoading}
        error={error}
        isEmpty={(contracts ?? []).length === 0}
        emptyMessage="Nenhum contrato cadastrado."
        onRetry={refetch}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Referência</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="tabular text-right">Mensalidade</TableHead>
              <TableHead className="tabular text-right">Repasse</TableHead>
              <TableHead className="tabular text-right">Lojas</TableHead>
              <TableHead>Vigência</TableHead>
              <TableHead>Situação</TableHead>
              {canWrite && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(contracts ?? []).map((contract) => (
              <TableRow key={contract.id}>
                <TableCell className="font-medium">{contract.reference}</TableCell>
                <TableCell>{contract.client?.name ?? `#${contract.client_id}`}</TableCell>
                <TableCell>{CONTRACT_KIND_LABELS[contract.kind] ?? contract.kind}</TableCell>
                <TableCell className="tabular text-right">{money(contract.monthly_fee_cents)}</TableCell>
                <TableCell className="tabular text-right">{bps(contract.revenue_share_bps)}</TableCell>
                <TableCell className="tabular text-right">{contract.stores?.length ?? 0}</TableCell>
                <TableCell className="tabular">
                  {date(contract.starts_on)}
                  {contract.ends_on ? ` – ${date(contract.ends_on)}` : ""}
                </TableCell>
                <TableCell>
                  <StatusBadge tone={contract.status === "active" ? "positive" : "neutral"}>
                    {contract.status === "active" ? "Ativo" : contract.status === "ended" ? "Encerrado" : "Rascunho"}
                  </StatusBadge>
                </TableCell>
                {canWrite && (
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" title="Editar" onClick={() => setEditing(contract)}>
                      <Pencil />
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
          title={`Editar ${editing.reference}`}
          description="Enviar a lista de lojas substitui a cobertura inteira do contrato."
          schema={contractSchema}
          fields={fields}
          defaultValues={
            {
              client_id: String(editing.client_id),
              reference: editing.reference,
              kind: editing.kind as ContractForm["kind"],
              monthly_fee: fromCents(editing.monthly_fee_cents),
              revenue_share_pct: String(editing.revenue_share_bps / 100),
              convenience_fee_pct: String(editing.convenience_fee_bps / 100),
              payment_term_days: String(editing.payment_term_days),
              starts_on: editing.starts_on.slice(0, 10),
              ends_on: editing.ends_on?.slice(0, 10) ?? "",
              store_ids: (editing.stores ?? []).map((s) => s.store_id).join(", "),
            } as ContractForm
          }
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onSubmit={(values) =>
            updateContract({
              id: editing.id,
              reference: values.reference,
              kind: values.kind,
              monthly_fee_cents: toCents(values.monthly_fee ?? "0"),
              revenue_share_bps: pctToBps(values.revenue_share_pct),
              convenience_fee_bps: pctToBps(values.convenience_fee_pct),
              payment_term_days: Number(values.payment_term_days || 30),
              starts_on: values.starts_on,
              ends_on: values.ends_on || undefined,
              store_ids: parseStoreIds(values.store_ids),
            }).unwrap()
          }
        />
      )}
    </div>
  );
}
