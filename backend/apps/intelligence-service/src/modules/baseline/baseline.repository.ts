import { Injectable } from '@nestjs/common'
import { PrismaClientService } from '../db-client/prisma-client.service'

export interface BaselineView {
  sku: string
  quantity: number
  source: string
  effectiveFrom: string
}

/**
 * The baseline quantity ("qtd itens por loja"): ONE value per SKU, applied to
 * every store, with an append-only history. A re-import adds a row and never
 * overwrites; the current baseline is the latest row already in effect.
 */
@Injectable()
export class BaselineRepository {
  constructor(private readonly prisma: PrismaClientService) {}

  async add(sku: string, quantity: number, source: string, effectiveFrom: Date): Promise<void> {
    await this.prisma.baselineQuantity.create({ data: { sku, quantity, source, effective_from: effectiveFrom } })
  }

  /** The baseline in force for a SKU at `asOf`, or `null` when none had taken effect yet. */
  async current(sku: string, asOf: Date = new Date()): Promise<BaselineView | null> {
    const row = await this.prisma.baselineQuantity.findFirst({
      where: { sku, effective_from: { lte: asOf } },
      orderBy: [{ effective_from: 'desc' }, { id: 'desc' }],
    })

    return row ? toView(row) : null
  }

  /** Every SKU's baseline at `asOf` (the latest row of each). */
  async currentForAll(asOf: Date = new Date()): Promise<BaselineView[]> {
    const rows = await this.prisma.baselineQuantity.findMany({
      where: { effective_from: { lte: asOf } },
      orderBy: [{ effective_from: 'desc' }, { id: 'desc' }],
    })

    const latest = new Map<string, (typeof rows)[number]>()
    for (const row of rows) if (!latest.has(row.sku)) latest.set(row.sku, row)

    return [...latest.values()].map(toView)
  }

  async history(sku: string): Promise<BaselineView[]> {
    const rows = await this.prisma.baselineQuantity.findMany({ where: { sku }, orderBy: [{ effective_from: 'asc' }, { id: 'asc' }] })

    return rows.map(toView)
  }
}

function toView(row: { sku: string; quantity: number; source: string; effective_from: Date }): BaselineView {
  return { sku: row.sku, quantity: row.quantity, source: row.source, effectiveFrom: row.effective_from.toISOString() }
}
