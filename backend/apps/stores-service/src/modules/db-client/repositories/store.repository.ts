import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client'
import type { Store } from '../../../../generated/prisma/client'
import { PrismaClientService } from '../prisma-client.service'

@Injectable()
export class StoreRepository extends PrismaRepository<Store, Store> {
  constructor(private readonly prismaClient: PrismaClientService) {
    super(prismaClient, prismaClient.store, 'Store')
  }

  /** Exact match on the POS code. Never falls back to name matching. */
  findByExternalCode(externalCode: string) {
    return this.prismaClient.store.findUnique({ where: { external_code: externalCode } })
  }
}
