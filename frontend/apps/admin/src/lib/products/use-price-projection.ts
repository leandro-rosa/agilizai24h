"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useSimulateCurrentPriceMutation, type Simulation } from "@/lib/api/pricing";
import { describeFailure, type SuggestionView } from "./suggestion";
import { useDraftSuggestion } from "./use-draft-suggestion";
import type { WorkspaceRow } from "./workspace";

export interface PriceProjection {
  /** `calculation`: o cálculo guardado descreve o preço e o custo de hoje; `initial`: sugestão inicial do motor, sem histórico de vendas. */
  mode: "calculation" | "initial";
  suggestedCents: number | null;
  targetMargin: number | null;
  /** Margem de contribuição no preço ESCOLHIDO (o digitado, ou a sugestão enquanto nada foi digitado); nula enquanto a resposta deste preço não chega. */
  margin: number | null;
  contributionCents: number | null;
  loading: boolean;
  /** O estado da sugestão em palavras (falta de dado, meta inviável, ressalva, falha). */
  view: SuggestionView;
  retry: () => void;
}

const DEBOUNCE_MS = 350;

/** A simulação do preço escolhido sobre o cálculo guardado. Cada pergunta tem um número e só a última vale; erro vira `failed` com "tentar de novo". */
function useSimulatedMargin(enabled: boolean, sku: string, priceCents: number | null, scope: { storeId: number | null }) {
  const [simulate] = useSimulateCurrentPriceMutation();
  const [outcome, setOutcome] = useState<{ key: string; result: Simulation | null; failure: { message: string; detail: string | null } | null } | null>(null);
  const [nonce, setNonce] = useState(0);
  const counter = useRef(0);
  const { storeId } = scope;
  const active = enabled && priceCents !== null;
  const key = JSON.stringify([sku, priceCents, storeId, nonce]);

  useEffect(() => {
    const mine = ++counter.current;
    if (!active) return;
    const timer = setTimeout(async () => {
      let next: { key: string; result: Simulation | null; failure: { message: string; detail: string | null } | null };
      try {
        next = { key, result: await simulate({ sku, priceCents: priceCents as number, storeId }).unwrap(), failure: null };
      } catch (error) {
        next = { key, result: null, failure: describeFailure(error) };
      }
      if (mine === counter.current) setOutcome(next);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [active, sku, priceCents, storeId, key, simulate]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  // A resposta de OUTRO preço nunca aparece ao lado do que está digitado.
  const current = active && outcome !== null && outcome.key === key ? outcome : null;

  return { current: current?.result ?? null, failure: current?.failure ?? null, loading: active && current === null, retry };
}

/**
 * A sugestão e a margem do painel de preço de um produto que já existe. Com o cálculo de hoje em dia, a sugestão é a dele e a margem de cada
 * preço digitado vem da simulação sobre ele; sem cálculo em dia (produto sem preço, sem dados suficientes ou fora do cálculo) a sugestão é a inicial
 * do motor, com o custo de hoje. Nada é calculado no navegador.
 */
export function usePriceProjection(row: WorkspaceRow, scope: { storeId: number | null }, typedCents: number | null): PriceProjection {
  const stored = row.analysis !== null && row.analysis.status !== "insufficient_data" ? row.analysis : null;
  const mode: PriceProjection["mode"] = stored ? "calculation" : "initial";
  const suggestedFromCalculation = stored?.recommendedPriceCents ?? null;
  const chosenFromCalculation = typedCents ?? suggestedFromCalculation;

  const sim = useSimulatedMargin(mode === "calculation", row.product.sku, chosenFromCalculation, scope);
  const draft = useDraftSuggestion({ category: row.product.category || null, unitCostCents: row.cost?.cents ?? null, typedPriceCents: typedCents, name: row.product.name }, mode === "initial");

  if (mode === "calculation" && stored) {
    const simulated = sim.current && sim.current.simulable ? sim.current : null;
    const view: SuggestionView = sim.failure
      ? { kind: "failed", message: sim.failure.message, detail: sim.failure.detail }
      : sim.current && !sim.current.simulable
        ? { kind: "missing", reasons: [sim.current.reason] }
        : suggestedFromCalculation === null
          ? { kind: "missing", reasons: stored.insufficientReasons.length > 0 ? stored.insufficientReasons : ["O cálculo não trouxe preço recomendado para este produto."] }
          : { kind: "idle", reason: "" };

    return {
      mode,
      suggestedCents: suggestedFromCalculation,
      targetMargin: stored.targetMargin,
      margin: simulated ? simulated.margin : null,
      contributionCents: simulated ? Math.round(simulated.unitProfitCents) : null,
      loading: sim.loading,
      view,
      retry: sim.retry,
    };
  }

  const suggestion = draft.view.kind === "ready" ? draft.view.suggestion : null;
  const margin = typedCents === null ? (suggestion?.suggestedMargin ?? null) : suggestion?.typedPrice?.priceCents === typedCents ? (suggestion?.typedPrice?.margin ?? null) : null;
  const chosen = typedCents ?? suggestion?.suggestedPriceCents ?? null;

  return {
    mode,
    suggestedCents: suggestion?.suggestedPriceCents ?? null,
    targetMargin: suggestion?.targetMargin ?? null,
    margin,
    contributionCents: chosen !== null && margin !== null ? Math.round(chosen * margin) : null,
    loading: draft.loading,
    view: draft.view,
    retry: draft.retry,
  };
}
