"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDeletePurchaseMutation, type Purchase } from "@/lib/api/purchases";
import { supplierAnalysisApi } from "@/lib/api/supplier-analysis";
import { useAppDispatch } from "@/lib/hooks";
import { formatCents, formatDate } from "@/lib/purchases/money";
import { orderTotalCents, STAGE_LABEL } from "@/lib/purchases/stages";

/** Exclusão de um pedido lançado por engano (ou de teste). É definitiva; o painel só recusa se um acerto confirmado já contou os itens. */
export function DeleteOrderDialog({ order, open, onOpenChange }: { order: Purchase; open: boolean; onOpenChange: (open: boolean) => void }) {
  const dispatch = useAppDispatch();
  const [remove, { isLoading }] = useDeletePurchaseMutation();
  const paid = order.items.filter((item) => item.payment_status === "paid").length;
  // O custo que esta compra já criou no produto é histórico e não se apaga junto com ela.
  const costsCreated = order.items.filter((item) => item.cost_sync?.state === "synced").length;

  async function confirm() {
    try {
      await remove(order.id).unwrap();
      dispatch(supplierAnalysisApi.util.invalidateTags(["Analysis"]));
      toast.success(`Pedido ${order.id} excluído.`);
      onOpenChange(false);
    } catch (failure) {
      toast.error((failure as { data?: { message?: string } })?.data?.message ?? "Não foi possível excluir o pedido.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Excluir pedido {order.id}?</DialogTitle>
          <DialogDescription>
            {order.supplier_name ?? `Fornecedor ${order.supplier_id}`} · {STAGE_LABEL[order.status]} · {formatDate(order.ordered_on)} · {formatCents(orderTotalCents(order))}. Os itens, o histórico e o registro de e-mails vão junto. Não dá para desfazer.
            {order.status === "received" && " Como já foi recebido, ele deixa de contar como comprado na análise."}
            {costsCreated > 0 && ` O custo que ${costsCreated === 1 ? "este item criou" : `estes ${costsCreated} itens criaram`} no cadastro do produto continua valendo (o histórico não se apaga); se estiver errado, registre um novo custo na tela do produto.`}
            {paid > 0 && ` ${paid === 1 ? "Há 1 item" : `Há ${paid} itens`} marcado${paid === 1 ? "" : "s"} como pago${paid === 1 ? "" : "s"}.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={isLoading}>
            {isLoading ? "Excluindo..." : "Excluir pedido"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
