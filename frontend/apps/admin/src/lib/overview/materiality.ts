/**
 * Materialidade — o que merece aparecer num resumo executivo.
 *
 * Todos os limiares abaixo são PROPOSTA INICIAL (PREMISSA), não regra
 * validada: a regra do repo é auditar a distribuição real antes de fixar
 * tolerâncias. Ficam exportados e nomeados para virarem parâmetro depois.
 *
 * Decisão = AND de duas condições, para não alertar nem oscilação pequena
 * de item grande nem salto enorme de item irrelevante:
 *   - relevância no todo:  |Δ abs| ≥ MIN_SHARE_OF_BASE × base (ex.: receita do mês)
 *   - relevância no item:  |Δ %|   ≥ MIN_PCT_CHANGE
 */
export const MATERIALITY = {
  /** Variação mínima do próprio item (fração). */
  MIN_PCT_CHANGE: 0.1,
  /** Variação absoluta mínima como fração da base de comparação (receita do mês, receita do produto…). */
  MIN_SHARE_OF_BASE: 0.01,
  /** Loja "estável" quando |Δ receita| < este valor (fração). */
  STORE_STABLE_BAND: 0.02,
  /** Perda/receita acima disso aponta atenção na loja (fração) — só com receita > 0. */
  STORE_LOSS_TO_REVENUE_ATTENTION: 0.05,
} as const;

export interface MaterialityInput {
  deltaAbs: number | null;
  deltaPct: number | null;
  /** Base para medir representatividade (receita total, receita do produto…). */
  base: number | null;
}

export function isMaterial({ deltaAbs, deltaPct, base }: MaterialityInput, cfg: Partial<typeof MATERIALITY> = {}): boolean {
  const c = { ...MATERIALITY, ...cfg };
  if (deltaAbs === null || base === null || base <= 0) return false;
  const bigEnoughInWhole = Math.abs(deltaAbs) >= c.MIN_SHARE_OF_BASE * base;
  // base do item zerada (pct null) mas com valor absoluto relevante: aparece (ex.: despesa nova).
  const bigEnoughInItem = deltaPct === null ? true : Math.abs(deltaPct) >= c.MIN_PCT_CHANGE;
  return bigEnoughInWhole && bigEnoughInItem;
}

/** Ordem de apresentação: maior impacto absoluto primeiro. */
export function byImpact<T extends { deltaAbs: number | null }>(a: T, b: T): number {
  return Math.abs(b.deltaAbs ?? 0) - Math.abs(a.deltaAbs ?? 0);
}
