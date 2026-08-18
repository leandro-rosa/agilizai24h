import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client'
import type { SalesRecord } from '../../../../generated/prisma/client'
import { PrismaClientService } from '../prisma-client.service'

@Injectable()
export class SalesRecordRepository extends PrismaRepository<SalesRecord, SalesRecord> {
  constructor(prismaClient: PrismaClientService) {
    super(prismaClient, prismaClient.salesRecord, 'SalesRecord')
  }
}
