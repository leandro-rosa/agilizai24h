import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client'
import type { Permission } from '../../../../generated/prisma/client'
import { PrismaClientService } from '../prisma-client.service'

@Injectable()
export class PermissionRepository extends PrismaRepository<Permission, Permission> {
  constructor(prismaClient: PrismaClientService) {
    super(prismaClient, prismaClient.permission, 'Permission')
  }
}
