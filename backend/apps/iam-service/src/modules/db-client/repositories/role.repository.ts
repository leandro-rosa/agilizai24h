import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client'
import type { Role } from '../../../../generated/prisma/client'
import { PrismaClientService } from '../prisma-client.service'

@Injectable()
export class RoleRepository extends PrismaRepository<Role, Role> {
  constructor(private readonly prismaClient: PrismaClientService) {
    super(prismaClient, prismaClient.role, 'Role')
  }

  findByNames(names: string[]) {
    return this.prismaClient.role.findMany({ where: { name: { in: names } } })
  }
}
