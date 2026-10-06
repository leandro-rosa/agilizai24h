"use client";

import { InvoiceImportDialog } from "@/components/purchases/invoice-import-dialog";
import { PageHeader } from "@/components/page-header";
import { PurchasesTable } from "@/components/purchases/purchases-table";
import { RequestState } from "@/components/request-state";
import { useGetPurchasesQuery } from "@/lib/api/purchases";

/** Notas fiscais de COMPRA (o que o fornecedor emitiu para nós) — não confundir com as notas de venda em Comercial. */
export default function PurchaseInvoicesPage() {
  const query = useGetPurchasesQuery({ invoicesOnly: true });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader title="Notas fiscais de compra" description="Compras que têm nota do fornecedor. Importe o XML da NF-e para registrar sem digitar." actions={<InvoiceImportDialog trigger={undefined} />} />
      <RequestState isLoading={query.isLoading} error={query.error} onRetry={query.refetch} isEmpty={query.data?.length === 0} emptyMessage="Nenhuma nota de compra registrada ainda.">
        <PurchasesTable purchases={query.data ?? []} />
      </RequestState>
    </div>
  );
}
