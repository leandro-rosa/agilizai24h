/**
 * Contract between products-service and the services that value a period in
 * currency — finance-service and supply-service.
 *
 * Extracted so the money unit and the partitioned-result shape are stated once.
 * Restating them per consumer is how one service ends up treating an unpriced
 * SKU as zero while another reports it.
 */

/**
 * Every monetary amount crossing a service boundary is an integer in minor
 * units (centavos). Never a float: these values are summed across thousands of
 * rows and multiplied by quantities, which is exactly the pattern that
 * accumulates binary floating-point error.
 */
export type Centavos = number

/** Why a requested SKU could not be priced or matched. */
export const UNRESOLVED_COST_REASONS = {
  UNKNOWN_SKU: 'unknown_sku',
  NO_COST_FOR_DATE: 'no_cost_for_date',
  AMBIGUOUS_NAME: 'ambiguous_name',
  UNKNOWN_NAME: 'unknown_name',
} as const

export type UnresolvedCostReason = (typeof UNRESOLVED_COST_REASONS)[keyof typeof UNRESOLVED_COST_REASONS]

export interface ResolvedCost {
  sku: string
  product_id: number
  cost_cents: Centavos
  /** ISO date of the cost version actually used, so a figure stays traceable. */
  effective_from: string
}

export interface UnresolvedCost {
  sku: string
  reason: UnresolvedCostReason
}

/**
 * Deliberately NOT a map of sku -> cost.
 *
 * A map invites `costs[sku] ?? 0`, and that single expression is how an
 * unpriced SKU becomes a silent zero — understating COGS and loss, which makes
 * the numbers look better, so nobody questions them. Consumers must branch on
 * `unresolved` (or on `complete`) rather than defaulting a missing entry.
 */
export interface BulkCostResult {
  /** ISO date the costs were resolved as of. */
  as_of: string
  resolved: ResolvedCost[]
  unresolved: UnresolvedCost[]
  /** True only when every requested SKU resolved. */
  complete: boolean
}

/**
 * Helper for the one correct way to consume a bulk result: a caller that needs
 * a total must first establish that nothing is unresolved.
 */
export function assertCompleteCosts(result: BulkCostResult): ResolvedCost[] {
  if (!result.complete) {
    const skus = result.unresolved.map(entry => `${entry.sku} (${entry.reason})`).join(', ')
    throw new Error(`Cannot total costs as of ${result.as_of}: unresolved SKUs — ${skus}`)
  }

  return result.resolved
}
