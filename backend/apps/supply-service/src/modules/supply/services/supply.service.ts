import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type {
  SupplyAdjustmentRow,
  SupplyRecordedClosingBalanceRow,
  SupplyRemovalRow,
  SupplyRestockRow,
  SupplyVisit,
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

export interface VisitLineView {
  sku: string
  balance_before: number
  /** The count made BEFORE restocking; null = not counted (never zero). */
  confirmed_count: number | null
  quantity_to_restock: number | null
  restocked: number
  removed_total: number
  adjustment: number
  balance_after: number
  capacity: number | null
}

export interface VisitView {
  id: number
  period: string
  kind: string
  started_at: string | null
  ended_at: string
  previous_ended_at: string | null
  source_reference: string
  lines: VisitLineView[]
}

export interface VisitsView {
  store_id: number
  from: string
  to: string
  visits: VisitView[]
}

export interface IngestPeriodInput {
  storeId: number
  period: string
  ingestionId: string
  restocks: SupplyRestockRow[]
  removals: SupplyRemovalRow[]
  adjustments: SupplyAdjustmentRow[]
  recordedClosingBalances: SupplyRecordedClosingBalanceRow[]
  /**
   * Undefined leaves the store-period's stored visits untouched (a job from a
   * worker that predates visits); a list — even an empty one — replaces them.
   */
  visits?: SupplyVisit[]
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
    visits,
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

      // Visits are replaced in the same transaction as the monthly records, so a
      // corrected report never leaves a superseded visit behind and a failed
      // write never leaves the two out of step. Lines go with their visit (cascade).
      if (visits !== undefined) {
        await tx.supplyVisit.deleteMany({ where: { store_id: storeId, period } })

        for (const visit of visits) {
          await tx.supplyVisit.create({
            data: {
              store_id: storeId,
              period,
              kind: visit.kind,
              started_at: visit.startedAt ? new Date(visit.startedAt) : null,
              ended_at: new Date(visit.endedAt),
              previous_ended_at: visit.previousEndedAt ? new Date(visit.previousEndedAt) : null,
              source_reference: visit.sourceReference,
              ingestion_id: ingestionId,
              lines: {
                create: visit.lines.map(line => ({
                  sku: line.sku,
                  balance_before: line.balanceBefore,
                  confirmed_count: line.confirmedCount,
                  quantity_to_restock: line.quantityToRestock,
                  restocked: line.restocked,
                  removed_total: line.removedTotal,
                  adjustment: line.adjustment,
                  balance_after: line.balanceAfter,
                  capacity: line.capacity,
                })),
              },
            },
          })
        }
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

  /**
   * A store's visits and their lines over a range of periods, ordered by end
   * instant. An empty list — not an error — for a range with none, so "never
   * ingested" and "ingested with no visits" read the same to this caller; the
   * period-level distinction still lives in `findPeriod`.
   */
  async findVisits(storeId: number, from: string, to: string): Promise<VisitsView> {
    const visits = await this.prisma.supplyVisit.findMany({
      where: { store_id: storeId, period: { gte: from, lte: to } },
      include: { lines: { orderBy: [{ sku: 'asc' }, { id: 'asc' }] } },
      orderBy: [{ ended_at: 'asc' }, { id: 'asc' }],
    })

    return {
      store_id: storeId,
      from,
      to,
      visits: visits.map(visit => ({
        id: visit.id,
        period: visit.period,
        kind: visit.kind,
        started_at: visit.started_at?.toISOString() ?? null,
        ended_at: visit.ended_at.toISOString(),
        previous_ended_at: visit.previous_ended_at?.toISOString() ?? null,
        source_reference: visit.source_reference,
        lines: visit.lines.map(line => ({
          sku: line.sku,
          balance_before: line.balance_before,
          confirmed_count: line.confirmed_count,
          quantity_to_restock: line.quantity_to_restock,
          restocked: line.restocked,
          removed_total: line.removed_total,
          adjustment: line.adjustment,
          balance_after: line.balance_after,
          capacity: line.capacity,
        })),
      })),
    }
  }

  /** The stores that have at least one visit in the range — what a network-wide reader iterates over. */
  async findVisitStoreIds(from: string, to: string): Promise<number[]> {
    const rows = await this.prisma.supplyVisit.findMany({
      where: { period: { gte: from, lte: to } },
      select: { store_id: true },
      distinct: ['store_id'],
      orderBy: { store_id: 'asc' },
    })

    return rows.map(row => row.store_id)
  }

  /**
   * Restocking visits per store and month: a visit of a restocking or combined operation with at least one line that actually restocked something. A
   * count-only visit (`inventory`) restocks nothing and is reported apart. The unit is one store served in one operation (a trip that serves several
   * stores counts several), and the same store and end instant is counted once, so a re-ingested sheet never doubles. A month with no visits has no row:
   * unknown is not zero.
   */
  async findVisitCounts(from: string, to: string): Promise<VisitCounts> {
    const visits = await this.prisma.supplyVisit.findMany({
      where: { period: { gte: from, lte: to } },
      select: { store_id: true, period: true, kind: true, ended_at: true, lines: { where: { restocked: { gt: 0 } }, select: { id: true }, take: 1 } },
      orderBy: [{ store_id: 'asc' }, { ended_at: 'asc' }],
    })

    const seen = new Set<string>()
    const counts = new Map<string, { store_id: number; period: string; restocking_visits: number; count_only_visits: number }>()
    for (const visit of visits) {
      const key = `${visit.store_id}|${visit.ended_at.toISOString()}`
      if (seen.has(key)) continue
      seen.add(key)

      const cell = counts.get(`${visit.store_id}|${visit.period}`) ?? { store_id: visit.store_id, period: visit.period, restocking_visits: 0, count_only_visits: 0 }
      if (visit.kind !== 'inventory' && visit.lines.length > 0) cell.restocking_visits += 1
      else cell.count_only_visits += 1
      counts.set(`${visit.store_id}|${visit.period}`, cell)
    }

    return {
      from,
      to,
      unit: 'one store served in one restocking operation (a trip that serves several stores counts several)',
      rows: [...counts.values()].sort((a, b) => a.period.localeCompare(b.period) || a.store_id - b.store_id),
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

export interface VisitCounts {
  from: string
  to: string
  /** What one counted visit is, so a cost per visit is never read as a cost per trip. */
  unit: string
  rows: { store_id: number; period: string; restocking_visits: number; count_only_visits: number }[]
}
