import { Injectable } from '@nestjs/common'
import { PrismaClientService } from '../db-client/prisma-client.service'

/**
 * "Closed pack preferred in this store" for a Product x Store. Stored and
 * shown beside a result as an operational option — and NEVER read by any
 * calculation (no engine code imports this class). Append-only; the latest row
 * of a pair wins.
 */
@Injectable()
export class ProductStoreFlagRepository {
  constructor(private readonly prisma: PrismaClientService) {}

  async setPreferClosedPack(storeId: number, sku: string, value: boolean): Promise<void> {
    await this.prisma.productStoreFlag.create({ data: { store_id: storeId, sku, prefer_closed_pack: value } })
  }

  async preferClosedPack(storeId: number, sku: string): Promise<boolean | null> {
    const row = await this.prisma.productStoreFlag.findFirst({ where: { store_id: storeId, sku }, orderBy: { id: 'desc' } })

    return row ? row.prefer_closed_pack : null
  }
}
