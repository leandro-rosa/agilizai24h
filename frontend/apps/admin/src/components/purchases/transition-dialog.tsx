"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTransitionPurchaseMutation, type Purchase, type Stage } from "@/lib/api/purchases";
import { STAGE_LABEL } from "@/lib/purchases/stages";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Avança o pedido uma etapa. "Faturar" pede o número da nota (ou a chave, ou "sem nota"); "Receber" pede as quantidades que
 * chegaram — a diferença para o pedido fica destacada e vira o que se registra como comprado. As demais etapas só confirmam.
 */
export function TransitionDialog({ order, to, open, onOpenChange }: { order: Purchase; to: Stage; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [transition, { isLoading }] = useTransitionPurchaseMutation();
  const [invoice, setInvoice] = useState("");
  const [key, setKey] = useState("");
  const [noInvoice, setNoInvoice] = useState(false);
  const [receivedOn, setReceivedOn] = useState(today());
  const [payNow, setPayNow] = useState(false);
  const [quantities, setQuantities] = useState<Record<number, string>>({});

  const quantityOf = (itemId: number, ordered: number) => {
    const typed = quantities[itemId];
    return typed === undefined || typed === "" ? ordered : Number(typed);
  };
  const invalidQuantity = order.items.some((item) => !Number.isInteger(quantityOf(item.id, item.quantity)) || quantityOf(item.id, item.quantity) < 0);
  // Quem paga na entrega pode registrar o pagamento no mesmo passo (não vale para boleto com vencimento).
  const canPayNow = to === "received" && order.payment_term !== "due_date" && order.items.some((item) => item.condition === "paid" && item.payment_status === "pending");
  const needsInvoice = to === "invoiced" && !order.invoice_number && !order.invoice_key && !order.without_invoice;
  const missingInvoice = needsInvoice && !invoice.trim() && !key.trim() && !noInvoice;

  async function confirm() {
    try {
      await transition({
        id: order.id,
        to,
        ...(to === "invoiced" ? { invoice_number: invoice.trim() || undefined, invoice_key: key.trim() || undefined, without_invoice: noInvoice || undefined } : {}),
        ...(to === "received"
          ? { received_on: receivedOn, received: order.items.map((item) => ({ item_id: item.id, quantity: quantityOf(item.id, item.quantity) })), pay_on_receipt: canPayNow && payNow ? true : undefined }
          : {}),
      }).unwrap();
      toast.success(`Pedido movido para “${STAGE_LABEL[to]}”.`);
      onOpenChange(false);
    } catch (failure) {
      toast.error((failure as { data?: { message?: string } })?.data?.message ?? "Não foi possível mover o pedido.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Mover para “{STAGE_LABEL[to]}”</DialogTitle>
          <DialogDescription>
            Pedido {order.id} · {order.supplier_name ?? `Fornecedor ${order.supplier_id}`}.
            {to === "received" && " Só o que foi recebido conta como comprado; depois de recebido o pedido não volta."}
          </DialogDescription>
        </DialogHeader>

        {to === "invoiced" && needsInvoice && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Número da nota
              <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} aria-label="Número da nota" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Chave da NF-e (opcional)
              <Input value={key} onChange={(e) => setKey(e.target.value)} aria-label="Chave da NF-e" />
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={noInvoice} onChange={(e) => setNoInvoice(e.target.checked)} />
              Fornecedor sem nota
            </label>
          </div>
        )}

        {to === "received" && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:w-48">
              Recebido em
              <Input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} aria-label="Recebido em" />
            </label>
            {canPayNow && (
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} />
                Já paguei na entrega (registra o pagamento junto com o recebimento)
              </label>
            )}
            <ul className="flex flex-col gap-1">
              {order.items.map((item) => {
                const received = quantityOf(item.id, item.quantity);
                const missing = item.quantity - received;
                return (
                  <li key={item.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{item.description ?? item.sku}</span>
                    <span className="tabular text-xs text-muted-foreground">pedido {item.quantity}</span>
                    <Input
                      type="number"
                      min={0}
                      className="w-24"
                      value={quantities[item.id] ?? String(item.quantity)}
                      onChange={(e) => setQuantities({ ...quantities, [item.id]: e.target.value })}
                      aria-label={`Recebido de ${item.description ?? item.sku}`}
                    />
                    {missing !== 0 && Number.isFinite(missing) && <span className="text-xs text-warning">{missing > 0 ? `faltou ${missing}` : `${-missing} a mais`}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={isLoading || missingInvoice || (to === "received" && invalidQuantity)}>
            {isLoading ? "Salvando..." : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
