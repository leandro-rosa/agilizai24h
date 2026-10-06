import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { readJson } from './read-json'

export interface CatalogueProduct {
  id: number
  sku: string
  name: string
  ean?: string | null
  units_per_package?: number | null
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
}
