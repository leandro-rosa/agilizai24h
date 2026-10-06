"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAppDispatch } from "@/lib/hooks";
import { supplierAnalysisApi } from "@/lib/api/supplier-analysis";
import { useUpdateProductMutation, type Product } from "@/lib/api/products";
import type { Supplier } from "@/lib/api/suppliers";

function labelOf(product: Product): string {
  return `${product.name} (${product.sku})`;
}

/** Grava o vínculo no cadastro do produto e refaz as análises. É o único modo de um produto passar a pertencer a um fornecedor — nada é inferido. */
function useLink() {
  const [update, { isLoading }] = useUpdateProductMutation();
  const dispatch = useAppDispatch();

  async function link(product: Product, supplierId: number | null): Promise<boolean> {
    try {
      await update({ id: product.id, changes: { supplierId } }).unwrap();
      dispatch(supplierAnalysisApi.util.invalidateTags(["Analysis"]));
      toast.success(supplierId === null ? "Vínculo removido." : "Produto vinculado ao fornecedor.");
      return true;
    } catch {
      toast.error("Não foi possível salvar o vínculo. Tente novamente.");
      return false;
    }
  }

  return { link, isLoading };
}

function ConfirmDialog({
  open,
  title,
  description,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? "Salvando..." : "Vincular"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Modo fornecedor: escolhe um produto sem fornecedor cadastrado e o vincula a este. */
export function LinkProductToSupplier({ supplier, products }: { supplier: Supplier; products: Product[] }) {
  const unlinked = useMemo(() => products.filter((product) => product.supplier_id == null), [products]);
  const [choice, setChoice] = useState("");
  const [confirming, setConfirming] = useState<Product | null>(null);
  const { link, isLoading } = useLink();
  const labels = useMemo(() => unlinked.map(labelOf), [unlinked]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Produtos sem fornecedor cadastrado</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {unlinked.length} {unlinked.length === 1 ? "produto não tem" : "produtos não têm"} fornecedor. O painel só atribui um produto a um fornecedor
          pelo vínculo cadastrado, nunca por palpite.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Combobox options={labels} value={choice} onChange={setChoice} placeholder="Escolha um produto" className="w-72" />
          <Button
            size="sm"
            disabled={!choice}
            onClick={() => setConfirming(unlinked.find((product) => labelOf(product) === choice) ?? null)}
          >
            Vincular a {supplier.name}
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirming !== null}
        title="Vincular produto ao fornecedor"
        description={confirming ? `${confirming.name} passará a ser atribuído a ${supplier.name} nas análises e no cadastro do produto.` : ""}
        busy={isLoading}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          if (confirming && (await link(confirming, supplier.id))) {
            setConfirming(null);
            setChoice("");
          }
        }}
      />
    </Card>
  );
}

/** Modo produto sem fornecedor: escolhe o fornecedor deste produto. */
export function LinkSupplierToProduct({ product, suppliers }: { product: Product; suppliers: Supplier[] }) {
  const [supplierId, setSupplierId] = useState("");
  const [confirming, setConfirming] = useState<Supplier | null>(null);
  const { link, isLoading } = useLink();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fornecedor não cadastrado</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <p className="w-full text-sm text-muted-foreground">Este produto não tem fornecedor vinculado. Informe qual é para ele entrar nas análises por fornecedor.</p>
        <Select value={supplierId} onValueChange={setSupplierId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Escolha o fornecedor" />
          </SelectTrigger>
          <SelectContent>
            {suppliers.map((supplier) => (
              <SelectItem key={supplier.id} value={String(supplier.id)}>
                {supplier.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={!supplierId} onClick={() => setConfirming(suppliers.find((s) => String(s.id) === supplierId) ?? null)}>
          Vincular
        </Button>
      </CardContent>
      <ConfirmDialog
        open={confirming !== null}
        title="Vincular fornecedor ao produto"
        description={confirming ? `${product.name} passará a ser atribuído a ${confirming.name}.` : ""}
        busy={isLoading}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          if (confirming && (await link(product, confirming.id))) {
            setConfirming(null);
            setSupplierId("");
          }
        }}
      />
    </Card>
  );
}
