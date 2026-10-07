"use client";

import { useState } from "react";
import { toast } from "sonner";

import { DeleteOrderDialog } from "@/components/purchases/delete-order-dialog";
import { PendingLinesDialog } from "@/components/purchases/pending-lines-dialog";
import { PurchaseFormDialog } from "@/components/purchases/purchase-form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRetryCostSyncMutation, useUpdatePurchaseItemMutation, type CostSync, type Condition, type Purchase } from "@/lib/api/purchases";
import { supplierAnalysisApi } from "@/lib/api/supplier-analysis";
import { useAppDispatch } from "@/lib/hooks";
import { STAGE_LABEL, orderAlerts } from "@/lib/purchases/stages";
import { CONDITION_LABEL, CONDITION_SHORT, formatCents, formatDate } from "@/lib/purchases/money";

const ALERT_TEXT = {
  large_variation: "Variação grande",
  closed_month: "Mês já fechado: o CMV dele não é recalculado sozinho",
  closed_month_unknown: "Não foi possível saber se o mês está fechado",
} as const;

/** O custo desta linha a caminho do produto: criado, igual ao que já valia, brinde (nunca cria custo), esperando ou com falha. */
function CostSyncCell({ sync, retrying, onRetry }: { sync: CostSync | undefined; retrying: boolean; onRetry: () => void }) {
  if (!sync || sync.state === null) return <span className="text-xs text-muted-foreground">Quando a compra for recebida</span>;
  if (sync.state === "skipped_bonus") return <span className="text-xs text-muted-foreground">Bonificação: não cria custo</span>;
  if (sync.state === "pending") return <StatusBadge tone="attention">Enviando…</StatusBadge>;
  if (sync.state === "failed")
    return (
      <span className="flex flex-col items-start gap-1">
        <StatusBadge tone="critical">Falhou</StatusBadge>
        <span className="max-w-48 text-xs text-muted-foreground">{sync.error}</span>
        <Button size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
          Reenviar
        </Button>
      </span>
    );

  return (
    <span className="flex flex-col gap-0.5">
      <StatusBadge tone="positive">{sync.state === "unchanged" ? "Igual ao custo vigente" : "Custo criado"}</StatusBadge>
      {sync.previous_cost_cents !== null && sync.state === "synced" && (
        <span className="text-xs text-muted-foreground">
          antes {formatCents(sync.previous_cost_cents)}
          {sync.variation_bps !== null ? ` (${sync.variation_bps > 0 ? "+" : ""}${(sync.variation_bps / 100).toFixed(1).replace(".", ",")}%)` : ""}
        </span>
      )}
      {sync.alerts.map((alert) => (
        <StatusBadge key={alert} tone="attention">
          {ALERT_TEXT[alert]}
        </StatusBadge>
      ))}
    </span>
  );
}

const CONDITION_TONE = { paid: "neutral", bonus: "positive", on_sale: "attention" } as const;

/**
 * Compras e o que está dentro de cada uma. Pago = gasto ao custo; consignado só é devido conforme vende (acerto semanal);
 * bonificação não custa nada. A condição muda até o item entrar num acerto confirmado — depois disso o painel recusa.
 */
export function PurchasesTable({ purchases, initialOpen }: { purchases: Purchase[]; /** A compra que já vem com os itens abertos (o link de uma nota vindo do produto). */ initialOpen?: number }) {
  const dispatch = useAppDispatch();
  const [update] = useUpdatePurchaseItemMutation();
  const [open, setOpen] = useState<number | null>(initialOpen ?? null);
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [deleting, setDeleting] = useState<Purchase | null>(null);
  const [pendingOf, setPendingOf] = useState<number | null>(null);
  const [retry, { isLoading: retrying }] = useRetryCostSyncMutation();

  async function change(itemId: number, changes: Parameters<typeof update>[0]["changes"], done: string) {
    try {
      await update({ itemId, changes }).unwrap();
      dispatch(supplierAnalysisApi.util.invalidateTags(["Analysis"]));
      toast.success(done);
    } catch (failure) {
      toast.error((failure as { data?: { message?: string } })?.data?.message ?? "Não foi possível salvar a alteração.");
    }
  }

  if (purchases.length === 0) return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma compra registrada ainda.</p>;

  return (
    <>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data</TableHead>
          <TableHead>Fornecedor</TableHead>
          <TableHead>Nota</TableHead>
          <TableHead className="text-right">Itens</TableHead>
          <TableHead className="text-right">Pago</TableHead>
          <TableHead className="text-right">Consignado (ao custo)</TableHead>
          <TableHead className="text-right">Bonificação</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {purchases.flatMap((purchase) => {
          const expanded = open === purchase.id;
          const rows = [
            <TableRow key={purchase.id}>
              <TableCell className="tabular">{formatDate(purchase.ordered_on)}</TableCell>
              <TableCell className="font-medium">
                {purchase.supplier_name ?? `Fornecedor ${purchase.supplier_id}`}
                <div className="flex flex-wrap gap-1 pt-0.5 font-normal">
                  <StatusBadge tone={purchase.status === "received" ? "positive" : "neutral"}>{STAGE_LABEL[purchase.status]}</StatusBadge>
                  {(purchase.awaiting_product_registration ?? 0) > 0 && (
                    <button type="button" onClick={() => setPendingOf(purchase.id)} aria-label={`Resolver linhas pendentes do pedido ${purchase.id}`}>
                      <StatusBadge tone="attention">Aguardando cadastro de produto ({purchase.awaiting_product_registration})</StatusBadge>
                    </button>
                  )}
                  {orderAlerts(purchase).map((alert) => (
                    <StatusBadge key={alert} tone="critical">
                      {alert}
                    </StatusBadge>
                  ))}
                </div>
              </TableCell>
              <TableCell>{purchase.invoice_number ? `NF ${purchase.invoice_number}` : <span className="text-xs text-muted-foreground">sem nota</span>}</TableCell>
              <TableCell className="tabular text-right">{purchase.items.length}</TableCell>
              <TableCell className="tabular text-right">{formatCents(purchase.paid_cents)}</TableCell>
              <TableCell className="tabular text-right">{formatCents(purchase.on_sale_cents)}</TableCell>
              <TableCell className="tabular text-right">{purchase.bonus_units > 0 ? `${purchase.bonus_units} un.` : "—"}</TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="sm" onClick={() => setEditing(purchase)} aria-label={`Editar pedido ${purchase.id}`}>
                  Editar
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleting(purchase)} aria-label={`Excluir pedido ${purchase.id}`}>
                  Excluir
                </Button>
                <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : purchase.id)}>
                  {expanded ? "Ocultar itens" : "Ver itens"}
                </Button>
              </TableCell>
            </TableRow>,
          ];

          if (expanded)
            rows.push(
              <TableRow key={`${purchase.id}-items`}>
                <TableCell colSpan={8} className="bg-muted/30">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="text-right">Qtd.</TableHead>
                        <TableHead className="text-right">Custo un.</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Condição</TableHead>
                        <TableHead>Pagamento</TableHead>
                        <TableHead>Custo no produto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {purchase.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="tabular">{item.sku}</TableCell>
                          <TableCell>{item.description ?? "—"}</TableCell>
                          <TableCell className="tabular text-right">{item.quantity}</TableCell>
                          <TableCell className="tabular text-right">{formatCents(item.unit_cost_cents)}</TableCell>
                          <TableCell className="tabular text-right">{item.condition === "bonus" ? <span title="Valor de referência: não é gasto">({formatCents(item.total_cents)})</span> : formatCents(item.total_cents)}</TableCell>
                          <TableCell>
                            <Select value={item.condition} onValueChange={(condition) => change(item.id, { condition: condition as Condition }, "Condição atualizada.")}>
                              <SelectTrigger className="w-48" aria-label={`Condição do item ${item.sku}`}>
                                <SelectValue>{CONDITION_SHORT[item.condition]}</SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {(Object.keys(CONDITION_LABEL) as Condition[]).map((condition) => (
                                  <SelectItem key={condition} value={condition}>
                                    {CONDITION_LABEL[condition]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            {item.condition === "paid" ? (
                              item.payment_status === "paid" ? (
                                <span className="flex items-center gap-2">
                                  <StatusBadge tone="positive">Pago em {formatDate(item.paid_on)}</StatusBadge>
                                  <Button variant="ghost" size="sm" onClick={() => change(item.id, { payment_status: "pending" }, "Pagamento desfeito.")}>
                                    Desfazer
                                  </Button>
                                </span>
                              ) : (
                                <span className="flex items-center gap-2">
                                  <StatusBadge tone="attention">Pendente</StatusBadge>
                                  <Button variant="outline" size="sm" onClick={() => change(item.id, { payment_status: "paid" }, "Marcado como pago.")}>
                                    Marcar como pago
                                  </Button>
                                </span>
                              )
                            ) : (
                              <StatusBadge tone={CONDITION_TONE[item.condition]}>{item.condition === "bonus" ? "Não deve nada" : "Pago no acerto semanal"}</StatusBadge>
                            )}
                          </TableCell>
                          <TableCell>
                            <CostSyncCell sync={item.cost_sync} retrying={retrying} onRetry={() => retry(purchase.id).unwrap().then(() => toast.success("Custo reenviado ao produto.")).catch(() => toast.error("Não foi possível reenviar o custo."))} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableCell>
              </TableRow>,
            );

          return rows;
        })}
      </TableBody>
    </Table>
      {pendingOf !== null && purchases.find((p) => p.id === pendingOf) && <PendingLinesDialog purchase={purchases.find((p) => p.id === pendingOf) as Purchase} open onOpenChange={(next) => !next && setPendingOf(null)} />}
      {editing && <PurchaseFormDialog order={editing} open onOpenChange={(open) => !open && setEditing(null)} />}
      {deleting && <DeleteOrderDialog order={deleting} open onOpenChange={(open) => !open && setDeleting(null)} />}
    </>
  );
}
