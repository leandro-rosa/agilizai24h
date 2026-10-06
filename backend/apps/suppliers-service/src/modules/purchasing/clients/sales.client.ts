import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { readJson } from './read-json'

export interface SoldBySku {
  from: string
  to: string
  rows: { sku: string; quantity: number; revenue_cents: number }[]
  /** Months the window touches whose receipts carry no timestamp: the sold units of those days are unknown. */
  months_without_dated_receipts: string[]
  /** Stores that have no receipts at all for a month of the window. */
  stores_missing: number
}

/** Read-only: units sold per SKU over a window of days, network-wide, from the dated receipts. */
@Injectable()
export class SalesClient {
  constructor(private readonly config: ConfigService) {}

  soldBySku(from: string, to: string, skus: string[], correlationId?: string): Promise<SoldBySku | null> {
    const query = new URLSearchParams({ from, to, skus: skus.join(',') })

    return readJson<SoldBySku>(`${this.config.getOrThrow<string>('SALES_SERVICE_URL')}/sales/network/sold-by-sku?${query}`, { correlationId })
  }
}
