import type { Figure } from './analysis.types'

/** What a purchase source says about one SKU in one month, summed over the network. */
export interface PurchaseMonth {
  units: number
  cents: number
}

/**
 * Where purchases come from. There is no purchase model yet (invoice import and
 * manual entry are Phase 2), so the only implementation reports that no history
 * exists. A later adapter replaces it without changing the response contract.
 */
export abstract class PurchaseSource {
  /** `null` = no purchase record for that SKU and month — NOT zero purchased. */
  abstract month(skus: string[], month: string): Promise<Map<string, PurchaseMonth> | null>

  /** First month purchases are recorded from, or null when there is none. */
  abstract baseFrom(): Promise<string | null>
}

export class NullPurchaseSource extends PurchaseSource {
  async month(): Promise<Map<string, PurchaseMonth> | null> {
    return null
  }

  async baseFrom(): Promise<string | null> {
    return null
  }
}

export const NO_PURCHASE_HISTORY: Figure = { available: false, reason: 'no_purchase_history' }
