import type { Parameters } from '../parameters/parameters.types'
import type { AssessedAction, CoherenceClass, LossReasonKey } from './backtest.types'
import type { FollowFacts } from './following'

/**
 * Coherence of a recommendation with what followed (design D13).
 *
 * "Coherent" means ONLY that the data that followed are compatible with the
 * recommendation under the criteria listed beside it. History cannot be replayed
 * under another quantity, so nothing here says the recommendation was right or
 * would have worked, and every assessment is labelled an estimate.
 */

/** Cycles with attributed loss needed to call a loss recurring (shown in every "keep" assessment). */
export const RECURRING_LOSS_CYCLES = 2

export const COHERENCE_MEANING: Record<CoherenceClass, string> = {
  coherent: 'The data that followed are compatible with this recommendation under the criteria shown. This is an estimate and says nothing more.',
  incoherent: 'The data that followed point against this recommendation under the criteria shown. This is an estimate and says nothing more.',
  inconclusive: 'The data that followed do not settle this recommendation under the criteria shown (too little afterwards, or the criteria point in different directions). This is an estimate.',
}

export interface Criterion {
  code: string
  description: string
  value: number | boolean | null
  /** Which way this criterion points for the recommendation. */
  points: 'for' | 'against' | 'neutral'
}

/** For a reduction only: the evidence as SEPARATE figures — never combined into one score. */
export interface ReductionEvidence {
  lossesFollowed: Record<LossReasonKey, number> & { total: number }
  salesFollowedUnits: number
  followingCycles: number
  cyclesAboveTarget: number
  /** Upper bound: sum over cycles of min(loss in the cycle, baseline - target). */
  lossPotentiallyAvoidable: number
  /** Sum over cycles of units consumed above the target (censored cycles give a lower bound). */
  salesPotentiallyAtRisk: number
  headroom: number
}

export interface Assessment {
  action: AssessedAction
  class: CoherenceClass
  label: 'estimate'
  meaning: string
  /** A stable code for why, so a reader can reproduce the class. */
  reason: string
  followingCycles: number
  criteria: Criterion[]
  reduction?: ReductionEvidence
}

export interface CoherenceInput {
  action: AssessedAction
  baseline: number | null
  /** The quantity the engine suggested (equal to the baseline for keep). */
  target: number | null
  follow: FollowFacts
  /** Daily demand (median) the engine had at the origin. */
  originRate: number | null
  parameters: Pick<Parameters, 'backtest' | 'quantity' | 'mix'>
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

function done(base: Omit<Assessment, 'label' | 'meaning'>, cls: CoherenceClass, reason: string): Assessment {
  return { ...base, class: cls, reason, label: 'estimate', meaning: COHERENCE_MEANING[cls] }
}

export function assessCoherence(input: CoherenceInput): Assessment {
  const { follow, parameters: p } = input
  const base = { action: input.action, class: 'inconclusive' as CoherenceClass, reason: '', followingCycles: follow.cycles.length, criteria: [] as Criterion[] }

  const tooFew = follow.cycles.length < p.backtest.minFollowingCycles
  base.criteria.push({
    code: 'following_cycles_at_least_minimum',
    description: `Following cycles observed, against the minimum of ${p.backtest.minFollowingCycles}`,
    value: follow.cycles.length,
    points: tooFew ? 'neutral' : 'for',
  })

  if (tooFew) return done(base, 'inconclusive', 'too_few_following_cycles')

  switch (input.action) {
    case 'reduce':
      return assessReduce(input, base)
    case 'increase':
    case 'test':
      return assessIncrease(input, base)
    case 'keep':
      return assessKeep(input, base)
    case 'evaluate_removal':
      return assessRemoval(input, base)
  }
}

type Base = Omit<Assessment, 'label' | 'meaning'>

function assessReduce(input: CoherenceInput, base: Base): Assessment {
  const { baseline, target, follow, parameters: p } = input
  if (baseline === null || target === null) return done(base, 'inconclusive', 'baseline_or_target_missing')

  const headroom = Math.max(0, baseline - target)
  const above = follow.cycles.filter(cycle => cycle.consumption > target || (cycle.censored && cycle.startBalance > target))
  const lossAvoidable = sum(follow.cycles.map(cycle => Math.min(cycle.loss, headroom)))
  const atRisk = sum(follow.cycles.map(cycle => Math.max(0, cycle.consumption - target)))
  const material = above.length > 0 && (follow.unitsSold <= 0 || atRisk / follow.unitsSold >= p.backtest.salesAtRiskShare)

  const reduction: ReductionEvidence = {
    lossesFollowed: { ...follow.lostByReason, total: follow.lostUnits },
    salesFollowedUnits: follow.unitsSold,
    followingCycles: follow.cycles.length,
    cyclesAboveTarget: above.length,
    lossPotentiallyAvoidable: lossAvoidable,
    salesPotentiallyAtRisk: atRisk,
    headroom,
  }

  const withEvidence: Base & { reduction: ReductionEvidence } = {
    ...base,
    reduction,
    criteria: [
      ...base.criteria,
      { code: 'loss_potentially_avoidable_units', description: 'Units of loss that followed which the lower quantity could have avoided (upper bound, limited by baseline minus target)', value: lossAvoidable, points: lossAvoidable > 0 ? 'for' : 'neutral' },
      { code: 'cycles_with_demand_above_target', description: 'Following cycles whose consumption exceeded the suggested quantity (or that emptied the shelf with more stock than it)', value: above.length, points: above.length > 0 ? 'against' : 'for' },
      { code: 'sales_potentially_at_risk_units', description: `Units consumed above the suggested quantity; material when at least ${Math.round(p.backtest.salesAtRiskShare * 100)}% of units sold`, value: atRisk, points: material ? 'against' : 'neutral' },
    ],
  }

  if (lossAvoidable > 0 && !material) return done(withEvidence, 'coherent', 'loss_followed_and_demand_stayed_within_target')
  if (lossAvoidable > 0 && material) return done(withEvidence, 'inconclusive', 'conflicting_criteria_loss_and_demand_above_target')
  if (material) return done(withEvidence, 'incoherent', 'demand_above_target_without_loss_to_avoid')

  return done(withEvidence, 'inconclusive', 'no_loss_and_no_material_demand_above_target')
}

function assessIncrease(input: CoherenceInput, base: Base): Assessment {
  const { baseline, follow, originRate, parameters: p } = input
  if (baseline === null) return done(base, 'inconclusive', 'baseline_or_target_missing')

  const atBaseline = follow.cycles.filter(cycle => baseline > 0 && cycle.consumption >= baseline).length
  const stockouts = follow.cycles.filter(cycle => cycle.censored).length
  const supports = stockouts > 0 || atBaseline > 0
  const lowLoss = follow.restockedUnits > 0 ? follow.lostUnits / follow.restockedUnits <= p.quantity.lossLowShare : follow.lostUnits === 0
  const demandFell = follow.observedRate !== null && originRate !== null && follow.observedRate < originRate

  const criteria: Criterion[] = [
    ...base.criteria,
    { code: 'cycles_with_stockout', description: 'Following cycles in which the shelf emptied', value: stockouts, points: stockouts > 0 ? 'for' : 'neutral' },
    { code: 'cycles_with_consumption_at_or_above_baseline', description: 'Following cycles that consumed at least the baseline', value: atBaseline, points: atBaseline > 0 ? 'for' : 'neutral' },
    { code: 'loss_stayed_low', description: `Units lost against units restocked, at or below ${Math.round(p.quantity.lossLowShare * 100)}%`, value: lowLoss, points: lowLoss ? 'for' : 'against' },
    { code: 'demand_fell_against_origin', description: 'Observed daily consumption below the median rate the engine had at the origin', value: demandFell, points: demandFell ? 'against' : 'neutral' },
  ]

  const out = { ...base, criteria }
  if (supports && lowLoss) return done(out, 'coherent', 'stockout_or_consumption_at_baseline_with_low_loss')
  if (supports) return done(out, 'inconclusive', 'conflicting_criteria_shortage_and_loss')
  if (demandFell) return done(out, 'incoherent', 'no_stockout_and_demand_fell')

  return done(out, 'inconclusive', 'no_stockout_and_demand_did_not_fall')
}

function assessKeep(input: CoherenceInput, base: Base): Assessment {
  const { follow } = input
  const stockouts = follow.cycles.filter(cycle => cycle.censored).length
  const cyclesWithLoss = follow.cycles.filter(cycle => cycle.loss > 0).length
  const recurring = cyclesWithLoss >= RECURRING_LOSS_CYCLES

  const out: Base = {
    ...base,
    criteria: [
      ...base.criteria,
      { code: 'cycles_with_stockout', description: 'Following cycles in which the shelf emptied', value: stockouts, points: stockouts > 0 ? 'against' : 'for' },
      { code: 'recurring_loss', description: `Loss attributed to at least ${RECURRING_LOSS_CYCLES} following cycles`, value: recurring, points: recurring ? 'against' : 'for' },
    ],
  }

  if (stockouts === 0 && !recurring) return done(out, 'coherent', 'no_stockout_and_no_recurring_loss')
  if (stockouts > 0 && recurring) return done(out, 'incoherent', 'stockout_and_recurring_loss')

  return done(out, 'inconclusive', stockouts > 0 ? 'stockout_without_recurring_loss' : 'recurring_loss_without_stockout')
}

function assessRemoval(input: CoherenceInput, base: Base): Assessment {
  const { follow, parameters: p } = input
  const lowRate = p.mix.lowDemandPerWeek / 7
  const lowDemand = follow.observedRate === null ? null : follow.observedRate < lowRate
  const contribution = follow.economics.contributionCents
  const lowContribution = contribution === null ? null : contribution <= p.mix.lowContributionShare * follow.revenueCents

  const out: Base = {
    ...base,
    criteria: [
      ...base.criteria,
      { code: 'demand_stayed_low', description: `Observed daily consumption below ${p.mix.lowDemandPerWeek} unit(s) a week`, value: lowDemand, points: lowDemand === null ? 'neutral' : lowDemand ? 'for' : 'against' },
      { code: 'economic_result_stayed_low', description: `Margin minus cost of units lost at or below ${Math.round(p.mix.lowContributionShare * 100)}% of revenue (cost is one current version)`, value: lowContribution, points: lowContribution === null ? 'neutral' : lowContribution ? 'for' : 'against' },
    ],
  }

  if (lowDemand === true && lowContribution === true) return done(out, 'coherent', 'demand_and_economic_result_stayed_low')
  if (lowDemand === false && lowContribution === false) return done(out, 'incoherent', 'demand_and_economic_result_recovered')

  return done(out, 'inconclusive', lowDemand === null || lowContribution === null ? 'demand_or_economic_result_unknown' : 'demand_and_economic_result_point_in_different_directions')
}
