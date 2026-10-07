"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCreateFeeMutation, useGetFeesInForceQuery, useGetFeesQuery, type PaymentMethod } from "@/lib/api/treasury";
import { useHasPermission } from "@/lib/auth/use-permission";
import { date, money } from "@/lib/format";
import { EMPTY_FEE_FORM, parseFeeForm, ratePctText, type FeeForm, type FeePayload } from "@/lib/pricing/fee-form";

const METHOD_LABEL: Record<PaymentMethod, string> = { pix: "PIX", debit: "Débito", credit: "Crédito", voucher: "VR/VA (voucher)" };
/** Nomes que o dono costuma usar, só como sugestão: nenhum é cadastrado sozinho nem tem taxa embutida. */
const SUGGESTED_ACQUIRERS = ["PagBank", "Pluxee", "Ticket", "VR Benefícios", "Alelo"];

function messageOf(error: unknown): string {
  const data = (error as { data?: { message?: unknown } } | undefined)?.data;
  const status = (error as { status?: number } | undefined)?.status;
  if (status === 409) return "Já existe uma taxa para este adquirente, meio de pagamento e data. Cadastre uma nova data de início.";
  if (Array.isArray(data?.message)) return data.message.join("; ");
  if (typeof data?.message === "string") return data.message;

  return "Não foi possível cadastrar a taxa. Nada foi salvo.";
}

/**
 * As taxas que o motor de preço lê. Cada uma tem data de início: uma data errada muda a margem de meses já analisados,
 * então o cadastro sempre passa por uma confirmação que mostra o que será salvo. Nada é cadastrado sozinho.
 */
export function FeesScreen() {
  const canWrite = useHasPermission("treasury:write");
  const { data: fees, isLoading, error, refetch } = useGetFeesQuery();
  const { data: inForce } = useGetFeesInForceQuery();
  const [create, { isLoading: saving }] = useCreateFeeMutation();
  const [form, setForm] = useState<FeeForm>(EMPTY_FEE_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<FeePayload | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const set = (patch: Partial<FeeForm>) => setForm((prev) => ({ ...prev, ...patch }));
  const inForceKeys = useMemo(() => new Set((inForce?.rates ?? []).map((rate) => `${rate.acquirer}|${rate.payment_method}|${rate.effective_from.slice(0, 10)}`)), [inForce]);
  const acquirers = useMemo(() => [...new Set([...SUGGESTED_ACQUIRERS, ...(fees ?? []).map((fee) => fee.acquirer)])], [fees]);

  function review() {
    const result = parseFeeForm(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    setFailure(null);
    setPending(result.payload);
  }

  async function confirm() {
    if (!pending) return;
    try {
      await create(pending).unwrap();
      toast.success(`Taxa de ${pending.acquirer} cadastrada.`);
      setPending(null);
      setForm(EMPTY_FEE_FORM);
    } catch (e) {
      setFailure(messageOf(e));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Taxas de pagamento" description="Taxa por adquirente, bandeira de VR/VA e meio de pagamento, com data de início. A Precificação Inteligente lê estas taxas; nada é digitado em dois lugares." />

      {(inForce?.methods_without_rate.length ?? 0) > 0 && (
        <p role="alert" className="rounded-lg border border-warning/30 bg-warning/12 p-3 text-sm text-warning">
          Sem taxa cadastrada em vigor: {inForce?.methods_without_rate.map((method) => METHOD_LABEL[method]).join(", ")}. Um meio sem taxa não é tratado como 0%: o preço fica sem recomendação.
        </p>
      )}

      {canWrite && (
        <section aria-labelledby="new-fee" className="flex flex-col gap-4 rounded-lg border p-4">
          <h2 id="new-fee" className="text-base font-semibold">Cadastrar taxa</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fee-acquirer">Adquirente ou bandeira</Label>
              <Input id="fee-acquirer" list="fee-acquirers" value={form.acquirer} onChange={(e) => set({ acquirer: e.target.value })} placeholder="PagBank, Ticket…" />
              <datalist id="fee-acquirers">
                {acquirers.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fee-method">Meio de pagamento</Label>
              <Select value={form.method || undefined} onValueChange={(value) => set({ method: value as PaymentMethod })}>
                <SelectTrigger id="fee-method">
                  <SelectValue placeholder="Escolha" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((method) => (
                    <SelectItem key={method} value={method}>
                      {METHOD_LABEL[method]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fee-rate">Taxa (%)</Label>
              <Input id="fee-rate" inputMode="decimal" value={form.ratePct} onChange={(e) => set({ ratePct: e.target.value })} placeholder="1,39" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fee-fixed">Taxa fixa por venda (R$)</Label>
              <Input id="fee-fixed" inputMode="decimal" value={form.fixedReais} onChange={(e) => set({ fixedReais: e.target.value })} placeholder="opcional, ex.: 0,89" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fee-from">Vale a partir de</Label>
              <Input id="fee-from" type="date" value={form.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} />
            </div>
          </div>

          {errors.length > 0 && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/12 p-3 text-sm text-destructive">
              <ul className="list-disc pl-5">
                {errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <Button onClick={review}>Revisar e cadastrar</Button>
          </div>
        </section>
      )}

      <RequestState isLoading={isLoading} error={error} isEmpty={(fees?.length ?? 0) === 0} emptyMessage="Nenhuma taxa cadastrada ainda." onRetry={refetch}>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Adquirente / bandeira</TableHead>
                <TableHead>Meio de pagamento</TableHead>
                <TableHead className="text-right">Taxa</TableHead>
                <TableHead className="text-right">Fixo por venda</TableHead>
                <TableHead>Vale a partir de</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(fees ?? []).map((fee) => (
                <TableRow key={fee.id}>
                  <TableCell className="font-medium">{fee.acquirer}</TableCell>
                  <TableCell>{METHOD_LABEL[fee.payment_method]}</TableCell>
                  <TableCell className="tabular text-right">{ratePctText(fee.rate_bps)}</TableCell>
                  <TableCell className="tabular text-right">{fee.fixed_cents > 0 ? money(fee.fixed_cents) : "—"}</TableCell>
                  <TableCell>{date(fee.effective_from)}</TableCell>
                  <TableCell>
                    {inForceKeys.has(`${fee.acquirer}|${fee.payment_method}|${fee.effective_from.slice(0, 10)}`) ? <StatusBadge tone="positive">Em vigor</StatusBadge> : <StatusBadge tone="neutral">Histórico</StatusBadge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </RequestState>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && !saving && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar taxa</DialogTitle>
            <DialogDescription>Confira antes de salvar: uma data de início errada muda a margem de meses já analisados.</DialogDescription>
          </DialogHeader>
          {pending && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Adquirente</dt>
              <dd className="font-medium">{pending.acquirer}</dd>
              <dt className="text-muted-foreground">Meio</dt>
              <dd className="font-medium">{METHOD_LABEL[pending.payment_method]}</dd>
              <dt className="text-muted-foreground">Taxa</dt>
              <dd className="tabular font-medium">{ratePctText(pending.rate_bps)}</dd>
              <dt className="text-muted-foreground">Fixo por venda</dt>
              <dd className="tabular font-medium">{pending.fixed_cents > 0 ? money(pending.fixed_cents) : "—"}</dd>
              <dt className="text-muted-foreground">Vale a partir de</dt>
              <dd className="font-medium">{date(pending.effective_from)}</dd>
            </dl>
          )}
          {failure && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/12 p-3 text-sm text-destructive">
              {failure}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={saving}>
              Voltar
            </Button>
            <Button onClick={confirm} disabled={saving}>
              {saving ? "Salvando…" : "Confirmar e salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
