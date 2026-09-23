import type { Period } from "./types";
import type { LossIntelligenceParameters } from "./parameters";

export interface UnnecessarySupplyInput {
  qtySold: number;
  monthsWithRestock: number;
  saleToSupplyRatio: number | null;
  /** Períodos (dentro da janela principal) com perda de validade > 0, em ordem cronológica. */
  periodsWithExpiryLoss: Period[];
  /** Períodos (dentro da janela principal, todos, não só qualifyingRestockPeriods) com abastecimento > 0. */
  periodsWithRestock: Period[];
  /** Períodos do lookback de recorrência com perda de QUALQUER motivo. */
  recurrencePeriodsWithAnyLoss: Period[];
  parameters: LossIntelligenceParameters;
}

export interface UnnecessarySupplyResult {
  sinaisTransversais: string[];
}

/**
 * Detector transversal — roda sobre o Produto×Loja consolidado, não por
 * motivo isolado (spec §10.4). O teto de prioridade para SKU com histórico
 * recente é responsabilidade de priority.ts (Task 14), que recebe
 * `firstSeenRecently` separadamente — este módulo só relata os sinais.
 */
export function detectUnnecessarySupply(input: UnnecessarySupplyInput): UnnecessarySupplyResult {
  const p = input.parameters.unnecessarySupply;
  const signals: string[] = [];

  if (input.qtySold === 0 && input.monthsWithRestock >= 2) {
    signals.push("ZERO_SALES_RECURRING_SUPPLY");
  }

  if (input.saleToSupplyRatio !== null && input.saleToSupplyRatio < p.verylowSaleRatio && input.periodsWithExpiryLoss.length > 0) {
    signals.push("LOW_SALES_EXPIRY_WASTE");
  }

  const restockAfterLoss = input.periodsWithExpiryLoss.some((lossPeriod) => input.periodsWithRestock.some((restockPeriod) => restockPeriod > lossPeriod));
  if (restockAfterLoss) {
    signals.push("RESTOCK_AFTER_EXPIRY_LOSS");
  }

  if (input.saleToSupplyRatio !== null && input.saleToSupplyRatio < input.parameters.validity.lowSaleRatio && input.recurrencePeriodsWithAnyLoss.length >= 2) {
    signals.push("OVERSUPPLY_WITH_RECURRING_LOSS");
  }

  return { sinaisTransversais: signals };
}
