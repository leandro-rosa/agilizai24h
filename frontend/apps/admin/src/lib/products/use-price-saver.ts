"use client";

import { useCallback } from "react";

import { useApplyPriceMutation, useChooseNewProductPriceMutation } from "@/lib/api/pricing";
import type { WorkspaceRow } from "./workspace";

export interface SaveInput {
  row: WorkspaceRow;
  /** De onde vem a sugestão que a pessoa viu: do cálculo guardado ou a inicial do motor. */
  mode: "calculation" | "initial";
  priceCents: number;
  /** O preço escolhido é exatamente a sugestão mostrada (nada digitado). */
  following: boolean;
  reason?: string;
  effectiveFrom: string;
  /** Uma chave por decisão: repetir o clique é a mesma decisão, uma gravação só. */
  key: string;
}

export type SaveResult = { ok: true; warning?: string } | { ok: false; message: string };

const messageOf = (error: unknown): string => {
  const data = (error as { data?: { message?: unknown } } | undefined)?.data;
  if (Array.isArray(data?.message)) return data.message.join("; ");
  if (typeof data?.message === "string") return data.message;

  return "Não foi possível salvar o preço. Nada foi alterado.";
};

/**
 * Salva um preço pelo caminho que registra usuário, data e preço anterior. Com o cálculo de hoje em dia vale a decisão de preço (a recomendação de HOJE é a
 * referência, calculada no servidor; outro preço exige motivo); sem cálculo (produto sem preço, custo ou preço mudou) vale a escolha de produto sem histórico, que o servidor
 * confere contra a sugestão inicial. Aprovar não publica nada no PDV: não existe integração que confirme isso.
 */
export function usePriceSaver() {
  const [apply] = useApplyPriceMutation();
  const [choose] = useChooseNewProductPriceMutation();

  return useCallback(
    async ({ row, mode, priceCents, following, reason, effectiveFrom, key }: SaveInput): Promise<SaveResult> => {
      try {
        if (mode === "calculation") {
          const result = await apply({ idempotencyKey: key, sku: row.product.sku, newPriceCents: priceCents, reason: reason?.trim() || undefined, effectiveFrom, basis: "current" }).unwrap();

          return { ok: true, warning: result.warning };
        }
        await choose({
          sku: row.product.sku,
          idempotencyKey: key,
          choice: following ? "suggested_accepted" : "changed_by_hand",
          chosenPriceCents: priceCents,
          reason: following ? undefined : reason?.trim(),
          costCents: row.cost?.cents,
          costOrigin: "Custo cadastrado do produto",
          effectiveFrom,
        }).unwrap();

        return { ok: true };
      } catch (error) {
        return { ok: false, message: messageOf(error) };
      }
    },
    [apply, choose],
  );
}
