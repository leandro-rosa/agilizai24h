import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { readJson } from './read-json'

export interface NetworkRemovals {
  from: string
  to: string
  /** Months of the range that were ever ingested: a month missing here is unknown, not zero. */
  months_with_data: string[]
  rows: { period: string; sku: string; reason: string; quantity: number; stores: number }[]
}

/** Read-only: units removed per SKU, month and reason across the network. The supply data keeps the month of a removal, never the day. */
@Injectable()
export class SupplyClient {
  constructor(private readonly config: ConfigService) {}

  removals(fromMonth: string, toMonth: string, skus: string[], correlationId?: string): Promise<NetworkRemovals | null> {
    const query = new URLSearchParams({ from: fromMonth, to: toMonth, skus: skus.join(',') })

    return readJson<NetworkRemovals>(`${this.config.getOrThrow<string>('SUPPLY_SERVICE_URL')}/supply/network/removals?${query}`, { correlationId })
  }
}
