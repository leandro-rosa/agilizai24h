"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetCategoriesQuery, useUpdateProductMutation, type Product } from "@/lib/api/products";
import { STATUS_LABEL } from "@/lib/products/labels";
import type { ClassificationState } from "@/lib/products/taxonomy";
import { CategoryFields } from "./category-fields";

/**
 * Edita a identificação do produto, a classificação (sobre a lista única de categorias), a marca, as unidades e o fator caixa/fardo → unidade. A categoria e
 * a subcategoria só vão para o servidor se mudaram: salvar sem mexer nelas não "confirma" uma classificação que ninguém escolheu.
 */
export function EditProductDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const categories = useGetCategoriesQuery().data;
  const [update, { isLoading }] = useUpdateProductMutation();
  const [name, setName] = useState(product.name);
  const [brand, setBrand] = useState(product.brand ?? "");
  const [saleUnit, setSaleUnit] = useState(product.sale_unit ?? "un");
  const [purchaseUnit, setPurchaseUnit] = useState(product.purchase_unit ?? "");
  const [packageType, setPackageType] = useState(product.package_type ?? "");
  const [factor, setFactor] = useState(product.units_per_package ? String(product.units_per_package) : "");
  const [fractionable, setFractionable] = useState(product.fractionable ?? false);
  const [status, setStatus] = useState(product.status ?? "active");
  // O ponto de partida é o que o produto já tem; mexer é escolha manual.
  const [classification, setClassification] = useState<ClassificationState>({ category: product.category, subcategory: product.subcategory ?? "", source: "manual", alternatives: [] });

  const factorNumber = factor.trim() === "" ? null : Number(factor);
  const invalidFactor = factorNumber !== null && (!Number.isInteger(factorNumber) || factorNumber < 1);

  async function save() {
    const classificationChanged = classification.category !== product.category || classification.subcategory !== (product.subcategory ?? "");
    try {
      await update({
        id: product.id,
        changes: {
          name: name.trim(),
          brand: brand.trim() ? brand.trim() : null,
          saleUnit: saleUnit.trim() || undefined,
          purchaseUnit: purchaseUnit.trim() ? purchaseUnit.trim() : null,
          packageType: packageType.trim() ? packageType.trim() : null,
          unitsPerPackage: factorNumber,
          fractionable,
          status: status === "discontinued" ? "discontinued" : "active",
          ...(classificationChanged ? { category: classification.category, subcategory: classification.subcategory || null } : {}),
        },
      }).unwrap();
      toast.success(`${name.trim()} atualizado.`);
      onClose();
    } catch (failure) {
      toast.error((failure as { data?: { message?: string } })?.data?.message ?? "Não foi possível salvar o produto.");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Editar produto — {product.name}</DialogTitle>
          <DialogDescription>Os códigos de barras, os custos e os preços têm abas próprias no cadastro do produto.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Nome
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome" />
          </label>
          <CategoryFields categories={categories} state={classification} onChange={setClassification} currentSubcategory={product.subcategory} />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Marca
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Marca" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Situação
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger aria-label="Situação do produto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Unidade de venda
              <Input value={saleUnit} onChange={(e) => setSaleUnit(e.target.value)} aria-label="Unidade de venda" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Unidade de compra (como o fornecedor vende)
              <Input value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)} aria-label="Unidade de compra" placeholder="CX" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Tipo de embalagem
              <Input value={packageType} onChange={(e) => setPackageType(e.target.value)} aria-label="Tipo de embalagem" placeholder="caixa, fardo…" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Fator: unidades por caixa/fardo
              <Input value={factor} onChange={(e) => setFactor(e.target.value)} aria-label="Fator de conversão" inputMode="numeric" />
              <span>O custo é sempre guardado por unidade vendida: custo da caixa ÷ este fator.</span>
            </label>
          </div>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={fractionable} onChange={(e) => setFractionable(e.target.checked)} />
            A embalagem pode ser fracionada no abastecimento
          </label>
          {invalidFactor && <p className="text-sm text-destructive">O fator deve ser um número inteiro de 1 em diante.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={!name.trim() || invalidFactor || isLoading}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
