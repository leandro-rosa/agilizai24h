/**
 * Relevância de um achado no resumo executivo. NÃO ordena pelo tamanho do % (um
 * produto que foi de 1 para 12 unidades é +1.087% e irrelevante). Combina:
 *  - impacto: |Δ em R$| ÷ receita líquida do mês anterior (limitado em IMPACT_CAP);
 *  - representatividade: parcela do que está sendo movido sobre o total da rede;
 *  - recorrência: o mesmo sentido em meses seguidos (0..1);
 *  - amplitude: fração das lojas afetadas (0..1).
 * Pesos e tetos são PREMISSA inicial a validar com a distribuição real.
 */
export const RANKING = {
  /** Um movimento de 3% da receita já é impacto máximo. */
  IMPACT_CAP: 0.03,
  W_IMPACT: 0.5,
  W_SHARE: 0.2,
  W_RECURRENCE: 0.15,
  W_BREADTH: 0.15,
} as const;

export interface RankInput {
  /** |Δ R$|, em centavos. null = sem valor financeiro (ex.: só unidades). */
  impactCents: number | null;
  /** Receita líquida do mês anterior (base). */
  baseCents: number | null;
  /** Parcela (0..1) do total movimentado que este item representa. */
  share?: number | null;
  /** 0..1: o mesmo sentido repetido nos meses anteriores. */
  recurrence?: number | null;
  /** 0..1: fração das lojas afetadas. */
  breadth?: number | null;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function rankScore({ impactCents, baseCents, share, recurrence, breadth }: RankInput): number {
  const impact = impactCents !== null && baseCents !== null && baseCents > 0 ? clamp01(Math.abs(impactCents) / baseCents / RANKING.IMPACT_CAP) : 0;
  return (
    RANKING.W_IMPACT * impact +
    RANKING.W_SHARE * clamp01(share ?? 0) +
    RANKING.W_RECURRENCE * clamp01(recurrence ?? 0) +
    RANKING.W_BREADTH * clamp01(breadth ?? 0)
  );
}

/** Quantos meses consecutivos (do mais recente para trás) a série se moveu no mesmo sentido do último movimento. */
export function recurrenceOf(values: (number | null)[], minMoves = 1): number {
  const moves: number[] = [];
  for (let i = values.length - 1; i > 0; i -= 1) {
    const a = values[i];
    const b = values[i - 1];
    if (a === null || b === null) break;
    moves.push(Math.sign(a - b));
  }
  if (moves.length < minMoves || moves[0] === 0) return 0;
  let run = 0;
  for (const m of moves) {
    if (m === moves[0]) run += 1;
    else break;
  }
  // 1 movimento = 0; 2 seguidos = 0.5; 3+ = 1.
  return clamp01((run - 1) / 2);
}

/**
 * Mostra a BASE quando um % pode distorcer: sempre que o valor anterior é pequeno,
 * a variação passa de 100% ou o anterior é zero. "+1.087%" vira "+1.087% (1 → 12 un.)".
 */
export function needsBase(previous: number | null, current: number | null, pct: number | null): boolean {
  if (previous === null || current === null) return false;
  if (previous === 0) return true;
  return Math.abs(pct ?? 0) > 1 || previous < 20;
}

/** "1 → 12 un." (a unidade é decidida por quem chama). */
export function baseText(previous: number, current: number, fmt: (n: number) => string, unit = ""): string {
  return `${fmt(previous)} → ${fmt(current)}${unit ? ` ${unit}` : ""}`;
}
