/**
 * Wire contract shared by `apps/quote` (producer of match requests,
 * consumer of match results) and `apps/search` (consumer of match
 * requests, producer of match results) for the partner-API quote item
 * matching flow. Types and queue names only — no logic, no NestJS module,
 * so neither app takes on a dependency heavier than the shapes it needs
 * to agree on. See `backend/apps/quote/CLAUDE.md` and the
 * `quote-partner-api-matching` OpenSpec change for the full design.
 */

/** apps/quote enqueues a request here; apps/search's worker consumes it. */
export const SEARCH_MATCH_REQUEST_QUEUE = 'search.match-item-request'

/** apps/search's worker enqueues a result here; apps/quote's worker consumes it. */
export const SEARCH_MATCH_RESULT_QUEUE = 'quote.match-item-result'

/**
 * Versioned envelope for every job on either queue above. Mirrors
 * apps/quote's own internal `QuoteJobEnvelope` shape
 * (`apps/quote/src/modules/quotes/jobs/quote-job-envelope.ts`) for
 * consistency, but is defined independently here since it's a contract
 * between two separately-deployed apps, not one app's internal job
 * plumbing. Bump schemaVersion (and handle both versions in the
 * corresponding consumer) if a payload shape ever needs a breaking change.
 */
export interface SearchMatchJobEnvelope<T> {
  schemaVersion: 1
  quoteId: number
  emittedAt: string
  payload: T
}

export function createSearchMatchJobEnvelope<T>(quoteId: number, payload: T): SearchMatchJobEnvelope<T> {
  return {
    schemaVersion: 1,
    quoteId,
    emittedAt: new Date().toISOString(),
    payload,
  }
}

/**
 * One identifying field submitted for a quote item, in the same
 * `{targetField, value, priority}` shape apps/quote's own
 * `candidate-scoring.util.ts` (`ScoredSearchField`) already scores
 * against — `targetField` is one of the canonical vocabulary keys
 * (`sku`, `ean`, `main_code`, `oem`, `trade_number`, `name`, `brand`).
 */
export interface SearchMatchField {
  targetField: string
  value: string
  priority: number
}

export interface SearchMatchRequestPayload {
  itemId: number
  searchFields: SearchMatchField[]
}

/**
 * A candidate product as apps/search can actually return it — deliberately
 * narrower than apps/quote's own `ProductCandidateDto` (no `oemCodes`/
 * `tradeNumbers`: `PRODUCT_BUNDLE_SOURCE_ALLOWLIST` excludes `identifiers`
 * for a confirmed security reason, see `apps/search/CLAUDE.md`,
 * "Security" — those fields simply aren't available from the real
 * catalog's public API). No score/reasons here either: scoring authority
 * stays in apps/quote (see design.md's "Scoring authority" decision).
 */
export interface SearchMatchCandidate {
  productId: string
  name: string
  brand: string
  sku: string
  ean: string
  mainCode: string
  category: string
  image?: string
  stock: number
}

export interface SearchMatchResultPayload {
  itemId: number
  candidates: SearchMatchCandidate[]
}

/**
 * Curated catalog of quote-export-able product-bundle fields — every
 * `sourceField` below MUST already be one of
 * `PRODUCT_BUNDLE_SOURCE_ALLOWLIST`'s entries
 * (`backend/apps/search/src/modules/products/constants/product-bundle.constants.ts`).
 * This list is how "use the Elasticsearch mapping to know what fields we
 * have" is implemented — as a hand-curated, security-reviewed subset of
 * the already-approved public allowlist, never a runtime `_mapping`
 * introspection or an endpoint that accepts arbitrary field names. Widen
 * this list only by adding an entry whose `sourceField` is already
 * allowlisted; never add a field the allowlist doesn't have without the
 * same product-owner sign-off that gate already requires (see
 * `backend/apps/search/CLAUDE.md`, "Security"). `identifiers` (OEM codes,
 * trade numbers) is excluded from the allowlist entirely, so no export
 * field can ever expose those — same limitation already documented for
 * matching.
 */
export interface ProductExportField {
  id: string
  label: string
  group: string
  sourceField: string
}

export const PRODUCT_EXPORT_FIELDS: ProductExportField[] = [
  { id: 'product_name', label: 'Nome do produto', group: 'Identificação', sourceField: 'product_name' },
  { id: 'brand_name', label: 'Marca', group: 'Identificação', sourceField: 'brand_mapped_name' },
  { id: 'product_sku', label: 'SKU', group: 'Identificação', sourceField: 'product_sku' },
  { id: 'ean', label: 'EAN', group: 'Identificação', sourceField: 'ean' },
  { id: 'main_code', label: 'Código principal', group: 'Identificação', sourceField: 'brand_mapped_code' },
  { id: 'normalized_sku', label: 'SKU normalizado', group: 'Identificação', sourceField: 'normalized_sku' },
  { id: 'stock_total', label: 'Estoque total', group: 'Estoque', sourceField: 'inventories' },
  { id: 'image', label: 'Imagem principal', group: 'Mídia', sourceField: 'gallery' },
  { id: 'applications', label: 'Aplicações (veículos)', group: 'Aplicação', sourceField: 'search_application' },
]

/**
 * One `mapped_attributes` entry's resolved-value shape — only the
 * `golden_record` sub-key `extractMappedAttributeValue` actually reads,
 * not the full `ProductBundleMappedAttributeSource`
 * (`apps/search/.../product-bundle-document.ts`; label/type/priority/etc.
 * are unused for export purposes). `mapped_attributes` is already on
 * `PRODUCT_BUNDLE_SOURCE_ALLOWLIST` and already returned in full by
 * `GET /v1/products*` — this only gives apps/quote a type for a field it
 * was already receiving but never declared.
 */
export interface FetchedCatalogMappedAttribute {
  golden_record?: {
    value?: boolean | number | string | null
  }
}

/**
 * Shape a quote-search-match consumer can expect back from
 * `GET {SEARCH_API_URL}/v1/products?ids=...` — only the fields
 * `PRODUCT_EXPORT_FIELDS` actually reads, not the full `PublicProductDto`
 * (apps/search's own response type stays local to that app; this is
 * just enough shape for apps/quote's export worker to extract values
 * without an `any`/unsafe cast on the HTTP response).
 */
export interface FetchedCatalogProduct {
  id: number
  product_name?: string
  brand_mapped_name?: string
  product_sku?: string
  ean?: string[]
  brand_mapped_code?: string
  normalized_sku?: string
  inventories?: Array<{ stock_quantity?: number }>
  gallery?: Array<{ url?: string }>
  search_application?: string[]
  /** Dynamic, per-product attribute keys — see quote-export-custom-mapped-attributes's design.md. */
  mapped_attributes?: Record<string, FetchedCatalogMappedAttribute | undefined>
}
