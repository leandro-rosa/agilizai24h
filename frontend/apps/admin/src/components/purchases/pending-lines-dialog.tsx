"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAddProductEanMutation, useGetProductsQuery } from "@/lib/api/products";
import { useResolvePendingLineMutation, type PendingLine, type Purchase } from "@/lib/api/purchases";
import { useHasPermission } from "@/lib/auth/use-permission";
import { formatCents } from "@/lib/purchases/money";
import { RegisterFromInvoiceDialog } from "./register-from-invoice-dialog";

const labelOf = (p: { name: string; sku: string }) => `${p.name} (${p.sku})`;

/**
 * "Aguardando cadastro de produto": as linhas da nota que foram deixadas para depois. Cada uma pode virar um item de um produto que já
 * existe, ou de um que a pessoa cadastra agora; o EAN da linha pode ser vinculado ao produto escolhido. Nada é criado sozinho.
 */
export function PendingLinesDialog({ purchase, open, onOpenChange }: { purchase: Purchase; open: boolean; onOpenChange: (open: boolean) => void }) {
  const productsQuery = useGetProductsQuery();
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const labels = useMemo(() => products.map(labelOf), [products]);
  const [resolve, { isLoading: resolving }] = useResolvePendingLineMutation();
  const [addEan, { isLoading: linking }] = useAddProductEanMutation();
  const canWriteProducts = useHasPermission("products:write");
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [registering, setRegistering] = useState<PendingLine | null>(null);

  const lines = purchase.pending_lines ?? [];
  const waiting = lines.filter((line) => line.status === "pending");
  const productOf = (line: PendingLine) => products.find((p) => labelOf(p) === chosen[line.id]);

  async function attachProduct(line: PendingLine, sku: string, linkEan: boolean) {
    const product = products.find((p) => p.sku === sku);
    try {
      if (linkEan && line.ean && product) await addEan({ productId: product.id, ean: line.ean, note: `Vinculado pela nota ${purchase.invoice_number ?? purchase.id}` }).unwrap();
      await resolve({ id: purchase.id, lineId: line.id, sku }).unwrap();
      toast.success(`${line.description} agora é ${product?.name ?? sku}${purchase.status === "received" ? "; o custo da nota foi para o produto." : "."}`);
    } catch (failure) {
      toast.error((failure as { data?: { message?: string } })?.data?.message ?? "Não foi possível resolver a linha.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Aguardando cadastro de produto</DialogTitle>
          <DialogDescription>
            Nota {purchase.invoice_number ?? purchase.id} · {purchase.supplier_name}. {waiting.length === 0 ? "Todas as linhas já têm produto." : `${waiting.length} ${waiting.length === 1 ? "linha espera" : "linhas esperam"} um produto.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {lines.map((line) => (
            <div key={line.id} className="rounded-md border p-3 text-sm">
              <p className="font-medium">{line.description}</p>
              <p className="text-xs text-muted-foreground">
                {line.quantity} un. × {formatCents(line.unit_cost_cents)} = {formatCents(line.total_cents)}
                {line.ean ? ` · EAN ${line.ean}` : " · sem código de barras"}
                {line.supplier_code ? ` · cód. do fornecedor ${line.supplier_code}` : ""}
              </p>

              {line.status === "resolved" ? (
                <p className="mt-2 text-xs text-success">Virou o produto {line.sku}.</p>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Combobox options={labels} value={chosen[line.id] ?? ""} onChange={(label) => setChosen((c) => ({ ...c, [line.id]: label }))} placeholder="Escolha o produto" className="w-72" />
                  <Button size="sm" variant="outline" disabled={!productOf(line) || resolving} onClick={() => attachProduct(line, (productOf(line) as { sku: string }).sku, false)}>
                    Usar este produto
                  </Button>
                  {line.ean && canWriteProducts && (
                    <Button size="sm" variant="outline" disabled={!productOf(line) || resolving || linking} onClick={() => attachProduct(line, (productOf(line) as { sku: string }).sku, true)}>
                      Vincular EAN e usar
                    </Button>
                  )}
                  {canWriteProducts && (
                    <Button size="sm" onClick={() => setRegistering(line)}>
                      Cadastrar produto novo
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </DialogContent>

      {registering && purchase.invoice_number && (
        <RegisterFromInvoiceDialog
          open
          onOpenChange={(next) => !next && setRegistering(null)}
          line={{ description: registering.description, ean: registering.ean, unitCostCents: registering.unit_cost_cents, unitsPerPack: registering.units_per_pack ?? 1, purchaseUnit: registering.purchase_unit }}
          invoice={{ number: purchase.invoice_number, issuedOn: purchase.invoice_issued_on ?? purchase.ordered_on, supplierId: purchase.supplier_id, supplierName: purchase.supplier_name ?? `Fornecedor ${purchase.supplier_id}`, received: purchase.status === "received" }}
          onCreated={(product) => void attachProduct(registering, product.sku, false)}
        />
      )}
    </Dialog>
  );
}
