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
   * Costs in effect on `asOf` for a set of products, resolved in the database
   * with DISTINCT ON so this stays one query rather than one per SKU.
   */
  findEffectiveForProducts(productIds: number[], asOf: Date) {
    return this.prismaClient.costVersion.findMany({
      where: { product_id: { in: productIds }, effective_from: { lte: asOf } },
      orderBy: [{ product_id: 'asc' }, { effective_from: 'desc' }],
      distinct: ['product_id'],
    })
  }

  findAllForProduct(productId: number) {
    return this.prismaClient.costVersion.findMany({
      where: { product_id: productId },
      orderBy: { effective_from: 'asc' },
    })
  }
}
