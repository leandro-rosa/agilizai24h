"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRecordCostMutation, useRecordPriceMutation } from "@/lib/api/products";
import { parseMoneyToCents } from "@/lib/purchases/money";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Custo ou preço digitado à mão. Vale a partir de uma data, exige o motivo e fica gravado com o seu usuário e a origem "Manual".
 * Nada é sobrescrito: uma correção é mais uma versão. Se já existe uma versão de nota na mesma data, a nota prevalece.
 */
export function ManualVersionDialog({ kind, sku, name, open, onOpenChange }: { kind: "cost" | "price"; sku: string; name: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [recordCost, { isLoading: savingCost }] = useRecordCostMutation();
  const [recordPrice, { isLoading: savingPrice }] = useRecordPriceMutation();
  const [value, setValue] = useState("");
  const [from, setFrom] = useState(today());
  const [reason, setReason] = useState("");
  const label = kind === "cost" ? "custo" : "preço";
  const cents = parseMoneyToCents(value);
  const invalid = cents === null || cents < 0 || (kind === "price" && cents === 0) || !from || !reason.trim();

  async function submit() {
    if (cents === null) return;
    try {
      if (kind === "cost") await recordCost({ sku, effective_from: from, cost_cents: cents, reason: reason.trim() }).unwrap();
      else await recordPrice({ sku, effective_from: from, price_cents: cents, reason: reason.trim() }).unwrap();
      toast.success(`Novo ${label} de ${name} registrado.`);
      onOpenChange(false);
    } catch (failure) {
      toast.error((failure as { data?: { message?: string } })?.data?.message ?? `Não foi possível registrar o ${label}.`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{kind === "cost" ? "Novo custo" : "Novo preço"} — {name}</DialogTitle>
          <DialogDescription>Fica no histórico com a origem “Manual”, o seu usuário e o motivo. Nada é apagado.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {kind === "cost" ? "Custo por unidade (R$)" : "Preço de venda (R$)"}
            <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="Ex.: 6,20" aria-label={kind === "cost" ? "Novo custo" : "Novo preço"} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Vale a partir de
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Vale a partir de" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Motivo (obrigatório)
            <Input value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Motivo da alteração" placeholder="Ex.: conferido com a nota do fornecedor" />
          </label>
          {kind === "cost" && <p className="text-xs text-muted-foreground">Um custo de data passada muda o CMV desse mês só quando ele for reapurado; o painel não recalcula meses fechados sozinho.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={savingCost || savingPrice}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={invalid || savingCost || savingPrice}>
            Registrar {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
