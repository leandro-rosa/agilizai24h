import { isSynthetic } from '../../common/synthetic'
import { shiftMonth } from '../refresh/months'
import type { SalesClient } from '../sources/sales.client'
import type { StoreDto } from '../sources/stores.client'
import type { SupplyClient } from '../sources/supply.client'
import type { Cell, MonthFacts } from './analysis.metrics'

const STORES_PER_BATCH = 8
const CACHE_MS = 60_000

/** The window shown: the selected month and the five before it — enough for the 6-month view and for a 3-month average. */
export const WINDOW_MONTHS = 6

export function windowOf(period: string): string[] {
  return Array.from({ length: WINDOW_MONTHS }, (_, i) => shiftMonth(period, i - (WINDOW_MONTHS - 1)))
}

/** What a day window of one month is made of: restocks from the visits, sales from the receipts, losses allocated. */
export interface DayFacts {
  facts: MonthFacts
  /** Losses are a month's recorded total spread over the visits' removals, not recorded per day. */
  lossEstimated: boolean
  /** No store had dated receipts for this month, so the day's sales are unknown (not zero). */
  salesDetailMissing: boolean
}

export function lastDayOf(month: string): string {
  const [year, number] = month.split('-').map(Number)

  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10)
}

/**
 * Reads restock, loss and sales per store × month and keeps the answer for a
 * minute: switching between suppliers and products re-reads the same months.
 * A store whose month was never ingested (404) is recorded as missing — never as
 * a store with zeroes — and synthetic stores are excluded.
 */
export class FactsLoader {
  private readonly cache = new Map<string, { at: number; facts: Promise<MonthFacts> }>()
  private readonly dayCache = new Map<string, { at: number; facts: Promise<DayFacts> }>()

  constructor(
    private readonly supply: SupplyClient,
    private readonly sales: SalesClient,
  ) {}

  month(month: string, stores: StoreDto[], correlationId?: string): Promise<MonthFacts> {
    const real = stores.filter(store => !isSynthetic(store.name))
    const key = `${month}:${real.map(s => s.id).join(',')}`
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.facts

    const facts = this.load(month, real, correlationId)
    this.cache.set(key, { at: Date.now(), facts })
    // A failed read must not be served again from the cache.
    facts.catch(() => this.cache.delete(key))

    return facts
  }

  /**
   * The cells of `[from, to]` inside one month. Restocks are exact (the sum of the visits' lines, which equals the
   * month's record). Sales are the dated receipts. Loss is NOT recorded per visit, so a month's loss for a store-SKU is
   * allocated to the days in proportion to the units the visits removed — the month total is preserved, the day split is an estimate.
   */
  days(month: string, from: string, to: string, stores: StoreDto[], correlationId?: string): Promise<DayFacts> {
    const real = stores.filter(store => !isSynthetic(store.name))
    const key = `${month}:${from}:${to}:${real.map(s => s.id).join(',')}`
    const hit = this.dayCache.get(key)
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.facts

    const facts = this.loadDays(month, from, to, real, correlationId)
    this.dayCache.set(key, { at: Date.now(), facts })
    facts.catch(() => this.dayCache.delete(key))

    return facts
  }

  private async loadDays(month: string, from: string, to: string, stores: StoreDto[], correlationId?: string): Promise<DayFacts> {
    const cells = new Map<number, Map<string, Cell>>()
    const missingSupply: number[] = []
    const missingSales: number[] = []
    const within = (iso: string) => {
      const day = iso.slice(0, 10)

      return day >= from && day <= to
    }

    for (let i = 0; i < stores.length; i += STORES_PER_BATCH) {
      await Promise.all(
        stores.slice(i, i + STORES_PER_BATCH).map(async store => {
          const supply = await this.supply.period(store.id, month, correlationId)
          const visits = supply ? await this.supply.visits(store.id, month, month, correlationId) : []
          const transactions = await this.sales.transactions(store.id, month, correlationId)
          const bySku = new Map<string, Cell>()
          const at = (sku: string): Cell => {
            const found = bySku.get(sku)
            if (found) return found
            const created = { restocked: 0, sold: 0, lost: 0, revenueCents: 0 }
            bySku.set(sku, created)
            return created
          }

          if (!supply) missingSupply.push(store.id)
          else {
            const lossOfMonth = new Map<string, number>()
            for (const row of supply.removals) if (row.counts_as_loss) lossOfMonth.set(row.sku, (lossOfMonth.get(row.sku) ?? 0) + row.quantity_removed)
            const removedInMonth = new Map<string, number>()
            const removedInWindow = new Map<string, number>()

            for (const visit of visits) {
              const inWindow = within(visit.ended_at)
              for (const line of visit.lines) {
                const removed = Math.abs(line.removed_total)
                removedInMonth.set(line.sku, (removedInMonth.get(line.sku) ?? 0) + removed)
                if (!inWindow) continue
                removedInWindow.set(line.sku, (removedInWindow.get(line.sku) ?? 0) + removed)
                at(line.sku).restocked += line.restocked
              }
            }

            for (const [sku, loss] of lossOfMonth) {
              const total = removedInMonth.get(sku) ?? 0
              const share = total > 0 ? (removedInWindow.get(sku) ?? 0) / total : 0
              if (share > 0) at(sku).lost += loss * share
            }
          }

          // Receipts without a timestamp cannot be placed on a day: the store's day sales are unknown, not zero.
          if (!transactions || transactions.length === 0 || transactions.some(t => t.occurred_at === null)) missingSales.push(store.id)
          else
            for (const row of transactions) {
              if (row.result !== 'OK' || row.occurred_at === null || !within(row.occurred_at)) continue
              const cell = at(row.sku)
              cell.sold += row.quantity
              cell.revenueCents += row.amount_paid_cents
            }

          cells.set(store.id, bySku)
        }),
      )
    }

    return {
      facts: { month: `${from}..${to}`, cells, storesMissingSupply: missingSupply, storesMissingSales: missingSales, storeCount: stores.length },
      lossEstimated: true,
      salesDetailMissing: stores.length > 0 && missingSales.length >= stores.length,
    }
  }

  private async load(month: string, stores: StoreDto[], correlationId?: string): Promise<MonthFacts> {
    const cells = new Map<number, Map<string, Cell>>()
    const missingSupply: number[] = []
    const missingSales: number[] = []

    for (let i = 0; i < stores.length; i += STORES_PER_BATCH) {
      await Promise.all(
        stores.slice(i, i + STORES_PER_BATCH).map(async store => {
          const [supply, sales] = await Promise.all([this.supply.period(store.id, month, correlationId), this.sales.period(store.id, month, correlationId)])
          const bySku = new Map<string, Cell>()
          const at = (sku: string): Cell => {
            const found = bySku.get(sku)
            if (found) return found
            const created = { restocked: 0, sold: 0, lost: 0, revenueCents: 0 }
            bySku.set(sku, created)
            return created
          }

          if (!supply) missingSupply.push(store.id)
          else {
            for (const row of supply.restocks) at(row.sku).restocked += row.quantity_restocked
            for (const row of supply.removals) if (row.counts_as_loss) at(row.sku).lost += row.quantity_removed
          }

          if (!sales) missingSales.push(store.id)
          else
            for (const row of sales) {
              const cell = at(row.sku)
              cell.sold += row.quantity_sold
              cell.revenueCents += row.revenue_cents
            }

          cells.set(store.id, bySku)
        }),
      )
    }

    return { month, cells, storesMissingSupply: missingSupply, storesMissingSales: missingSales, storeCount: stores.length }
  }
}
