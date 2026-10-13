"use client";

import { newUuid } from "@/lib/uuid";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { money } from "@/lib/format";
import { percent } from "@/lib/pricing/labels";
import { buildBatch, savable } from "@/lib/products/batch";
import { usePriceSaver } from "@/lib/products/use-price-saver";
import type { WorkspaceRow } from "@/lib/products/workspace";

const today = () => new Date().toISOString().slice(0, 10);
const dayText = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

type Outcome = { state: "saved" } | { state: "failed"; message: string };

/**
 * Revisão de preços em lote: mostra, antes de salvar, os produtos escolhidos, o escopo, o preço atual e o proposto, a margem resultante e a pendência
 * de cada um. NADA vem marcado: a pessoa marca produto a produto (ou "marcar todos os aptos", uma ação explícita). Produto bloqueado mostra o motivo e
 * não pode ser marcado. Cada produto é salvo por conta própria, com a mesma regra do painel individual; uma falha não desfaz os que já foram salvos e
 * fica à vista para tentar de novo.
 */
export function BatchReviewDialog({ rows, onClose, onSaved }: { rows: WorkspaceRow[]; onClose: () => void; onSaved: () => void }) {
  const items = useMemo(() => buildBatch(rows), [rows]);
  const apt = useMemo(() => savable(items), [items]);
  const save = usePriceSaver();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [validFrom, setValidFrom] = useState(today());
  const [saving, setSaving] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [keys] = useState(() => new Map<string, string>());

  const keyFor = (sku: string) => keys.get(sku) ?? (keys.set(sku, newUuid()), keys.get(sku) as string);
  const toggle = (sku: string, on: boolean) =>
    setChecked((previous) => {
      const next = new Set(previous);
      if (on) next.add(sku);
      else next.delete(sku);

      return next;
    });
  const pending = apt.filter((item) => checked.has(item.row.product.sku) && outcomes[item.row.product.sku]?.state !== "saved");

  async function confirm() {
    setSaving(true);
    let saved = 0;
    for (const item of pending) {
      const sku = item.row.product.sku;
      // O preço proposto É o do cálculo: seguir a sugestão não exige motivo.
      const result = await save({ row: item.row, mode: "calculation", priceCents: item.proposedCents as number, following: true, effectiveFrom: validFrom, key: keyFor(sku) });
      setOutcomes((previous) => ({ ...previous, [sku]: result.ok ? { state: "saved" } : { state: "failed", message: result.message } }));
      if (result.ok) saved += 1;
    }
    setSaving(false);
    if (saved > 0) {
      toast.success(`${saved} ${saved === 1 ? "preço salvo" : "preços salvos"} a partir de ${dayText(validFrom)}.`);
      onSaved();
    }
    if (saved === pending.length) onClose();
  }

  const failures = Object.values(outcomes).filter((outcome) => outcome.state === "failed").length;

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Revisar preços em lote</DialogTitle>
          <DialogDescription>
            {rows.length} {rows.length === 1 ? "produto selecionado" : "produtos selecionados"}. Escopo: todas as lojas (o preço é único para a rede). Nada vem marcado: escolha o que salvar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            Vigência a partir de
            <Input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} aria-label="Vigência a partir de" className="h-10 w-44" />
          </label>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={apt.length === 0 || saving} onClick={() => setChecked(new Set(apt.map((item) => item.row.product.sku)))}>
              Marcar todos os aptos ({apt.length})
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={checked.size === 0 || saving} onClick={() => setChecked(new Set())}>
              Desmarcar
            </Button>
          </div>
        </div>

        <div className="max-h-[50vh] overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="w-10 px-3 py-2" />
                <th className="px-3 py-2">Produto</th>
                <th className="px-3 py-2 text-right">Preço atual</th>
                <th className="px-3 py-2 text-right">Preço proposto</th>
                <th className="px-3 py-2 text-right">Margem resultante</th>
                <th className="px-3 py-2">Situação</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const sku = item.row.product.sku;
                const outcome = outcomes[sku];
                const disabled = item.blocked !== null || outcome?.state === "saved" || saving;

                return (
                  <tr key={sku} className="border-b last:border-b-0 align-top">
                    <td className="px-3 py-2">
                      <Checkbox aria-label={`Marcar ${item.row.product.name}`} checked={checked.has(sku)} disabled={disabled} onCheckedChange={(on) => toggle(sku, on === true)} />
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{item.row.product.name}</span>
                      <span className="block text-xs text-muted-foreground">SKU {sku}</span>
                    </td>
                    <td className="tabular px-3 py-2 text-right">{item.row.price ? money(item.row.price.cents) : "Não definido"}</td>
                    <td className="tabular px-3 py-2 text-right font-medium">{item.proposedCents !== null ? money(item.proposedCents) : "—"}</td>
                    <td className="tabular px-3 py-2 text-right">{item.resultingMargin !== null ? percent(item.resultingMargin) : "—"}</td>
                    <td className="px-3 py-2">
                      {outcome?.state === "saved" ? (
                        <StatusBadge tone="positive">Salvo</StatusBadge>
                      ) : outcome?.state === "failed" ? (
                        <span className="text-xs text-destructive">Falhou: {outcome.message}</span>
                      ) : item.blocked ? (
                        <span className="text-xs text-muted-foreground" data-testid="blocked-reason">
                          Bloqueado: {item.blocked}
                        </span>
                      ) : (
                        <StatusBadge tone="attention">Pronto para salvar</StatusBadge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Fica registrado quem aprovou, quando e o preço anterior de cada produto. Isto não publica nada no PDV.</p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {failures > 0 ? "Fechar" : "Cancelar"}
          </Button>
          <Button onClick={confirm} disabled={pending.length === 0 || saving}>
            {saving ? "Salvando…" : `Salvar ${pending.length} ${pending.length === 1 ? "preço" : "preços"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
