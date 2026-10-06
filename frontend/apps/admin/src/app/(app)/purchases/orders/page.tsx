"use client";

import { useState } from "react";

import { InvoiceImportDialog } from "@/components/purchases/invoice-import-dialog";
import { OrdersBoard } from "@/components/purchases/orders-board";
import { PageHeader } from "@/components/page-header";
import { PurchaseFormDialog } from "@/components/purchases/purchase-form-dialog";
import { PurchasesTable } from "@/components/purchases/purchases-table";
import { RequestState } from "@/components/request-state";
import { Button } from "@/components/ui/button";
import { useGetPurchasesQuery } from "@/lib/api/purchases";

export default function OrdersPage() {
  const query = useGetPurchasesQuery();
  const [view, setView] = useState<"board" | "list">("board");

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Pedidos"
        description="Do pedido ao recebimento. Só o recebido conta como comprado; a requisição pode ser enviada por e-mail ao fornecedor. Também dá para lançar uma compra em qualquer etapa."
        actions={
          <>
            <Button variant="outline" onClick={() => setView(view === "board" ? "list" : "board")}>
              {view === "board" ? "Ver em lista" : "Ver em quadro"}
            </Button>
            <InvoiceImportDialog />
            <PurchaseFormDialog title="Nova requisição" defaultStage="requisition" />
          </>
        }
      />
      <RequestState isLoading={query.isLoading} error={query.error} onRetry={query.refetch} isEmpty={query.data?.length === 0} emptyMessage="Nenhum pedido ainda. Crie uma requisição, importe uma nota fiscal ou lance uma compra.">
        {view === "board" ? <OrdersBoard purchases={query.data ?? []} /> : <PurchasesTable purchases={query.data ?? []} />}
      </RequestState>
    </div>
  );
}
