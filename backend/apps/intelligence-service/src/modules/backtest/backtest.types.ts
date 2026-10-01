import type { QuantityAction } from '../engine/quantity'

/** What the engine suggested for a Product x Store at an origin. `evaluate_removal` comes from the Mix state. */
export type BacktestAction = QuantityAction | 'evaluate_removal'
export type AssessedAction = Exclude<BacktestAction, 'no_evidence'>

/**
 * "Coherent" means ONLY that the data that followed are compatible with the
 * recommendation under the criteria shown. It is never a claim that the
 * recommendation was right or would have worked.
 */
export type CoherenceClass = 'coherent' | 'incoherent' | 'inconclusive'

export const LOSS_REASON_KEYS = ['expired', 'damaged_product', 'other_reason'] as const
export type LossReasonKey = (typeof LOSS_REASON_KEYS)[number]

/** How many origins, Product x Store observations and cycles a figure rests on. */
export interface FigureCoverage {
  origins: number
  pairs: number
  cycles: number
}

export const BACKTEST_SCHEMA_VERSION = 1
