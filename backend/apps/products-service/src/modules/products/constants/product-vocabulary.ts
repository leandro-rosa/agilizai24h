/** Open vocabulary validated at the DTO layer, not as a Prisma enum. */
export const PRODUCT_CATEGORY_VALUES = ['meal', 'snack', 'beverage', 'essential'] as const
export type ProductCategory = (typeof PRODUCT_CATEGORY_VALUES)[number]

/** Why a requested SKU could not be priced. Carried on every unresolved entry. */
export const UNRESOLVED_REASONS = {
  UNKNOWN_SKU: 'unknown_sku',
  NO_COST_FOR_DATE: 'no_cost_for_date',
  AMBIGUOUS_NAME: 'ambiguous_name',
  UNKNOWN_NAME: 'unknown_name',
} as const

export type UnresolvedReason = (typeof UNRESOLVED_REASONS)[keyof typeof UNRESOLVED_REASONS]

/**
 * Where a cost or price version came from. Open vocabulary validated in the service, not a Prisma enum.
 * `legacy_import` is only ever written by the migration that introduced provenance: it marks versions whose
 * origin was never recorded, so nobody reads a made-up origin into them.
 */
export const VERSION_SOURCES = ['manual', 'invoice', 'pricing_intelligence', 'catalogue_sync', 'legacy_import', 'other'] as const
export type VersionSource = (typeof VERSION_SOURCES)[number]

/** Sources a caller may send. `legacy_import` is reserved for the migration. */
export const WRITABLE_VERSION_SOURCES = VERSION_SOURCES.filter(source => source !== 'legacy_import')

/**
 * Among COST versions with the same effective date, the lower rank is the one in force: an invoice beats a manual
 * entry, and everything else ties (then the latest recorded wins). A later effective date always beats an earlier
 * one, whatever the source. Prices do not rank by source: the latest recorded wins.
 */
export const COST_SOURCE_RANK: Record<VersionSource, number> = {
  invoice: 0,
  manual: 1,
  pricing_intelligence: 2,
  catalogue_sync: 2,
  legacy_import: 2,
  other: 2,
}
