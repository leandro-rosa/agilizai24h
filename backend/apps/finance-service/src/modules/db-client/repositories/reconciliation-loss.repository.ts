import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client'
import type { ReconciliationLoss } from '../../../../generated/prisma/client'
import { PrismaClientService } from '../prisma-client.service'

@Injectable()
export class ReconciliationLossRepository extends PrismaRepository<ReconciliationLoss, ReconciliationLoss> {
  constructor(prismaClient: PrismaClientService) {
    super(prismaClient, prismaClient.reconciliationLoss, 'ReconciliationLoss')
  }
}
