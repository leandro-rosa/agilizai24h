import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { readJson } from './read-json'

export interface CatalogueProduct {
  id: number
  sku: string
  name: string
  /** The principal EAN. Every EAN of a product, including inactive ones, is resolved by `resolveEans`, not read from here. */
  ean?: string | null
  units_per_package?: number | null
}

/** The answer of products-service `POST /eans/resolve`: the rule (active, historical, ambiguous, unknown) lives there, once. */
export interface EanResolution {
  resolved: { ean: string; match: 'active' | 'historical'; product: CatalogueProduct }[]
  unresolved: { ean: string; unresolved: 'ean_not_identified' | 'ean_ambiguous' | 'ean_invalid'; candidates?: string[] }[]
}

/** Read-only: the catalogue, to validate SKUs and resolve invoice lines. Cached for a minute — it changes a few times a week. */
@Injectable()
export class ProductsClient {
  private cache: { at: number; products: Promise<CatalogueProduct[]> } | null = null

  constructor(private readonly config: ConfigService) {}

  products(correlationId?: string): Promise<CatalogueProduct[]> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.products

    const products = readJson<CatalogueProduct[]>(`${this.config.getOrThrow<string>('PRODUCTS_SERVICE_URL')}/products`, { correlationId }).then(list => list ?? [])
    this.cache = { at: Date.now(), products }
    products.catch(() => (this.cache = null))

    return products
  }

  /** Finds the SKU of each EAN, active or historical. Read-only: an unknown EAN never creates a product. */
  async resolveEans(eans: string[], correlationId?: string): Promise<EanResolution> {
    if (eans.length === 0) return { resolved: [], unresolved: [] }

    const url = `${this.config.getOrThrow<string>('PRODUCTS_SERVICE_URL')}/eans/resolve`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(correlationId ? { 'x-correlation-id': correlationId } : {}) },
      body: JSON.stringify({ eans }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`POST ${url} -> ${response.status}`)

    return (await response.json()) as EanResolution
  }
}
