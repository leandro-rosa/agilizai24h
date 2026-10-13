import { spDayOf } from './consignment-period'

/** An agreed cost that applies from `validFrom` (a Sao Paulo day) until the next vigência of the same SKU. */
export interface CostVigencia {
  sku: string
  validFrom: string
  unitCostCents: number
}

export interface ResolvedCost {
  unitCostCents: number
  validFrom: string
}

/** The agreed cost in force on the sale day. NOT the received-lot cost: this delivery has no lot-cost mode. */
export function resolveCost(costs: CostVigencia[], sku: string, soldAt: Date): ResolvedCost | null {
  const day = spDayOf(soldAt)
  const inForce = costs.filter(c => c.sku === sku && c.validFrom <= day).sort((a, b) => b.validFrom.localeCompare(a.validFrom))

  return inForce.length ? { unitCostCents: inForce[0].unitCostCents, validFrom: inForce[0].validFrom } : null
}
