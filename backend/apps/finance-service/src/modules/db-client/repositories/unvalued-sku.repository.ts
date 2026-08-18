import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client'
import type { UnvaluedSku } from '../../../../generated/prisma/client'
import { PrismaClientService } from '../prisma-client.service'

@Injectable()
export class UnvaluedSkuRepository extends PrismaRepository<UnvaluedSku, UnvaluedSku> {
  constructor(prismaClient: PrismaClientService) {
    super(prismaClient, prismaClient.unvaluedSku, 'UnvaluedSku')
  }
}
