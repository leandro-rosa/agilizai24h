import type { AnalysisWindow, Period } from "./types";
import type { LossIntelligenceParameters } from "./parameters";

export function periodOf(dateISO: string): Period {
  return dateISO.slice(0, 7);
}

export function addMonths(period: Period, delta: number): Period {
  const [y, m] = period.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const newY = Math.floor(total / 12);
  const newM = (total % 12) + 1;
  return `${newY}-${String(newM).padStart(2, "0")}`;
}

function lastNClosedPeriods(currentPeriod: Period, n: number): Period[] {
  const periods: Period[] = [];
  for (let i = n; i >= 1; i--) periods.push(addMonths(currentPeriod, -i));
  return periods;
}

export interface ResolveWindowInput {
  storeId: number;
  sku: string;
  /** YYYY-MM-DD. */
  today: string;
  /** Períodos (todo o histórico disponível, não só a janela) com quantity_restocked > 0 para esta loja×SKU. */
  allKnownRestockPeriods: Period[];
  parameters: LossIntelligenceParameters;
}

/**
 * Resolve a janela de análise (spec §8). O mês corrente nunca entra em
 * qualifyingRestockPeriods e nunca sozinho decide uma ação estrutural — ver
 * a Global Constraint correspondente e o uso em unnecessary-supply.ts /
 * diagnosis/*.ts (Tasks 8-11), que devem consumir qualifyingRestockPeriods
 * para qualquer condição de "abasteceu e não vendeu", nunca primaryClosedPeriods
 * direto.
 */
export function resolveAnalysisWindow(input: ResolveWindowInput): AnalysisWindow {
  const currentPeriod = periodOf(input.today);
  const primaryClosedPeriods = lastNClosedPeriods(currentPeriod, input.parameters.window.primaryWindowMonths);
  const recurrenceLookbackPeriods = lastNClosedPeriods(currentPeriod, input.parameters.window.recurrenceLookbackMonths);

  const mostRecent = primaryClosedPeriods[primaryClosedPeriods.length - 1];
  const isOnlyRestockEver = input.allKnownRestockPeriods.length === 1 && input.allKnownRestockPeriods[0] === mostRecent;
  const qualifyingRestockPeriods = primaryClosedPeriods.length === 0 || isOnlyRestockEver ? primaryClosedPeriods : primaryClosedPeriods.slice(0, -1);

  return {
    storeId: input.storeId,
    sku: input.sku,
    primaryClosedPeriods,
    qualifyingRestockPeriods,
    currentInProgressPeriod: currentPeriod,
    recurrenceLookbackPeriods,
  };
}
