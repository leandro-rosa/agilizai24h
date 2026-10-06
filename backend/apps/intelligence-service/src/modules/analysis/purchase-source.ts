import { Injectable } from '@nestjs/common'
import { SuppliersClient, type PurchaseSummaryDto } from '../sources/suppliers.client'
import type { Figure } from './analysis.types'

/** What a purchase source says about one SKU in one month, summed over the network. */
export interface PurchaseMonth {
  /** Bought units (paid and on-sale); bonus units are not bought. */
  units: number
  /** What the bought units cost at the paid unit cost. */
  cents: number
  /** Units received as a bonus (bonificação): free, and kept out of margin. */
  bonusUnits: number
}

/**
 * Where purchases come from: the purchases of suppliers-service (`HttpPurchaseSource`). `NullPurchaseSource` stays for tests
 * and for any environment without that service: it reports that no history exists.
 */
export abstract class PurchaseSource {
  /** `null` = the month is before purchase records begin — NOT zero purchased. A month after the base with no purchase of a SKU is a real zero (absent from the map). */
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

/** Reads the purchases of suppliers-service. A month's summary is cached for a minute: the analysis asks for each month many times. */
@Injectable()
export class HttpPurchaseSource extends PurchaseSource {
  private readonly cache = new Map<string, { at: number; summary: Promise<PurchaseSummaryDto> }>()

  constructor(private readonly suppliers: SuppliersClient) {
    super()
  }

  async month(skus: string[], month: string): Promise<Map<string, PurchaseMonth> | null> {
    const summary = await this.summary(month)
    // Before the first recorded purchase there is no history: that is "unavailable", not "bought nothing".
    if (!summary.base_from || month < summary.base_from) return null

    const wanted = new Set(skus)

    return new Map(
      summary.rows
        .filter(row => wanted.has(row.sku))
        .map((row): [string, PurchaseMonth] => [row.sku, { units: row.units_paid + row.units_on_sale, cents: row.cents_paid + row.cents_on_sale, bonusUnits: row.bonus_units }]),
    )
  }

  async baseFrom(): Promise<string | null> {
    return (await this.summary(new Date().toISOString().slice(0, 7))).base_from
  }

  private summary(month: string): Promise<PurchaseSummaryDto> {
    const hit = this.cache.get(month)
    if (hit && Date.now() - hit.at < 60_000) return hit.summary

    const summary = this.suppliers.purchaseSummary(month)
    this.cache.set(month, { at: Date.now(), summary })
    summary.catch(() => this.cache.delete(month))

    return summary
  }
}
