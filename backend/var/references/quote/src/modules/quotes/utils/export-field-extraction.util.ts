import { FetchedCatalogProduct } from '@app/quote-search-match'

/**
 * Extracts one export column's value from a freshly-fetched catalog
 * product, per `PRODUCT_EXPORT_FIELDS`'s `sourceField`. Kept separate
 * from `generate-export.worker.ts` so the field-by-field mapping is
 * independently testable — `export-field-extraction.util.spec.ts` covers
 * every `PRODUCT_EXPORT_FIELDS` entry with a populated product to prove
 * each one actually reaches its own case, not the `default` fallthrough.
 */
export function extractProductExportValue(product: FetchedCatalogProduct, sourceField: string): string | number {
  switch (sourceField) {
    case 'product_name':
      return product.product_name ?? ''
    case 'brand_mapped_name':
      return product.brand_mapped_name ?? ''
    case 'product_sku':
      return product.product_sku ?? ''
    case 'ean':
      return product.ean?.join(', ') ?? ''
    case 'brand_mapped_code':
      return product.brand_mapped_code ?? ''
    case 'normalized_sku':
      return product.normalized_sku ?? ''
    case 'inventories':
      return product.inventories?.reduce((total, inventory) => total + (inventory.stock_quantity ?? 0), 0) ?? 0
    case 'gallery':
      return product.gallery?.[0]?.url ?? ''
    case 'search_application':
      // Capped, not the full list — a product can carry one entry per
      // application x year combination (see CatalogProductPayload's doc
      // comment in frontend/src/domain/model.ts), which can be long.
      return product.search_application?.slice(0, 5).join('; ') ?? ''
    default:
      return ''
  }
}

/**
 * Extracts a reviewer-typed custom export column from a freshly-fetched
 * catalog product's `mapped_attributes` — dynamic per-product keys the
 * hand-curated `PRODUCT_EXPORT_FIELDS` catalog can't enumerate, see
 * openspec/changes/quote-export-custom-mapped-attributes/design.md.
 * Always reads `golden_record` (the resolved cross-source value), never a
 * raw per-source entry. Returns '' when the value key itself is missing —
 * an unknown/misspelled key is indistinguishable from "no data for this
 * item" by design (no validation that a typed key exists on any product).
 */
export function extractMappedAttributeValue(
  product: FetchedCatalogProduct,
  attributeKey: string,
  unitAttributeKey?: string,
): string {
  const value = product.mapped_attributes?.[attributeKey]?.golden_record?.value
  if (value === undefined || value === null || value === '') {
    return ''
  }

  const unit = unitAttributeKey ? product.mapped_attributes?.[unitAttributeKey]?.golden_record?.value : undefined
  if (unit === undefined || unit === null || unit === '') {
    return String(value)
  }

  return `${value} ${unit}`
}
