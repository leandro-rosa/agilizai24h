"use client";

import { useState } from "react";

import { SendOrderDialog } from "@/components/purchases/send-order-dialog";
import { TransitionDialog } from "@/components/purchases/transition-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import type { Purchase, Stage } from "@/lib/api/purchases";
import { formatCents, formatDate } from "@/lib/purchases/money";
import { groupByStage, NEXT_ACTION, nextStage, orderAlerts, orderTotalCents, STAGE_LABEL, STAGES } from "@/lib/purchases/stages";

/** O quadro de cinco colunas, um cartão por pedido e o botão da próxima etapa (sem arrastar). */
export function OrdersBoard({ purchases }: { purchases: Purchase[] }) {
  const columns = groupByStage(purchases);
  const [sending, setSending] = useState<Purchase | null>(null);
  const [moving, setMoving] = useState<{ order: Purchase; to: Stage } | null>(null);

  function advance(order: Purchase) {
    const to = nextStage(order.status);
    if (!to) return;
    // O primeiro passo é o envio por e-mail: ele mesmo move o pedido para "aguardando faturamento".
    if (order.status === "requisition") setSending(order);
    else setMoving({ order, to });
  }

  return (
    <>
      <div className="grid min-w-0 gap-3 overflow-x-auto pb-2 lg:grid-cols-5">
        {STAGES.map((stage) => (
          <section key={stage} aria-label={STAGE_LABEL[stage]} className="flex min-w-56 flex-col gap-2 rounded-lg bg-muted/40 p-2">
            <h2 className="flex items-center justify-between px-1 text-sm font-medium">
              {STAGE_LABEL[stage]}
              <span className="tabular text-xs text-muted-foreground">{columns[stage].length}</span>
            </h2>
            {columns[stage].map((order) => (
              <article key={order.id} className="flex flex-col gap-1 rounded-md border bg-card p-3 text-sm" data-testid={`order-${order.id}`}>
                <p className="font-medium">{order.supplier_name ?? `Fornecedor ${order.supplier_id}`}</p>
                <p className="tabular text-base">{formatCents(orderTotalCents(order))}</p>
                <p className="text-xs text-muted-foreground">
                  {order.invoice_number ? `NF ${order.invoice_number}` : order.without_invoice ? "sem nota" : "sem nota ainda"} · criado {formatDate(order.ordered_on)}
                  {order.created_by ? ` por ${order.created_by}` : ""}
                </p>
                {order.expected_delivery_on && !order.received_on && <p className="text-xs text-muted-foreground">entrega até {formatDate(order.expected_delivery_on)}</p>}
                {order.received_on && (
                  <p className="text-xs text-muted-foreground">
                    recebido {formatDate(order.received_on)}
                    {order.received_by ? ` por ${order.received_by}` : ""}
                  </p>
                )}
                <div className="flex flex-wrap gap-1">
                  {orderAlerts(order).map((alert) => (
                    <StatusBadge key={alert} tone="critical">
                      {alert}
                    </StatusBadge>
                  ))}
                </div>
                {NEXT_ACTION[order.status] && (
                  <Button size="sm" variant="outline" className="mt-1" onClick={() => advance(order)}>
                    {NEXT_ACTION[order.status]}
                  </Button>
                )}
              </article>
            ))}
            {columns[stage].length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">Nenhum pedido</p>}
          </section>
        ))}
      </div>
      {sending && <SendOrderDialog order={sending} open onOpenChange={(open) => !open && setSending(null)} />}
      {moving && <TransitionDialog order={moving.order} to={moving.to} open onOpenChange={(open) => !open && setMoving(null)} />}
    </>
  );
}
