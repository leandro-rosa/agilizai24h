import type { NewProductSuggestion } from "@/lib/api/pricing";

/**
 * O que a tela mostra de uma sugestão de preço. Quatro situações que pedem quatro respostas diferentes (nunca uma frase genérica para todas):
 * falta informação → diz o que falta; a meta não fecha → explica, sem inventar preço; dá para calcular com ressalva → mostra o preço e a ressalva;
 * falha técnica → permite tentar de novo e diz o que aconteceu.
 */
export type SuggestionView =
  | { kind: "idle"; reason: string }
  | { kind: "ready"; suggestion: NewProductSuggestion; caveats: string[]; validated: boolean }
  | { kind: "missing"; reasons: string[] }
  | { kind: "unreachable"; reason: string }
  | { kind: "failed"; message: string; detail: string | null };

/** Uma falha de chamada em linguagem de quem usa: o que houve e se tentar de novo adianta. O motivo técnico vai à parte (`detail`), nunca no lugar. */
export function describeFailure(error: unknown): { message: string; detail: string | null } {
  const e = error as { status?: number | string; data?: { message?: unknown; error?: unknown } } | undefined;
  const status = e?.status;
  const raw = Array.isArray(e?.data?.message) ? (e?.data?.message as string[]).join("; ") : typeof e?.data?.message === "string" ? e.data.message : null;

  if (status === 404) return { message: "A precificação desta instalação está desatualizada e ainda não conhece este cálculo. Avise quem cuida do sistema; o cadastro pode ser salvo sem preço.", detail: "Rota de sugestão não encontrada (404)" };
  if (status === "FETCH_ERROR" || status === "TIMEOUT_ERROR") return { message: "Sem conexão com o servidor. Tente de novo; o que você preencheu foi mantido.", detail: String(status) };
  if (typeof status === "number" && status >= 500) return { message: "O serviço de precificação não respondeu agora. Tente de novo; o que você preencheu foi mantido.", detail: raw ?? `Erro ${status}` };
  if (typeof status === "number" && status === 400) return { message: raw ?? "Algum dado do cálculo é inválido. Confira o custo e a categoria.", detail: raw };
  if (status === 401 || status === 403) return { message: "Você não tem permissão para calcular sugestões de preço.", detail: `Erro ${status}` };

  return { message: "Não foi possível calcular a sugestão. Tente de novo; o que você preencheu foi mantido.", detail: raw ?? (typeof status === "number" ? `Erro ${status}` : null) };
}

/** A resposta do motor, classificada. Só um preço válido (positivo, inteiro) vira `ready`. */
export function classifySuggestion(suggestion: NewProductSuggestion): SuggestionView {
  const price = suggestion.suggestedPriceCents;
  if (suggestion.status === "suggested" && price !== null && Number.isInteger(price) && price > 0) {
    const caveats = [
      ...(suggestion.initial ? ["Sugestão inicial: não há histórico de vendas deste produto por trás dela."] : []),
      ...(suggestion.validated === false ? (suggestion.validationNotes ?? []) : []),
    ];

    return { kind: "ready", suggestion, caveats, validated: suggestion.validated !== false };
  }
  if (suggestion.blocker === "unreachable") return { kind: "unreachable", reason: suggestion.insufficientReasons[0] ?? "A meta de margem não é alcançável pela fórmula." };

  return { kind: "missing", reasons: suggestion.insufficientReasons.length > 0 ? suggestion.insufficientReasons : ["Faltam dados para calcular o preço."] };
}

/** Pode haver um preço para aprovar? O botão de salvar preço só se habilita com um preço válido, sugerido ou digitado. */
export const hasValidPrice = (cents: number | null | undefined): cents is number => typeof cents === "number" && Number.isInteger(cents) && cents > 0;
