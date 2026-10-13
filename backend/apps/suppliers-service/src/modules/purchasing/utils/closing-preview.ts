import { currentCosts, type CostRow } from './consignment-agreement'

export type PreviewIssueCode = 'cost_changes_in_period' | 'sales_dates_missing' | 'stores_missing'

export interface PreviewIssue {
  code: PreviewIssueCode
  /** Only the person can decide to go on with it (stores without import); a cost or date problem is never acceptable. */
  acceptable: boolean
  sku?: string
  detail?: string
}

export interface PreviewLine {
  sku: string
  sold_units: number
  unit_cost_cents: number
  total_cents: number
}

export type PreviewStatus = 'ready' | 'no_sales' | 'incomplete'

export interface Preview {
  status: PreviewStatus
  lines: PreviewLine[]
  total_units: number
  total_cents: number
  configured_skus: number
  skus_without_sales: number
  issues: PreviewIssue[]
}

export interface PreviewInput {
  /** First and last day, both included (São Paulo days). */
  from: string
  to: string
  costs: CostRow[]
  sales: { rows: { sku: string; quantity: number }[]; months_without_dated_receipts: string[]; stores_missing: number }
}

/**
 * The read-only closing of a period: units sold of the supplier's SKUs × the agreed cost in force on the first day. Nothing is stored and nothing
 * is owed until a person confirms. A cost that begins inside the period would need a line per vigência, which this basis does not split: it says so
 * instead of picking one cost silently.
 */
export function previewClosing(input: PreviewInput): Preview {
  const skus = [...new Set(input.costs.map(c => c.sku))]
  const atStart = new Map(currentCosts(input.costs, input.from).map(c => [c.sku, c.unit_cost_cents]))
  const issues: PreviewIssue[] = []

  for (const sku of skus) {
    const later = input.costs.find(c => c.sku === sku && c.valid_from > input.from && c.valid_from <= input.to)
    if (later) issues.push({ code: 'cost_changes_in_period', acceptable: false, sku, detail: later.valid_from })
  }
  if (input.sales.months_without_dated_receipts.length > 0) issues.push({ code: 'sales_dates_missing', acceptable: false, detail: input.sales.months_without_dated_receipts.join(', ') })
  if (input.sales.stores_missing > 0) issues.push({ code: 'stores_missing', acceptable: true, detail: String(input.sales.stores_missing) })

  const sold = new Map(input.sales.rows.map(r => [r.sku, r.quantity]))
  const lines: PreviewLine[] = []
  for (const sku of skus) {
    const units = sold.get(sku) ?? 0
    const cost = atStart.get(sku)
    if (units > 0 && cost !== undefined) lines.push({ sku, sold_units: units, unit_cost_cents: cost, total_cents: units * cost })
  }
  lines.sort((a, b) => b.total_cents - a.total_cents || a.sku.localeCompare(b.sku))

  const total_units = lines.reduce((s, l) => s + l.sold_units, 0)
  const total_cents = lines.reduce((s, l) => s + l.total_cents, 0)
  const status: PreviewStatus = issues.length > 0 ? 'incomplete' : total_units === 0 ? 'no_sales' : 'ready'

  return { status, lines, total_units, total_cents, configured_skus: skus.length, skus_without_sales: skus.length - new Set(lines.map(l => l.sku)).size, issues }
}
