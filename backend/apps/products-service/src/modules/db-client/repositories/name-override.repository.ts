import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client'
import type { ProductNameOverride } from '../../../../generated/prisma/client'
import { PrismaClientService } from '../prisma-client.service'

@Injectable()
export class NameOverrideRepository extends PrismaRepository<ProductNameOverride, ProductNameOverride> {
  constructor(private readonly prismaClient: PrismaClientService) {
    super(prismaClient, prismaClient.productNameOverride, 'ProductNameOverride')
  }

  findByNormalizedNames(normalized: string[]) {
    return this.prismaClient.productNameOverride.findMany({
      where: { source_normalized_name: { in: normalized } },
      include: { product: { include: { eans: { orderBy: [{ is_primary: 'desc' as const }, { status: 'asc' as const }, { id: 'asc' as const }] } } } },
    })
  }
}
