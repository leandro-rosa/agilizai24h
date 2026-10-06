"use client";

import { ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useDecideSkuLinkMutation, useDeleteSkuLinkMutation, useGetProductsQuery, useGetSkuLinksQuery } from "@/lib/api/products";
import { useHasPermission } from "@/lib/auth/use-permission";
import { period as fmtPeriod } from "@/lib/format";
import type { SkuSuggestion } from "@/lib/overview/sku-match";
import { Block } from "./shared";

/**
 * Pergunta ao operador se um SKU "sem histórico"/em teste é o mesmo produto de
 * um SKU antigo de nome parecido (troca de código de barras). Só sugere: nada é
 * vinculado sem o clique. A decisão fica gravada; a tela recalcula já unindo o histórico.
 */
export function SkuLinksCard({ suggestions }: { suggestions: SkuSuggestion[] }) {
  const canWrite = useHasPermission("products:write");
  const [decide, { isLoading }] = useDecideSkuLinkMutation();
  const [remove, { isLoading: removing }] = useDeleteSkuLinkMutation();
  const { data: links } = useGetSkuLinksQuery();
  const { data: products } = useGetProductsQuery();
  const nameOf = (sku: string) => products?.find((p) => p.sku === sku)?.name ?? sku;
  const decided = links ?? [];

  async function onUndo(id: number) {
    try {
      await remove(id).unwrap();
      toast.success("Decisão desfeita: o par volta a ser sugerido se ainda parecer uma troca.");
    } catch {
      toast.error("Não foi possível desfazer a decisão.");
    }
  }

  if (suggestions.length === 0 && decided.length === 0) return null;

  async function onDecide(oldSku: string, newSku: string, decision: "same" | "different") {
    try {
      await decide({ old_sku: oldSku, new_sku: newSku, decision }).unwrap();
      toast.success(decision === "same" ? "Vinculado: o histórico dos dois códigos foi somado." : "Registrado: não é o mesmo produto.");
    } catch (e) {
      const msg = (e as { data?: { message?: string } })?.data?.message;
      toast.error(msg ?? "Não foi possível salvar a decisão.");
    }
  }

  return (
    <Block title={suggestions.length > 0 ? "Possível troca de código de barras — confirme" : "Trocas de código de barras já decididas"} icon={<ArrowLeftRight className="size-4 text-primary" />} href="/products" linkLabel="Ver produtos">
      {suggestions.length > 0 && <p className="text-sm text-muted-foreground">
        Estes produtos aparecem como novos, mas há no catálogo um produto de nome parecido cujas vendas caíram (vendia bem e quase parou). Se for o mesmo item com outro código,
        confirme: o histórico passa a ser somado e ele deixa de aparecer como novo ou em teste.
      </p>}
      <ul className="flex flex-col gap-4">
        {suggestions.map((s) => (
          <li key={s.newSku} className="flex flex-col gap-2 rounded-lg border p-3">
            <p className="text-sm">
              <span className="font-semibold">{s.newName}</span> <span className="text-muted-foreground">({s.newSku}) — código novo</span>
            </p>
            {s.candidates.map((c) => (
              <div key={c.oldSku} className="flex flex-col gap-2 border-t pt-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm">
                  É o mesmo que <span className="font-medium">{c.oldName}</span> <span className="text-muted-foreground">({c.oldSku})</span>?
                  <span className="block text-xs text-muted-foreground">
                    Código antigo: chegou a vender {c.peakUnits} un./mês e vendeu {c.unitsInPeriod} un. no mês
                    {c.lastSoldPeriod ? ` (última venda em ${fmtPeriod(c.lastSoldPeriod)})` : ""} · semelhança de nome {Math.round(c.score * 100)}%
                  </span>
                </p>
                {canWrite && (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" disabled={isLoading} onClick={() => onDecide(c.oldSku, s.newSku, "same")}>É o mesmo produto</Button>
                    <Button size="sm" variant="outline" disabled={isLoading} onClick={() => onDecide(c.oldSku, s.newSku, "different")}>Não é</Button>
                  </div>
                )}
              </div>
            ))}
          </li>
        ))}
      </ul>
      {!canWrite && <p className="text-xs text-muted-foreground">Sem permissão para confirmar vínculos (products:write).</p>}
      {decided.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Decisões já tomadas ({decided.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {decided.map((l) => (
              <li key={l.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {l.decision === "same" ? "Mesmo produto: " : "Não é o mesmo: "}
                  <span className="font-medium">{nameOf(l.old_sku)}</span> → <span className="font-medium">{nameOf(l.new_sku)}</span>
                </span>
                {canWrite && <Button size="sm" variant="outline" disabled={removing} onClick={() => onUndo(l.id)}>Desfazer</Button>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Block>
  );
}
