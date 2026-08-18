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
