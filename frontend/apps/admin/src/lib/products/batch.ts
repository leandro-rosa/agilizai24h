import type { WorkspaceRow } from "./workspace";

/** Uma linha da revisão em lote: o que seria proposto e, quando não pode ser salvo, o motivo (nunca sumir em silêncio). */
export interface BatchItem {
  row: WorkspaceRow;
  proposedCents: number | null;
  /** Margem de contribuição no preço proposto, do cálculo guardado; nula quando não há. */
  resultingMargin: number | null;
  /** Motivo que impede salvar este produto em lote; nulo quando pode ser marcado. */
  blocked: string | null;
}

/**
 * Para cada produto selecionado, o preço que o cálculo guardado recomenda, a margem nele e o que o bloqueia. Só um cálculo EM DIA propõe preço: sem custo,
 * sem preço atual (precisa do painel do produto, onde a sugestão inicial e o motivo são vistos), sem recomendação ou com a recomendação igual ao preço
 * atual o produto fica bloqueado, com o motivo. O lote nunca inventa um preço e nunca marca nada sozinho.
 */
export function buildBatch(rows: WorkspaceRow[]): BatchItem[] {
  return rows.map((row) => {
    const analysis = row.analysis;
    const proposed = row.suggestedCents;
    let blocked: string | null = null;

    if (row.cost === null) blocked = "Sem custo cadastrado";
    else if (row.price === null) blocked = "Sem preço atual: revise pelo painel do produto (sugestão inicial, com o motivo)";
    else if (row.situation === "stale") blocked = "O preço ou o custo mudou depois do cálculo: atualize a lista";
    else if (analysis === null) blocked = "Fora do cálculo de hoje: atualize a lista";
    else if (analysis.status === "insufficient_data") blocked = analysis.insufficientReasons[0] ?? "Dados insuficientes para o cálculo";
    else if (proposed === null) blocked = "O cálculo não trouxe preço recomendado";
    else if (row.price !== null && proposed === row.price.cents) blocked = "O preço atual já é o recomendado";

    return { row, proposedCents: blocked === null ? proposed : null, resultingMargin: blocked === null ? (analysis?.recommendedMargin ?? null) : null, blocked };
  });
}

export const savable = (items: BatchItem[]): BatchItem[] => items.filter((item) => item.blocked === null);
