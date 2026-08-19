import { Injectable, Logger, MethodNotAllowedException, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { MovementsClient } from './movements.client'
import { deriveStockSeries, type PeriodMovements } from '../utils/derive-stock'

export interface StockView {
  store_id: number
  sku: string
  period: string
  restocked: number
  sold: number
  removed: number
  /** Net inventory adjustment — signed (design D4/D6). */
  adjustment: number
  closing_stock: number
  /** True when the derived balance is below zero — a data problem, not a level. */
  inconsistent: boolean
  /**
   * The operators' own reading for this period, when supply-service has one —
   * stored for visibility, never compared against `closing_stock` (design D5,
   * reversed: it is a visit-moment reading, not a month-end one).
   */
  recorded_closing_balance: number | null
  minimum?: number
  below_minimum?: boolean
}

export interface StoreStockView {
  store_id: number
  period: string
  items: StockView[]
  /** Set when any item's balance is negative, so a total cannot be mistaken for clean. */
  has_inconsistencies: boolean
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name)

  constructor(
    private readonly prisma: PrismaClientService,
    private readonly movements: MovementsClient,
  ) {}

  /**
   * Rebuilds a store's derived stock from the period that changed onward.
   *
   * Later periods are recomputed too, not just the one that changed: closing
   * stock carries forward, so a correction to March moves April and everything
   * after it. Recomputing only the changed period would leave every later
   * balance quietly wrong.
   *
   * Idempotent by construction — the snapshots are replaced from the recorded
   * movements, so a redelivered event produces identical values. That matters
   * because the period event is delivered at least once.
   */
  async recomputeStore(
    storeId: number,
    fromPeriod: string,
    correlationId?: string,
  ): Promise<{ written: number; periods: string[] }> {
    // Rebuilt incrementally: periods before the change keep their snapshots, and
    // the running balance is seeded from the closing stock immediately before
    // `fromPeriod`. Rebuilding the whole history instead would mean re-fetching
    // every month a store has ever had, on every ingestion.
    //
    // Everything from `fromPeriod` forward IS recomputed, though — closing stock
    // carries forward, so correcting March moves April and every month after it.
    const opening = await this.openingBalances(storeId, fromPeriod)

    const periods = await this.periodsToRebuild(storeId, fromPeriod)
    const bySku = new Map<string, PeriodMovements[]>()

    for (const period of periods) {
      const movements = await this.movements.movementsFor(storeId, period, correlationId)

      for (const [sku, movement] of movements) {
        if (!bySku.has(sku)) bySku.set(sku, [])
        bySku.get(sku)!.push(movement)
      }
    }

    // A SKU that had stock before the change but no movement after it still
    // needs its balance carried forward, or it would vanish from the listing.
    for (const sku of opening.keys()) {
      if (!bySku.has(sku)) bySku.set(sku, [])
    }

    let written = 0

    await this.prisma.$transaction(async tx => {
      await tx.stockSnapshot.deleteMany({ where: { store_id: storeId, period: { gte: fromPeriod } } })

      for (const [sku, movements] of bySku) {
        const series = deriveStockSeries(movements, opening.get(sku) ?? 0)

        if (series.length === 0) continue

        await tx.stockSnapshot.createMany({
          data: series.map(entry => ({
            store_id: storeId,
            sku,
            period: entry.period,
            restocked: entry.restocked,
            sold: entry.sold,
            removed: entry.removed,
            adjustment: entry.adjustment,
            closing_stock: entry.closingStock,
            recorded_closing_balance: entry.recordedClosingBalance,
          })),
        })

        written += series.length
      }

      const latest = await tx.stockSnapshot.findFirst({
        where: { store_id: storeId },
        orderBy: { period: 'desc' },
        select: { period: true },
      })

      await tx.derivedStore.upsert({
        where: { store_id: storeId },
        create: { store_id: storeId, latest_period: latest?.period ?? fromPeriod },
        update: { latest_period: latest?.period ?? fromPeriod, last_computed_at: new Date() },
      })
    })

    this.logger.log(`Recomputed ${written} stock snapshot(s) for store ${storeId} from ${fromPeriod}`)

    // The periods come back, not just the count: every one of them has a new
    // closing balance, and reconciliation values remaining stock from it — so
    // each needs revaluing, not only the month the change arrived for.
    return { written, periods }
  }

  /**
   * Closing balance per SKU immediately before `fromPeriod` — the opening
   * position the rebuild starts from.
   */
  private async openingBalances(storeId: number, fromPeriod: string): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<{ sku: string; closing_stock: number }[]>`
      SELECT DISTINCT ON (sku) sku, closing_stock
      FROM stock_snapshot
      WHERE store_id = ${storeId} AND period < ${fromPeriod}
      ORDER BY sku ASC, period DESC
    `

    return new Map(rows.map(row => [row.sku, Number(row.closing_stock)]))
  }

  /**
   * Which periods to fetch: from the change through the current month, plus any
   * later period already derived.
   *
   * The forward window matters — a month that was ingested but never derived,
   * because its own event was missed or suppressed, would otherwise stay
   * invisible and every later balance would be silently wrong.
   */
  private async periodsToRebuild(storeId: number, fromPeriod: string): Promise<string[]> {
    const known = await this.prisma.stockSnapshot.findMany({
      where: { store_id: storeId, period: { gte: fromPeriod } },
      select: { period: true },
      distinct: ['period'],
    })

    return [...new Set([...known.map(row => row.period), ...periodsFrom(fromPeriod, currentPeriod())])].sort((a, b) =>
      a.localeCompare(b),
    )
  }

  /** Stock for a store as of a period — the closing balance at that point. */
  async stockForStore(storeId: number, period?: string): Promise<StoreStockView> {
    await this.assertDerived(storeId)

    const asOf = period ?? (await this.latestPeriod(storeId))
    if (!asOf) throw new NotFoundException(`No stock derived for store ${storeId}`)

    // The latest snapshot at or before the requested period, per SKU: a SKU with
    // no movement in that month still has the balance it carried in.
    const rows = await this.prisma.$queryRaw<
      {
        sku: string
        period: string
        restocked: number
        sold: number
        removed: number
        adjustment: number
        closing_stock: number
        recorded_closing_balance: number | null
      }[]
    >`
      SELECT DISTINCT ON (sku) sku, period, restocked, sold, removed, adjustment, closing_stock,
        recorded_closing_balance
      FROM stock_snapshot
      WHERE store_id = ${storeId} AND period <= ${asOf}
      ORDER BY sku ASC, period DESC
    `

    const minimums = await this.prisma.minimumLevel.findMany({ where: { store_id: storeId } })
    const minimumBySku = new Map(minimums.map(level => [level.sku, level.minimum]))

    const items = rows.map(row => this.toView(storeId, row, minimumBySku.get(row.sku)))

    return {
      store_id: storeId,
      period: asOf,
      items,
      has_inconsistencies: items.some(item => item.inconsistent),
    }
  }

  async stockForSku(storeId: number, sku: string, period?: string): Promise<StockView> {
    const stock = await this.stockForStore(storeId, period)
    const found = stock.items.find(item => item.sku === sku)

    if (!found) {
      // Distinct from a stock of zero, which would look like a sold-out SKU.
      throw new NotFoundException(`No movements known for SKU ${sku} at store ${storeId}`)
    }

    return found
  }

  /** SKUs at or below their configured minimum. Only those that have one. */
  async belowMinimum(storeId: number, period?: string): Promise<StockView[]> {
    const stock = await this.stockForStore(storeId, period)

    return stock.items.filter(item => item.below_minimum === true)
  }

  async setMinimum(storeId: number, sku: string, minimum: number) {
    return this.prisma.minimumLevel.upsert({
      where: { store_id_sku: { store_id: storeId, sku } },
      create: { store_id: storeId, sku, minimum },
      update: { minimum },
    })
  }

  listMinimums(storeId: number) {
    return this.prisma.minimumLevel.findMany({ where: { store_id: storeId }, orderBy: { sku: 'asc' } })
  }

  /**
   * Stock is derived, never entered. Correcting a figure means correcting the
   * movements it came from, which keeps the read model reproducible.
   */
  setStock(): never {
    throw new MethodNotAllowedException(
      'Stock is derived from recorded movements and cannot be set directly — correct the sales or supply data instead',
    )
  }

  private async latestPeriod(storeId: number): Promise<string | null> {
    const derived = await this.prisma.derivedStore.findUnique({ where: { store_id: storeId } })
    return derived?.latest_period ?? null
  }

  private async assertDerived(storeId: number): Promise<void> {
    const derived = await this.prisma.derivedStore.findUnique({ where: { store_id: storeId } })

    if (!derived) {
      throw new NotFoundException(`No stock has been derived for store ${storeId}`)
    }
  }

  private toView(
    storeId: number,
    row: {
      sku: string
      period: string
      restocked: number
      sold: number
      removed: number
      adjustment: number
      closing_stock: number
      recorded_closing_balance: number | null
    },
    minimum?: number,
  ): StockView {
    const closing = Number(row.closing_stock)

    return {
      store_id: storeId,
      sku: row.sku,
      period: row.period,
      restocked: Number(row.restocked),
      sold: Number(row.sold),
      removed: Number(row.removed),
      adjustment: Number(row.adjustment),
      closing_stock: closing,
      inconsistent: closing < 0,
      recorded_closing_balance: row.recorded_closing_balance === null ? null : Number(row.recorded_closing_balance),
      minimum,
      // Asserted only for SKUs that actually have a minimum: without one there
      // is no judgement to make, and defaulting would invent a threshold.
      below_minimum: minimum === undefined ? undefined : closing <= minimum,
    }
  }
}

/** The current month as YYYY-MM. */
function currentPeriod(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Every month from `from` through `to`, inclusive.
 *
 * Bounded by the current month, so a malformed or far-future period cannot make
 * this walk forever. Returns just `from` when `to` precedes it.
 */
export function periodsFrom(from: string, to: string): string[] {
  if (from.localeCompare(to) > 0) return [from]

  const periods: string[] = []
  let [year, month] = from.split('-').map(Number)

  // A store's history is measured in months, so this loop is short; the guard
  // is only here so a bad input cannot spin.
  for (let guard = 0; guard < 600; guard += 1) {
    const period = `${year}-${String(month).padStart(2, '0')}`
    periods.push(period)

    if (period.localeCompare(to) >= 0) break

    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }

  return periods
}
