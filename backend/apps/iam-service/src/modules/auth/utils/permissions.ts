import type { Permission, Role, RolePermission, UserRole } from '../../../../generated/prisma/client'

type RoleWithPermissions = Role & { permissions: (RolePermission & { permission: Permission })[] }
export type UserWithPermissions = { roles: (UserRole & { role: RoleWithPermissions })[] }

/**
 * Effective permissions are the de-duplicated union of the user's roles'
 * permissions. A user with no roles resolves to an empty set — they can
 * authenticate, but are authorized for nothing.
 *
 * Pure and side-effect free so it can be unit-tested without any I/O.
 */
export function resolveEffectivePermissions(user: UserWithPermissions): string[] {
  const names = new Set<string>()

  for (const userRole of user.roles) {
    for (const rolePermission of userRole.role.permissions) {
      names.add(rolePermission.permission.name)
    }
  }

  return [...names].sort()
}

export function resolveRoleNames(user: UserWithPermissions): string[] {
  return user.roles.map(userRole => userRole.role.name).sort()
}
