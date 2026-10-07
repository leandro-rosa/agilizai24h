"use client";

import { useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useApplyPriceMutation, type PricingProduct } from "@/lib/api/pricing";
import { date, money } from "@/lib/format";
import { CONFIDENCE_LABEL, CONFIDENCE_TONE, parsePriceToCents } from "@/lib/pricing/labels";

/** A mensagem de um erro do gateway, em uma linha: o motivo real, não "erro 502". */
export function errorMessage(error: unknown): string {
  const data = (error as { data?: { message?: unknown } } | undefined)?.data;
  if (Array.isArray(data?.message)) return data.message.join("; ");
  if (typeof data?.message === "string") return data.message;

  return "Não foi possível aplicar o preço. Nada foi alterado.";
}

function reais(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * Aprovação explícita de um preço. A IA só recomenda: nada muda até esta confirmação. A justificativa é obrigatória quando
 * o preço escolhido não é exatamente o recomendado. A chave de idempotência nasce quando o diálogo abre, então um clique
 * duplo é uma decisão só. O formulário é remontado a cada abertura (e a cada produto), então nunca herda o texto anterior.
 */
export function ApplyPriceDialog({
  product,
  initialPriceCents,
  runId,
  open,
  onOpenChange,
  onApplied,
}: {
  product: PricingProduct;
  initialPriceCents: number | null;
  runId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chamado depois de um preço aplicado, para o relatório ser recalculado. */
  onApplied: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <ApplyForm key={`${product.sku}:${initialPriceCents}`} product={product} initialPriceCents={initialPriceCents} runId={runId} onOpenChange={onOpenChange} onApplied={onApplied} />}
    </Dialog>
  );
}

function ApplyForm({
  product,
  initialPriceCents,
  runId,
  onOpenChange,
  onApplied,
}: {
  product: PricingProduct;
  initialPriceCents: number | null;
  runId: string | null;
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
}) {
  const [priceText, setPriceText] = useState(initialPriceCents === null ? "" : reais(initialPriceCents));
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const [apply, { isLoading }] = useApplyPriceMutation();

  const cents = parsePriceToCents(priceText);
  const recommended = product.recommendedPriceCents;
  const sameAsRecommended = cents !== null && cents === recommended;
  const needsReason = cents !== null && !sameAsRecommended;
  const unchanged = cents !== null && cents === product.currentPriceCents;
  const blocked = cents === null || unchanged || (needsReason && reason.trim() === "") || isLoading;

  async function confirm() {
    if (cents === null) return;
    setFailure(null);
    try {
      const result = await apply({ idempotencyKey: key, sku: product.sku, newPriceCents: cents, reason: reason.trim() || undefined, runId: runId ?? undefined }).unwrap();
      if (result.warning) toast.warning(result.warning);
      else toast.success(`Preço de ${product.name ?? product.sku} alterado para ${money(cents)}.`);
      onOpenChange(false);
      onApplied();
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Aplicar novo preço</DialogTitle>
        <DialogDescription>
          {product.name ?? product.sku}: de {money(product.currentPriceCents)} para o preço abaixo, a partir de {date(new Date().toISOString().slice(0, 10))}.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Recomendação da IA:</span>
          <span className="tabular font-medium">{recommended === null ? "— (sem recomendação)" : money(recommended)}</span>
          <StatusBadge tone={CONFIDENCE_TONE[product.confidence]}>Confiança {CONFIDENCE_LABEL[product.confidence].toLowerCase()}</StatusBadge>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="apply-price">Novo preço (R$)</Label>
          <Input id="apply-price" inputMode="decimal" value={priceText} onChange={(event) => setPriceText(event.target.value)} aria-invalid={cents === null && priceText !== ""} />
          {priceText !== "" && cents === null && <p className="text-xs text-destructive">Informe um preço válido, maior que zero.</p>}
          {unchanged && <p className="text-xs text-warning">É o preço atual: nada a alterar.</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="apply-reason">Motivo{needsReason ? " (obrigatório)" : " (opcional)"}</Label>
          <Textarea id="apply-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder={needsReason ? "Por que este preço, e não o recomendado?" : "Ex.: custo subiu"} />
        </div>

        {failure && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/12 p-3 text-sm text-destructive">
            {failure}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
          Cancelar
        </Button>
        <Button onClick={confirm} disabled={blocked}>
          {isLoading ? "Aplicando…" : "Aplicar novo preço"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
