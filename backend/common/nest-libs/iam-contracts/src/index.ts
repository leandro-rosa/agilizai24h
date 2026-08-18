/**
 * Contract between iam-service and every service that makes an access decision
 * — today that is gateway-service alone.
 *
 * Permission names are imported from here rather than written as string
 * literals at each call site: a typo in a duplicated literal silently grants
 * access to nobody (or, if a check is ever inverted, to everybody), whereas a
 * typo against these constants is a compile error.
 */

export const PERMISSIONS = {
  STORES_READ: 'stores:read',
  STORES_WRITE: 'stores:write',
  PRODUCTS_READ: 'products:read',
  PRODUCTS_WRITE: 'products:write',
  SALES_READ: 'sales:read',
  SUPPLY_READ: 'supply:read',
  INVENTORY_READ: 'inventory:read',
  INVENTORY_WRITE: 'inventory:write',
  FINANCE_READ: 'finance:read',
  INGESTION_UPLOAD: 'ingestion:upload',
  INGESTION_READ: 'ingestion:read',
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
} as const

export type PermissionName = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ALL_PERMISSIONS: PermissionName[] = Object.values(PERMISSIONS)

/**
 * Role names are organisational and may churn — they exist so administrators
 * have something to assign. Authorization is always expressed in permissions.
 */
export const ROLES = {
  ADMINISTRATOR: 'administrator',
  OPERATOR: 'operator',
} as const

export type RoleName = (typeof ROLES)[keyof typeof ROLES]

/** Read-only across the six domains; deliberately no write or upload rights. */
export const OPERATOR_PERMISSIONS: PermissionName[] = [
  PERMISSIONS.STORES_READ,
  PERMISSIONS.PRODUCTS_READ,
  PERMISSIONS.SALES_READ,
  PERMISSIONS.SUPPLY_READ,
  PERMISSIONS.INVENTORY_READ,
  PERMISSIONS.FINANCE_READ,
  PERMISSIONS.INGESTION_READ,
]

/** Shape returned by iam-service's introspection endpoint. */
export interface SessionIntrospection {
  valid: boolean
  reason?: 'unknown' | 'expired' | 'revoked' | 'inactive'
  id?: number
  email?: string
  name?: string
  roles?: string[]
  permissions?: string[]
  expiresAt?: string
}
