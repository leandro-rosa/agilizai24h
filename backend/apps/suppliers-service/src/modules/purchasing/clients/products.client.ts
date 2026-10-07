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

/** What products-service answers to a cost write. `unchanged`: the invoice cost equals the cost already in force, so no version exists. */
export interface RecordedCost {
  created: boolean
  unchanged: boolean
  version_id: number | null
  cost_cents: number
  previous_cost_cents: number | null
}

export interface InvoiceCostInput {
  effective_from: string
  cost_cents: number
  supplier_id: number
  purchase_id: number
  purchase_item_id: number
  invoice_number?: string
  source_ref: string
  purchase_quantity?: number
  purchase_total_cents?: number
  pack_quantity?: number
  units_per_pack?: number
}

/** The catalogue, to validate SKUs and resolve invoice lines (cached for a minute — it changes a few times a week), and the one write: the cost an invoice proves. */
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

  /**
   * Sends the cost of a received invoice line. Always `source: invoice`; the key makes a resend a no-op, so the caller may retry freely.
   * Throws on any non-2xx: a failure is the caller's to keep and retry, never to read as "no cost".
   */
  async recordInvoiceCost(sku: string, input: InvoiceCostInput, correlationId?: string): Promise<RecordedCost> {
    const url = `${this.config.getOrThrow<string>('PRODUCTS_SERVICE_URL')}/products/${encodeURIComponent(sku)}/costs`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(correlationId ? { 'x-correlation-id': correlationId } : {}) },
      body: JSON.stringify({ ...input, source: 'invoice' }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`POST ${url} -> ${response.status} ${(await response.text()).slice(0, 200)}`)

    return (await response.json()) as RecordedCost
  }
}
