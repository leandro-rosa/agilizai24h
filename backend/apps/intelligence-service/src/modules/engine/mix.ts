import type { Parameters } from '../parameters/parameters.types'
import { DAY_MS, type MonthlyFacts, type NetworkEvidence, type VisitPoint } from './engine.types'
import type { DemandEstimate } from './demand'
import type { Interval } from './intervals'

export type Presence = 'sells' | 'low_adherence' | 'restocked_without_sales' | 'no_recent_restock' | 'never_tested' | 'insufficient_data'
export type Mix = 'keep' | 'test' | 'evaluate_removal' | 'insufficient_data'

export interface Economics {
  monthsCounted: number
  revenueCents: number
  unitsSold: number
  /** Units lost, loss reasons only (expired, damaged, other reason) — a return or transfer is not loss. */
  lostUnits: number
  marginCents: number | null
  lossCostCents: number | null
  /** margin minus the cost of units lost. Each lost unit is counted ONCE; never also netted against sold units. */
  contributionCents: number | null
}

const LOSS_REASONS = ['expired', 'damaged_product', 'other_reason'] as const

export function lostUnitsOf(month: MonthlyFacts): number {
  return LOSS_REASONS.reduce((sum, reason) => sum + (month.removals[reason] ?? 0), 0)
}

/**
 * Economics from the monthly figures, with the single current cost version. Cost
 * unresolved → margin and contribution are null (never computed with a zero cost).
 */
export function computeEconomics(monthly: MonthlyFacts[], costCents: number | null): Economics {
  const withSales = monthly.filter(month => month.salesPresent)
  const revenueCents = withSales.reduce((sum, month) => sum + month.revenueCents, 0)
  const unitsSold = withSales.reduce((sum, month) => sum + month.sold, 0)
  const lostUnits = monthly.reduce((sum, month) => sum + lostUnitsOf(month), 0)

  const marginCents = costCents === null ? null : revenueCents - costCents * unitsSold
  const lossCostCents = costCents === null ? null : costCents * lostUnits

  return {
    monthsCounted: withSales.length,
    revenueCents,
    unitsSold,
    lostUnits,
    marginCents,
    lossCostCents,
    contributionCents: marginCents === null || lossCostCents === null ? null : marginCents - lossCostCents,
  }
}

export interface PresenceInput {
  visits: VisitPoint[]
  intervals: Interval[]
  restockEvents: Date[]
  demand: DemandEstimate
  intervalDays: number | null
  asOf: Date
  parameters: Parameters
}

/** Whether the SKU ever held stock at the store: any restock or any positive balance in any visit. */
export function everHadStock(visits: VisitPoint[]): boolean {
  return visits.some(visit => visit.restocked > 0 || visit.balanceAfter > 0 || visit.balanceBefore > 0)
}

/**
 * What "it does not sell" really means, kept apart. Never tested (no stock ever)
 * is NOT low adherence; a new SKU is insufficient data, not a verdict.
 */
export function classifyPresence(input: PresenceInput): Presence {
  const { visits, intervals, restockEvents, demand, intervalDays, asOf, parameters: p } = input

  if (!everHadStock(visits)) return 'never_tested'
  if (restockEvents.length <= p.pattern.newCycles || demand.observations < p.pattern.minObservations) return 'insufficient_data'

  const lowRate = p.mix.lowDemandPerWeek / 7
  const informative = intervals.filter(interval => !interval.noStock && !interval.rise && interval.days > 0)
  const recent = informative.slice(-p.demand.recentIntervals)

  if (recent.length >= 2 && recent.every(interval => interval.consumption === 0) && recent.some(interval => interval.restockedAtStart > 0)) {
    return 'restocked_without_sales'
  }

  const uncensoredRates = recent.filter(interval => !interval.censored).map(interval => interval.consumption / interval.days)
  const lowShare = uncensoredRates.length === 0 ? 0 : uncensoredRates.filter(rate => rate < lowRate).length / uncensoredRates.length

  if (restockEvents.length >= p.mix.minExposureCycles && lowShare >= p.mix.lowRecurrenceShare) return 'low_adherence'

  const lastRestock = restockEvents[restockEvents.length - 1]
  const goodHistory = demand.rateMid !== null && demand.rateMid >= lowRate
  if (intervalDays !== null && lastRestock && goodHistory && (asOf.getTime() - lastRestock.getTime()) / DAY_MS > p.mix.noRecentRestockFactor * intervalDays) {
    return 'no_recent_restock'
  }

  return 'sells'
}

export interface MixInput {
  presence: Presence
  isNew: boolean
  economics: Economics
  /** Expired loss recurring over the recent months. */
  expiredRecurrent: boolean
  parameters: Parameters['mix']
}

/** Contribution after losses at or below the configured share of revenue — "low or negative". Null when cost is unknown. */
export function contributionIsLow(economics: Economics, p: Parameters['mix']): boolean | null {
  if (economics.contributionCents === null) return null
  return economics.contributionCents <= p.lowContributionShare * economics.revenueCents
}

export interface MixDecision {
  mix: Mix
  reason: string
  /** The store-level removal pattern holds (used by the network evaluation). */
  removalPattern: boolean
}

/**
 * Mix per Product x Store. Removal is only EVALUATED, never automatic, and never
 * from low sales or loss alone: it needs sufficient exposure with recurrently
 * low demand AND (low or negative contribution after losses OR recurrent expiry).
 */
export function decideMix(input: MixInput): MixDecision {
  const { presence, isNew, economics, expiredRecurrent } = input

  if (presence === 'never_tested') return { mix: 'insufficient_data', reason: 'never_tested', removalPattern: false }
  if (isNew) return { mix: 'test', reason: 'new_product_not_penalised', removalPattern: false }
  if (presence === 'insufficient_data') return { mix: 'insufficient_data', reason: 'too_few_observations', removalPattern: false }

  if (presence === 'low_adherence' || presence === 'restocked_without_sales') {
    const low = contributionIsLow(economics, input.parameters)
    if (low === true || expiredRecurrent) {
      return { mix: 'evaluate_removal', reason: low === true ? 'low_adherence_and_low_contribution' : 'low_adherence_and_recurrent_expiry', removalPattern: true }
    }
    return { mix: 'keep', reason: low === null ? 'low_adherence_but_contribution_unknown' : 'low_adherence_but_contribution_not_low', removalPattern: false }
  }

  return { mix: 'keep', reason: 'demand_consistent', removalPattern: false }
}

/**
 * Removal from the NETWORK needs the same pattern in MORE than the configured
 * share (a majority) of the stores where the SKU was actually exposed — far
 * stronger evidence than removal from one store.
 */
export function networkRemovalPattern(network: NetworkEvidence | null, p: Parameters['mix']): boolean {
  if (!network || network.exposedStores === 0) return false
  return network.storesWithRemovalPattern / network.exposedStores > p.networkMajorityShare
}
