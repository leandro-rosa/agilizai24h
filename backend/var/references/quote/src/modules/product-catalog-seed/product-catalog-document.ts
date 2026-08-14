/**
 * Shape stored in the `quote-demo-products` Elasticsearch index — the
 * source-of-truth product record a query is matched against. Deliberately
 * without `matchScore`/`matchReasons`: those are computed per query by
 * MatchItemWorker / the manual-search endpoint, never stored on the
 * document itself.
 */
export interface ProductCatalogDocument {
  productId: string
  name: string
  brand: string
  category: string
  sku: string
  ean: string
  mainCode: string
  oemCodes: string[]
  tradeNumbers: string[]
  image?: string
  stock: number
}
