"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePayOrdersMutation, type PayableOrder, type PaymentMethod } from "@/lib/api/purchases";
import { formatCents, formatDate } from "@/lib/purchases/money";
import { FORM_LABEL } from "./labels";

const today = () => new Date().toISOString().slice(0, 10);
const KEEP = "keep";

/**
 * Lançar pagamento: marca como pagos os itens em aberto dos pedidos escolhidos. O painel só REGISTRA que foi pago; não paga nada.
 * Sem `preselected`, a pessoa escolhe os pedidos na lista; vindo de uma linha, já vem escolhido.
 */
export function PayDialog({ candidates, preselected, open, onOpenChange }: { candidates: PayableOrder[]; preselected?: number[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [pay, { isLoading }] = usePayOrdersMutation();
  const [chosen, setChosen] = useState<number[]>(preselected ?? []);
  const [paidOn, setPaidOn] = useState(today());
  const [method, setMethod] = useState<PaymentMethod | typeof KEEP>(KEEP);
  const [note, setNote] = useState("");

  const open_ = candidates.filter((order) => order.state !== "paid");
  const total = open_.filter((order) => chosen.includes(order.purchase_id)).reduce((sum, order) => sum + order.open_cents, 0);
  const toggle = (id: number) => setChosen((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  async function confirm() {
    try {
      const result = await pay({ purchase_ids: chosen, paid_on: paidOn, method: method === KEEP ? undefined : method, note: note.trim() || undefined }).unwrap();
      toast.success(`Pagamento registrado: ${formatCents(result.paid_cents)} em ${result.paid_items} ${result.paid_items === 1 ? "item" : "itens"}.`);
      onOpenChange(false);
    } catch (failure) {
      toast.error((failure as { data?: { message?: string } })?.data?.message ?? "Não foi possível registrar o pagamento.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lançar pagamento</DialogTitle>
          <DialogDescription>Registra que o pagamento foi feito (o painel não paga). Todos os itens em aberto de cada pedido escolhido são marcados como pagos.</DialogDescription>
        </DialogHeader>

        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
          {open_.length === 0 && <li className="text-sm text-muted-foreground">Nada em aberto para pagar.</li>}
          {open_.map((order) => (
            <li key={order.purchase_id}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={chosen.includes(order.purchase_id)} onChange={() => toggle(order.purchase_id)} aria-label={`Pagar pedido ${order.purchase_id}`} />
                <span className="min-w-0 flex-1 truncate">
                  {order.supplier_name ?? `Fornecedor ${order.supplier_id}`}
                  {order.invoice_number ? ` · NF ${order.invoice_number}` : ""}
                  {order.due_on ? ` · vence ${formatDate(order.due_on)}` : ""}
                </span>
                <span className="tabular">{formatCents(order.open_cents)}</span>
              </label>
            </li>
          ))}
        </ul>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Pago em
            <Input type="date" max={today()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} aria-label="Data do pagamento" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Forma
            <Select value={method} onValueChange={(next) => setMethod(next as PaymentMethod | typeof KEEP)}>
              <SelectTrigger aria-label="Forma do pagamento">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP}>A do pedido</SelectItem>
                <SelectItem value="boleto">{FORM_LABEL.boleto}</SelectItem>
                <SelectItem value="transfer">Pix / transferência</SelectItem>
                <SelectItem value="other">{FORM_LABEL.other}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Observação
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} aria-label="Observação do pagamento" />
          </label>
        </div>

        <DialogFooter>
          <p className="tabular mr-auto self-center text-sm">Total: {formatCents(total)}</p>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={isLoading || chosen.length === 0 || !paidOn}>
            {isLoading ? "Registrando..." : "Registrar pagamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
