import type { LossLevel } from './pricing.types'

export interface LossObservation {
  /** Units that left the shelf as loss, and units supplied, over the window. */
  lostUnits: number
  suppliedUnits: number
}

export interface LossScopes {
  product?: LossObservation | null
  category?: LossObservation | null
  store?: LossObservation | null
  network?: LossObservation | null
}

export interface LossChoice {
  /** Fraction of purchased units lost, 0 <= rate < 1. */
  rate: number
  level: LossLevel
  suppliedUnits: number
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
    return { rate, level, suppliedUnits: observation.suppliedUnits }
  }

  return null
}
