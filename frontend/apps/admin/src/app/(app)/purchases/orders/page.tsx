"use client";

import { InvoiceImportDialog } from "@/components/purchases/invoice-import-dialog";
import { PageHeader } from "@/components/page-header";
import { PurchaseFormDialog } from "@/components/purchases/purchase-form-dialog";
import { PurchasesTable } from "@/components/purchases/purchases-table";
import { RequestState } from "@/components/request-state";
import { useGetPurchasesQuery } from "@/lib/api/purchases";

export default function OrdersPage() {
  const query = useGetPurchasesQuery();

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Pedidos"
        description="Tudo o que foi comprado: com nota fiscal ou lançado à mão. Cada item é pago, bonificação ou consignado."
        actions={
          <>
            <InvoiceImportDialog />
            <PurchaseFormDialog />
          </>
        }
      />
      <RequestState isLoading={query.isLoading} error={query.error} onRetry={query.refetch} isEmpty={query.data?.length === 0} emptyMessage="Nenhuma compra registrada ainda. Importe uma nota fiscal ou lance uma compra.">
        <PurchasesTable purchases={query.data ?? []} />
      </RequestState>
    </div>
  );
}
