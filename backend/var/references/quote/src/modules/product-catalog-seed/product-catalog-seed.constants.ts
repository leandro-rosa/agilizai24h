/**
 * "demo" in the index name is a deliberate, durable code-level signal (not
 * just a comment) — see backend/apps/quote/CLAUDE.md, "Decisões pendentes
 * (resolvidas)". This index is a static seed catalog subset for the quote
 * module's matching demo. It is NOT synced with the real external catalog
 * (the `product-bundle` Elasticsearch index served by backend/apps/search,
 * reached from frontend/server via SEARCH_API_URL).
 * Never present it as live production catalog data.
 */
export const QUOTE_DEMO_PRODUCTS_INDEX = 'quote-demo-products'

/**
 * Applied to every exact-match code field (sku/ean/mainCode/oemCodes/
 * tradeNumbers) at both index and query time — a plain `keyword` field's
 * `term` query is byte-exact, so without this, MatchItemWorker's "case"
 * normalization rule (which lowercases the query side only) would silently
 * never match anything, since the indexed catalog codes keep their
 * original case. `lowercase` here makes term-level equality
 * case-insensitive at the ES layer itself, matching candidate-scoring.util's
 * own case-folded comparison.
 */
const CODE_NORMALIZER = 'code_normalizer'

export const QUOTE_DEMO_PRODUCTS_INDEX_SETTINGS = {
  analysis: {
    normalizer: {
      [CODE_NORMALIZER]: { type: 'custom', filter: ['lowercase'] },
    },
  },
} as const

export const QUOTE_DEMO_PRODUCTS_MAPPING = {
  properties: {
    productId: { type: 'keyword' },
    name: { type: 'text', fields: { keyword: { type: 'keyword' } } },
    brand: { type: 'keyword', normalizer: CODE_NORMALIZER },
    category: { type: 'keyword' },
    sku: { type: 'keyword', normalizer: CODE_NORMALIZER },
    ean: { type: 'keyword', normalizer: CODE_NORMALIZER },
    mainCode: { type: 'keyword', normalizer: CODE_NORMALIZER },
    oemCodes: { type: 'keyword', normalizer: CODE_NORMALIZER },
    tradeNumbers: { type: 'keyword', normalizer: CODE_NORMALIZER },
    image: { type: 'keyword', index: false },
    stock: { type: 'integer' },
  },
} as const
