import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client'
import type { Product } from '../../../../generated/prisma/client'
import { PrismaClientService } from '../prisma-client.service'

@Injectable()
export class ProductRepository extends PrismaRepository<Product, Product> {
  constructor(private readonly prismaClient: PrismaClientService) {
    super(prismaClient, prismaClient.product, 'Product')
  }

  findBySkus(skus: string[]) {
    return this.prismaClient.product.findMany({ where: { sku: { in: skus } } })
  }

  /** Returns every match: more than one means ambiguity, which must be reported. */
  findByNormalizedName(normalized: string) {
    return this.prismaClient.product.findMany({ where: { normalized_name: normalized } })
  }
}
