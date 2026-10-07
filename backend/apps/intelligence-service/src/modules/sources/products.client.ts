import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'
import type { BulkCostResult } from '@app/products-contracts'
import { httpGet } from './http-read'

export interface ProductDto {
  id: number
  sku: string
  name: string
  /** 'meal' | 'snack' | 'beverage' | 'essential' (the first level). */
  category?: string | null
  subcategory?: string | null
  package_type?: string | null
  units_per_package?: number | null
  /** Declared supplier (suppliers-service id); null/absent when none is registered. */
  supplier_id?: number | null
}

@Injectable()
export class ProductsClient {
  constructor(
    private readonly http: AxiosHttpClient,
    private readonly config: ConfigService,
  ) {}

  private base(): string {
    return this.config.getOrThrow<string>('PRODUCTS_SERVICE_URL')
  }

  async products(correlationId?: string): Promise<ProductDto[]> {
    return (await httpGet<ProductDto[]>(this.http, `${this.base()}/products`, { correlationId })) ?? []
  }

  /** Costs as of a date, partitioned into resolved and unresolved — never a map that invites reading a missing cost as zero. */
  async costsAsOf(skus: string[], asOf: string, correlationId?: string): Promise<BulkCostResult> {
    const result = await this.http.send<BulkCostResult>({
      http_method: 'post',
      url: `${this.base()}/costs/bulk`,
      payload: { skus, as_of: asOf },
      headers: correlationId ? { 'x-correlation-id': correlationId } : undefined,
      timeout: 30000,
    })

    return result.response.data as BulkCostResult
  }

  /** Sale prices as of a date, partitioned like the costs — a missing price is never read as zero. */
  async pricesAsOf(skus: string[], asOf: string, correlationId?: string): Promise<BulkPriceDto> {
    const result = await this.http.send<BulkPriceDto>({
      http_method: 'post',
      url: `${this.base()}/prices/bulk`,
      payload: { skus, as_of: asOf },
      headers: correlationId ? { 'x-correlation-id': correlationId } : undefined,
      timeout: 30000,
    })

    return result.response.data as BulkPriceDto
  }
}

export interface BulkPriceDto {
  resolved: { sku: string; product_id: number; price_cents: number; effective_from: string }[]
  unresolved: { sku: string; reason: string }[]
  complete: boolean
}
