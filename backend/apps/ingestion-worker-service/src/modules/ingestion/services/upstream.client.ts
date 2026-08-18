import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'
import type { BulkCostResult } from '@app/products-contracts'

export interface ResolvedStore {
  id: number
  name: string
  external_code: string | null
}

export interface NameResolution {
  matched: { source_name: string; product: { id: number; sku: string; name: string } }[]
  unmatched: { source_name: string; reason: string }[]
}

/**
 * Reads from stores-service and products-service while parsing.
 *
 * Deliberately narrow: ingestion needs to resolve a store code and a set of
 * product names, nothing more. See gateway-service's CLAUDE.md for the two
 * @app/http-client behaviours this has to work around — the raw axios error
 * carries the status, and `throw_on_exception` would discard it.
 */
@Injectable()
export class UpstreamClient {
  private readonly logger = new Logger(UpstreamClient.name)

  constructor(
    private readonly http: AxiosHttpClient,
    private readonly config: ConfigService,
  ) {}

  /** Resolves the POS code to a store, or null when nothing matches. */
  async resolveStoreByExternalCode(externalCode: string, correlationId?: string): Promise<ResolvedStore | null> {
    const base = this.config.getOrThrow<string>('STORES_SERVICE_URL')

    try {
      const result = await this.http.send<ResolvedStore>({
        http_method: 'get',
        url: `${base}/stores/by-external-code/${encodeURIComponent(externalCode)}`,
        headers: correlationId ? { 'x-correlation-id': correlationId } : undefined,
        timeout: 5000,
      })

      return (result.response.data as ResolvedStore) ?? null
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status
      // A 404 is a real answer: no store carries that code. Anything else is a
      // transport problem and must not be mistaken for "no match".
      if (status === 404) return null
      throw error
    }
  }

  async resolveProductNames(names: string[], correlationId?: string): Promise<NameResolution> {
    const base = this.config.getOrThrow<string>('PRODUCTS_SERVICE_URL')

    const result = await this.http.send<NameResolution>({
      http_method: 'post',
      url: `${base}/names/resolve`,
      payload: { names },
      headers: correlationId ? { 'x-correlation-id': correlationId } : undefined,
      timeout: 10000,
    })

    return (result.response.data as NameResolution) ?? { matched: [], unmatched: [] }
  }

  /** Used only to confirm a SKU exists before writing a cost against it. */
  async costsFor(skus: string[], asOf: string, correlationId?: string): Promise<BulkCostResult> {
    const base = this.config.getOrThrow<string>('PRODUCTS_SERVICE_URL')

    const result = await this.http.send<BulkCostResult>({
      http_method: 'post',
      url: `${base}/costs/bulk`,
      payload: { skus, as_of: asOf },
      headers: correlationId ? { 'x-correlation-id': correlationId } : undefined,
      timeout: 10000,
    })

    return result.response.data as BulkCostResult
  }

  async recordCost(sku: string, effectiveFrom: string, costCents: number, correlationId?: string): Promise<void> {
    const base = this.config.getOrThrow<string>('PRODUCTS_SERVICE_URL')

    await this.http.send({
      http_method: 'post',
      url: `${base}/products/${encodeURIComponent(sku)}/costs`,
      payload: { effective_from: effectiveFrom, cost_cents: costCents },
      headers: correlationId ? { 'x-correlation-id': correlationId } : undefined,
      timeout: 10000,
    })
  }
}
