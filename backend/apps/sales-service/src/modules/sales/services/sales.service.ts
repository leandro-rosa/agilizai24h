import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { SalesRow } from '@app/ingestion-contracts'
import { PrismaClientService } from '../../db-client/prisma-client.service'

export interface SalesRecordView {
  store_id: number
  period: string
  sku: string
  quantity_sold: number
  revenue_cents: number
  ingestion_id: string
}

export interface PeriodTotals {
  store_id: number
  period: string
  total_quantity_sold: number
  total_revenue_cents: number
  sku_count: number
}

export interface IngestPeriodInput {
  storeId: number
  period: string
  ingestionId: string
  rows: SalesRow[]
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name)

  constructor(private readonly prisma: PrismaClientService) {}

  /**
   * Replaces a store's period wholesale, in one transaction.
   *
   * Whole-period replacement rather than row-by-row upsert, deliberately: an
   * upsert leaves behind SKUs that the corrected report no longer contains, so
   * a period silently keeps stale rows and its totals stay too high. Replacing
   * makes "a SKU dropped from the corrected file disappears" true by
   * construction.
   *
   * One transaction, so a failure part-way cannot leave a period half-replaced
   * — a state in which every downstream figure would be wrong with nothing to
   * indicate it. Other periods and other stores are untouched.
   *
   * Idempotent by the same property: re-ingesting identical rows converges to
   * the same result, which matters because BullMQ delivers at least once.
   */
  async ingestPeriod({ storeId, period, ingestionId, rows }: IngestPeriodInput): Promise<PeriodTotals> {
    await this.prisma.$transaction(async tx => {
      await tx.salesRecord.deleteMany({ where: { store_id: storeId, period } })

      if (rows.length > 0) {
        await tx.salesRecord.createMany({
          data: rows.map(row => ({
            store_id: storeId,
            period,
            sku: row.sku,
            quantity_sold: row.quantitySold,
            revenue_cents: row.revenueCents,
            ingestion_id: ingestionId,
          })),
        })
      }

      // Marks the period as ingested even when it contained no rows, which is
      // what keeps "no upload" distinguishable from "a month with no sales".
      await tx.ingestedPeriod.upsert({
        where: { store_id_period: { store_id: storeId, period } },
        create: { store_id: storeId, period, ingestion_id: ingestionId, row_count: rows.length },
        update: { ingestion_id: ingestionId, row_count: rows.length, ingested_at: new Date() },
      })
    })

    this.logger.log(`Ingested ${rows.length} sales rows for store ${storeId} period ${period}`)

    return this.totals(storeId, period)
  }

  async findPeriod(storeId: number, period: string): Promise<SalesRecordView[]> {
    await this.assertIngested(storeId, period)

    const records = await this.prisma.salesRecord.findMany({
      where: { store_id: storeId, period },
      orderBy: [{ sku: 'asc' }],
    })

    return records.map(toView)
  }

  async totals(storeId: number, period: string): Promise<PeriodTotals> {
    await this.assertIngested(storeId, period)

    // Aggregated in the database rather than in application code, so a caller
    // deriving COGS does not re-sum thousands of rows over the wire.
    const aggregate = await this.prisma.salesRecord.aggregate({
      where: { store_id: storeId, period },
      _sum: { quantity_sold: true, revenue_cents: true },
      _count: { _all: true },
    })

    return {
      store_id: storeId,
      period,
      total_quantity_sold: aggregate._sum.quantity_sold ?? 0,
      total_revenue_cents: aggregate._sum.revenue_cents ?? 0,
      sku_count: aggregate._count._all,
    }
  }

  /**
   * "Never ingested" is reported as not-found rather than as zeroes. Zeroes
   * would be indistinguishable from a month that genuinely had no sales, and a
   * caller cannot tell a missing upload from a quiet month.
   */
  private async assertIngested(storeId: number, period: string): Promise<void> {
    const ingested = await this.prisma.ingestedPeriod.findUnique({
      where: { store_id_period: { store_id: storeId, period } },
    })

    if (!ingested) {
      throw new NotFoundException(`No sales data ingested for store ${storeId} period ${period}`)
    }
  }
}

function toView(record: SalesRecordView): SalesRecordView {
  return {
    store_id: record.store_id,
    period: record.period,
    sku: record.sku,
    quantity_sold: record.quantity_sold,
    revenue_cents: record.revenue_cents,
    ingestion_id: record.ingestion_id,
  }
}
