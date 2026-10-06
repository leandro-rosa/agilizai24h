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
