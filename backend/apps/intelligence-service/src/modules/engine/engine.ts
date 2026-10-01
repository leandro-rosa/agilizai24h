import { buildAlerts, expiredIsRecurrent, presenceMonths, type Alert } from './alerts'
import { estimateBalance, type BalanceEstimate } from './balance'
import { buildConfidence, type Confidence } from './confidence'
import { detectConflicts, type DataConflict } from './conflicts'
import { estimateDemand, type DemandEstimate } from './demand'
import { DAY_MS, type PairInput } from './engine.types'
import { buildCycles, buildIntervals, restockEvents, sortVisits, type Cycle } from './intervals'
import { classifyPresence, computeEconomics, decideMix, everHadStock, lostUnitsOf, networkRemovalPattern, type Economics, type Mix, type Presence } from './mix'
import { classifyPattern, type Pattern } from './pattern'
import { decideQuantity, replenishmentInterval, type QuantityDecision } from './quantity'

/** Bumped with ANY change of engine logic, so a stored result says which logic produced it. */
export const ENGINE_VERSION = '1.0.0'

/** Exactly one per Product x Store, so the five numbers of the coverage report sum to the total considered. */
export type CoverageCategory =
  | 'insufficient_history'
  | 'conflicting_data'
  | 'analysable_reliable_balance'
  | 'analysable_unreliable_balance'
  | 'analysable_not_enough_counts'

export interface Fact {
  code: string
  data?: Record<string, unknown>
}

export interface PairResult {
  engineVersion: string
  storeId: number
  sku: string
  asOf: string
  exposure: {
    firstAppearance: string | null
    lastRestock: string | null
    lastVisit: string | null
    restockCount: number
    intervals: number
    uncensoredIntervals: number
    cycles: number
  }
  cycles: (Omit<Cycle, 'from' | 'to'> & { from: string; to: string })[]
  demand: DemandEstimate
  pattern: Pattern
  presence: Presence
  mix: { value: Mix; reason: string; removalPatternInThisStore: boolean; networkRemovalPattern: boolean }
  quantity: QuantityDecision
  /** Operation decision: every factual alert that applies, empty = none. */
  operation: Alert[]
  economics: Economics
  balance: BalanceEstimate
  conflicts: DataConflict[]
  coverage: CoverageCategory
  /** Filled by the run once every store has reported: the cross-store view of this SKU. */
  network?: { exposedStores: number; storesWithRemovalPattern: number; storesWithDamage: number }
  confidence: Confidence
  explanation: {
    facts: Fact[]
    evidenceToKeep: Fact[]
    evidenceToChange: Fact[]
    limitations: string[]
  }
}

const iso = (date: Date | null) => (date ? date.toISOString() : null)
const monthOf = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`

export interface CoverageInput {
  isNew: boolean
  uncensoredObservations: number
  minObservations: number
  conflicts: number
  tolerance: BalanceEstimate['tolerance']['status']
}

/**
 * Evaluated in this order so each Product x Store lands in exactly one category:
 * insufficient history, then conflicting data (which wins over the balance
 * status), then the three analysable ones split by tolerance status.
 */
export function coverageCategory(input: CoverageInput): CoverageCategory {
  if (input.isNew || input.uncensoredObservations < input.minObservations) return 'insufficient_history'
  if (input.conflicts > 0) return 'conflicting_data'
  if (input.tolerance === 'within_tolerance') return 'analysable_reliable_balance'
  if (input.tolerance === 'outside_tolerance') return 'analysable_unreliable_balance'
  return 'analysable_not_enough_counts'
}

/**
 * The Product x Store engine: a pure function of its input. No database, no
 * clock (the reference date is an input), no side effect — the same input,
 * engine version and parameters always give the same result, and nothing here
 * can change a baseline, a parameter or any other data.
 */
export function runPair(input: PairInput): PairResult {
  const p = input.parameters
  const visits = sortVisits(input.visits.filter(visit => visit.endedAt.getTime() <= input.asOf.getTime()))
  const monthly = [...input.monthly].sort((a, b) => a.month.localeCompare(b.month))

  const intervals = buildIntervals(visits, p.demand.minIntervalDays)
  const cycles = buildCycles(intervals)
  const events = restockEvents(visits)
  const demand = estimateDemand(intervals, input.asOf, p.demand)
  const isNew = events.length <= p.pattern.newCycles
  const pattern = classifyPattern(intervals, events.length, p.pattern, p.demand.recentIntervals)
  const intervalDays = replenishmentInterval(events, p.quantity.recentRestocks, input.plannedRefillIntervalDays)

  const recentMonths = presenceMonths(monthly)
  const recentRestocked = recentMonths.reduce((sum, month) => sum + month.restocked, 0)
  const recentLostUnits = recentMonths.reduce((sum, month) => sum + lostUnitsOf(month), 0)
  const lossShare = recentRestocked > 0 ? recentLostUnits / recentRestocked : null

  const quantity = decideQuantity({
    baseline: input.baseline,
    baselineIsOfRecord: input.baselineIsOfRecord,
    demand,
    pattern,
    intervalDays,
    lossShare,
    unitsPerPackage: input.unitsPerPackage,
    parameters: p.quantity,
  })

  const economics = computeEconomics(monthly, input.costCents)
  const presence = classifyPresence({ visits, intervals, restockEvents: events, demand, intervalDays, asOf: input.asOf, parameters: p })
  const expiredRecurrent = expiredIsRecurrent(monthly, p.alerts)
  const mix = decideMix({ presence, isNew, economics, expiredRecurrent, parameters: p.mix })
  const networkPattern = networkRemovalPattern(input.network, p.mix)

  // Consumption in a month whose sales were never imported: a conflict, not a big difference.
  const consumptionMonthsWithoutSales = [
    ...new Set(intervals.filter(interval => interval.consumption > 0 && input.salesMonthsMissing.includes(monthOf(interval.to))).map(interval => monthOf(interval.to))),
  ].sort()

  const conflicts = detectConflicts({ intervals, consumptionMonthsWithoutSales, rejectedAtIngestion: input.rejectedAtIngestion, baselineConflict: input.baselineConflict })
  const conflicting = conflicts.length > 0
  const balance = estimateBalance(visits, input.asOf, demand.rateMid, conflicting, p.tolerance, everHadStock(visits))

  const lastThreeAdjustments = visits.slice(-3).filter(visit => visit.adjustment !== 0).length
  const lowRate = p.mix.lowDemandPerWeek / 7

  const operation = buildAlerts({
    monthly,
    pattern,
    lowDemand: demand.rateMid !== null && demand.rateMid < lowRate,
    economics,
    network: input.network,
    toleranceOutside: balance.tolerance.status === 'outside_tolerance',
    recurringAdjustment: lastThreeAdjustments >= 2,
    salesMonthsMissing: input.salesMonthsMissing,
    rejectedAtIngestion: input.rejectedAtIngestion,
    parameters: p.alerts,
  })

  const confidence = buildConfidence({
    demand,
    pattern,
    salesMonthsMissing: input.salesMonthsMissing,
    conflicting,
    balance,
    quantity,
    economics,
    costCents: input.costCents,
    recentLostUnits,
    parameters: p,
  })

  const coverage = coverageCategory({
    isNew,
    uncensoredObservations: demand.observations,
    minObservations: p.pattern.minObservations,
    conflicts: conflicts.length,
    tolerance: balance.tolerance.status,
  })

  const firstWithStock = visits.find(visit => visit.restocked > 0 || visit.balanceAfter > 0 || visit.balanceBefore > 0)

  return {
    engineVersion: ENGINE_VERSION,
    storeId: input.storeId,
    sku: input.sku,
    asOf: input.asOf.toISOString(),
    exposure: {
      firstAppearance: iso(everHadStock(visits) && firstWithStock ? firstWithStock.endedAt : null),
      lastRestock: iso(events.length > 0 ? events[events.length - 1] : null),
      lastVisit: iso(visits.length > 0 ? visits[visits.length - 1].endedAt : null),
      restockCount: events.length,
      intervals: intervals.length,
      uncensoredIntervals: demand.observations,
      cycles: cycles.length,
    },
    cycles: cycles.map(cycle => ({ ...cycle, from: cycle.from.toISOString(), to: cycle.to.toISOString() })),
    demand,
    pattern,
    presence,
    mix: { value: mix.mix, reason: mix.reason, removalPatternInThisStore: mix.removalPattern, networkRemovalPattern: networkPattern },
    quantity,
    operation,
    economics,
    balance,
    conflicts,
    coverage,
    confidence,
    explanation: explain({ input, demand, pattern, presence, quantity, mix: mix.mix, balance, conflicts, economics, intervalDays, isNew, lossShare }),
  }
}

interface ExplainInput {
  input: PairInput
  demand: DemandEstimate
  pattern: Pattern
  presence: Presence
  quantity: QuantityDecision
  mix: Mix
  balance: BalanceEstimate
  conflicts: DataConflict[]
  economics: Economics
  intervalDays: number | null
  isNew: boolean
  lossShare: number | null
}

/**
 * The facts, the evidence to keep, the evidence to change and the limitations —
 * everything a person needs to reproduce the decision. A generative model, if
 * one is used later, may only PHRASE these; it never decides.
 */
function explain(e: ExplainInput): PairResult['explanation'] {
  const facts: Fact[] = [
    { code: 'uncensored_intervals', data: { count: e.demand.observations } },
    { code: 'daily_demand', data: { low: e.demand.rateLow, mid: e.demand.rateMid, high: e.demand.rateHigh } },
    { code: 'pattern', data: { value: e.pattern } },
    { code: 'presence', data: { value: e.presence } },
    { code: 'baseline', data: { quantity: e.input.baseline, ofRecord: e.input.baselineIsOfRecord } },
    { code: 'replenishment_interval_days', data: { value: e.intervalDays, leadDays: e.quantity.leadDays } },
  ]
  if (e.demand.demandCensored) facts.push({ code: 'frequent_stockouts', data: { share: e.demand.censoredShare } })

  const keep: Fact[] = []
  const change: Fact[] = []

  if (e.quantity.action === 'keep') keep.push({ code: 'baseline_within_demand_band', data: { qLow: e.quantity.qLow, qHigh: e.quantity.qHigh } })
  if (e.quantity.action === 'reduce') change.push({ code: 'baseline_above_demand_band', data: { qHigh: e.quantity.qHigh, baseline: e.quantity.from } })
  if (e.quantity.action === 'increase') change.push({ code: 'stockouts_with_baseline_below_demand', data: { qLow: e.quantity.qLow, censoredShare: e.demand.censoredShare } })
  if (e.quantity.action === 'test') change.push({ code: 'growing_demand_with_low_loss', data: { qLow: e.quantity.qLow, lossShare: e.lossShare } })
  if (e.presence === 'sells') keep.push({ code: 'demand_consistent' })
  if (e.economics.contributionCents !== null && e.economics.contributionCents > 0) keep.push({ code: 'positive_contribution_after_losses', data: { cents: e.economics.contributionCents } })
  if (e.mix === 'evaluate_removal') change.push({ code: 'low_adherence_with_low_contribution_or_recurrent_expiry' })
  if (e.isNew) keep.push({ code: 'new_product_not_penalised' })

  const limitations: string[] = [
    'Sales exist only as monthly aggregates; consumption between visits (from the balances) is the cycle signal.',
    'Consumption and sales come from the same point of sale: their agreement shows the data are aligned, not what is physically on the shelf.',
    'The balance is an ESTIMATE, never physical stock.',
    'No shelf life is recorded for any product: expiry attention rests only on recurring expired loss.',
    'Shelf capacity is not available: no capacity-limited alert is possible.',
  ]
  if (e.input.unitsPerPackage === null) limitations.push('Units per package are unknown: splitting alerts are off.')
  if (e.input.baselineIsOfRecord) limitations.push('The baseline of the time is unknown for this period; the baseline of record was used.')
  if (e.balance.tolerance.status !== 'within_tolerance') limitations.push(`Balance not released for balance-driven use: ${e.balance.gateReason ?? 'not verifiable'}.`)
  if (e.conflicts.length > 0) limitations.push(`Conflicting data: ${e.conflicts.map(c => c.code).join(', ')}.`)
  if (e.input.salesMonthsMissing.length > 0) limitations.push(`Sales not imported for: ${e.input.salesMonthsMissing.join(', ')}.`)
  if (e.demand.demandCensored) limitations.push('Frequent stock-outs: observed consumption is a lower bound of demand.')

  return { facts, evidenceToKeep: keep, evidenceToChange: change, limitations }
}

export { DAY_MS }
