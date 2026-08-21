"use client";

import { Plus, Wallet } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { ResourceFormDialog, toCents, type FieldSpec } from "@/components/resource-form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CONTRIBUTION_KIND_LABELS,
  CONTRIBUTION_KINDS,
  useAddContributionMutation,
  useCreateInvestorMutation,
  useGetInvestorQuery,
  useGetInvestorSummaryQuery,
} from "@/lib/api/capex";
import { useHasPermission } from "@/lib/auth/use-permission";
import { count, date, money } from "@/lib/format";

const investorSchema = z.object({
  name: z.string().min(1, "Informe o nome"),
  committed: z.string().optional(),
});

type InvestorForm = z.infer<typeof investorSchema>;

const contributionSchema = z.object({
  contributed_on: z.string().min(1, "Informe a data"),
  amount: z.string().min(1, "Informe o valor"),
  kind: z.enum(CONTRIBUTION_KINDS),
  note: z.string().optional(),
});

type ContributionForm = z.infer<typeof contributionSchema>;

const CONTRIBUTION_FIELDS: FieldSpec<ContributionForm>[] = [
  { name: "contributed_on", label: "Data", kind: "date" },
  { name: "amount", label: "Valor (R$)", kind: "number" },
  {
    name: "kind",
    label: "Natureza",
    kind: "select",
    options: CONTRIBUTION_KINDS.map((k) => ({ value: k, label: CONTRIBUTION_KIND_LABELS[k] })),
  },
  { name: "note", label: "Observação", kind: "text" },
];

export default function InvestorsPage() {
  const { data: rows, isLoading, error, refetch } = useGetInvestorSummaryQuery();
  const [createInvestor] = useCreateInvestorMutation();
  const canWrite = useHasPermission("capex:write");
  const [contributionsOf, setContributionsOf] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Investidores"
        description="Quanto cada um comprometeu e quanto de fato aportou."
        actions={
          canWrite ? (
            <ResourceFormDialog
              title="Novo investidor"
              trigger={
                <Button>
                  <Plus /> Novo investidor
                </Button>
              }
              schema={investorSchema}
              fields={[
                { name: "name", label: "Nome", kind: "text", placeholder: "Josias" },
                { name: "committed", label: "Valor comprometido (R$)", kind: "number" },
              ]}
              defaultValues={{ name: "" } as InvestorForm}
              onSubmit={(values) =>
                createInvestor({
                  name: values.name,
                  committed_amount_cents: toCents(values.committed ?? "0"),
                }).unwrap()
              }
            />
          ) : null
        }
      />

      <RequestState
        isLoading={isLoading}
        error={error}
        isEmpty={(rows ?? []).length === 0}
        emptyMessage="Nenhum investidor cadastrado."
        onRetry={refetch}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Investidor</TableHead>
              <TableHead className="tabular text-right">Comprometido</TableHead>
              <TableHead className="tabular text-right">Aportado</TableHead>
              <TableHead className="tabular text-right">Diferença</TableHead>
              <TableHead className="tabular text-right">Aportes</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((row) => (
              <TableRow key={row.investor_id}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="tabular text-right">{money(row.committed_amount_cents)}</TableCell>
                <TableCell className="tabular text-right">{money(row.contributed_amount_cents)}</TableCell>
                <TableCell className="tabular text-right">
                  {row.difference_cents === 0 ? (
                    <StatusBadge tone="positive">Em dia</StatusBadge>
                  ) : (
                    <span className={row.difference_cents > 0 ? "text-warning" : "text-success"}>
                      {money(row.difference_cents)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="tabular text-right">{count(row.contribution_count)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Aportes"
                    onClick={() => setContributionsOf(row.investor_id)}
                  >
                    <Wallet />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </RequestState>

      <ContributionsSheet
        investorId={contributionsOf}
        onClose={() => setContributionsOf(null)}
        canWrite={canWrite}
      />
    </div>
  );
}

function ContributionsSheet({
  investorId,
  onClose,
  canWrite,
}: {
  investorId: number | null;
  onClose: () => void;
  canWrite: boolean;
}) {
  const { data, isLoading, error, refetch } = useGetInvestorQuery(investorId as number, {
    skip: investorId === null,
  });
  const [addContribution] = useAddContributionMutation();

  return (
    <Sheet open={investorId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Aportes de {data?.name ?? "…"}</SheetTitle>
          <SheetDescription>Comprometido: {money(data?.committed_amount_cents)}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          {canWrite && investorId !== null && (
            <ResourceFormDialog
              title="Novo aporte"
              trigger={
                <Button variant="outline" className="self-start">
                  <Plus /> Novo aporte
                </Button>
              }
              schema={contributionSchema}
              fields={CONTRIBUTION_FIELDS}
              defaultValues={
                { kind: "equipment", contributed_on: new Date().toISOString().slice(0, 10) } as ContributionForm
              }
              onSubmit={(values) =>
                addContribution({
                  id: investorId,
                  contributed_on: values.contributed_on,
                  amount_cents: toCents(values.amount),
                  kind: values.kind,
                  note: values.note || undefined,
                }).unwrap()
              }
            />
          )}

          <RequestState
            isLoading={isLoading}
            error={error}
            isEmpty={(data?.contributions.length ?? 0) === 0}
            emptyMessage="Nenhum aporte registrado."
            onRetry={refetch}
            loadingRows={3}
          >
            <ul className="flex flex-col gap-2">
              {data?.contributions.map((contribution) => (
                <li key={contribution.id} className="flex items-start justify-between rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {CONTRIBUTION_KIND_LABELS[contribution.kind] ?? contribution.kind}
                    </p>
                    <p className="tabular text-xs text-muted-foreground">{date(contribution.contributed_on)}</p>
                    {contribution.note && <p className="truncate text-xs text-muted-foreground">{contribution.note}</p>}
                  </div>
                  <p className="tabular text-sm font-semibold">{money(contribution.amount_cents)}</p>
                </li>
              ))}
            </ul>
          </RequestState>
        </div>
      </SheetContent>
    </Sheet>
  );
}
