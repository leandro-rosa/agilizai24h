"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useDraftSuggestionMutation } from "@/lib/api/pricing";
import { classifySuggestion, describeFailure, type SuggestionView } from "./suggestion";

export interface DraftInput {
  category: string | null;
  unitCostCents: number | null;
  typedPriceCents?: number | null;
  name?: string;
}

const DEBOUNCE_MS = 350;
const IDLE: SuggestionView = { kind: "idle", reason: "Informe o custo para calcular o preço sugerido." };

/**
 * A sugestão de preço de um produto (novo, ou existente sem cálculo guardado) pelo motor compartilhado. Pergunta de novo a cada mudança de custo,
 * categoria ou preço digitado e DESCARTA a resposta de uma pergunta antiga (cada pergunta tem um número; só a última vale). Uma resposta só vale para a
 * entrada que a gerou: enquanto a da entrada atual não chega, `loading` é verdadeiro e a resposta anterior não é apresentada como se fosse desta.
 * Em erro diz o que houve e oferece `retry`. Este hook só lê: nunca apaga o que a pessoa digitou.
 */
export function useDraftSuggestion(input: DraftInput, enabled = true) {
  const [ask] = useDraftSuggestionMutation();
  const [outcome, setOutcome] = useState<{ key: string; view: SuggestionView } | null>(null);
  const counter = useRef(0);
  const [nonce, setNonce] = useState(0);

  const { category, unitCostCents, typedPriceCents = null, name } = input;
  const ready = enabled && unitCostCents !== null && unitCostCents > 0;
  const key = JSON.stringify([category, unitCostCents, typedPriceCents, name?.trim() ?? "", nonce]);

  useEffect(() => {
    // A pergunta anterior perde a vez sempre que a entrada muda ou a tela sai.
    const mine = ++counter.current;
    if (!ready) return;
    const timer = setTimeout(async () => {
      let view: SuggestionView;
      try {
        const answer = await ask({ category, unitCostCents, typedPriceCents, name: name?.trim() || undefined }).unwrap();
        view = classifySuggestion(answer.suggestion);
      } catch (error) {
        const { message, detail } = describeFailure(error);
        view = { kind: "failed", message, detail };
      }
      if (mine !== counter.current) return;
      setOutcome({ key, view });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [ready, category, unitCostCents, typedPriceCents, name, key, ask]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  const answered = ready && outcome !== null && outcome.key === key;
  // Entre a mudança da entrada e a resposta, o que se mostra é o último resultado (para não piscar), nunca apresentado como o da entrada nova.
  const view: SuggestionView = !ready ? IDLE : answered ? (outcome as { view: SuggestionView }).view : (outcome?.view ?? IDLE);

  return { view, loading: ready && !answered, retry };
}
