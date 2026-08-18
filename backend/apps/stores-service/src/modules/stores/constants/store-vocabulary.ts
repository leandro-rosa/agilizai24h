/**
 * Open vocabularies validated at the DTO layer with `@IsIn`, not as Prisma
 * enums — both are expected to grow, and an enum would need a migration each
 * time one does.
 */
export const STORE_STATUS_VALUES = ['active', 'maintenance', 'inactive'] as const
export type StoreStatus = (typeof STORE_STATUS_VALUES)[number]

export const STORE_TYPE_VALUES = ['company', 'condo'] as const
export type StoreType = (typeof STORE_TYPE_VALUES)[number]

/** Listings default to this when no status filter is supplied. */
export const DEFAULT_LISTED_STATUSES: StoreStatus[] = ['active']
