"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { count } from "@/lib/format";
import type { PendencyGroup, WorkspaceRow } from "@/lib/products/workspace";

/** As pendências que afetam a decisão, uma a uma: o que é, quais produtos afeta e a ação que resolve. Sem produtos listados quando vale para o cálculo inteiro. */
export function PendenciesDialog({ groups, rows, onClose, onAction, onOpenProduct }: { groups: PendencyGroup[]; rows: WorkspaceRow[]; onClose: () => void; onAction: (group: PendencyGroup) => void; onOpenProduct: (sku: string) => void }) {
  const nameOf = new Map(rows.map((row) => [row.product.sku, row.product.name]));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pendências que afetam a decisão de preço</DialogTitle>
          <DialogDescription>Cada pendência diz quais produtos afeta e como resolver. Nenhuma delas aprova ou muda um preço sozinha.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-4">
          {groups.map((group) => (
            <li key={group.code} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="min-w-0 flex-1 text-sm font-medium">
                  {group.label}
                  {group.skus.length > 0 && <span className="ml-2 font-normal text-muted-foreground">{count(group.skus.length)} {group.skus.length === 1 ? "produto" : "produtos"}</span>}
                </p>
                {group.action !== "info" && (
                  <Button size="sm" variant="outline" onClick={() => onAction(group)}>
                    {group.actionLabel}
                  </Button>
                )}
              </div>
              {group.skus.length > 0 && (
                <ul className="mt-2 max-h-40 divide-y overflow-auto text-sm">
                  {group.skus.slice(0, 30).map((sku) => (
                    <li key={sku} className="flex items-center justify-between gap-3 py-1.5">
                      <span>
                        {nameOf.get(sku) ?? sku} <span className="font-mono text-xs text-muted-foreground">{sku}</span>
                      </span>
                      <button type="button" className="text-xs font-medium underline underline-offset-2" onClick={() => onOpenProduct(sku)}>
                        Abrir
                      </button>
                    </li>
                  ))}
                  {group.skus.length > 30 && <li className="py-1.5 text-xs text-muted-foreground">e mais {group.skus.length - 30}…</li>}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
