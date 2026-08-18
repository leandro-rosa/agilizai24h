import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { SessionRepository } from '../../db-client/repositories/session.repository'
import { UserRepository } from '../../db-client/repositories/user.repository'
import { PasswordService } from '../../auth/services/password.service'
import { resolveEffectivePermissions, resolveRoleNames } from '../../auth/utils/permissions'

export interface UserView {
  id: number
  email: string
  name: string
  is_active: boolean
  roles: string[]
  permissions: string[]
}

@Injectable()
export class UsersService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly passwords: PasswordService,
    private readonly prisma: PrismaClientService,
  ) {}

  async create(email: string, name: string, password: string, roleNames: string[]): Promise<UserView> {
    // Checked explicitly rather than by catching a unique-constraint violation:
    // PrismaRepository rethrows a generic Error and discards Prisma's error
    // code, so `error.code === 'P2002'` is not available to branch on. The
    // database constraint remains the backstop against the race this leaves.
    const existing = await this.users.findUnique({ where: { email } })
    if (existing) throw new ConflictException(`A user with email ${email} already exists`)

    const roles = await this.prisma.role.findMany({ where: { name: { in: roleNames } } })
    const missing = roleNames.filter(name => !roles.some(role => role.name === name))
    if (missing.length > 0) throw new NotFoundException(`Unknown roles: ${missing.join(', ')}`)

    const passwordHash = await this.passwords.hash(password)

    const created = await this.prisma.user.create({
      data: {
        email,
        name,
        password_hash: passwordHash,
        roles: { create: roles.map(role => ({ role_id: role.id })) },
      },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    })

    return this.toView(created)
  }

  async findById(id: number): Promise<UserView> {
    const user = await this.users.findByIdWithPermissions(id)
    if (!user) throw new NotFoundException(`User ${id} not found`)

    return this.toView(user)
  }

  async list(): Promise<UserView[]> {
    const users = await this.prisma.user.findMany({
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
      orderBy: { id: 'asc' },
    })

    return users.map(user => this.toView(user))
  }

  /**
   * Deactivating an account revokes its sessions in the same transaction, so
   * there is no window where a deactivated user still has a working session.
   */
  async setActive(id: number, isActive: boolean): Promise<UserView> {
    const user = await this.users.findUnique({ where: { id } })
    if (!user) throw new NotFoundException(`User ${id} not found`)

    await this.prisma.$transaction(async tx => {
      await tx.user.update({ where: { id }, data: { is_active: isActive } })

      if (!isActive) {
        await tx.session.updateMany({
          where: { user_id: id, revoked_at: null },
          data: { revoked_at: new Date() },
        })
      }
    })

    return this.findById(id)
  }

  async setRoles(id: number, roleNames: string[]): Promise<UserView> {
    const user = await this.users.findUnique({ where: { id } })
    if (!user) throw new NotFoundException(`User ${id} not found`)

    const roles = await this.prisma.role.findMany({ where: { name: { in: roleNames } } })
    const missing = roleNames.filter(name => !roles.some(role => role.name === name))
    if (missing.length > 0) throw new NotFoundException(`Unknown roles: ${missing.join(', ')}`)

    // Sessions are deliberately NOT revoked: the spec requires a role change to
    // take effect on the next introspection without forcing a re-login, and
    // permissions are resolved per introspection rather than captured at login.
    await this.prisma.$transaction(async tx => {
      await tx.userRole.deleteMany({ where: { user_id: id } })
      await tx.userRole.createMany({ data: roles.map(role => ({ user_id: id, role_id: role.id })) })
    })

    return this.findById(id)
  }

  private toView(user: Parameters<typeof resolveEffectivePermissions>[0] & {
    id: number
    email: string
    name: string
    is_active: boolean
  }): UserView {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      is_active: user.is_active,
      roles: resolveRoleNames(user),
      permissions: resolveEffectivePermissions(user),
    }
  }
}
