"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetProductsQuery } from "@/lib/api/products";
import {
  useConfirmSettlementMutation,
  useGetOpenTotalQuery,
  useGetPurchasesQuery,
  useGetSettlementsQuery,
  usePaySettlementMutation,
  useProposeSettlementMutation,
  type Settlement,
  type SettlementState,
} from "@/lib/api/purchases";
import { formatCents, formatDate, weekStartOf } from "@/lib/purchases/money";

const STATE_LABEL: Record<SettlementState, string> = { proposal: "Proposta (ainda não é devido)", confirmed: "Confirmado (a pagar)", paid: "Pago" };
const STATE_TONE: Record<SettlementState, StatusTone> = { proposal: "attention", confirmed: "neutral", paid: "positive" };
const today = () => new Date().toISOString().slice(0, 10);
const message = (failure: unknown, fallback: string) => (failure as { data?: { message?: string } })?.data?.message ?? fallback;

/**
 * Acerto semanal do consignado: devido = unidades vendidas × custo; o que não vendeu, venceu ou voltou não se paga. O painel calcula uma
 * PROPOSTA com a evidência; só vale depois que uma pessoa confirma, e o "pago" é só um registro — o sistema nunca paga nem lança nada.
 */
export function SettlementScreen() {
  const purchasesQuery = useGetPurchasesQuery();
  const products = useGetProductsQuery().data ?? [];
  const history = useGetSettlementsQuery();
  const openTotal = useGetOpenTotalQuery();
  const [propose, { isLoading: proposing }] = useProposeSettlementMutation();
  const [confirm, { isLoading: confirming }] = useConfirmSettlementMutation();
  const [pay, { isLoading: paying }] = usePaySettlementMutation();

  const [supplierId, setSupplierId] = useState("");
  const [day, setDay] = useState(today());
  const [current, setCurrent] = useState<Settlement | null>(null);
  const [writeOffs, setWriteOffs] = useState<Record<number, { expired: string; returned: string }>>({});
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState("");

  const nameOf = (sku: string) => products.find((p) => p.sku === sku)?.name ?? sku;
  // Só quem tem item consignado entra no seletor: é para esses que existe acerto.
  const onSaleSuppliers = useMemo(() => {
    const seen = new Map<number, string>();
    for (const purchase of purchasesQuery.data ?? []) if (purchase.items.some((i) => i.condition === "on_sale")) seen.set(purchase.supplier_id, purchase.supplier_name ?? `Fornecedor ${purchase.supplier_id}`);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [purchasesQuery.data]);

  function open(settlement: Settlement) {
    setCurrent(settlement);
    setSupplierId(String(settlement.supplier_id));
    setDay(settlement.week_start);
    setAcceptPartial(false);
    setWriteOffs(Object.fromEntries(settlement.evidence.lines.map((l) => [l.itemId, { expired: String(l.expired), returned: String(l.returned) }])));
  }

  async function calculate() {
    if (!supplierId) return void toast.error("Escolha o fornecedor.");
    const offs = Object.entries(writeOffs).map(([id, v]) => ({ item_id: Number(id), expired: Number(v.expired) || 0, returned: Number(v.returned) || 0 }));
    try {
      const result = await propose({ supplier_id: Number(supplierId), week_start: day, write_offs: offs }).unwrap();
      setCurrent(result);
      if (result.supplier_id !== current?.supplier_id || result.week_start !== current?.week_start)
        setWriteOffs(Object.fromEntries(result.evidence.lines.map((l) => [l.itemId, { expired: String(l.expired), returned: String(l.returned) }])));
    } catch (failure) {
      toast.error(message(failure, "Não foi possível calcular o acerto."));
    }
  }

  async function onConfirm() {
    if (!current) return;
    try {
      setCurrent(await confirm({ id: current.id, accept_partial: acceptPartial }).unwrap());
      toast.success("Acerto confirmado: agora conta como devido.");
    } catch (failure) {
      toast.error(message(failure, "Não foi possível confirmar."));
    }
  }

  async function onPay() {
    if (!current) return;
    try {
      setCurrent(await pay({ id: current.id, paid_on: paidOn, note: note || undefined }).unwrap());
      toast.success("Registrado como pago. (O painel não faz pagamento: é só o registro.)");
    } catch (failure) {
      toast.error(message(failure, "Não foi possível registrar o pagamento."));
    }
  }

  const editable = !current || current.state === "proposal";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm font-normal text-muted-foreground">A pagar (acertos confirmados)</CardTitle>
          </CardHeader>
          <CardContent className="tabular text-2xl font-semibold">{openTotal.data ? formatCents(openTotal.data.confirmed_cents) : "—"}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm font-normal text-muted-foreground">Propostas esperando decisão</CardTitle>
          </CardHeader>
          <CardContent className="tabular text-2xl font-semibold">{openTotal.data ? openTotal.data.proposals : "—"}</CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-4">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Fornecedor (com item consignado)
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="w-64" aria-label="Fornecedor do acerto">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {onSaleSuppliers.map(([id, name]) => (
                  <SelectItem key={id} value={String(id)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Um dia da semana
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Dia da semana do acerto" />
          </label>
          <p className="text-sm text-muted-foreground">Semana de segunda {formatDate(weekStartOf(day))}.</p>
          <Button onClick={calculate} disabled={proposing || !editable}>
            {proposing ? "Calculando..." : current ? "Recalcular proposta" : "Calcular proposta"}
          </Button>
        </CardContent>
      </Card>
      {onSaleSuppliers.length === 0 && <p className="text-sm text-muted-foreground">Nenhum fornecedor tem item consignado ainda. Marque a condição “Consignado” ao lançar uma compra.</p>}

      {current && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">
                {current.supplier_name} · semana {formatDate(current.week_start)} a {formatDate(current.week_end)}
              </CardTitle>
              <StatusBadge tone={STATE_TONE[current.state]}>{STATE_LABEL[current.state]}</StatusBadge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="tabular text-3xl font-semibold">{formatCents(current.owed_cents)}</p>
            <p className="text-xs text-muted-foreground">Conta: {current.evidence.formula}.</p>

            {current.partial && (
              <p className="flex items-start gap-1 rounded-md border border-warning/40 p-2 text-sm" data-testid="partial-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>
                  Semana parcial.
                  {current.evidence.quality.salesUnknown
                    ? ` Sem recibos com data em ${current.evidence.quality.monthsWithoutDatedReceipts.join(", ")}: as vendas da semana são desconhecidas e nada foi contado como devido.`
                    : ` ${current.evidence.quality.storesMissing} loja(s) sem recibos: o devido pode estar subestimado.`}
                </span>
              </p>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Entregue</TableHead>
                  <TableHead className="text-right">Em aberto antes</TableHead>
                  <TableHead className="text-right">Vendido</TableHead>
                  <TableHead className="text-right">Vencido</TableHead>
                  <TableHead className="text-right">Devolvido</TableHead>
                  <TableHead className="text-right">Sem vender</TableHead>
                  <TableHead className="text-right">Custo un.</TableHead>
                  <TableHead className="text-right">Devido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {current.evidence.lines.map((line) => (
                  <TableRow key={line.itemId}>
                    <TableCell className="font-medium">{nameOf(line.sku)}</TableCell>
                    <TableCell className="tabular text-right">{line.delivered}</TableCell>
                    <TableCell className="tabular text-right">{line.openBefore}</TableCell>
                    <TableCell className="tabular text-right">{line.sold}</TableCell>
                    {(["expired", "returned"] as const).map((field) => (
                      <TableCell key={field} className="text-right">
                        {editable ? (
                          <Input
                            className="ml-auto w-16 text-right"
                            inputMode="numeric"
                            aria-label={`${field === "expired" ? "Vencido" : "Devolvido"} de ${nameOf(line.sku)}`}
                            value={writeOffs[line.itemId]?.[field] ?? "0"}
                            onChange={(e) => setWriteOffs((w) => ({ ...w, [line.itemId]: { expired: w[line.itemId]?.expired ?? "0", returned: w[line.itemId]?.returned ?? "0", [field]: e.target.value } }))}
                          />
                        ) : (
                          <span className="tabular">{line[field]}</span>
                        )}
                        {line.writeOffCapped && field === "returned" && <p className="text-xs text-warning">limitado ao que estava em aberto</p>}
                      </TableCell>
                    ))}
                    <TableCell className="tabular text-right">{line.unsold}</TableCell>
                    <TableCell className="tabular text-right">{formatCents(line.unitCostCents)}</TableCell>
                    <TableCell className="tabular text-right font-medium">{formatCents(line.owedCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">Vencidos e devolvidos são informados por você: o abastecimento só registra esses motivos por mês, não por semana.</p>
            {Object.keys(current.evidence.soldNotCovered).length > 0 && (
              <p className="text-xs text-muted-foreground">
                Vendas além do consignado em aberto (vieram de estoque que não é consignado, não são devidas aqui):{" "}
                {Object.entries(current.evidence.soldNotCovered).map(([sku, units]) => `${nameOf(sku)} (${units} un.)`).join(", ")}.
              </p>
            )}

            {current.state === "proposal" && (
              <div className="flex flex-wrap items-center gap-3">
                {current.partial && (
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={acceptPartial} onChange={(e) => setAcceptPartial(e.target.checked)} />
                    Confirmar mesmo parcial (assumo o número)
                  </label>
                )}
                <Button onClick={onConfirm} disabled={confirming || (current.partial && !acceptPartial)}>
                  {confirming ? "Confirmando..." : "Confirmar acerto"}
                </Button>
              </div>
            )}
            {current.state === "confirmed" && (
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Pago em
                  <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} aria-label="Data do pagamento" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Observação
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: PIX" aria-label="Observação do pagamento" />
                </label>
                <Button onClick={onPay} disabled={paying}>
                  {paying ? "Registrando..." : "Marcar como pago"}
                </Button>
              </div>
            )}
            {current.state === "paid" && <p className="text-sm text-muted-foreground">Pago em {formatDate(current.paid_on)}{current.payment_note ? ` · ${current.payment_note}` : ""}.</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Acertos anteriores</CardTitle>
        </CardHeader>
        <CardContent>
          {(history.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum acerto calculado ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Semana</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Devido</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history.data ?? []).map((settlement) => (
                  <TableRow key={settlement.id}>
                    <TableCell className="tabular">{formatDate(settlement.week_start)}</TableCell>
                    <TableCell>{settlement.supplier_name}</TableCell>
                    <TableCell>
                      <StatusBadge tone={STATE_TONE[settlement.state]}>{STATE_LABEL[settlement.state]}</StatusBadge>
                      {settlement.partial && <span className="ml-2 text-xs text-warning">parcial</span>}
                    </TableCell>
                    <TableCell className="tabular text-right">{formatCents(settlement.owed_cents)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => open(settlement)}>
                        Abrir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
