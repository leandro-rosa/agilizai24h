"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { ImagePlus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { ResourceFormDialog, type FieldSpec } from "@/components/resource-form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { date, money, period as fmtPeriod } from "@/lib/format";
import {
  IMPORT_STATUS_LABELS,
  MAPPING_KINDS,
  NATURE_LABELS,
  NATURES,
  TREASURY_SOURCE_LABELS,
  normalizeCounterpartyForGrouping,
  useAttachProofMutation,
  useConfirmImportMutation,
  useGetPendingImportQuery,
  useGetPendingImportsQuery,
  useRejectImportMutation,
  useUpdatePendingTransactionMutation,
  type MappingKind,
  type PendingImport,
  type PendingImportDetail,
  type PendingTransaction,
} from "@/lib/api/treasury";
import { useGetSuppliersQuery } from "@/lib/api/suppliers";
import { useHasPermission } from "@/lib/auth/use-permission";

const pendingEditSchema = z.object({
  suggested_kind: z.enum(MAPPING_KINDS),
  suggested_category: z.string().min(1, "Informe a categoria"),
  suggested_nature: z.enum(NATURES).optional(),
  suggested_supplier_id: z.string().optional(),
});

type PendingEditForm = z.infer<typeof pendingEditSchema>;

// Referências estáveis (fora do componente) para os `groupBy`/`groupLabel`
// de `GroupSection` — como prop, uma arrow function inline seria recriada a
// cada render do componente pai e invalidaria o `useMemo` interno do
// `GroupSection` sempre, mesmo sem os dados mudarem.
function groupByCategory(t: PendingTransaction): string {
  return t.suggested_category ?? "Sem categoria";
}

function groupByCounterparty(t: PendingTransaction): string {
  return normalizeCounterpartyForGrouping(t.counterparty_raw);
}

function counterpartyLabel(t: PendingTransaction): string {
  return t.counterparty_raw;
}

export default function TreasuryImportReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ period: string }>;
  searchParams: Promise<{ sources?: string }>;
}) {
  const { period } = use(params);
  const { sources } = use(searchParams);
  const expectedSources = sources ? sources.split(",") : [];
  const canWrite = useHasPermission("treasury:write");

  const [detailsById, setDetailsById] = useState<Record<number, PendingImportDetail>>({});
  const handleDetail = useCallback((id: number, detail: PendingImportDetail | undefined) => {
    if (detail) setDetailsById((prev) => (prev[id] === detail ? prev : { ...prev, [id]: detail }));
  }, []);

  const { data: imports, isLoading, error, refetch } = useGetPendingImportsQuery({ period });

  const stillWaiting =
    expectedSources.length > 0 && !expectedSources.every((source) => (imports ?? []).some((imp) => imp.source === source));

  // Logo após o upload, os arquivos ainda não viraram PendingImport (o
  // parse é assíncrono via fila) — poll (refetch por timer) até cada fonte
  // esperada aparecer. `stillWaiting` na dependência é o que para o
  // polling: quando ele vira `false`, este efeito é re-executado, limpa o
  // intervalo anterior e não cria um novo. `refetch` é chamado dentro do
  // callback do timer, não de forma síncrona no corpo do efeito.
  useEffect(() => {
    if (!stillWaiting) return;
    const id = setInterval(() => refetch(), 3000);
    return () => clearInterval(id);
  }, [stillWaiting, refetch]);

  const staged = useMemo(() => (imports ?? []).filter((imp) => imp.status === "staged"), [imports]);
  const stagedTransactions = useMemo(
    () => staged.flatMap((imp) => detailsById[imp.id]?.transactions ?? []),
    [staged, detailsById],
  );

  const expense = useMemo(() => stagedTransactions.filter((t) => t.suggested_kind === "expense"), [stagedTransactions]);
  const movement = useMemo(() => stagedTransactions.filter((t) => t.suggested_kind === "movement"), [stagedTransactions]);
  const pending = useMemo(
    () => stagedTransactions.filter((t) => t.suggested_kind === "pending" || !t.suggested_kind),
    [stagedTransactions],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Conferência — ${fmtPeriod(period)}`}
        description="Confira o que o sistema entendeu antes de confirmar. Nada aqui conta no dashboard até confirmar."
        actions={
          <Button variant="outline" asChild>
            <Link href={`/treasury?period=${period}`}>Ver lançamentos do período</Link>
          </Button>
        }
      />

      {stillWaiting && (
        <p className="flex items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          Aguardando o processamento de {expectedSources.length} arquivo(s)... isto normalmente leva poucos segundos.
        </p>
      )}

      <RequestState
        isLoading={isLoading}
        error={error}
        isEmpty={(imports ?? []).length === 0 && !stillWaiting}
        emptyMessage="Nenhum arquivo enviado para este período ainda."
        onRetry={refetch}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(imports ?? []).map((imp) => (
            <ImportCard key={imp.id} summary={imp} canWrite={canWrite} onDetail={handleDetail} />
          ))}
        </div>
      </RequestState>

      {staged.length > 0 && (
        <>
          <GroupSection
            title="Despesa por categoria"
            emptyMessage="Nenhuma despesa classificada ainda."
            transactions={expense}
            groupBy={groupByCategory}
            canWrite={canWrite}
          />
          <GroupSection
            title="Despesa por fornecedor"
            emptyMessage="Nenhuma despesa classificada ainda."
            transactions={expense}
            groupBy={groupByCounterparty}
            groupLabel={counterpartyLabel}
            canWrite={canWrite}
          />
          <GroupSection
            title="Movimentação"
            description="Informativo — nunca soma como despesa nem receita."
            emptyMessage="Nenhuma movimentação neste período."
            transactions={movement}
            canWrite={canWrite}
            flat
          />
          <GroupSection
            title="Pendentes"
            description="Favorecido ainda não identificado — anexe o comprovante para resolver."
            emptyMessage="Nenhum lançamento pendente."
            transactions={pending}
            canWrite={canWrite}
            flat
          />
        </>
      )}
    </div>
  );
}

function ImportCard({
  summary,
  canWrite,
  onDetail,
}: {
  summary: PendingImport;
  canWrite: boolean;
  onDetail: (id: number, detail: PendingImportDetail | undefined) => void;
}) {
  const { data: detail } = useGetPendingImportQuery(summary.id);
  const [confirmImport, { isLoading: confirming }] = useConfirmImportMutation();
  const [rejectImport, { isLoading: rejecting }] = useRejectImportMutation();
  const [showRejections, setShowRejections] = useState(false);

  useEffect(() => {
    onDetail(summary.id, detail);
  }, [summary.id, detail, onDetail]);

  const tone = summary.status === "confirmed" ? "positive" : summary.status === "rejected" ? "critical" : "attention";
  const unresolvedCount = (detail?.transactions ?? []).filter((t) => t.suggested_kind === "pending" || !t.suggested_kind).length;

  async function handleConfirm() {
    const result = await confirmImport(summary.id).unwrap().catch(() => null);
    if (result) toast.success(`${result.confirmed} lançamento(s) confirmado(s).`);
  }

  async function handleReject() {
    await rejectImport(summary.id)
      .unwrap()
      .then(() => toast.success("Importação rejeitada."))
      .catch(() => null);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm font-medium">{TREASURY_SOURCE_LABELS[summary.source]}</CardTitle>
        <StatusBadge tone={tone}>{IMPORT_STATUS_LABELS[summary.status]}</StatusBadge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {summary.line_count} linha(s) lida(s)
          {summary.rejected_line_count > 0 && (
            <>
              {" · "}
              <button className="underline underline-offset-2" onClick={() => setShowRejections(true)}>
                {summary.rejected_line_count} rejeitada(s)
              </button>
            </>
          )}
        </p>

        {canWrite && summary.status === "staged" && (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleConfirm} disabled={confirming || rejecting}>
              {confirming ? "Confirmando..." : "Confirmar"}
            </Button>
            {unresolvedCount > 0 && (
              <span className="text-xs text-muted-foreground">{unresolvedCount} pendente(s) ficarão sem favorecido</span>
            )}
            <Button size="sm" variant="outline" onClick={handleReject} disabled={confirming || rejecting}>
              {rejecting ? "Rejeitando..." : "Rejeitar"}
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={showRejections} onOpenChange={setShowRejections}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Linhas rejeitadas — {TREASURY_SOURCE_LABELS[summary.source]}</DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Linha</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Detalhe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detail?.rejections ?? []).map((rejection) => (
                  <TableRow key={rejection.id}>
                    <TableCell className="font-mono text-xs">{rejection.row_reference}</TableCell>
                    <TableCell>{rejection.reason}</TableCell>
                    <TableCell>{rejection.detail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function GroupSection({
  title,
  description,
  emptyMessage,
  transactions,
  groupBy,
  groupLabel,
  canWrite,
  flat = false,
}: {
  title: string;
  description?: string;
  emptyMessage: string;
  transactions: PendingTransaction[];
  groupBy?: (t: PendingTransaction) => string;
  groupLabel?: (t: PendingTransaction) => string;
  canWrite: boolean;
  flat?: boolean;
}) {
  const groups = useMemo(
    () =>
      groupBy
        ? Array.from(
            transactions.reduce((map, t) => {
              const key = groupBy(t);
              const list = map.get(key) ?? [];
              list.push(t);
              map.set(key, list);
              return map;
            }, new Map<string, PendingTransaction[]>()),
          )
            .map(([key, items]) => ({
              key,
              label: groupLabel ? groupLabel(items[0]) : key,
              items,
              total: items.reduce((sum, t) => sum + t.amount_cents, 0),
            }))
            .sort((a, b) => b.total - a.total)
        : null,
    [transactions, groupBy, groupLabel],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        ) : flat || !groups ? (
          <PendingTransactionTable transactions={transactions} canWrite={canWrite} />
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group.key}>
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-medium">{group.label}</p>
                  <p className="tabular font-medium">{money(group.total)}</p>
                </div>
                <PendingTransactionTable transactions={group.items} canWrite={canWrite} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PendingTransactionTable({ transactions, canWrite }: { transactions: PendingTransaction[]; canWrite: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data</TableHead>
          <TableHead>Favorecido</TableHead>
          <TableHead>Categoria</TableHead>
          <TableHead className="tabular text-right">Valor</TableHead>
          {canWrite && <TableHead className="w-20" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="tabular">{date(t.occurred_on)}</TableCell>
            <TableCell>
              <span className="font-medium">{t.counterparty_raw}</span>
              {t.likely_duplicate_of_id && (
                <StatusBadge tone="critical" className="ml-2">
                  Possível duplicidade
                </StatusBadge>
              )}
              {(t.suggested_kind === "pending" || !t.suggested_kind) && (
                <StatusBadge tone="attention" className="ml-2">
                  Sem favorecido resolvido
                </StatusBadge>
              )}
            </TableCell>
            <TableCell>{t.suggested_category ?? "—"}</TableCell>
            <TableCell className="tabular text-right">
              {t.direction === "inflow" ? "+" : "−"}
              {money(t.amount_cents)}
            </TableCell>
            {canWrite && (
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  {(t.suggested_kind === "pending" || !t.suggested_kind) && <AttachProofButton transaction={t} />}
                  <PendingEditButton transaction={t} />
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PendingEditButton({ transaction }: { transaction: PendingTransaction }) {
  const [updateTransaction] = useUpdatePendingTransactionMutation();
  const { data: suppliers } = useGetSuppliersQuery();

  const fields: FieldSpec<PendingEditForm>[] = [
    {
      name: "suggested_kind",
      label: "Tipo de lançamento",
      kind: "select",
      options: MAPPING_KINDS.map((k) => ({ value: k, label: k === "revenue" ? "Receita" : k === "expense" ? "Despesa" : "Movimentação" })),
    },
    { name: "suggested_category", label: "Categoria", kind: "text", placeholder: "Estoque" },
    {
      name: "suggested_nature",
      label: "Natureza",
      kind: "select",
      options: NATURES.map((n) => ({ value: n, label: NATURE_LABELS[n] })),
      hint: "Só se aplica quando o tipo é Despesa.",
    },
    {
      name: "suggested_supplier_id",
      label: "Fornecedor cadastrado (opcional)",
      kind: "select",
      options: [{ value: "none", label: "Nenhum" }, ...(suppliers ?? []).map((s) => ({ value: String(s.id), label: s.name }))],
      hint: "Só para vincular a um fornecedor de estoque já cadastrado — a maioria dos favorecidos não precisa disto.",
    },
  ];

  return (
    <ResourceFormDialog
      title="Corrigir classificação"
      trigger={
        <Button variant="ghost" size="icon" title="Corrigir">
          <Pencil />
        </Button>
      }
      schema={pendingEditSchema}
      fields={fields}
      defaultValues={
        {
          suggested_kind: (transaction.suggested_kind === "pending" || !transaction.suggested_kind
            ? "expense"
            : transaction.suggested_kind) as MappingKind,
          suggested_category: transaction.suggested_category ?? "",
          suggested_nature: transaction.suggested_nature ?? undefined,
          suggested_supplier_id: transaction.suggested_supplier_id ? String(transaction.suggested_supplier_id) : "none",
        } as PendingEditForm
      }
      onSubmit={(values) =>
        updateTransaction({
          import_id: transaction.pending_import_id,
          transaction_id: transaction.id,
          suggested_kind: values.suggested_kind,
          suggested_category: values.suggested_category,
          suggested_nature: values.suggested_kind === "expense" ? values.suggested_nature : undefined,
          suggested_supplier_id:
            values.suggested_supplier_id && values.suggested_supplier_id !== "none"
              ? Number(values.suggested_supplier_id)
              : undefined,
        }).unwrap()
      }
    />
  );
}

const proofSchema = z.object({
  counterparty_raw: z.string().min(1, "Informe quem foi pago"),
  image: z.instanceof(File, { message: "Anexe o comprovante" }),
});
type ProofForm = z.infer<typeof proofSchema>;

function AttachProofButton({ transaction }: { transaction: PendingTransaction }) {
  const [open, setOpen] = useState(false);
  const [attachProof, { isLoading }] = useAttachProofMutation();
  const form = useForm<ProofForm>({
    resolver: zodResolver(proofSchema),
    defaultValues: { counterparty_raw: "" },
  });

  async function onSubmit(values: ProofForm) {
    try {
      await attachProof({
        import_id: transaction.pending_import_id,
        transaction_id: transaction.id,
        image: values.image,
        counterparty_raw: values.counterparty_raw,
      }).unwrap();
      toast.success("Comprovante anexado e favorecido identificado.");
      setOpen(false);
      form.reset({ counterparty_raw: "" });
    } catch {
      toast.error("Não foi possível anexar o comprovante.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon" title="Anexar comprovante" onClick={() => setOpen(true)}>
        <ImagePlus />
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Anexar comprovante</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <FormField
              control={form.control}
              name="counterparty_raw"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quem foi pago</FormLabel>
                  <FormControl>
                    <Input placeholder="Nome do favorecido" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="image"
              render={({ field: { value: _value, onChange, ...field } }) => (
                <FormItem>
                  <FormLabel>Comprovante (imagem)</FormLabel>
                  <FormControl>
                    <Input type="file" accept="image/*" onChange={(event) => onChange(event.target.files?.[0])} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Enviando..." : "Anexar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
