"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreatePurchaseMutation, type Condition, type NewPurchase } from "@/lib/api/purchases";
import { useGetProductsQuery } from "@/lib/api/products";
import { supplierAnalysisApi } from "@/lib/api/supplier-analysis";
import { useGetSuppliersQuery } from "@/lib/api/suppliers";
import { useAppDispatch } from "@/lib/hooks";
import { CONDITION_LABEL, parseMoneyToCents } from "@/lib/purchases/money";

interface Row {
  product: string;
  quantity: string;
  cost: string;
  condition: Condition;
}

const emptyRow = (): Row => ({ product: "", quantity: "", cost: "", condition: "paid" });
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Lançamento manual de compra: para fornecedor que não emite nota (número da nota é opcional). Cada item tem a sua condição —
 * pago, bonificação (não custa nada) ou consignado (só se paga o que vender, no acerto semanal).
 */
export function PurchaseFormDialog({ trigger }: { trigger?: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const suppliers = useGetSuppliersQuery({ status: "active" }).data ?? [];
  const products = useGetProductsQuery().data;
  const [create, { isLoading }] = useCreatePurchaseMutation();

  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(today());
  const [invoice, setInvoice] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);

  const labelOf = (p: { name: string; sku: string }) => `${p.name} (${p.sku})`;
  const labels = useMemo(() => (products ?? []).map(labelOf), [products]);
  const skuOf = (label: string) => (products ?? []).find((p) => labelOf(p) === label)?.sku;

  const setRow = (index: number, patch: Partial<Row>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  /** Cada linha vira um item válido, ou o motivo de não ser. Nada é adivinhado. */
  function build(): { purchase?: NewPurchase; error?: string } {
    if (!supplierId) return { error: "Escolha o fornecedor." };
    const items = [];
    for (const [i, row] of rows.entries()) {
      if (!row.product && !row.quantity && !row.cost) continue;
      const sku = skuOf(row.product);
      const quantity = Number(row.quantity);
      const cost = row.condition === "bonus" && row.cost.trim() === "" ? 0 : parseMoneyToCents(row.cost);
      if (!sku) return { error: `Linha ${i + 1}: escolha um produto da lista.` };
      if (!Number.isInteger(quantity) || quantity < 1) return { error: `Linha ${i + 1}: a quantidade deve ser um número inteiro de unidades.` };
      if (cost === null) return { error: `Linha ${i + 1}: informe o custo por unidade (ex.: 8,50).` };
      items.push({ sku, quantity, unit_cost_cents: cost, condition: row.condition });
    }
    if (items.length === 0) return { error: "Informe ao menos um item." };

    return { purchase: { supplier_id: Number(supplierId), ordered_on: date, invoice_number: invoice.trim() || undefined, origin: "manual", items } };
  }

  async function submit() {
    const { purchase, error } = build();
    if (!purchase) return void toast.error(error);

    try {
      await create(purchase).unwrap();
      dispatch(supplierAnalysisApi.util.invalidateTags(["Analysis"]));
      toast.success("Compra registrada.");
      setOpen(false);
      setRows([emptyRow()]);
      setInvoice("");
    } catch (failure) {
      const message = (failure as { data?: { message?: string } })?.data?.message;
      toast.error(message ?? "Não foi possível registrar a compra.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button>Lançar compra</Button>}</DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Lançar compra</DialogTitle>
          <DialogDescription>Para fornecedor sem nota fiscal o número fica em branco. O custo é o que foi combinado por unidade.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Fornecedor
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger aria-label="Fornecedor da compra">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {[...suppliers].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Data
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Data da compra" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Nota fiscal (opcional)
            <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="Número da nota" aria-label="Número da nota" />
          </label>
        </div>

        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_5rem_6rem_10rem_auto] items-center gap-2">
              <Combobox options={labels} value={row.product} onChange={(product) => setRow(index, { product })} placeholder="Produto" />
              <Input inputMode="numeric" placeholder="Qtd." value={row.quantity} onChange={(e) => setRow(index, { quantity: e.target.value })} aria-label={`Quantidade da linha ${index + 1}`} />
              <Input inputMode="decimal" placeholder="Custo un." value={row.cost} onChange={(e) => setRow(index, { cost: e.target.value })} aria-label={`Custo da linha ${index + 1}`} />
              <Select value={row.condition} onValueChange={(condition) => setRow(index, { condition: condition as Condition })}>
                <SelectTrigger aria-label={`Condição da linha ${index + 1}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONDITION_LABEL) as Condition[]).map((condition) => (
                    <SelectItem key={condition} value={condition}>
                      {CONDITION_LABEL[condition]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" aria-label={`Remover linha ${index + 1}`} disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <div>
          <Button variant="outline" size="sm" onClick={() => setRows((current) => [...current, emptyRow()])}>
            <Plus className="size-4" /> Adicionar item
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isLoading}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={isLoading}>
            {isLoading ? "Salvando..." : "Registrar compra"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
