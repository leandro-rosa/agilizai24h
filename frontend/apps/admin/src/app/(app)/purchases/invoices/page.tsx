"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { InvoiceImportDialog } from "@/components/purchases/invoice-import-dialog";
import { PageHeader } from "@/components/page-header";
import { PurchasesTable } from "@/components/purchases/purchases-table";
import { RequestState } from "@/components/request-state";
import { useGetPurchaseQuery, useGetPurchasesQuery } from "@/lib/api/purchases";

/**
 * Notas fiscais de COMPRA (o que o fornecedor emitiu para nós) — não confundir com as notas de venda em Comercial.
 * `?purchase=ID` mostra uma nota só, com os itens abertos: é o link que o produto, o histórico de custo e as compras dele usam.
 */
export default function PurchaseInvoicesPage() {
  const linked = Number(useSearchParams().get("purchase")) || null;
  const list = useGetPurchasesQuery({ invoicesOnly: true }, { skip: linked !== null });
  const one = useGetPurchaseQuery(linked as number, { skip: linked === null });
  const query = linked !== null ? one : list;
  const purchases = linked !== null ? (one.data ? [one.data] : []) : (list.data ?? []);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader title="Notas fiscais de compra" description="Compras que têm nota do fornecedor. Importe o XML da NF-e para registrar sem digitar." actions={<InvoiceImportDialog trigger={undefined} />} />
      {linked !== null && (
        <p className="text-sm text-muted-foreground">
          Mostrando só a compra {linked}.{" "}
          <Link className="underline" href="/purchases/invoices">
            Ver todas as notas
          </Link>
        </p>
      )}
      <RequestState isLoading={query.isLoading} error={query.error} onRetry={query.refetch} isEmpty={purchases.length === 0} emptyMessage={linked !== null ? "Esta compra não foi encontrada." : "Nenhuma nota de compra registrada ainda."}>
        <PurchasesTable key={linked ?? "all"} purchases={purchases} initialOpen={linked ?? undefined} />
      </RequestState>
    </div>
  );
}
