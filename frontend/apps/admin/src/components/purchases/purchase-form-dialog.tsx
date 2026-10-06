"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreatePurchaseMutation, type Condition, type NewPurchase, type Stage } from "@/lib/api/purchases";
import { useGetProductsQuery, type Product } from "@/lib/api/products";
import { supplierAnalysisApi } from "@/lib/api/supplier-analysis";
import { useGetSuppliersQuery } from "@/lib/api/suppliers";
import { useAppDispatch } from "@/lib/hooks";
import { useHasPermission } from "@/lib/auth/use-permission";
import { CONDITION_LABEL, parseMoneyToCents } from "@/lib/purchases/money";
import { STAGE_LABEL, STAGES } from "@/lib/purchases/stages";
import { NewProductDialog } from "./new-product-dialog";
import { EMPTY_TERMS, OrderTermsFields, termsPayload, termsProblem, type OrderTerms } from "./order-terms-fields";

interface Row {
  product: string;
  quantity: string;
  cost: string;
  condition: Condition;
}

const emptyRow = (): Row => ({ product: "", quantity: "", cost: "", condition: "paid" });
const today = () => new Date().toISOString().slice(0, 10);
/** A partir de "faturado" a nota (ou "sem nota") é exigida: é o que o backend também confere. */
const needsInvoice = (stage: Stage) => stage === "invoiced" || stage === "awaiting_receipt" || stage === "received";

/**
 * Lança uma compra em QUALQUER etapa: o pedido muitas vezes só é registrado depois de feito e com a nota emitida. Com número de nota
 * a etapa padrão é "Faturado"; sem número, a pessoa escolhe (requisição, ou já recebido de fornecedor sem nota). Cada item tem a sua
 * condição — pago, bonificação (não custa nada) ou consignado (só se paga o que vender).
 */
export function PurchaseFormDialog({ trigger, defaultStage, title = "Lançar compra" }: { trigger?: React.ReactNode; defaultStage?: Stage; title?: string }) {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const suppliers = useGetSuppliersQuery({ status: "active" }).data ?? [];
  const productsQuery = useGetProductsQuery();
  // Produto recém-cadastrado entra na lista na hora, sem esperar o cadastro ser relido.
  const [created, setCreated] = useState<Product[]>([]);
  const products = useMemo(() => {
    const known = new Set((productsQuery.data ?? []).map((p) => p.sku));
    return [...(productsQuery.data ?? []), ...created.filter((p) => !known.has(p.sku))];
  }, [productsQuery.data, created]);
  const canCreateProduct = useHasPermission("products:write");
  const [create, { isLoading }] = useCreatePurchaseMutation();

  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(today());
  const [invoice, setInvoice] = useState("");
  const [noInvoice, setNoInvoice] = useState(false);
  const [stageChoice, setStageChoice] = useState<Stage | null>(null);
  const [receivedOn, setReceivedOn] = useState(today());
  const [terms, setTerms] = useState<OrderTerms>(EMPTY_TERMS);
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [newProductFor, setNewProductFor] = useState<number | null>(null);

  // Com nota a etapa padrão é "Faturado"; sem nota, a que o botão que abriu o formulário sugeriu (ou "Recebido").
  const stage: Stage = stageChoice ?? (invoice.trim() ? "invoiced" : (defaultStage ?? "received"));

  const labelOf = (p: { name: string; sku: string }) => `${p.name} (${p.sku})`;
  const labels = useMemo(() => products.map(labelOf), [products]);
  const skuOf = (label: string) => products.find((p) => labelOf(p) === label)?.sku;
  const setRow = (index: number, patch: Partial<Row>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  /** Cada linha vira um item válido, ou o motivo de não ser. Nada é adivinhado. */
  function build(): { purchase?: NewPurchase; error?: string } {
    if (!supplierId) return { error: "Escolha o fornecedor." };
    if (needsInvoice(stage) && !invoice.trim() && !noInvoice) return { error: "Informe o número da nota ou marque “fornecedor sem nota”." };
    const problem = termsProblem(terms);
    if (problem) return { error: problem };

    const items = [];
    for (const [i, row] of rows.entries()) {
      if (!row.product && !row.quantity && !row.cost) continue;
      const sku = skuOf(row.product);
      const quantity = Number(row.quantity);
      const cost = row.condition === "bonus" && row.cost.trim() === "" ? 0 : parseMoneyToCents(row.cost);
      if (!sku) return { error: `Linha ${i + 1}: escolha um produto da lista (ou cadastre um novo).` };
      if (!Number.isInteger(quantity) || quantity < 1) return { error: `Linha ${i + 1}: a quantidade deve ser um número inteiro de unidades.` };
      if (cost === null) return { error: `Linha ${i + 1}: informe o custo por unidade (ex.: 8,50).` };
      items.push({ sku, quantity, unit_cost_cents: cost, condition: row.condition });
    }
    if (items.length === 0) return { error: "Informe ao menos um item." };

    return {
      purchase: {
        supplier_id: Number(supplierId),
        ordered_on: date,
        stage,
        invoice_number: invoice.trim() || undefined,
        without_invoice: needsInvoice(stage) && !invoice.trim() ? true : undefined,
        received_on: stage === "received" ? receivedOn : undefined,
        origin: "manual",
        ...termsPayload(terms),
        items,
      },
    };
  }

  async function submit() {
    const { purchase, error } = build();
    if (!purchase) return void toast.error(error);

    try {
      await create(purchase).unwrap();
      dispatch(supplierAnalysisApi.util.invalidateTags(["Analysis"]));
      toast.success(`Registrado em “${STAGE_LABEL[stage]}”.`);
      setOpen(false);
      setRows([emptyRow()]);
      setInvoice("");
      setNoInvoice(false);
      setStageChoice(null);
      setTerms(EMPTY_TERMS);
    } catch (failure) {
      toast.error((failure as { data?: { message?: string } })?.data?.message ?? "Não foi possível registrar.");
    }
  }

  const costOfRow = newProductFor !== null ? parseMoneyToCents(rows[newProductFor]?.cost ?? "") : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button>{title}</Button>}</DialogTrigger>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Registre o pedido na etapa em que ele está: não precisa criar a requisição antes. O custo é o combinado por unidade.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-4">
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
            Data do pedido
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Data da compra" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Nota fiscal
            <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="Número da nota" aria-label="Número da nota" disabled={noInvoice} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Etapa em que entra
            <Select value={stage} onValueChange={(next) => setStageChoice(next as Stage)}>
              <SelectTrigger aria-label="Etapa em que o pedido entra">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={noInvoice} onChange={(e) => setNoInvoice(e.target.checked)} />
            Fornecedor sem nota fiscal
          </label>
          {stage === "received" && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Recebido em
              <Input type="date" className="w-40" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} aria-label="Data do recebimento" />
            </label>
          )}
        </div>

        <OrderTermsFields value={terms} onChange={setTerms} />

        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_5rem_6rem_11rem_auto] items-center gap-2">
              <div className="flex min-w-0 items-center gap-1">
                <Combobox options={labels} value={row.product} onChange={(product) => setRow(index, { product })} placeholder="Produto" className="min-w-0 flex-1" />
                {canCreateProduct && (
                  <Button variant="ghost" size="sm" title="Cadastrar produto novo" aria-label={`Cadastrar produto novo na linha ${index + 1}`} onClick={() => setNewProductFor(index)}>
                    <Plus className="size-4" /> Novo
                  </Button>
                )}
              </div>
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
            {isLoading ? "Salvando..." : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {newProductFor !== null && (
        <NewProductDialog
          open
          onOpenChange={(next) => !next && setNewProductFor(null)}
          unitCostCents={costOfRow}
          supplierId={supplierId ? Number(supplierId) : undefined}
          onCreated={(product: Product) => {
            setCreated((current) => [...current, product]);
            setRow(newProductFor, { product: labelOf(product) });
            setNewProductFor(null);
          }}
        />
      )}
    </Dialog>
  );
}
