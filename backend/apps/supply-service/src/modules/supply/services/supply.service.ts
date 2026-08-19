import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type {
  SupplyAdjustmentRow,
  SupplyRecordedClosingBalanceRow,
  SupplyRemovalRow,
  SupplyRestockRow,
} from '@app/ingestion-contracts'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { deriveLoss, type ClassifiedRemoval, type DerivedLoss } from '../utils/derive-loss'

export interface RestockView {
  sku: string
  quantity_restocked: number
}

export interface RemovalView {
  sku: string
  reason: string
  reason_label: string
  /** Carried on every row so a displayed figure can show the rule that produced it. */
  counts_as_loss: boolean
  quantity_removed: number
}

export interface AdjustmentView {
  sku: string
  /** Signed: positive is inbound, negative is outbound. */
  quantity: number
}

export interface RecordedClosingBalanceView {
  sku: string
  quantity: number
}

export interface PeriodView {
  store_id: number
  period: string
  restocks: RestockView[]
  removals: RemovalView[]
  adjustments: AdjustmentView[]
  recorded_closing_balances: RecordedClosingBalanceView[]
  loss: DerivedLoss
}

export interface IngestPeriodInput {
  storeId: number
  period: string
  ingestionId: string
  restocks: SupplyRestockRow[]
  removals: SupplyRemovalRow[]
  adjustments: SupplyAdjustmentRow[]
  recordedClosingBalances: SupplyRecordedClosingBalanceRow[]
}

export interface IngestResult {
  changed: boolean
  restockCount: number
  removalCount: number
  adjustmentCount: number
}

@Injectable()
export class SupplyService {
  private readonly logger = new Logger(SupplyService.name)

  constructor(private readonly prisma: PrismaClientService) {}

  /**
   * Replaces a store's period wholesale, in one transaction — the same contract
   * sales-service established. Three services solving this the same way is
   * worth more than three local optimisations.
   *
   * Returns whether anything actually changed, so the caller can suppress the
   * period-data-updated event on a no-op. Re-uploading an identical file is a
   * normal operator action, and publishing unconditionally would trigger a
   * recomputation storm downstream for nothing.
   */
  async ingestPeriod({
    storeId,
    period,
    ingestionId,
    restocks,
    removals,
    adjustments,
    recordedClosingBalances,
  }: IngestPeriodInput): Promise<IngestResult> {
    const reasons = await this.prisma.removalReason.findMany()
    const byKey = new Map(reasons.map(reason => [reason.key, reason]))

    // An unrecognised reason is rejected, never bucketed. Both defaults are
    // wrong in a way that hides itself: defaulting to loss inflates the figure
    // the business is trying to reduce; defaulting to non-loss quietly deletes
    // real loss from the books.
    const unknown = [...new Set(removals.map(r => r.reason).filter(reason => !byKey.has(reason)))]
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unrecognised removal reason(s) for store ${storeId} period ${period}: ${unknown.join(', ')}. ` +
          `Known reasons: ${[...byKey.keys()].join(', ')}`,
      )
    }

    const before = await this.snapshot(storeId, period)

    await this.prisma.$transaction(async tx => {
      await tx.restockRecord.deleteMany({ where: { store_id: storeId, period } })
      await tx.removalRecord.deleteMany({ where: { store_id: storeId, period } })
      await tx.adjustmentRecord.deleteMany({ where: { store_id: storeId, period } })
      await tx.recordedClosingBalance.deleteMany({ where: { store_id: storeId, period } })

      if (restocks.length > 0) {
        await tx.restockRecord.createMany({
          data: restocks.map(row => ({
            store_id: storeId,
            period,
            sku: row.sku,
            quantity_restocked: row.quantityRestocked,
            ingestion_id: ingestionId,
          })),
        })
      }

      if (removals.length > 0) {
        await tx.removalRecord.createMany({
          data: removals.map(row => ({
            store_id: storeId,
            period,
            sku: row.sku,
            reason_id: byKey.get(row.reason)!.id,
            quantity_removed: row.quantityRemoved,
            source_text: row.sourceText ?? null,
            ingestion_id: ingestionId,
          })),
        })
      }

      if (adjustments.length > 0) {
        await tx.adjustmentRecord.createMany({
          data: adjustments.map(row => ({
            store_id: storeId,
            period,
            sku: row.sku,
            quantity: row.quantity,
            ingestion_id: ingestionId,
          })),
        })
      }

      if (recordedClosingBalances.length > 0) {
        await tx.recordedClosingBalance.createMany({
          data: recordedClosingBalances.map(row => ({
            store_id: storeId,
            period,
            sku: row.sku,
            quantity: row.quantity,
            ingestion_id: ingestionId,
          })),
        })
      }

      await tx.ingestedPeriod.upsert({
        where: { store_id_period: { store_id: storeId, period } },
        create: {
          store_id: storeId,
          period,
          ingestion_id: ingestionId,
          restock_count: restocks.length,
          removal_count: removals.length,
        },
        update: {
          ingestion_id: ingestionId,
          restock_count: restocks.length,
          removal_count: removals.length,
          ingested_at: new Date(),
        },
      })
    })

    const after = await this.snapshot(storeId, period)
    const changed = before !== after

    this.logger.log(
      `Ingested ${restocks.length} restocks, ${removals.length} removals and ${adjustments.length} adjustments ` +
        `for store ${storeId} period ${period}` +
        (changed ? '' : ' (no change — event suppressed)'),
    )

    return { changed, restockCount: restocks.length, removalCount: removals.length, adjustmentCount: adjustments.length }
  }

  async findPeriod(storeId: number, period: string): Promise<PeriodView> {
    await this.assertIngested(storeId, period)

    const [restocks, removals, adjustments, closingBalances] = await Promise.all([
      this.prisma.restockRecord.findMany({ where: { store_id: storeId, period }, orderBy: { sku: 'asc' } }),
      this.prisma.removalRecord.findMany({
        where: { store_id: storeId, period },
        include: { reason: true },
        orderBy: [{ sku: 'asc' }, { reason_id: 'asc' }],
      }),
      this.prisma.adjustmentRecord.findMany({ where: { store_id: storeId, period }, orderBy: { sku: 'asc' } }),
      this.prisma.recordedClosingBalance.findMany({ where: { store_id: storeId, period }, orderBy: { sku: 'asc' } }),
    ])

    // Restocks, removals and adjustments are reported separately, never netted
    // into each other: a caller valuing the period needs all three, and
    // netting would destroy the distinction (design D4/D6).
    return {
      store_id: storeId,
      period,
      restocks: restocks.map(row => ({ sku: row.sku, quantity_restocked: row.quantity_restocked })),
      removals: removals.map(row => ({
        sku: row.sku,
        reason: row.reason.key,
        reason_label: row.reason.label,
        counts_as_loss: row.reason.counts_as_loss,
        quantity_removed: row.quantity_removed,
      })),
      adjustments: adjustments.map(row => ({ sku: row.sku, quantity: row.quantity })),
      recorded_closing_balances: closingBalances.map(row => ({ sku: row.sku, quantity: row.quantity })),
      loss: deriveLoss(removals.map(toClassified)),
    }
  }

  async findLoss(storeId: number, period: string): Promise<DerivedLoss> {
    await this.assertIngested(storeId, period)

    const removals = await this.prisma.removalRecord.findMany({
      where: { store_id: storeId, period },
      include: { reason: true },
    })

    // Read from the reason table's flag, never from a local copy of the rule.
    // Adjustments never reach this — they are neither a removal nor a loss.
    return deriveLoss(removals.map(toClassified))
  }

  listReasons() {
    return this.prisma.removalReason.findMany({ orderBy: [{ counts_as_loss: 'desc' }, { key: 'asc' }] })
  }

  /**
   * A cheap fingerprint of a store's period, used only to decide whether an
   * ingestion actually changed anything.
   */
  private async snapshot(storeId: number, period: string): Promise<string> {
    const [restocks, removals, adjustments, closingBalances] = await Promise.all([
      this.prisma.restockRecord.findMany({
        where: { store_id: storeId, period },
        select: { sku: true, quantity_restocked: true },
        orderBy: { sku: 'asc' },
      }),
      this.prisma.removalRecord.findMany({
        where: { store_id: storeId, period },
        select: { sku: true, reason_id: true, quantity_removed: true },
        orderBy: [{ sku: 'asc' }, { reason_id: 'asc' }],
      }),
      this.prisma.adjustmentRecord.findMany({
        where: { store_id: storeId, period },
        select: { sku: true, quantity: true },
        orderBy: { sku: 'asc' },
      }),
      this.prisma.recordedClosingBalance.findMany({
        where: { store_id: storeId, period },
        select: { sku: true, quantity: true },
        orderBy: { sku: 'asc' },
      }),
    ])

    return JSON.stringify({ restocks, removals, adjustments, closingBalances })
  }

  private async assertIngested(storeId: number, period: string): Promise<void> {
    const ingested = await this.prisma.ingestedPeriod.findUnique({
      where: { store_id_period: { store_id: storeId, period } },
    })

    if (!ingested) {
      throw new NotFoundException(`No supply data ingested for store ${storeId} period ${period}`)
    }
  }
}

function toClassified(row: {
  sku: string
  quantity_removed: number
  reason: { key: string; counts_as_loss: boolean }
}): ClassifiedRemoval {
  return {
    sku: row.sku,
    reasonKey: row.reason.key,
    countsAsLoss: row.reason.counts_as_loss,
    quantityRemoved: row.quantity_removed,
  }
}
