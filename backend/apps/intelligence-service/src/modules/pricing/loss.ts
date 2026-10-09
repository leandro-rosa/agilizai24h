import type { LossLevel } from './pricing.types'

export interface LossObservation {
  /** Units removed from the shelf as loss (a removal reason flagged `counts_as_loss` in the supply service), and units SUPPLIED to the stores (restocked), over the window. */
  lostUnits: number
  suppliedUnits: number
  /** Units sold in the same window and scope. Not used by the rate; carried so the result can show whether supplied = sold + lost closes. */
  soldUnits?: number
}

export interface LossScopes {
  product?: LossObservation | null
  category?: LossObservation | null
  store?: LossObservation | null
  network?: LossObservation | null
}

export interface LossChoice {
  /**
   * Fraction of the units SUPPLIED to the stores that were removed as loss, 0 <= rate < 1 (`lostUnits ÷ suppliedUnits`). It is the right rate for
   * `cost ÷ (1 − rate)` only because the units that reach the shelf either sell or are lost: the cost of the lost units is spread over the sold ones.
   * The finance service does not define a loss percentage (its "perda real" is a value, reconciled from inventory), so this definition comes from supply.
   */
  rate: number
  level: LossLevel
  suppliedUnits: number
  lostUnits: number
  soldUnits: number | null
}

/**
 * The loss rate of a product: its own history when it has at least
 * `minUnits` supplied, else its category's, else its store's, else the
 * network's. The level used is returned so the result can say so. `null` when
 * no level has any history — an unknown loss is not 0%.
 */
export function chooseLoss(scopes: LossScopes, minUnits: number): LossChoice | null {
  const order: LossLevel[] = ['product', 'category', 'store', 'network']

  for (const level of order) {
    const observation = scopes[level]
    if (!observation || observation.suppliedUnits <= 0) continue
    // The product level needs real volume; a broader level is its own evidence.
    if (level === 'product' && observation.suppliedUnits < minUnits) continue

    const rate = Math.min(Math.max(observation.lostUnits / observation.suppliedUnits, 0), 0.95)
    return { rate, level, suppliedUnits: observation.suppliedUnits, lostUnits: observation.lostUnits, soldUnits: observation.soldUnits ?? null }
  }

  return null
}
