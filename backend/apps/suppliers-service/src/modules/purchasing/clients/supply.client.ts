import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { readJson } from './read-json'

export interface NetworkRemovals {
  from: string
  to: string
  /** Months of the range that were ever ingested: a month missing here is unknown, not zero. */
  months_with_data: string[]
  /** Per month, the last day of the visits imported: later days of that month are not in the data. */
  data_until: Record<string, string>
  rows: { period: string; sku: string; reason: string; quantity: number; stores: number }[]
}

export interface NetworkBalances {
  rows: { sku: string; in_stores: number; stores: number; last_visit: string; oldest_store_visit: string }[]
}

/** Read-only: units removed per SKU, month and reason across the network. The supply data keeps the month of a removal, never the day. */
@Injectable()
export class SupplyClient {
  constructor(private readonly config: ConfigService) {}

  removals(fromMonth: string, toMonth: string, skus: string[], correlationId?: string): Promise<NetworkRemovals | null> {
    const query = new URLSearchParams({ from: fromMonth, to: toMonth, skus: skus.join(',') })

    return readJson<NetworkRemovals>(`${this.config.getOrThrow<string>('SUPPLY_SERVICE_URL')}/supply/network/removals?${query}`, { correlationId })
  }

  /** The stores' current stock per SKU (the central stock is not here). */
  balances(skus: string[], correlationId?: string): Promise<NetworkBalances | null> {
    const query = new URLSearchParams({ skus: skus.join(',') })

    return readJson<NetworkBalances>(`${this.config.getOrThrow<string>('SUPPLY_SERVICE_URL')}/supply/network/balances?${query}`, { correlationId })
  }
}
