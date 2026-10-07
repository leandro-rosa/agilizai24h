import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { buildMarginIntervals, buildTimeline, type MarginInterval, type TimelineEvent } from '../utils/timeline'

/** Reads a product's whole cost and price history. Read-only: nothing is recorded or recomputed here. */
@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaClientService) {}

  async timeline(productId: number): Promise<{ product_id: number; history_available_from: string | null; events: TimelineEvent[] }> {
    const { costs, prices } = await this.versions(productId)

    return { product_id: productId, ...buildTimeline(costs, prices) }
  }

  /** The product margin split at every change of cost or price, each period read with the versions in force ON ITS date. */
  async marginIntervals(productId: number): Promise<{ product_id: number; history_available_from: string | null; intervals: MarginInterval[] }> {
    const { costs, prices } = await this.versions(productId)

    return { product_id: productId, history_available_from: buildTimeline(costs, prices).history_available_from, intervals: buildMarginIntervals(costs, prices) }
  }

  private async versions(productId: number) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true } })
    if (!product) throw new NotFoundException(`Product ${productId} not found`)

    const [costs, prices] = await Promise.all([
      this.prisma.costVersion.findMany({ where: { product_id: productId }, orderBy: [{ effective_from: 'asc' }, { id: 'asc' }] }),
      this.prisma.priceVersion.findMany({ where: { product_id: productId }, orderBy: [{ effective_from: 'asc' }, { id: 'asc' }] }),
    ])

    return { costs, prices }
  }
}
