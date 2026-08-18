import { SetMetadata } from '@nestjs/common'
import type { PermissionName } from '@app/iam-contracts'

/** Name of the HTTP-only cookie carrying the opaque session token. */
export const SESSION_COOKIE = 'agiliz_session'

/**
 * Routes that must answer without a session, by path.
 *
 * `@Public()` covers routes declared in this service, but the health endpoint
 * comes from @app/health's own controller, which cannot carry our decorator.
 * Without this, the global guard puts liveness behind auth and the container
 * reports itself unhealthy forever — which is exactly what happened the first
 * time this ran.
 */
export const PUBLIC_PATH_PREFIXES = [
  '/health',
  // Swagger serves the UI at /docs and the contract itself at these two.
  // Listed explicitly rather than loosening the match to a bare startsWith,
  // which would also expose anything merely beginning with "docs".
  '/docs',
  '/docs-json',
  '/docs-yaml',
]

export const IS_PUBLIC_KEY = 'gateway:isPublic'
export const REQUIRED_PERMISSION_KEY = 'gateway:requiredPermission'

/** Login and health only — everything else needs a session. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)

/**
 * Declares the permission a route requires. Takes a PermissionName from
 * @app/iam-contracts rather than a string, so a typo is a compile error rather
 * than a silent access change.
 */
export const RequiresPermission = (permission: PermissionName) => SetMetadata(REQUIRED_PERMISSION_KEY, permission)
