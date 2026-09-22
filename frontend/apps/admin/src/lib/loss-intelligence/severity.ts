import { ACTION_SEVERITY_ORDER, type LossAction } from "./types";

/** Índice 0 = mais severo. Usado para comparar duas ações e para tetos (clamp). */
export function severityRank(action: LossAction): number {
  return ACTION_SEVERITY_ORDER.indexOf(action);
}

/** Se `action` é mais severo que `ceiling`, retorna `ceiling`; senão retorna `action` inalterado. */
export function clampSeverity(action: LossAction, ceiling: LossAction): LossAction {
  return severityRank(action) < severityRank(ceiling) ? ceiling : action;
}

/** A mais severa dentre as ações dadas (usado pela consolidação, Task 13). */
export function mostSevere(actions: LossAction[]): LossAction {
  return [...actions].sort((a, b) => severityRank(a) - severityRank(b))[0];
}
