import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client'
import type { CostVersion } from '../../../../generated/prisma/client'
import { PrismaClientService } from '../prisma-client.service'

@Injectable()
export class CostVersionRepository extends PrismaRepository<CostVersion, CostVersion> {
  constructor(private readonly prismaClient: PrismaClientService) {
    super(prismaClient, prismaClient.costVersion, 'CostVersion')
  }

  /**
   * EVERY version of these products effective on or before `asOf`, not just one per product: several versions can
   * share a date (a correction, an invoice over a manual entry), and which one is in force is decided by
   * `resolveByProduct`, the one place that rule lives.
   */
  findUpTo(productIds: number[], asOf: Date) {
    return this.prismaClient.costVersion.findMany({
      where: { product_id: { in: productIds }, effective_from: { lte: asOf } },
      orderBy: [{ product_id: 'asc' }, { effective_from: 'asc' }, { id: 'asc' }],
    })
  }

  findAllForProduct(productId: number) {
    return this.prismaClient.costVersion.findMany({
      where: { product_id: productId },
      orderBy: [{ effective_from: 'asc' }, { id: 'asc' }],
    })
  }
}
