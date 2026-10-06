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
import { useGetProductsQuery } from "@/lib/api/products";
import { useAddAliasMutation, useGetSuppliersQuery, useUpdateSupplierMutation } from "@/lib/api/suppliers";
import { supplierAnalysisApi } from "@/lib/api/supplier-analysis";
import { useAppDispatch } from "@/lib/hooks";
import { CONDITION_LABEL, formatCents, formatDate } from "@/lib/purchases/money";

const REASON: Record<string, string> = {
  no_match: "Produto não encontrado no cadastro",
  fractional_quantity: "Quantidade fracionada (não vira unidade inteira)",
  package_unknown: "Caixa/fardo sem unidades por embalagem cadastradas",
};

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
  const suppliers = useGetSuppliersQuery({ status: "active" }).data ?? [];
  const [addAlias, { isLoading: linking }] = useAddAliasMutation();
  const [updateSupplier] = useUpdateSupplierMutation();
  const [conditions, setConditions] = useState<Record<number, Condition>>({});
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [read, { isLoading: reading }] = usePreviewInvoiceMutation();
  const [create, { isLoading: saving }] = useCreatePurchaseMutation();
  const productsQuery = useGetProductsQuery();
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);

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

  const skuFor = (item: InvoicePreview["items"][number]) => item.sku ?? products.find((p) => labelOf(p) === chosen[item.line])?.sku ?? null;
  const resolved = preview ? preview.items.filter((item) => skuFor(item) && (item.unresolved_reason === null || item.unresolved_reason === "no_match")) : [];
  const left = preview ? preview.items.length - resolved.length : 0;
  const blocked = !preview || !preview.supplier || preview.duplicate_of !== null || resolved.length === 0;

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
        items: resolved.map((item) => ({
          sku: skuFor(item) as string,
          description: item.description,
          quantity: item.quantity,
          unit_cost_cents: item.unit_cost_cents,
          condition: conditions[item.line] ?? "paid",
        })),
      }).unwrap();
      dispatch(supplierAnalysisApi.util.invalidateTags(["Analysis"]));
      toast.success(`Nota ${preview.number} registrada com ${resolved.length} ${resolved.length === 1 ? "item" : "itens"}.`);
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
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Importar nota fiscal (NF-e)</DialogTitle>
          <DialogDescription>Envie o XML da nota. Você confere o que seria registrado antes de confirmar; nada é gravado até lá.</DialogDescription>
        </DialogHeader>

        <Input type="file" accept=".xml,text/xml,application/xml" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Arquivo XML da NF-e" />
        {reading && <p className="text-sm text-muted-foreground">Lendo a nota…</p>}

        {preview && (
          <div className="flex flex-col gap-3">
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

            <div className="max-h-80 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item da nota</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Qtd.</TableHead>
                    <TableHead className="text-right">Custo un.</TableHead>
                    <TableHead>Condição</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.items.map((item) => {
                    const sku = skuFor(item);
                    const fixable = item.unresolved_reason === "no_match";
                    return (
                      <TableRow key={item.line}>
                        <TableCell>
                          <p className="font-medium">{item.description}</p>
                          <p className="text-xs text-muted-foreground">
                            cód. {item.code}
                            {item.conversion ? ` · ${item.conversion}` : ""}
                          </p>
                        </TableCell>
                        <TableCell>
                          {item.sku ? (
                            <span className="text-sm">{item.product_name}</span>
                          ) : fixable ? (
                            <Combobox options={labels} value={chosen[item.line] ?? ""} onChange={(label) => setChosen((c) => ({ ...c, [item.line]: label }))} placeholder="Escolha o produto" className="w-56" />
                          ) : (
                            <span className="text-xs text-destructive">{REASON[item.unresolved_reason ?? "no_match"]}</span>
                          )}
                          {!item.sku && fixable && !sku && <p className="text-xs text-muted-foreground">{REASON.no_match}; fica de fora se não escolher.</p>}
                        </TableCell>
                        <TableCell className="tabular text-right">{item.quantity}</TableCell>
                        <TableCell className="tabular text-right">{formatCents(item.unit_cost_cents)}</TableCell>
                        <TableCell>
                          {sku ? (
                            <Select value={conditions[item.line] ?? "paid"} onValueChange={(c) => setConditions((current) => ({ ...current, [item.line]: c as Condition }))}>
                              <SelectTrigger aria-label={`Condição do item ${item.line}`} className="w-52">
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
            {left > 0 && <p className="text-sm text-warning">{left} {left === 1 ? "linha fica" : "linhas ficam"} de fora por não terem produto resolvido.</p>}
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
    </Dialog>
  );
}
