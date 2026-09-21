import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { SalesTransactionRow } from '@app/ingestion-contracts'
import { PrismaClientService } from '../../db-client/prisma-client.service'

export interface SalesTransactionView {
  store_id: number
  period: string
  occurred_at: Date | null
  sku: string
  quantity: number
  amount_paid_cents: number
  original_amount_cents: number | null
  discount_cents: number | null
  net_amount_cents: number | null
  coupon: string | null
  result: string
  method: string | null
  acquirer: string | null
  card_brand: string | null
  card_last_digits: string | null
  internal_code: string | null
  acquirer_code: string | null
  pos_id: string | null
  machine_model: string | null
  buyer_number: string | null
  ingestion_id: string
}

export interface IngestPeriodTransactionsInput {
  storeId: number
  period: string
  ingestionId: string
  rows: SalesTransactionRow[]
}

@Injectable()
export class SalesTransactionsService {
  private readonly logger = new Logger(SalesTransactionsService.name)

  constructor(private readonly prisma: PrismaClientService) {}

  /**
   * Replaces a store's period wholesale, same contract as `SalesService.ingestPeriod` —
   * see that method's doc for why whole-period replacement rather than upsert, and why
   * one transaction. Unlike the aggregate, there is no natural per-row unique key here
   * (two genuinely distinct transactions can share every field), so replacement is
   * scoped to (store_id, period) rather than a per-row constraint.
   */
  async ingestPeriodTransactions({ storeId, period, ingestionId, rows }: IngestPeriodTransactionsInput): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.salesTransaction.deleteMany({ where: { store_id: storeId, period } })

      if (rows.length > 0) {
        await tx.salesTransaction.createMany({
          data: rows.map(row => ({
            store_id: storeId,
            period,
            occurred_at: row.occurredAt ? new Date(row.occurredAt) : null,
            sku: row.sku,
            quantity: row.quantity,
            amount_paid_cents: row.amountPaidCents,
            original_amount_cents: row.originalAmountCents ?? null,
            discount_cents: row.discountCents ?? null,
            net_amount_cents: row.netAmountCents ?? null,
            coupon: row.coupon ?? null,
            result: row.result,
            method: row.method ?? null,
            acquirer: row.acquirer ?? null,
            card_brand: row.cardBrand ?? null,
            card_last_digits: row.cardLastDigits ?? null,
            internal_code: row.internalCode ?? null,
            acquirer_code: row.acquirerCode ?? null,
            pos_id: row.posId ?? null,
            machine_model: row.machineModel ?? null,
            buyer_number: row.buyerNumber ?? null,
            ingestion_id: ingestionId,
          })),
        })
      }
    })

    this.logger.log(`Ingested ${rows.length} sales transactions for store ${storeId} period ${period}`)
  }

  /**
   * 404 rather than an empty list — never ingested and "ingested from a report with no
   * transaction-level columns" are deliberately the same outcome here (see
   * sales-transaction-detail spec), so a plain row-count check is enough; no separate
   * presence marker like SalesRecord's IngestedPeriod is needed for this table.
   */
  async findPeriod(storeId: number, period: string): Promise<SalesTransactionView[]> {
    const records = await this.prisma.salesTransaction.findMany({
      where: { store_id: storeId, period },
      orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }],
    })

    if (records.length === 0) {
      throw new NotFoundException(`No sales transaction detail for store ${storeId} period ${period}`)
    }

    return records.map(toView)
  }
}

function toView(record: SalesTransactionView): SalesTransactionView {
  return {
    store_id: record.store_id,
    period: record.period,
    occurred_at: record.occurred_at,
    sku: record.sku,
    quantity: record.quantity,
    amount_paid_cents: record.amount_paid_cents,
    original_amount_cents: record.original_amount_cents,
    discount_cents: record.discount_cents,
    net_amount_cents: record.net_amount_cents,
    coupon: record.coupon,
    result: record.result,
    method: record.method,
    acquirer: record.acquirer,
    card_brand: record.card_brand,
    card_last_digits: record.card_last_digits,
    internal_code: record.internal_code,
    acquirer_code: record.acquirer_code,
    pos_id: record.pos_id,
    machine_model: record.machine_model,
    buyer_number: record.buyer_number,
    ingestion_id: record.ingestion_id,
  }
}
