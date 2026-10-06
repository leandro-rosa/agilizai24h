"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateProductMutation, useRecordCostMutation, type Product } from "@/lib/api/products";

const CATEGORIES: { value: Product["category"]; label: string }[] = [
  { value: "meal", label: "Refeição / marmita" },
  { value: "snack", label: "Lanche" },
  { value: "beverage", label: "Bebida" },
  { value: "essential", label: "Mercearia / essenciais" },
];

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Cadastra um produto que ainda não existe, sem sair da compra. Depois de criado ele já aparece no seletor. O custo da compra pode
 * virar o custo de referência do produto a partir de uma data (opcional): sem isso a margem do produto fica "sem custo cadastrado".
 */
export function NewProductDialog({
  open,
  onOpenChange,
  initial,
  unitCostCents,
  supplierId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sugestões vindas da linha da nota ou da compra. */
  initial?: { sku?: string; name?: string; ean?: string };
  /** Custo por unidade da compra, oferecido como custo de referência. */
  unitCostCents?: number | null;
  /** Fornecedor da compra: o produto novo já nasce vinculado a ele. */
  supplierId?: number;
  onCreated: (product: Product) => void;
}) {
  const [create, { isLoading }] = useCreateProductMutation();
  const [recordCost] = useRecordCostMutation();
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [ean, setEan] = useState(initial?.ean ?? "");
  const [category, setCategory] = useState<Product["category"]>("snack");
  const [registerCost, setRegisterCost] = useState(unitCostCents != null && unitCostCents > 0);
  const [costFrom, setCostFrom] = useState(today());

  async function submit() {
    if (!sku.trim() || !name.trim()) return void toast.error("Informe o código (SKU) e o nome do produto.");
    if (ean.trim() && !/^\d{8,14}$/.test(ean.trim())) return void toast.error("O código de barras deve ter de 8 a 14 dígitos.");

    try {
      const product = await create({ sku: sku.trim(), name: name.trim(), category, ean: ean.trim() || undefined, supplierId }).unwrap();
      if (registerCost && unitCostCents != null && unitCostCents > 0) {
        // Falhar aqui não desfaz o produto: ele existe e a pessoa é avisada de que falta o custo.
        await recordCost({ sku: product.sku, effective_from: costFrom, cost_cents: unitCostCents })
          .unwrap()
          .catch(() => toast.warning("Produto cadastrado, mas não foi possível registrar o custo de referência."));
      }
      toast.success(`Produto ${product.name} cadastrado.`);
      onCreated(product);
      onOpenChange(false);
    } catch (failure) {
      toast.error((failure as { data?: { message?: string } })?.data?.message ?? "Não foi possível cadastrar o produto.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cadastrar produto novo</DialogTitle>
          <DialogDescription>O produto passa a existir no cadastro e já pode ser escolhido na compra.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Código (SKU)
            <Input value={sku} onChange={(e) => setSku(e.target.value)} aria-label="SKU do produto novo" placeholder="Ex.: 100200" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Nome
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do produto novo" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Categoria
              <Select value={category} onValueChange={(value) => setCategory(value as Product["category"])}>
                <SelectTrigger aria-label="Categoria do produto novo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Código de barras (opcional)
              <Input value={ean} onChange={(e) => setEan(e.target.value)} aria-label="Código de barras do produto novo" inputMode="numeric" />
            </label>
          </div>
          {unitCostCents != null && unitCostCents > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={registerCost} onChange={(e) => setRegisterCost(e.target.checked)} />
                Registrar {(unitCostCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} como custo de referência a partir de
              </label>
              <Input type="date" className="w-40" value={costFrom} onChange={(e) => setCostFrom(e.target.value)} aria-label="Custo de referência a partir de" disabled={!registerCost} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={isLoading}>
            {isLoading ? "Cadastrando..." : "Cadastrar produto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

