import { currentCosts, type CostRow } from './consignment-agreement'

export interface RemovalRow {
  period: string
  sku: string
  reason: string
  quantity: number
}

export interface RemovalCell {
  units: number
  /** Units × the agreed cost in force on the first day of the period; null when the SKU has no cost then. */
  cents: number | null
}

export interface RemovalLine {
  sku: string
  month: string
  expired: RemovalCell
  other_reason: RemovalCell
  returned: RemovalCell
}

export interface MonthScope {
  month: string
  /**
   * whole_month: no earlier closing counted this month, so the month's total is shown whole.
   * since_last_closing: what the month accumulated AFTER the last closing that counted it (current total minus that closing's total).
   */
  mode: 'whole_month' | 'since_last_closing'
  /** Last day of that month's visits in the supply data. */
  data_until: string | null
  /** The data does not go past the period's last day, so the figure cannot include days outside the period. When false, choosing it to be paid is refused. */
  dated_ok: boolean
  /** In since_last_closing: the day the previous closing's data reached. */
  counted_since: string | null
}

export interface RemovalsView {
  /** The supply data keeps the month only; the figures are dated by comparison with the last closing, never by the day of the removal. */
  basis: 'month'
  months: string[]
  scope: MonthScope[]
  months_without_data: string[]
  lines: RemovalLine[]
  totals: { expired: RemovalCell; other_reason: RemovalCell; returned: RemovalCell }
}

/** Every `YYYY-MM` from the month of `from` to the month of `to`. */
export function monthsTouched(from: string, to: string): string[] {
  const months: string[] = []
  let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))]
  const end = to.slice(0, 7)
  for (;;) {
    const label = `${y}-${String(m).padStart(2, '0')}`
    months.push(label)
    if (label >= end) return months
    m += 1
    if (m > 12) [y, m] = [y + 1, 1]
  }
}

/**
 * Expired, other-reason (theft: the owner bears it) and returned units per SKU and month, valued at the agreed cost. They are SHOWN beside the
 * sales and never added to the amount to settle: whether they are paid is a decision of the person, product by product.
 */
export interface PreviousClosingTotals {
  /** Raw month totals (per SKU and reason) as they were when that closing was confirmed. */
  rows: RemovalRow[]
  months: string[]
  data_until: Record<string, string>
}

export function viewRemovals(input: { from: string; to: string; costs: CostRow[]; rows: RemovalRow[]; monthsWithData: string[]; dataUntil?: Record<string, string>; previous?: PreviousClosingTotals[] }): RemovalsView {
  const months = monthsTouched(input.from, input.to)
  const dataUntil = input.dataUntil ?? {}
  // Per month, the most recent closing that counted it: only what came after it is new.
  const baseOf = new Map<string, PreviousClosingTotals>()
  for (const closing of input.previous ?? []) for (const month of closing.months) if (!baseOf.has(month)) baseOf.set(month, closing)
  const taken = new Map<string, number>()
  for (const [month, closing] of baseOf) for (const row of closing.rows) if (row.period === month) taken.set(`${month}|${row.sku}|${row.reason}`, (taken.get(`${month}|${row.sku}|${row.reason}`) ?? 0) + row.quantity)
  const cost = new Map(currentCosts(input.costs, input.from).map(c => [c.sku, c.unit_cost_cents]))
  const cell = (units: number, sku: string): RemovalCell => ({ units, cents: units === 0 ? 0 : cost.has(sku) ? units * (cost.get(sku) as number) : null })
  const key = (period: string, sku: string) => `${period}|${sku}`

  const lines = new Map<string, { sku: string; month: string; expired: number; other_reason: number; returned: number }>()
  for (const raw of input.rows) {
    if (!months.includes(raw.period)) continue
    const row = { ...raw, quantity: Math.max(0, raw.quantity - (taken.get(`${raw.period}|${raw.sku}|${raw.reason}`) ?? 0)) }
    const field = row.reason === 'expired' ? 'expired' : row.reason === 'other_reason' ? 'other_reason' : row.reason === 'return' ? 'returned' : null
    if (!field) continue
    const line = lines.get(key(row.period, row.sku)) ?? { sku: row.sku, month: row.period, expired: 0, other_reason: 0, returned: 0 }
    line[field] += row.quantity
    lines.set(key(row.period, row.sku), line)
  }

  const out: RemovalLine[] = [...lines.values()]
    .map(l => ({ sku: l.sku, month: l.month, expired: cell(l.expired, l.sku), other_reason: cell(l.other_reason, l.sku), returned: cell(l.returned, l.sku) }))
    .sort((a, b) => a.month.localeCompare(b.month) || a.sku.localeCompare(b.sku))

  const total = (field: 'expired' | 'other_reason' | 'returned'): RemovalCell => {
    const units = out.reduce((s, l) => s + l[field].units, 0)
    const priced = out.filter(l => l[field].cents !== null)

    return { units, cents: out.some(l => l[field].units > 0 && l[field].cents === null) ? null : priced.reduce((s, l) => s + (l[field].cents as number), 0) }
  }

  const scope: MonthScope[] = months.map(month => {
    const base = baseOf.get(month)
    const until = dataUntil[month] ?? null

    return { month, mode: base ? 'since_last_closing' : 'whole_month', data_until: until, dated_ok: until === null || until <= input.to, counted_since: base?.data_until[month] ?? null }
  })

  return {
    basis: 'month',
    months,
    scope,
    months_without_data: months.filter(m => !input.monthsWithData.includes(m)),
    lines: out,
    totals: { expired: total('expired'), other_reason: total('other_reason'), returned: total('returned') },
  }
}
