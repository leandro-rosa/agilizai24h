import { addDays } from './week'

export interface BalanceRow {
  sku: string
  in_stores: number
  stores: number
  last_visit: string
  oldest_store_visit: string
}

export interface StockLine {
  sku: string
  /** Units in the stores after each store's latest visit; null when the supply data has no visit line for the SKU (unknown, not zero). */
  in_stores: number | null
  stores: number
  last_visit: string | null
  oldest_store_visit: string | null
  sold_units: number
  /** Units sold per day over the period; null when nothing sold. */
  per_day: number | null
  /** Days the stores' stock lasts at that pace; null when nothing sold or the stock is unknown. */
  coverage_days: number | null
}

/** Days in the period, both ends included. */
export function daysOf(from: string, to: string): number {
  let n = 1
  for (let d = from; d < to; d = addDays(d, 1)) n += 1

  return n
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places

/**
 * What is left in the stores, beside the pace of sales: for showing the supplier and for deciding whether to buy more. It is arithmetic on the
 * supply and sales figures, never a recommendation. Stock at home is not here: only the person knows it, and informs it on the screen.
 */
export function viewStock(input: { from: string; to: string; skus: string[]; balances: BalanceRow[]; sold: Map<string, number> }): StockLine[] {
  const days = daysOf(input.from, input.to)
  const balance = new Map(input.balances.map(b => [b.sku, b]))

  return input.skus
    .map(sku => {
      const b = balance.get(sku)
      const soldUnits = input.sold.get(sku) ?? 0
      const perDay = soldUnits > 0 ? soldUnits / days : null

      return {
        sku,
        in_stores: b ? b.in_stores : null,
        stores: b?.stores ?? 0,
        last_visit: b?.last_visit ?? null,
        oldest_store_visit: b?.oldest_store_visit ?? null,
        sold_units: soldUnits,
        per_day: perDay === null ? null : round(perDay, 2),
        coverage_days: perDay !== null && b ? round(b.in_stores / perDay, 1) : null,
      }
    })
    .sort((a, b) => a.sku.localeCompare(b.sku))
}
