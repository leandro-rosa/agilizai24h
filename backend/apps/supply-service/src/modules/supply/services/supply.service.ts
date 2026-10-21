import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type {
  SupplyAdjustmentRow,
  SupplyRecordedClosingBalanceRow,
  SupplyRemovalRow,
  SupplyRestockRow,
  SupplyVisit,
} from '@app/ingestion-contracts'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { CLIENT_REPORT_REASON_KEY } from '../constants/client-report'
import { deriveDivergences, type VisitLineFact } from '../utils/derive-divergences'
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

const lineSelect = {
  sku: true,
  confirmed_count: true,
  removed_total: true,
  removals_by_reason: true,
  visit: { select: { id: true, store_id: true, kind: true, period: true, source_reference: true, ended_at: true } },
} as const

function toFact(line: {
  sku: string
  confirmed_count: number | null
  removed_total: number
  removals_by_reason: unknown
  visit: { id: number; store_id: number; kind: string; period: string; source_reference: string; ended_at: Date }
}): VisitLineFact {
  const split = line.removals_by_reason

  return {
    storeId: line.visit.store_id,
    sku: line.sku,
    visitId: line.visit.id,
    kind: line.visit.kind,
    period: line.visit.period,
    sourceReference: line.visit.source_reference,
    endedAt: line.visit.ended_at,
    confirmedCount: line.confirmed_count,
    removedTotal: line.removed_total,
    removalsByReason: split !== null && typeof split === 'object' && !Array.isArray(split) ? (split as Record<string, number>) : null,
  }
}

/** `[{ reason, quantity }]` → `{ reason: total }`; a repeated reason adds up. */
function splitByReason(entries: Array<{ reason: string; quantity: number }>): Record<string, number> {
  const split: Record<string, number> = {}
  for (const entry of entries) split[entry.reason] = (split[entry.reason] ?? 0) + entry.quantity

  return split
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

export interface DivergenceView {
  store_id: number
  sku: string
  quantity: number
  /** The report's own instants (wall-clock in UTC fields) of the visit that reported the units and of the earlier count. */
  identified_at: string
  identified_kind: string
  previous_conference_at: string | null
  previous_conference_kind: string | null
  /** Where each date came from, for tracing back to the report — internal, never printed in a client document. */
  identified_source: { visit_id: number; sheet: string }
  previous_conference_source: { visit_id: number; sheet: string } | null
}

export interface DivergencesView {
  reason: string
  from: string
  to: string
  store_ids: number[]
  divergences: DivergenceView[]
  /** Visits in the range that removed units whose reasons were not stored (reports imported before the split was kept): re-import the month. */
  unsplit_visits: number
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
                  // Undefined (a worker that predates the split) stores NULL = unknown, never an empty split.
                  removals_by_reason: line.removalsByReason === undefined ? undefined : splitByReason(line.removalsByReason),
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

  /**
   * The units removed under the client-report reason, per visit and SKU, with the previous count of that SKU. `from`/`to` are
   * report days (YYYY-MM-DD) compared against the report's own instants, inclusive of both whole days. Read-only.
   */
  async findDivergences(storeIds: number[], from: string, to: string): Promise<DivergencesView> {
    const start = new Date(`${from}T00:00:00.000Z`)
    const end = new Date(`${to}T23:59:59.999Z`)
    const reasonKey = CLIENT_REPORT_REASON_KEY

    const visitFilter = { store_id: { in: storeIds } }
    const reporting = await this.prisma.supplyVisitLine.findMany({
      where: { removed_total: { lt: 0 }, visit: { ...visitFilter, ended_at: { gte: start, lte: end } } },
      select: lineSelect,
    })

    const reportingFacts = reporting.map(toFact)
    const skus = [...new Set(reportingFacts.filter(f => f.removalsByReason?.[reasonKey]).map(f => f.sku))]
    const counted = skus.length === 0
      ? []
      : await this.prisma.supplyVisitLine.findMany({
          where: { confirmed_count: { not: null }, sku: { in: skus }, visit: { ...visitFilter, ended_at: { lt: end } } },
          select: lineSelect,
        })

    const result = deriveDivergences([...reportingFacts, ...counted.map(toFact)], reasonKey, start, end)

    return {
      reason: reasonKey,
      from,
      to,
      store_ids: storeIds,
      unsplit_visits: result.unsplitVisits,
      divergences: result.divergences.map(d => ({
        store_id: d.storeId,
        sku: d.sku,
        quantity: d.quantity,
        identified_at: d.identifiedAt.toISOString(),
        identified_kind: d.identifiedKind,
        previous_conference_at: d.previousConferenceAt?.toISOString() ?? null,
        previous_conference_kind: d.previousConferenceKind,
        identified_source: { visit_id: d.identifiedVisitId, sheet: d.identifiedReference },
        previous_conference_source:
          d.previousConferenceVisitId === null ? null : { visit_id: d.previousConferenceVisitId, sheet: d.previousConferenceReference ?? '' },
      })),
    }
  }

  /** The stores' stock per SKU: the balance after each store's latest visit that has a line for it, summed. Never the central stock. */
  async findNetworkBalances(skus: string[]) {
    if (skus.length === 0) return { rows: [] as Array<{ sku: string; in_stores: number; stores: number; last_visit: string; oldest_store_visit: string }> }

    const lines = await this.prisma.supplyVisitLine.findMany({
      where: { sku: { in: skus } },
      select: { sku: true, balance_after: true, visit: { select: { store_id: true, ended_at: true } } },
    })
    const latest = new Map<string, { sku: string; balance: number; endedAt: Date }>()
    for (const line of lines) {
      const key = `${line.visit.store_id}|${line.sku}`
      const held = latest.get(key)
      if (!held || line.visit.ended_at > held.endedAt) latest.set(key, { sku: line.sku, balance: line.balance_after, endedAt: line.visit.ended_at })
    }

    const bySku = new Map<string, { in_stores: number; stores: number; newest: Date; oldest: Date }>()
    for (const row of latest.values()) {
      const acc = bySku.get(row.sku) ?? { in_stores: 0, stores: 0, newest: row.endedAt, oldest: row.endedAt }
      acc.in_stores += row.balance
      acc.stores += 1
      if (row.endedAt > acc.newest) acc.newest = row.endedAt
      if (row.endedAt < acc.oldest) acc.oldest = row.endedAt
      bySku.set(row.sku, acc)
    }
    const day = (d: Date) => d.toISOString().slice(0, 10)

    return { rows: [...bySku.entries()].map(([sku, a]) => ({ sku, in_stores: a.in_stores, stores: a.stores, last_visit: day(a.newest), oldest_store_visit: day(a.oldest) })).sort((a, b) => a.sku.localeCompare(b.sku)) }
  }

  /** Removed units per month, SKU and reason across every store: what a supplier closing shows beside the sales. A month never ingested has no row (unknown, not zero). */
  async findNetworkRemovals(from: string, to: string, skus: string[]) {
    const grouped = skus.length
      ? await this.prisma.removalRecord.groupBy({
          by: ['period', 'sku', 'reason_id'],
          where: { period: { gte: from, lte: to }, sku: { in: skus } },
          _sum: { quantity_removed: true },
          _count: { store_id: true },
        })
      : []
    const reasons = new Map((await this.prisma.removalReason.findMany()).map(r => [r.id, r.key]))
    const periods = await this.prisma.removalRecord.findMany({ where: { period: { gte: from, lte: to } }, distinct: ['period'], select: { period: true }, orderBy: { period: 'asc' } })
    // Up to which day each month was imported: a removal total of a month can only be dated up to there.
    const visits = await this.prisma.supplyVisit.groupBy({ by: ['period'], where: { period: { gte: from, lte: to } }, _max: { ended_at: true } })

    return {
      from,
      to,
      months_with_data: periods.map(p => p.period),
      data_until: Object.fromEntries(visits.filter(v => v._max.ended_at).map(v => [v.period, (v._max.ended_at as Date).toISOString().slice(0, 10)])),
      rows: grouped
        .map(g => ({ period: g.period, sku: g.sku, reason: reasons.get(g.reason_id) ?? String(g.reason_id), quantity: g._sum.quantity_removed ?? 0, stores: g._count.store_id }))
        .sort((a, b) => a.period.localeCompare(b.period) || a.sku.localeCompare(b.sku) || a.reason.localeCompare(b.reason)),
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
