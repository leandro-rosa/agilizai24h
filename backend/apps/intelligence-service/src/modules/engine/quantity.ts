import type { Parameters } from '../parameters/parameters.types'
import { DAY_MS } from './engine.types'
import type { DemandEstimate } from './demand'
import type { Pattern } from './pattern'

export type QuantityAction = 'keep' | 'reduce' | 'increase' | 'test' | 'no_evidence'

export interface QuantityDecision {
  action: QuantityAction
  from: number | null
  to: number | null
  delta: number | null
  /** The replenishment interval the quantity was computed for — a quantity is never stated without it. */
  intervalDays: number | null
  leadDays: number
  qLow: number | null
  qHigh: number | null
  /** A stable code for why, so a reader can reproduce the decision. */
  reason: string
  /** Only an operational implication when a package size is known; the suggestion is NEVER rounded to it. */
  requiresSplitting: { unitsPerPackage: number } | null
  baselineIsOfRecord: boolean
}

/** Median days between the last restock events, or the owner's override. Null with fewer than two events. */
export function replenishmentInterval(events: Date[], recentRestocks: number, override: number | null): number | null {
  if (override !== null && override > 0) return override

  const recent = [...events].sort((a, b) => a.getTime() - b.getTime()).slice(-recentRestocks)
  if (recent.length < 2) return null

  const gaps: number[] = []
  for (let i = 1; i < recent.length; i++) gaps.push((recent[i].getTime() - recent[i - 1].getTime()) / DAY_MS)

  gaps.sort((a, b) => a - b)
  const middle = Math.floor(gaps.length / 2)
  return gaps.length % 2 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2
}

export interface QuantityInput {
  baseline: number | null
  baselineIsOfRecord: boolean
  demand: DemandEstimate
  pattern: Pattern
  intervalDays: number | null
  /** Share of recent restocked units that were lost to expiry/damage/other (loss reasons only). */
  lossShare: number | null
  unitsPerPackage: number | null
  parameters: Parameters['quantity']
}

/**
 * The Quantity decision against the current baseline, for a replenishment
 * interval H:
 *   qLow  = ceil(p50 · (H + L))
 *   qHigh = ceil(p80 · (H + L) + z · σ · √(H + L))
 * - baseline inside [qLow, qHigh]                      → keep
 * - baseline above qHigh, no recent stock-outs         → reduce to qHigh
 * - recent stock-outs and baseline below qLow          → increase to qLow
 * - growing, low loss, no stock-out, below qLow        → test qLow
 * - anything else                                      → no evidence to change
 *
 * Loss alone never reduces it; a missing stock-out never claims shortage; the
 * result is never rounded to a package multiple.
 */
export function decideQuantity(input: QuantityInput): QuantityDecision {
  const { baseline, demand, intervalDays, parameters: q } = input

  const base: QuantityDecision = {
    action: 'no_evidence',
    from: baseline,
    to: null,
    delta: null,
    intervalDays,
    leadDays: q.leadDays,
    qLow: null,
    qHigh: null,
    reason: '',
    requiresSplitting: null,
    baselineIsOfRecord: input.baselineIsOfRecord,
  }

  if (baseline === null) return { ...base, reason: 'no_baseline' }
  if (intervalDays === null) return { ...base, reason: 'no_replenishment_interval' }
  if (demand.rateMid === null || demand.rateHigh === null) return { ...base, reason: 'no_uncensored_demand' }

  const horizon = intervalDays + q.leadDays
  const safety = q.safetyZ * (demand.rateStd ?? 0) * Math.sqrt(horizon)
  const qLow = Math.ceil(demand.rateMid * horizon)
  const qHigh = Math.max(qLow, Math.ceil(demand.rateHigh * horizon + safety))

  const decided = (action: QuantityAction, to: number | null, reason: string): QuantityDecision => ({
    ...base,
    action,
    to,
    delta: to === null ? null : to - baseline,
    qLow,
    qHigh,
    reason,
    requiresSplitting:
      to !== null && input.unitsPerPackage !== null && input.unitsPerPackage > 0 && to % input.unitsPerPackage !== 0
        ? { unitsPerPackage: input.unitsPerPackage }
        : null,
  })

  const recentStockouts = demand.censoredShare >= q.censoredShareIncrease

  if (baseline < qLow && recentStockouts) return decided('increase', qLow, 'stockouts_with_baseline_below_demand')

  if (baseline > qHigh) {
    // Excess AND stock-outs at once is contradictory: say so instead of picking a side.
    if (recentStockouts) return decided('no_evidence', null, 'conflicting_stockouts_and_excess')
    return decided('reduce', qHigh, 'baseline_above_demand_band')
  }

  if (baseline >= qLow) return decided('keep', baseline, 'baseline_within_demand_band')

  const lowLoss = input.lossShare !== null && input.lossShare <= q.lossLowShare
  if (input.pattern === 'growing' && lowLoss && !recentStockouts) return decided('test', qLow, 'growing_demand_with_low_loss')

  return decided('no_evidence', null, 'below_demand_without_evidence_of_shortage')
}
