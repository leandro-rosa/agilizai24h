import { resolveEffectivePermissions, resolveRoleNames, type UserWithPermissions } from './permissions'

const role = (name: string, permissions: string[]) => ({
  role: {
    id: 1,
    name,
    description: '',
    created_at: new Date(),
    permissions: permissions.map(p => ({
      role_id: 1,
      permission_id: 1,
      permission: { id: 1, name: p, description: '', created_at: new Date() },
    })),
  },
})

const user = (roles: ReturnType<typeof role>[]): UserWithPermissions =>
  ({ roles: roles.map(r => ({ user_id: 1, role_id: 1, ...r })) }) as unknown as UserWithPermissions

describe('resolveEffectivePermissions', () => {
  it('unions overlapping roles without duplicates', () => {
    const result = resolveEffectivePermissions(
      user([role('a', ['stores:read', 'finance:read']), role('b', ['finance:read', 'sales:read'])]),
    )

    expect(result).toEqual(['finance:read', 'sales:read', 'stores:read'])
  })

  it('returns an empty set for a user with no roles', () => {
    // Such a user can still authenticate — they are simply authorized for nothing.
    expect(resolveEffectivePermissions(user([]))).toEqual([])
  })

  it('returns an empty set for a role carrying no permissions', () => {
    expect(resolveEffectivePermissions(user([role('empty', [])]))).toEqual([])
  })
})

describe('resolveRoleNames', () => {
  it('lists role names in a stable order', () => {
    expect(resolveRoleNames(user([role('operator', []), role('administrator', [])]))).toEqual([
      'administrator',
      'operator',
    ])
  })
})
