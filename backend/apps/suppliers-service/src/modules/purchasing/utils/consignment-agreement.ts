import { isDay } from './week'

export interface CostRow {
  sku: string
  valid_from: string
  unit_cost_cents: number
}

/** Weekly (7), every 10 days, every 15 days or a custom number of days; at most one year. */
export function validatePeriodDays(days: number): string | null {
  return Number.isInteger(days) && days >= 1 && days <= 366 ? null : 'period_days must be a whole number of days from 1 to 366'
}

export function validateCost(input: { sku: string; valid_from: string; unit_cost_cents: number }): string[] {
  const problems: string[] = []
  if (input.sku.trim() === '') problems.push('sku is required')
  if (!isDay(input.valid_from)) problems.push('valid_from must be a real date, YYYY-MM-DD')
  if (!Number.isInteger(input.unit_cost_cents) || input.unit_cost_cents < 0) problems.push('unit_cost_cents must be a whole number of cents, zero or more')

  return problems
}

/** The agreed cost in force on `on` (a day), one per SKU; a SKU whose first vigência is still in the future is left out. */
export function currentCosts(costs: CostRow[], on: string): CostRow[] {
  const bySku = new Map<string, CostRow>()
  for (const cost of costs) {
    if (cost.valid_from > on) continue
    const held = bySku.get(cost.sku)
    if (!held || cost.valid_from > held.valid_from) bySku.set(cost.sku, cost)
  }

  return [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku))
}
