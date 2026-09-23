import type { Period, SupplyRecordInput } from "./types";
import type { LossIntelligenceParameters } from "./parameters";

export interface RecentHistoryGuardInput {
  firstSeenPeriod: Period | null;
  monthsSinceFirstSeen: number | null;
  /** Todo o histórico de abastecimento desta loja×SKU — mesmo array usado em computeLossMetrics. */
  allSupplyRows: SupplyRecordInput[];
  parameters: LossIntelligenceParameters;
}

export interface RecentHistoryGuardResult {
  firstSeenRecently: boolean;
  qtyRestockedSinceFirstSeen: number;
  reason: "no_history" | "months_below_minimum" | "units_below_minimum" | null;
}

export function evaluateRecentHistory(input: RecentHistoryGuardInput): RecentHistoryGuardResult {
  if (input.firstSeenPeriod === null || input.monthsSinceFirstSeen === null) {
    return { firstSeenRecently: true, qtyRestockedSinceFirstSeen: 0, reason: "no_history" };
  }

  const qtyRestockedSinceFirstSeen = input.allSupplyRows
    .filter((row) => row.period >= input.firstSeenPeriod!)
    .reduce((total, row) => total + row.quantity_restocked, 0);

  if (input.monthsSinceFirstSeen < input.parameters.recentHistory.minClosedMonths) {
    return { firstSeenRecently: true, qtyRestockedSinceFirstSeen, reason: "months_below_minimum" };
  }
  if (qtyRestockedSinceFirstSeen < input.parameters.recentHistory.minUnits) {
    return { firstSeenRecently: true, qtyRestockedSinceFirstSeen, reason: "units_below_minimum" };
  }
  return { firstSeenRecently: false, qtyRestockedSinceFirstSeen, reason: null };
}

/**
 * "Evidência esmagadora" (spec §9) — decisão de implementação explícita, não
 * um parâmetro novo (a spec aprovada lista 20 parâmetros; isto reaproveita
 * `recentHistory.minUnits` com um multiplicador fixo, documentado aqui em vez
 * de inventar um 21º threshold): abastecido pelo menos o dobro do mínimo de
 * histórico recente, com zero vendas. Usada por `diagnosis/validity.ts` e
 * `diagnosis/other-reason.ts` para decidir se a exceção do §9 se aplica.
 */
export function hasOverwhelmingEvidence(input: { qtySold: number; qtyRestocked: number; parameters: LossIntelligenceParameters }): boolean {
  return input.qtySold === 0 && input.qtyRestocked >= input.parameters.recentHistory.minUnits * 2;
}
