import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'
import type { BulkCostResult } from '@app/products-contracts'

export interface SupplyPeriod {
  restocks: { sku: string; quantity_restocked: number }[]
  removals: { sku: string; reason: string; counts_as_loss: boolean; quantity_removed: number }[]
}

export interface SalesRow {
  sku: string
  quantity_sold: number
}

export interface StockItem {
  sku: string
  closing_stock: number
  /**
   * inventory-service reports a negative balance rather than zeroing it, so
   * this flag is the only carrier of "the movement data for this SKU is
   * wrong". Dropping it would hide exactly what it was raised to show.
   */
  inconsistent?: boolean
  /** Net inventory adjustment for the period — signed (design D4/D6). */
  adjustment?: number
}

/**
 * Reads the four services a reconciliation is built from.
 *
 * A 404 means "that period has no data", which is a real answer and must not be
 * mistaken for a transport failure — the two lead to very different figures.
 */
@Injectable()
export class UpstreamClient {
  private readonly logger = new Logger(UpstreamClient.name)

  constructor(
    private readonly http: AxiosHttpClient,
    private readonly config: ConfigService,
  ) {}

  async supplyFor(storeId: number, period: string, correlationId?: string): Promise<SupplyPeriod> {
    return this.get<SupplyPeriod>(
      `${this.config.getOrThrow<string>('SUPPLY_SERVICE_URL')}/supply/${storeId}?period=${encodeURIComponent(period)}`,
      { restocks: [], removals: [] },
      correlationId,
    )
  }

  async salesFor(storeId: number, period: string, correlationId?: string): Promise<SalesRow[]> {
    return this.get<SalesRow[]>(
      `${this.config.getOrThrow<string>('SALES_SERVICE_URL')}/sales/${storeId}?period=${encodeURIComponent(period)}`,
      [],
      correlationId,
    )
  }

  async stockFor(storeId: number, period: string, correlationId?: string): Promise<StockItem[]> {
    const result = await this.get<{ items: StockItem[] }>(
      `${this.config.getOrThrow<string>('INVENTORY_SERVICE_URL')}/inventory/${storeId}?period=${encodeURIComponent(period)}`,
      { items: [] },
      correlationId,
    )

    return result.items ?? []
  }

  /**
   * Costs as of a date. The result is partitioned by products-service on
   * purpose — resolved and unresolved are separate lists, so a missing cost
   * cannot be defaulted to zero on the way in.
   */
  async costsAsOf(skus: string[], asOf: string, correlationId?: string): Promise<BulkCostResult> {
    if (skus.length === 0) return { as_of: asOf, resolved: [], unresolved: [], complete: true }

    const result = await this.http.send<BulkCostResult>({
      http_method: 'post',
      url: `${this.config.getOrThrow<string>('PRODUCTS_SERVICE_URL')}/costs/bulk`,
      payload: { skus, as_of: asOf },
      headers: correlationId ? { 'x-correlation-id': correlationId } : undefined,
      timeout: 10000,
    })

    return result.response.data as BulkCostResult
  }

  private async get<T>(url: string, whenAbsent: T, correlationId?: string): Promise<T> {
    try {
      const result = await this.http.send<T>({
        http_method: 'get',
        url,
        headers: correlationId ? { 'x-correlation-id': correlationId } : undefined,
        timeout: 8000,
      })

      return (result.response.data as T) ?? whenAbsent
    } catch (error) {
      if ((error as { response?: { status?: number } })?.response?.status === 404) return whenAbsent
      throw error
    }
  }
}
