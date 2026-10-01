import { runPair, type CoverageCategory, type PairResult } from '../engine/engine'
import type { PairInput } from '../engine/engine.types'
import type { Mix } from '../engine/mix'
import type { QuantityAction } from '../engine/quantity'
import type { Parameters } from '../parameters/parameters.types'
import { assessCoherence, type Assessment } from './coherence'
import type { AssessedAction, BacktestAction } from './backtest.types'
import { forecastObservation, type ForecastObservation } from './forecast-error'
import { followingFacts, followingMonths, type FollowFacts } from './following'
import { HistoryView, type BaselineAtOrigin } from './history-view'
import type { SensitivityEntry } from './sensitivity'

export interface ReplayContext {
  origins: Date[]
  /** The last instant the data covers (end of `dataThrough`); the last origin is evaluated up to it. */
  endOfData: Date
  /** The last month the data covers, YYYY-MM. */
  dataThrough: string
  parameters: Parameters
  /** The baseline in force at an origin according to the stored history, else the baseline of record (marked). */
  baselineAt: (sku: string, origin: Date) => BaselineAtOrigin
}

/** What the backtest keeps of one Product x Store at one origin. Compact on purpose: the engine's full result is not stored. */
export interface PairOutcome {
  origin: string
  storeId: number
  sku: string
  coverage: CoverageCategory
  mix: { value: Mix; reason: string }
  /** The engine's suggestion: `evaluate_removal` when the Mix says so, else the quantity action. */
  action: BacktestAction
  baseline: {
    quantity: number | null
    /** The stored baseline history does not reach this origin: the baseline of record stands in and the quantity of the time is unknown. */
    ofRecordQuantityOfTheTimeUnknown: boolean
  }
  quantity: { action: QuantityAction; baseline: number | null; target: number | null; intervalDays: number | null; qLow: number | null; qHigh: number | null; reason: string }
  demandRateAtOrigin: number | null
  following: Omit<FollowFacts, 'intervals'> & { followingIntervals: number }
  forecast: ForecastObservation | null
  assessments: Assessment[]
}

export interface PairObservation {
  key: string
  origin: string
  coverage: CoverageCategory
  /** Null when the pair had not enough data for a recommendation outcome (counted by its coverage category only). */
  outcome: PairOutcome | null
  sensitivity: SensitivityEntry
}

const hasActivity = (input: PairInput) =>
  input.visits.length > 0 || input.monthly.some(month => month.sold > 0 || month.restocked > 0 || Object.values(month.removals).some(units => (units ?? 0) > 0))

/**
 * Replays one Product x Store over every origin: the engine runs on data cut at
 * the origin (a `HistoryView`, so nothing later is read) and the result is set
 * beside what followed. The full history is loaded once by the caller.
 */
export function replayPair(full: PairInput, ctx: ReplayContext): { observations: PairObservation[]; view: HistoryView } {
  const view = new HistoryView(full)
  const observations: PairObservation[] = []

  ctx.origins.forEach((origin, index) => {
    const cut = view.at(origin, ctx.baselineAt(full.sku, origin))
    if (!hasActivity(cut)) return // the pair did not exist yet at this origin

    const nextOrigin = ctx.origins[index + 1] ?? null
    const result = runPair(cut)
    const key = `${origin.toISOString()}|${full.storeId}|${full.sku}`

    const sensitivity: SensitivityEntry = {
      origin: origin.toISOString(),
      asOf: origin,
      countedVisits: cut.visits.filter(visit => visit.confirmedCount !== null),
      isNew: result.exposure.restockCount <= ctx.parameters.pattern.newCycles,
      uncensoredObservations: result.exposure.uncensoredIntervals,
      minObservations: ctx.parameters.pattern.minObservations,
      conflicts: result.conflicts.length,
      everStocked: result.presence !== 'never_tested',
    }

    const outcome = result.coverage === 'insufficient_history' ? null : evaluate(full, cut, result, origin, nextOrigin, ctx)
    observations.push({ key, origin: origin.toISOString(), coverage: result.coverage, outcome, sensitivity })
  })

  return { observations, view }
}

function evaluate(full: PairInput, cut: PairInput, result: PairResult, origin: Date, nextOrigin: Date | null, ctx: ReplayContext): PairOutcome {
  const months = followingMonths(origin, nextOrigin, ctx.dataThrough)
  const periodEnd = nextOrigin ? new Date(nextOrigin.getTime() - 1) : ctx.endOfData
  const follow = followingFacts(full, origin, periodEnd, months)
  const forecast = forecastObservation(result.demand.rateMid, follow.intervals)
  const { intervals, ...followingRest } = follow

  const quantity = result.quantity
  const assessed: { action: AssessedAction; target: number | null }[] = []
  if (quantity.action !== 'no_evidence') assessed.push({ action: quantity.action, target: quantity.action === 'keep' ? quantity.from : quantity.to })
  if (result.mix.value === 'evaluate_removal') assessed.push({ action: 'evaluate_removal', target: null })

  const assessments = assessed.map(item =>
    assessCoherence({ action: item.action, baseline: cut.baseline, target: item.target, follow, originRate: result.demand.rateMid, parameters: ctx.parameters }),
  )

  return {
    origin: origin.toISOString(),
    storeId: full.storeId,
    sku: full.sku,
    coverage: result.coverage,
    mix: { value: result.mix.value, reason: result.mix.reason },
    action: result.mix.value === 'evaluate_removal' ? 'evaluate_removal' : quantity.action,
    baseline: { quantity: cut.baseline, ofRecordQuantityOfTheTimeUnknown: cut.baselineIsOfRecord },
    quantity: { action: quantity.action, baseline: quantity.from, target: quantity.to, intervalDays: quantity.intervalDays, qLow: quantity.qLow, qHigh: quantity.qHigh, reason: quantity.reason },
    demandRateAtOrigin: result.demand.rateMid,
    following: { ...followingRest, followingIntervals: intervals.length },
    forecast,
    assessments,
  }
}
