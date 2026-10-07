import { describeVersions, historyStart } from './describe-versions'
import { COST_RANK, NO_RANK, resolveVersionAsOf, type Versioned } from './resolve-version'

export interface CostRow extends Versioned {
  cost_cents: number
  actor: string | null
  reason: string | null
  supplier_id: number | null
  purchase_id: number | null
  invoice_number: string | null
  purchase_quantity: number | null
  purchase_total_cents: number | null
  created_at: Date
}

export interface PriceRow extends Versioned {
  price_cents: number
  actor: string | null
  reason: string | null
  source_ref: string | null
  created_at: Date
}

export interface TimelineEvent {
  kind: 'cost' | 'price'
  /** The effective date. */
  date: string
  value_cents: number
  /** What was in force the day before; null when this is the first version (nothing is asserted before it). */
  previous_value_cents: number | null
  source: string
  actor: string | null
  reason: string | null
  /** Another version of the same date outranks this one: it never took effect. */
  superseded: boolean
  /** When it was recorded in the system, as opposed to when it takes effect. */
  recorded_at: string
  supplier_id?: number | null
  purchase_id?: number | null
  invoice_number?: string | null
  purchase_quantity?: number | null
  purchase_total_cents?: number | null
  /** The pricing decision, for a price that came from the recommendation. */
  source_ref?: string | null
}

const day = (date: Date): string => date.toISOString().slice(0, 10)
const dayBefore = (date: Date): Date => new Date(date.getTime() - 86_400_000)

/**
 * One list of everything that changed a product's cost or price, newest first. For each version the value that was in
 * force the day before is derived from the series, so "R$ 5,70 → R$ 6,20" is always read from the same rule as the
 * lookups, never stored. `history_available_from` says where the data starts: nothing is claimed before it.
 */
export function buildTimeline(costs: CostRow[], prices: PriceRow[]): { history_available_from: string | null; events: TimelineEvent[] } {
  const events: TimelineEvent[] = []

  for (const { version, superseded } of describeVersions(costs, COST_RANK)) {
    const before = resolveVersionAsOf(costs, dayBefore(version.effective_from), COST_RANK)
    events.push({
      kind: 'cost',
      date: day(version.effective_from),
      value_cents: version.cost_cents,
      previous_value_cents: before ? before.cost_cents : null,
      source: version.source,
      actor: version.actor,
      reason: version.reason,
      superseded,
      recorded_at: version.created_at.toISOString(),
      supplier_id: version.supplier_id,
      purchase_id: version.purchase_id,
      invoice_number: version.invoice_number,
      purchase_quantity: version.purchase_quantity,
      purchase_total_cents: version.purchase_total_cents,
    })
  }

  for (const { version, superseded } of describeVersions(prices, NO_RANK)) {
    const before = resolveVersionAsOf(prices, dayBefore(version.effective_from), NO_RANK)
    events.push({
      kind: 'price',
      date: day(version.effective_from),
      value_cents: version.price_cents,
      previous_value_cents: before ? before.price_cents : null,
      source: version.source,
      actor: version.actor,
      reason: version.reason,
      superseded,
      recorded_at: version.created_at.toISOString(),
      source_ref: version.source_ref,
    })
  }

  events.sort((a, b) => b.date.localeCompare(a.date) || b.recorded_at.localeCompare(a.recorded_at))

  return { history_available_from: [historyStart(costs), historyStart(prices)].filter((d): d is string => d !== null).sort()[0] ?? null, events }
}

export interface MarginInterval {
  from: string
  /** Last day of the interval; null for the current one. */
  to: string | null
  price_cents: number | null
  /** The cost in force on the first day of the interval. */
  cost_cents: number | null
  /** `(price − cost) / price`; null when either side is missing, never zero. */
  margin: number | null
  /** `price / cost`. */
  markup: number | null
  price_source: string | null
  cost_source: string | null
  cost_invoice_number: string | null
  cost_supplier_id: number | null
  price_reason: string | null
}

/**
 * The product margin over time, split at EVERY change of cost or price: each interval shows the price and the cost in
 * force at its start. A change of today's cost never alters an earlier interval, because each interval reads the
 * versions in force on ITS date.
 */
export function buildMarginIntervals(costs: CostRow[], prices: PriceRow[]): MarginInterval[] {
  const dates = [...new Set([...costs, ...prices].map(version => day(version.effective_from)))].sort()
  const intervals: MarginInterval[] = []
  let lastCostId: number | null | undefined
  let lastPriceId: number | null | undefined

  for (const date of dates) {
    const at = new Date(`${date}T00:00:00Z`)
    const cost = resolveVersionAsOf(costs, at, COST_RANK)
    const price = resolveVersionAsOf(prices, at, NO_RANK)
    // The same versions in force as the previous interval: a superseded or repeated version changes nothing visible.
    if (cost?.id === lastCostId && price?.id === lastPriceId) continue
    lastCostId = cost?.id ?? null
    lastPriceId = price?.id ?? null

    const rated = cost !== null && price !== null && cost.cost_cents > 0 && price.price_cents > 0
    intervals.push({
      from: date,
      to: null,
      price_cents: price?.price_cents ?? null,
      cost_cents: cost?.cost_cents ?? null,
      margin: rated ? (price.price_cents - cost.cost_cents) / price.price_cents : null,
      markup: rated ? price.price_cents / cost.cost_cents : null,
      price_source: price?.source ?? null,
      cost_source: cost?.source ?? null,
      cost_invoice_number: cost?.invoice_number ?? null,
      cost_supplier_id: cost?.supplier_id ?? null,
      price_reason: price?.reason ?? null,
    })
  }

  intervals.forEach((interval, index) => {
    const next = intervals[index + 1]
    interval.to = next ? day(dayBefore(new Date(`${next.from}T00:00:00Z`))) : null
  })

  return intervals
}
