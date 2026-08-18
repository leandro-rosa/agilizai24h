import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client'
import type { User } from '../../../../generated/prisma/client'
import { PrismaClientService } from '../prisma-client.service'

@Injectable()
export class UserRepository extends PrismaRepository<User, User> {
  constructor(private readonly prismaClient: PrismaClientService) {
    super(prismaClient, prismaClient.user, 'User')
  }

  /**
   * Loads a user with roles and permissions in one query. Introspection runs on
   * every gateway request, so this must not become N+1.
   */
  findByEmailWithPermissions(email: string) {
    return this.prismaClient.user.findUnique({
      where: { email },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    })
  }

  findByIdWithPermissions(id: number) {
    return this.prismaClient.user.findUnique({
      where: { id },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    })
  }
}
