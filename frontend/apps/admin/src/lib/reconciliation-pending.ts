import type { StockItem } from "@/lib/api/inventory";
import { addMonths } from "@/lib/period-range";

/**
 * Pendências do saldo de estoque a partir de uma data-base. Antes de julho/2026 o time ainda estava aprendendo o sistema de
 * abastecimento, então o histórico anterior carrega erro; a conta de pendências recomeça na CONTAGEM de fim do mês anterior à base
 * e soma só os movimentos da base em diante. É uma leitura para achar onde corrigir — não substitui o saldo calculado pelo
 * serviço de estoque nem altera nenhuma cifra da reconciliação.
 */
export const PENDING_BASELINE = "2026-07";

export interface PendingRow {
  sku: string;
  /** Contagem de fim do mês anterior à base; null = produto sem contagem (conta como 0 e é dito). */
  opening: number | null;
  restocked: number;
  sold: number;
  removed: number;
  adjustment: number;
  /** opening + abastecido − vendido − retirado + ajuste (negativo = pendência). */
  expected: number;
  /** Unidades vendidas/retiradas sem abastecimento nem contagem que as sustente (= −expected). */
  missing: number;
  /** Nenhum abastecimento registrado desde a base, mas houve venda ou retirada. */
  neverRestocked: boolean;
}

export interface PendingSummary {
  baseline: string;
  /** Mês da contagem usada como estoque inicial. */
  openingPeriod: string;
  rows: PendingRow[];
  productCount: number;
  missingUnits: number;
  neverRestockedCount: number;
  withoutOpeningCount: number;
}

/**
 * `movements`: movimentos SOMADOS da base até o mês final (o que `getStockRange` devolve).
 * `opening`: itens do mês anterior à base (só a contagem `recorded_closing_balance` interessa); null = não carregado.
 */
export function buildPending(movements: StockItem[], opening: StockItem[] | null, baseline: string = PENDING_BASELINE): PendingSummary {
  const countBySku = new Map<string, number | null>();
  // O serviço devolve o último registro até o mês pedido: a "contagem de junho" de um produto sem registro em junho seria a de um mês antigo.
  const openingPeriod = addMonths(baseline, -1);
  for (const i of opening ?? []) if (i.period === openingPeriod) countBySku.set(i.sku, i.recorded_closing_balance);

  const rows: PendingRow[] = [];
  for (const m of movements) {
    const count = countBySku.get(m.sku) ?? null;
    const expected = (count ?? 0) + m.restocked - m.sold - m.removed + m.adjustment;
    if (expected >= 0) continue;
    rows.push({
      sku: m.sku,
      opening: count,
      restocked: m.restocked,
      sold: m.sold,
      removed: m.removed,
      adjustment: m.adjustment,
      expected,
      missing: -expected,
      neverRestocked: m.restocked === 0 && m.sold + m.removed > 0,
    });
  }
  rows.sort((a, b) => b.missing - a.missing);
  return {
    baseline,
    openingPeriod,
    rows,
    productCount: rows.length,
    missingUnits: rows.reduce((s, r) => s + r.missing, 0),
    neverRestockedCount: rows.filter((r) => r.neverRestocked).length,
    withoutOpeningCount: rows.filter((r) => r.opening === null).length,
  };
}
