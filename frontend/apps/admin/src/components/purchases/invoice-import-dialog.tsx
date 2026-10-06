"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCreatePurchaseMutation, usePreviewInvoiceMutation, type Condition, type InvoicePreview } from "@/lib/api/purchases";
import { useGetProductsQuery, type Product } from "@/lib/api/products";
import { useHasPermission } from "@/lib/auth/use-permission";
import { useAddAliasMutation, useGetSuppliersQuery, useUpdateSupplierMutation } from "@/lib/api/suppliers";
import { supplierAnalysisApi } from "@/lib/api/supplier-analysis";
import { useAppDispatch } from "@/lib/hooks";
import { CONDITION_LABEL, formatCents, formatDate, packConversion } from "@/lib/purchases/money";
import { NewProductDialog } from "./new-product-dialog";
import { EMPTY_TERMS, OrderTermsFields, termsPayload, termsProblem, type OrderTerms } from "./order-terms-fields";
import { useUpdateProductMutation } from "@/lib/api/products";

const NO_MATCH = "Produto não encontrado no cadastro";

/**
 * Importa uma NF-e: mostra o que seria registrado e deixa a pessoa decidir. Linhas que o painel não consegue casar (por código de
 * barras ou código igual ao SKU, nunca por parecença) ficam de fora até serem escolhidas à mão; nada é gravado antes de confirmar.
 */
export function InvoiceImportDialog({ trigger }: { trigger?: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [linkTo, setLinkTo] = useState("");
  const [packs, setPacks] = useState<Record<number, string>>({});
  const [remember, setRemember] = useState(true);
  const [updateProduct] = useUpdateProductMutation();
  const suppliers = useGetSuppliersQuery({ status: "active" }).data ?? [];
  const [addAlias, { isLoading: linking }] = useAddAliasMutation();
  const [updateSupplier] = useUpdateSupplierMutation();
  const [conditions, setConditions] = useState<Record<number, Condition>>({});
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [read, { isLoading: reading }] = usePreviewInvoiceMutation();
  const [create, { isLoading: saving }] = useCreatePurchaseMutation();
  const productsQuery = useGetProductsQuery();
  // Produto recém-cadastrado entra na lista na hora, sem esperar o cadastro ser relido.
  const [created, setCreated] = useState<Product[]>([]);
  const products = useMemo(() => {
    const known = new Set((productsQuery.data ?? []).map((p) => p.sku));
    return [...(productsQuery.data ?? []), ...created.filter((p) => !known.has(p.sku))];
  }, [productsQuery.data, created]);
  const canCreateProduct = useHasPermission("products:write");
  const [newProductLine, setNewProductLine] = useState<number | null>(null);
  const [alreadyReceived, setAlreadyReceived] = useState(false);
  const [receivedOn, setReceivedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [terms, setTerms] = useState<OrderTerms>(EMPTY_TERMS);

  const labelOf = (p: { name: string; sku: string }) => `${p.name} (${p.sku})`;
  const labels = useMemo(() => products.map(labelOf), [products]);

  async function onFile(next: File | undefined) {
    if (!next) return;
    setFile(next);
    setPreview(null);
    try {
      setPreview(await read(next).unwrap());
      setConditions({});
      setChosen({});
      setPacks({});
      setAlreadyReceived(false);
      setTerms(EMPTY_TERMS);
    } catch (failure) {
      const message = (failure as { data?: { message?: string } })?.data?.message;
      toast.error(message ?? "Não foi possível ler a nota. Confirme que é um XML de NF-e.");
    }
  }

  /**
   * O de-para do fornecedor: o nome do emitente da nota vira alias do fornecedor escolhido (e o CNPJ dele, se ainda não tiver um), então
   * esta e as próximas notas desse emitente (de qualquer filial) são reconhecidas sozinhas. Depois relê a nota.
   */
  async function linkSupplier() {
    const target = suppliers.find((s) => String(s.id) === linkTo);
    if (!preview || !target || !file) return;
    try {
      await addAlias({ id: target.id, alias: preview.issuer.name }).unwrap();
      if (!target.tax_id) await updateSupplier({ id: target.id, tax_id: preview.issuer.tax_id, legal_name: target.legal_name ?? preview.issuer.name }).unwrap().catch(() => undefined);
      toast.success(`${preview.issuer.name} agora é reconhecido como ${target.name}.`);
      setPreview(await read(file).unwrap());
      setLinkTo("");
    } catch (failure) {
      toast.error((failure as { data?: { message?: string } })?.data?.message ?? "Não foi possível vincular o emitente a esse fornecedor.");
    }
  }

  /** O melhor parecido pelo nome, já escolhido no seletor — só quando a medida bate com a da nota. A pessoa troca ou limpa. */
  const suggestedOf = (item: InvoicePreview["items"][number]) => item.suggestions.find((s) => !s.measure_differs) ?? null;
  const chosenLabel = (item: InvoicePreview["items"][number]) => {
    if (chosen[item.line] !== undefined) return chosen[item.line];
    const suggested = suggestedOf(item);
    return suggested ? labelOf(suggested) : "";
  };
  const skuFor = (item: InvoicePreview["items"][number]) => item.sku ?? products.find((p) => labelOf(p) === chosenLabel(item))?.sku ?? null;
  const isSuggested = (item: InvoicePreview["items"][number]) => !item.sku && chosen[item.line] === undefined && suggestedOf(item) !== null;
  /** Os parecidos primeiro na lista do seletor, o resto do catálogo depois. */
  const optionsFor = (item: InvoicePreview["items"][number]) => {
    const top = item.suggestions.map((s) => labelOf(s));
    return [...top, ...labels.filter((label) => !top.includes(label))];
  };
  /** Embalagem da linha: a que a pessoa digitou, senão a sugerida (cadastro ou descrição), senão 1 (a nota já está em unidades). */
  const packOf = (item: InvoicePreview["items"][number]) => Number(packs[item.line] ?? item.pack_size_suggested ?? 1);
  const conversionOf = (item: InvoicePreview["items"][number]) => packConversion(item.quantity, item.unit_cost_cents, packOf(item));
  const withProduct = preview ? preview.items.filter((item) => skuFor(item)) : [];
  const invalid = withProduct.filter((item) => conversionOf(item) === null);
  const resolved = withProduct.filter((item) => conversionOf(item) !== null);
  const left = preview ? preview.items.length - withProduct.length : 0;
  const blocked = !preview || !preview.supplier || preview.duplicate_of !== null || resolved.length === 0 || invalid.length > 0 || termsProblem(terms) !== null;

  async function confirm() {
    if (!preview?.supplier) return;
    try {
      await create({
        supplier_id: preview.supplier.id,
        ordered_on: preview.issued_on,
        invoice_number: preview.number,
        invoice_key: preview.key ?? undefined,
        invoice_object_key: preview.object_key,
        origin: "nfe",
        // A nota já foi emitida: entra em "Faturado" (ou já "Recebido", se a mercadoria chegou).
        stage: alreadyReceived ? "received" : "invoiced",
        received_on: alreadyReceived ? receivedOn : undefined,
        ...termsPayload(terms),
        items: resolved.map((item) => {
          const converted = conversionOf(item) as { units: number; unitCostCents: number };
          return { sku: skuFor(item) as string, supplier_code: item.sku ? undefined : item.code, description: item.description, quantity: converted.units, unit_cost_cents: converted.unitCostCents, condition: conditions[item.line] ?? "paid" };
        }),
      }).unwrap();
      // A embalagem digitada vira dado do produto (só onde ainda não havia): a próxima nota já vem sugerida.
      if (remember)
        await Promise.all(
          resolved.flatMap((item) => {
            const product = products.find((p) => p.sku === skuFor(item));
            const pack = packOf(item);
            return product && pack >= 2 && !product.units_per_package ? [updateProduct({ id: product.id, changes: { unitsPerPackage: pack } }).unwrap().catch(() => undefined)] : [];
          }),
        );
      dispatch(supplierAnalysisApi.util.invalidateTags(["Analysis"]));
      const linked = resolved.filter((item) => !item.sku).length;
      toast.success(
        `Nota ${preview.number} registrada com ${resolved.length} ${resolved.length === 1 ? "item" : "itens"}.` +
          (linked > 0 ? ` ${linked} ${linked === 1 ? "associação guardada" : "associações guardadas"}: na próxima nota deste fornecedor ${linked === 1 ? "o item vem" : "os itens vêm"} preenchido${linked === 1 ? "" : "s"}.` : ""),
      );
      setOpen(false);
      setPreview(null);
    } catch (failure) {
      const message = (failure as { data?: { message?: string } })?.data?.message;
      toast.error(message ?? "Não foi possível registrar a nota.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button variant="outline">Importar nota fiscal</Button>}</DialogTrigger>
      <DialogContent className="max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Importar nota fiscal (NF-e)</DialogTitle>
          <DialogDescription>Envie o XML da nota. Você confere o que seria registrado antes de confirmar; nada é gravado até lá.</DialogDescription>
        </DialogHeader>

        <Input type="file" accept=".xml,text/xml,application/xml" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Arquivo XML da NF-e" />
        {reading && <p className="text-sm text-muted-foreground">Lendo a nota…</p>}

        {preview && (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">
                Nota {preview.number} · {formatDate(preview.issued_on)}
              </p>
              <p className="text-muted-foreground">
                Emitente: {preview.issuer.name} (CNPJ/CPF {preview.issuer.tax_id}) · {preview.supplier ? `fornecedor cadastrado: ${preview.supplier.name}` : "fornecedor NÃO cadastrado"}
              </p>
              {preview.supplier && preview.matched_by === "alias" && <p className="mt-1 text-xs text-muted-foreground">Reconhecido pelo nome do emitente cadastrado em {preview.supplier.name}.</p>}
              {preview.supplier && preview.matched_by === "cnpj_root" && <p className="mt-1 text-xs text-muted-foreground">Mesma empresa de {preview.supplier.name} (outra filial: mesma raiz de CNPJ).</p>}
              {!preview.supplier && (
                <div className="mt-2 flex flex-col gap-2 rounded-md border border-dashed p-2">
                  <p className="text-destructive">Este emitente ainda não é um fornecedor cadastrado. Quem ele é?</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={linkTo} onValueChange={setLinkTo}>
                      <SelectTrigger className="w-64" aria-label="Fornecedor deste emitente">
                        <SelectValue placeholder="Escolha o fornecedor" />
                      </SelectTrigger>
                      <SelectContent>
                        {[...suppliers].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={linkSupplier} disabled={!linkTo || linking}>
                      {linking ? "Vinculando..." : "Vincular emitente"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Ex.: {preview.issuer.name} é o fornecedor “Juntos+”. O vínculo fica salvo: as próximas notas dele são reconhecidas sozinhas. Se ele não existe, cadastre em Fornecedores.</p>
                </div>
              )}
              {preview.duplicate_of !== null && <p className="mt-1 text-destructive">Esta nota já foi registrada (compra {preview.duplicate_of}). Não será duplicada.</p>}
            </div>

            <div className="max-h-80 min-w-0 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item da nota</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Na nota</TableHead>
                    <TableHead>Un. por embalagem</TableHead>
                    <TableHead className="text-right">Registra</TableHead>
                    <TableHead>Condição</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.items.map((item) => {
                    const sku = skuFor(item);
                    const fixable = item.unresolved_reason === "no_match";
                    const converted = conversionOf(item);
                    return (
                      <TableRow key={item.line}>
                        <TableCell>
                          <p className="font-medium">{item.description}</p>
                          <p className="text-xs text-muted-foreground">cód. {item.code}{item.unit ? ` · unidade da nota: ${item.unit}` : ""}</p>
                        </TableCell>
                        <TableCell>
                          {item.sku ? (
                            <>
                              <span className="text-sm">{item.product_name}</span>
                              {item.matched_by === "supplier_code" && <p className="text-xs text-muted-foreground">pelo código deste fornecedor, vinculado antes</p>}
                            </>
                          ) : (
                            <>
                              <Combobox options={optionsFor(item)} value={chosenLabel(item)} onChange={(label) => setChosen((c) => ({ ...c, [item.line]: label }))} placeholder="Escolha o produto" className="w-64" />
                              {isSuggested(item) && <p className="text-xs text-warning">Sugerido pelo nome — confira; para trocar, escolha outro no seletor.</p>}
                              {fixable && !sku && <p className="text-xs text-muted-foreground">{NO_MATCH}; fica de fora se não escolher.</p>}
                              {fixable && !sku && canCreateProduct && (
                                <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setNewProductLine(item.line)}>
                                  Cadastrar produto novo
                                </Button>
                              )}
                            </>
                          )}
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {item.quantity} × {formatCents(item.unit_cost_cents)}
                        </TableCell>
                        <TableCell>
                          {sku ? (
                            <div className="flex flex-col gap-0.5">
                              <Input
                                className="w-20"
                                inputMode="numeric"
                                aria-label={`Unidades por embalagem do item ${item.line}`}
                                value={packs[item.line] ?? String(item.pack_size_suggested ?? 1)}
                                onChange={(e) => setPacks((current) => ({ ...current, [item.line]: e.target.value }))}
                              />
                              {item.pack_source && packs[item.line] === undefined && (
                                <span className="text-xs text-muted-foreground">sugerido ({item.pack_source === "catalogue" ? "cadastro" : "descrição"})</span>
                              )}
                            </div>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {sku ? (
                            converted ? (
                              <>
                                {converted.units} un.
                                <p className="text-xs text-muted-foreground">{formatCents(converted.unitCostCents)} cada</p>
                              </>
                            ) : (
                              <span className="text-xs text-destructive">embalagem inválida</span>
                            )
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          {sku ? (
                            <Select value={conditions[item.line] ?? "paid"} onValueChange={(c) => setConditions((current) => ({ ...current, [item.line]: c as Condition }))}>
                              <SelectTrigger aria-label={`Condição do item ${item.line}`} className="w-36">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(Object.keys(CONDITION_LABEL) as Condition[]).map((c) => (
                                  <SelectItem key={c} value={c}>
                                    {CONDITION_LABEL[c]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={alreadyReceived} onChange={(e) => setAlreadyReceived(e.target.checked)} />
                Já recebi a mercadoria
              </label>
              {alreadyReceived && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Recebido em
                  <Input type="date" className="w-40" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} aria-label="Data do recebimento" />
                </label>
              )}
            </div>
            <OrderTermsFields value={terms} onChange={setTerms} />
            <p className="text-xs text-muted-foreground">A nota costuma trazer o preço do fardo ou da caixa. Informe quantas unidades vêm em cada um: o painel registra unidades e o custo de UMA unidade.</p>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Lembrar a embalagem no cadastro dos produtos que ainda não têm
            </label>
            {invalid.length > 0 && <p className="text-sm text-destructive">{invalid.length} {invalid.length === 1 ? "linha tem" : "linhas têm"} embalagem inválida (use um número inteiro de unidades).</p>}
            {left > 0 && <p className="text-sm text-warning">{left} {left === 1 ? "linha fica" : "linhas ficam"} de fora por não terem produto escolhido.</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={blocked || saving}>
            {saving ? "Registrando..." : `Registrar ${resolved.length} ${resolved.length === 1 ? "item" : "itens"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    
      {preview && newProductLine !== null && (
        <NewProductDialog
          open
          onOpenChange={(next) => !next && setNewProductLine(null)}
          initial={{ sku: preview.items.find((i) => i.line === newProductLine)?.code, name: preview.items.find((i) => i.line === newProductLine)?.description }}
          unitCostCents={(() => {
            const line = preview.items.find((i) => i.line === newProductLine);
            return line ? (conversionOf(line)?.unitCostCents ?? line.unit_cost_cents) : null;
          })()}
          supplierId={preview.supplier?.id}
          onCreated={(product) => {
            setCreated((current) => [...current, product]);
            setChosen((current) => ({ ...current, [newProductLine]: labelOf(product) }));
            setNewProductLine(null);
          }}
        />
      )}
    </Dialog>
  );
}
