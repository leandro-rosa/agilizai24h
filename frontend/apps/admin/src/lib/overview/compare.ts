/**
 * Comparações do Resumo Mensal. `null` nunca vira zero: "sem comparação" é
 * um estado, não um 0%. Valores usam `%`; taxas/margens usam `p.p.` — nunca
 * o contrário (uma margem de 24,0% → 25,2% é +1,2 p.p., não +5%).
 */

export interface ValueDelta {
  /** Fração (0.084 = +8,4%). `null` quando a base é zero/ausente. */
  pct: number | null;
  /** Diferença absoluta na unidade do valor (centavos, unidades…). */
  abs: number | null;
}

export interface RateDelta {
  /** Pontos percentuais (1.2 = +1,2 p.p.). */
  pp: number | null;
}

export interface Comparison<D> {
  vsPrevious: D;
  vsAvg3: D;
}

export function valueDelta(current: number | null, base: number | null): ValueDelta {
  if (current === null || base === null) return { pct: null, abs: null };
  const abs = current - base;
  if (base === 0) return { pct: null, abs };
  return { pct: abs / Math.abs(base), abs };
}

export function rateDelta(current: number | null, base: number | null): RateDelta {
  if (current === null || base === null) return { pp: null };
  return { pp: (current - base) * 100 };
}

/** Média dos valores presentes; `null` se faltar algum dos meses (não promediar buraco). */
export function avgOfAll(values: (number | null)[], expected = 3): number | null {
  if (values.length < expected || values.some((v) => v === null)) return null;
  const nums = values as number[];
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

export function compareValue(current: number | null, previous: number | null, last3: (number | null)[]): Comparison<ValueDelta> {
  return { vsPrevious: valueDelta(current, previous), vsAvg3: valueDelta(current, avgOfAll(last3)) };
}

export function compareRate(current: number | null, previous: number | null, last3: (number | null)[]): Comparison<RateDelta> {
  return { vsPrevious: rateDelta(current, previous), vsAvg3: rateDelta(current, avgOfAll(last3)) };
}

/** "↑ 8,4%" não é texto: o sinal é decisão de UI. Aqui só o número com sinal. */
export function signedPct(pct: number | null, digits = 1): string {
  if (pct === null) return "sem comparação";
  const v = Math.abs(pct * 100).toFixed(digits).replace(".", ",");
  return `${pct >= 0 ? "+" : "−"}${v}%`;
}

export function signedPp(pp: number | null, digits = 1): string {
  if (pp === null) return "sem comparação";
  const v = Math.abs(pp).toFixed(digits).replace(".", ",");
  return `${pp >= 0 ? "+" : "−"}${v} p.p.`;
}
