"use client";

import { useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAddProductEanMutation, useUpdateProductEanMutation, type Product } from "@/lib/api/products";
import { isoDay } from "@/lib/products/labels";

const SOURCE_TEXT: Record<string, string> = { manual: "Manual", catalogue_sync: "Sincronização", invoice_import: "Nota fiscal", legacy_import: "Carga inicial", other: "Outra" };

/** Todos os códigos de barras do produto, com situação e validade. Um EAN nunca é apagado: o histórico dele fica com o produto. */
export function EanSection({ product, canWrite }: { product: Product; canWrite: boolean }) {
  const eans = product.eans ?? [];
  const [adding, setAdding] = useState(false);
  const [update, { isLoading: updating }] = useUpdateProductEanMutation();

  async function change(eanId: number, changes: { status?: "active" | "inactive"; primary?: boolean }, done: string) {
    try {
      await update({ productId: product.id, eanId, ...changes }).unwrap();
      toast.success(done);
    } catch (failure) {
      toast.error((failure as { data?: { message?: string } })?.data?.message ?? "Não foi possível alterar o EAN.");
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Códigos de barras (EAN)</h3>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            + Adicionar EAN
          </Button>
        )}
      </div>
      {eans.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Este produto não tem código de barras cadastrado.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>EAN</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Desde</TableHead>
              <TableHead>Até</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Usuário</TableHead>
              <TableHead>Observação</TableHead>
              {canWrite && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {eans.map((ean) => (
              <TableRow key={ean.id}>
                <TableCell className="tabular font-mono text-xs">
                  {ean.ean} {ean.is_primary && <StatusBadge tone="positive">Principal</StatusBadge>}
                </TableCell>
                <TableCell>{ean.status === "active" ? "Ativo" : "Inativo"}</TableCell>
                <TableCell className="tabular">{ean.valid_from ? isoDay(ean.valid_from) : "—"}</TableCell>
                <TableCell className="tabular">{ean.valid_to ? isoDay(ean.valid_to) : "—"}</TableCell>
                <TableCell>{SOURCE_TEXT[ean.source] ?? ean.source}</TableCell>
                <TableCell className="text-xs">{ean.actor ?? "—"}</TableCell>
                <TableCell className="whitespace-normal text-xs text-muted-foreground">{ean.note ?? "—"}</TableCell>
                {canWrite && (
                  <TableCell className="text-right">
                    {ean.status === "active" && !ean.is_primary && (
                      <Button size="sm" variant="ghost" disabled={updating} onClick={() => change(ean.id, { primary: true }, `EAN ${ean.ean} agora é o principal.`)}>
                        Tornar principal
                      </Button>
                    )}
                    {ean.status === "active" ? (
                      <Button size="sm" variant="ghost" disabled={updating} onClick={() => change(ean.id, { status: "inactive" }, `EAN ${ean.ean} inativado; o histórico dele continua neste produto.`)}>
                        Inativar
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={updating} onClick={() => change(ean.id, { status: "active" }, `EAN ${ean.ean} ativado.`)}>
                        Reativar
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {adding && <AddEanDialog product={product} onOpenChange={setAdding} />}
    </section>
  );
}

function AddEanDialog({ product, onOpenChange }: { product: Product; onOpenChange: (open: boolean) => void }) {
  const [add, { isLoading }] = useAddProductEanMutation();
  const [ean, setEan] = useState("");
  const [note, setNote] = useState("");
  const [makePrimary, setMakePrimary] = useState(false);
  const [retireCurrent, setRetireCurrent] = useState(false);
  const valid = /^\d{8,14}$/.test(ean.trim());

  async function submit() {
    try {
      await add({ productId: product.id, ean: ean.trim(), note: note.trim() || undefined, make_primary: makePrimary || undefined, retire_current: retireCurrent || undefined }).unwrap();
      toast.success(`EAN ${ean.trim()} vinculado a ${product.name}.`);
      onOpenChange(false);
    } catch (failure) {
      toast.error((failure as { data?: { message?: string } })?.data?.message ?? "Não foi possível vincular o EAN.");
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar EAN — {product.name}</DialogTitle>
          <DialogDescription>Um produto pode ter vários códigos de barras. O histórico de compras, vendas e margem continua num produto só.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Código de barras (8 a 14 dígitos)
            <Input value={ean} onChange={(e) => setEan(e.target.value)} inputMode="numeric" aria-label="Novo EAN" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Observação (opcional)
            <Input value={note} onChange={(e) => setNote(e.target.value)} aria-label="Observação do EAN" placeholder="Ex.: embalagem nova do fornecedor" />
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={makePrimary} onChange={(e) => setMakePrimary(e.target.checked)} />
            Tornar este o EAN principal
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={retireCurrent} onChange={(e) => setRetireCurrent(e.target.checked)} />
            Inativar o EAN atual (a embalagem mudou)
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!valid || isLoading}>
            Vincular EAN
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
