"use client";

import { useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useUpdatePurchaseItemMutation, type Condition, type Purchase } from "@/lib/api/purchases";
import { supplierAnalysisApi } from "@/lib/api/supplier-analysis";
import { useAppDispatch } from "@/lib/hooks";
import { CONDITION_LABEL, CONDITION_SHORT, formatCents, formatDate } from "@/lib/purchases/money";

const CONDITION_TONE = { paid: "neutral", bonus: "positive", on_sale: "attention" } as const;

/**
 * Compras e o que está dentro de cada uma. Pago = gasto ao custo; consignado só é devido conforme vende (acerto semanal);
 * bonificação não custa nada. A condição muda até o item entrar num acerto confirmado — depois disso o painel recusa.
 */
export function PurchasesTable({ purchases }: { purchases: Purchase[] }) {
  const dispatch = useAppDispatch();
  const [update] = useUpdatePurchaseItemMutation();
  const [open, setOpen] = useState<number | null>(null);

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
              <TableCell className="font-medium">{purchase.supplier_name ?? `Fornecedor ${purchase.supplier_id}`}</TableCell>
              <TableCell>{purchase.invoice_number ? `NF ${purchase.invoice_number}` : <span className="text-xs text-muted-foreground">sem nota</span>}</TableCell>
              <TableCell className="tabular text-right">{purchase.items.length}</TableCell>
              <TableCell className="tabular text-right">{formatCents(purchase.paid_cents)}</TableCell>
              <TableCell className="tabular text-right">{formatCents(purchase.on_sale_cents)}</TableCell>
              <TableCell className="tabular text-right">{purchase.bonus_units > 0 ? `${purchase.bonus_units} un.` : "—"}</TableCell>
              <TableCell className="text-right">
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
  );
}
