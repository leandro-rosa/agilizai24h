/**
 * Comportamento de produto sobre a série recente (unidades por mês, mais
 * antigo primeiro), não só mês atual vs. anterior. A classificação é
 * EVIDÊNCIA, nunca decisão automática. Limiares: PREMISSA inicial a validar
 * com a distribuição real.
 */
export const BEHAVIOR = {
  /** Meses com venda necessários para não ser "novo". */
  MIN_ACTIVE_MONTHS: 3,
  /** Variação total mínima (primeiro → último) para tendência consistente. */
  TREND_MIN_TOTAL_CHANGE: 0.15,
  /** Último mês vs. média dos 3 anteriores para "mudança recente". */
  RECENT_SHIFT: 0.2,
  /** CV dos 3 anteriores para considerá-los estáveis antes da mudança. */
  STABLE_CV: 0.1,
  /** CV da série inteira a partir do qual é volátil. */
  VOLATILE_CV: 0.25,
} as const;

export type ProductBehavior =
  | "estavel"
  | "crescimento_consistente"
  | "queda_consistente"
  | "volatil"
  | "mudanca_recente"
  | "novo"
  | "dados_insuficientes";

export const BEHAVIOR_LABELS: Record<ProductBehavior, string> = {
  estavel: "Estável",
  crescimento_consistente: "Crescimento consistente",
  queda_consistente: "Queda consistente",
  volatil: "Volátil",
  mudanca_recente: "Mudança recente",
  novo: "Novo no período",
  dados_insuficientes: "Histórico insuficiente",
};

function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function cv(xs: number[]): number {
  const m = mean(xs);
  if (m === 0) return 0;
  const variance = mean(xs.map((v) => (v - m) ** 2));
  return Math.sqrt(variance) / m;
}

/** `series`: um valor por mês, mais antigo primeiro; `null` = mês sem dado ingerido. */
export function classifyBehavior(series: (number | null)[]): ProductBehavior {
  if (series.length < 4 || series.slice(-4).some((v) => v === null)) {
    // Buraco de ingestão nos últimos 4 meses não é "queda a zero".
    return "dados_insuficientes";
  }
  const s = series as number[];
  const active = s.filter((v) => v > 0).length;
  if (active < BEHAVIOR.MIN_ACTIVE_MONTHS || s[0] === 0) return active === 0 ? "dados_insuficientes" : "novo";

  const last4 = s.slice(-4);
  const steps = last4.slice(1).map((v, i) => v - last4[i]);
  const total = (last4[3] - last4[0]) / last4[0];
  if (steps.every((d) => d > 0) && total >= BEHAVIOR.TREND_MIN_TOTAL_CHANGE) return "crescimento_consistente";
  if (steps.every((d) => d < 0) && total <= -BEHAVIOR.TREND_MIN_TOTAL_CHANGE) return "queda_consistente";

  const prev3 = last4.slice(0, 3);
  const prevMean = mean(prev3);
  if (prevMean > 0 && cv(prev3) <= BEHAVIOR.STABLE_CV && Math.abs(last4[3] - prevMean) / prevMean >= BEHAVIOR.RECENT_SHIFT) {
    return "mudanca_recente";
  }
  if (cv(last4) >= BEHAVIOR.VOLATILE_CV) return "volatil";
  return "estavel";
}

/**
 * Distribuição do crescimento/queda entre lojas: o mesmo +23% pode ser
 * estrutural (muitas lojas) ou evento localizado (2 lojas).
 */
export const DISTRIBUTION = { CONCENTRATED_TOP_N: 2, CONCENTRATED_SHARE: 0.7 } as const;

export interface Distribution {
  direction: "up" | "down" | "flat";
  /** Lojas que se moveram na direção do total. */
  storesAffected: number;
  /** Parcela do movimento total que ficou nas `topN` lojas (0..1). */
  topShare: number | null;
  concentrated: boolean;
}

/** `deltaByStore`: variação do produto em cada loja (atual − anterior), mesma unidade. */
export function distribution(deltaByStore: number[]): Distribution {
  const total = deltaByStore.reduce((s, v) => s + v, 0);
  if (total === 0) return { direction: "flat", storesAffected: 0, topShare: null, concentrated: false };
  const direction = total > 0 ? "up" : "down";
  const aligned = deltaByStore.filter((d) => (direction === "up" ? d > 0 : d < 0));
  const alignedTotal = aligned.reduce((s, v) => s + v, 0);
  const sorted = [...aligned].sort((a, b) => Math.abs(b) - Math.abs(a));
  const top = sorted.slice(0, DISTRIBUTION.CONCENTRATED_TOP_N).reduce((s, v) => s + v, 0);
  const topShare = alignedTotal === 0 ? null : top / alignedTotal;
  return {
    direction,
    storesAffected: aligned.length,
    topShare,
    concentrated: topShare !== null && aligned.length > DISTRIBUTION.CONCENTRATED_TOP_N && topShare >= DISTRIBUTION.CONCENTRATED_SHARE,
  };
}
