import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client'
import type { Reconciliation } from '../../../../generated/prisma/client'
import { PrismaClientService } from '../prisma-client.service'

@Injectable()
export class ReconciliationRepository extends PrismaRepository<Reconciliation, Reconciliation> {
  constructor(prismaClient: PrismaClientService) {
    super(prismaClient, prismaClient.reconciliation, 'Reconciliation')
  }
}
