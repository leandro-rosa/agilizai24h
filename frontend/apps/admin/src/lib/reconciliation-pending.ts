import type { MonthItems, StockItem } from "@/lib/api/inventory";
import { addMonths, monthsInRange } from "@/lib/period-range";

/**
 * Pendências do saldo de estoque MÊS A MÊS. Antes de julho/2026 o time ainda estava aprendendo o sistema de abastecimento (histórico com muito erro),
 * então a análise começa em `PENDING_BASELINE`. Em cada mês o ponto de partida é a CONTAGEM de fim do mês anterior: venda sem abastecimento no mês
 * pode ser estoque que sobrou do mês passado (abastecidos 18, vendidos 15, no mês seguinte vendem os 3 que sobraram), e o erro de um mês não pode
 * se acumular nos seguintes. É uma leitura para achar onde corrigir — não substitui o saldo do serviço de estoque nem altera cifra da reconciliação.
 */
export const PENDING_BASELINE = "2026-07";

/** `entrada_nao_lancada`: há estoque contado no fim do mês, então o produto existia e faltou lançar entrada. `saiu_mais_que_entrou`: sem estoque contado no fim. */
export type PendingKind = "entrada_nao_lancada" | "saiu_mais_que_entrou";

export interface PendingRow {
  sku: string;
  /** Contagem de fim do mês anterior; null = produto sem contagem lá (conta como 0 e é dito). */
  opening: number | null;
  restocked: number;
  sold: number;
  removed: number;
  adjustment: number;
  /** opening + abastecido − vendido − retirado + ajuste (negativo = pendência). */
  expected: number;
  /** Contagem de fim DO mês; null = não contado. */
  countEnd: number | null;
  /** Unidades que precisariam ter entrado e não constam: −expected, ou countEnd − expected quando há estoque contado no fim. */
  missing: number;
  kind: PendingKind;
  /** Nenhum abastecimento no mês, mas houve venda ou retirada. */
  noRestockInMonth: boolean;
}

export interface MonthlyPending {
  month: string;
  /** Mês da contagem usada como estoque inicial. */
  openingPeriod: string;
  /** Há registros desse mês? false = nada importado (nunca é "zero pendência"). */
  hasData: boolean;
  rows: PendingRow[];
  productCount: number;
  /** Produtos com registro no mês (base do percentual). */
  productsInMonth: number;
  missingUnits: number;
  entryNotLoggedCount: number;
  withoutOpeningCount: number;
}

const byMonth = (months: MonthItems[]) => new Map(months.map((m) => [m.period, m.items]));

export function buildMonthlyPending(months: MonthItems[], month: string): MonthlyPending {
  const periods = byMonth(months);
  const openingPeriod = addMonths(month, -1);
  const current = periods.get(month);
  const opening = new Map<string, number | null>();
  // O serviço devolve o último registro até o mês pedido: só vale a contagem que é DO mês anterior (`MonthItems` já vem só com registros do próprio mês).
  for (const i of periods.get(openingPeriod) ?? []) opening.set(i.sku, i.recorded_closing_balance);

  const rows: PendingRow[] = [];
  for (const m of current ?? []) {
    const open = opening.get(m.sku) ?? null;
    const expected = (open ?? 0) + m.restocked - m.sold - m.removed + m.adjustment;
    if (expected >= 0) continue;
    const kind: PendingKind = m.recorded_closing_balance !== null && m.recorded_closing_balance > 0 ? "entrada_nao_lancada" : "saiu_mais_que_entrou";
    rows.push({
      sku: m.sku,
      opening: open,
      restocked: m.restocked,
      sold: m.sold,
      removed: m.removed,
      adjustment: m.adjustment,
      expected,
      countEnd: m.recorded_closing_balance,
      missing: kind === "entrada_nao_lancada" ? (m.recorded_closing_balance ?? 0) - expected : -expected,
      kind,
      noRestockInMonth: m.restocked === 0 && m.sold + m.removed > 0,
    });
  }
  rows.sort((a, b) => b.missing - a.missing);
  return {
    month,
    openingPeriod,
    hasData: current !== undefined,
    rows,
    productCount: rows.length,
    productsInMonth: current?.length ?? 0,
    missingUnits: rows.reduce((s, r) => s + r.missing, 0),
    entryNotLoggedCount: rows.filter((r) => r.kind === "entrada_nao_lancada").length,
    withoutOpeningCount: rows.filter((r) => r.opening === null).length,
  };
}

/** Meses analisados: da base até o mês final. Antes da base não se analisa (histórico em aprendizado). */
export function pendingMonths(endPeriod: string, baseline: string = PENDING_BASELINE): string[] {
  return endPeriod < baseline ? [] : monthsInRange({ start: baseline, end: endPeriod });
}

/** Período a buscar: do mês anterior à base (contagem inicial) até o mês final. */
export function pendingFetchRange(endPeriod: string, baseline: string = PENDING_BASELINE) {
  return { start: addMonths(baseline, -1), end: endPeriod };
}

export interface PendingTrendPoint {
  month: string;
  count: number;
  hasData: boolean;
}

/** Negativos de cada mês analisado: mostra se a loja melhora ou piora ("Jul 12 → Ago 7 → Set 5"). */
export function pendingTrend(months: MonthItems[], endPeriod: string): PendingTrendPoint[] {
  return pendingMonths(endPeriod).map((m) => {
    const p = buildMonthlyPending(months, m);
    return { month: m, count: p.productCount, hasData: p.hasData };
  });
}

export type { StockItem };
