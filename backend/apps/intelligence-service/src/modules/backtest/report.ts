import type { CoverageCategory } from '../engine/engine'
import type { Parameters } from '../parameters/parameters.types'
import { BACKTEST_SCHEMA_VERSION, LOSS_REASON_KEYS, type AssessedAction, type BacktestAction, type CoherenceClass, type FigureCoverage, type LossReasonKey } from './backtest.types'
import { COHERENCE_MEANING, RECURRING_LOSS_CYCLES } from './coherence'
import { emptyCategories, reportFromCounts, type CoverageReport } from './coverage-report'
import { aggregateForecastError, type ForecastError, type ForecastObservation } from './forecast-error'
import type { PairObservation, PairOutcome } from './replay'
import { SensitivityAccumulator, configuredRules, type SensitivityCombination, type SkippedCombination } from './sensitivity'

export interface Totals {
  covers: FigureCoverage
  unitsSold: number
  revenueCents: number
  lostByReason: Record<LossReasonKey, number>
  lostUnits: number
  stockouts: number
  /** Sum over pairs whose cost is known; pairs without a cost are counted apart, never valued at zero. */
  marginCents: number
  lossCostCents: number
  /** Margin minus cost of units lost; each lost unit once, never netted against sold units. */
  economicResultCents: number
  pairsWithoutCost: number
}

export interface ActionSection {
  covers: FigureCoverage
  assessed: number
  /** Descriptive counts of the three classes. Not a score and not a pass mark. */
  classes: Record<CoherenceClass, number>
  reasons: Record<string, number>
  /** For reductions only: the evidence as separate totals. */
  reduction?: {
    lossesFollowed: Record<LossReasonKey, number> & { total: number }
    salesFollowedUnits: number
    cyclesAboveTarget: number
    followingCycles: number
    lossPotentiallyAvoidable: number
    salesPotentiallyAtRisk: number
  }
  following: Totals
}

export interface BacktestReport {
  schemaVersion: number
  status: 'completed'
  computedAt: string
  engineVersion: string
  parameterVersionId: number
  request: { rangeFrom: string; rangeTo: string; dataThrough: string; asOf: string }
  origins: string[]
  notice: string[]
  /** Stated first and prominently: the quantity of the time is unknown for most of the history. */
  baselineOfTime: { statement: string; outcomes: number; outcomesUsingBaselineOfRecord: number; byOrigin: { origin: string; outcomes: number; outcomesUsingBaselineOfRecord: number }[] }
  limitations: string[]
  coverage: {
    statement: string
    overall: CoverageReport & { covers: FigureCoverage }
    byOrigin: (CoverageReport & { origin: string })[]
  }
  forecastError: {
    definition: string
    overall: ForecastError & { covers: FigureCoverage }
    byOrigin: (ForecastError & { origin: string; covers: FigureCoverage })[]
  }
  recommendations: {
    meaning: Record<CoherenceClass, string>
    criteria: { minFollowingCycles: number; salesAtRiskShare: number; recurringLossCycles: number; lossLowShare: number; lowDemandPerWeek: number; lowContributionShare: number }
    byAction: Partial<Record<AssessedAction, ActionSection>>
    noEvidence: { covers: FigureCoverage; following: Totals }
  }
  economics: { note: string; overall: Totals; byOrigin: (Totals & { origin: string })[] }
  sensitivity: {
    note: string
    defaultsProvisional: true
    covers: FigureCoverage
    configured: { windowCounts: number; minCounts: number; maxAgeDays: number; tolerancePct: number; toleranceUnits: number }
    combinations: SensitivityCombination[]
    skippedCombinations: SkippedCombination[]
  }
}

export const REPORT_NOTICE = [
  'This report decides nothing: it fixes no threshold, changes no parameter and gives no pass mark. It is read with the owner.',
  'Every coherence class is an estimate. "Coherent" means only that the data that followed are compatible with the recommendation under the criteria shown beside it.',
  'History cannot be replayed under another quantity, so nothing here shows what would have happened had a recommendation been followed.',
]

export const BASELINE_OF_TIME_STATEMENT =
  'THE QUANTITY OF THE TIME IS UNKNOWN: the stored baseline history starts when the baseline was first imported (September 2026) and the inventory par level is a single snapshot, ' +
  'so for origins before that the baseline of record stands in for the quantity in force then. Every result marked "ofRecordQuantityOfTheTimeUnknown" depends on it; read those figures accordingly.'

const emptyTotals = (): Totals => ({
  covers: { origins: 0, pairs: 0, cycles: 0 },
  unitsSold: 0,
  revenueCents: 0,
  lostByReason: { expired: 0, damaged_product: 0, other_reason: 0 },
  lostUnits: 0,
  stockouts: 0,
  marginCents: 0,
  lossCostCents: 0,
  economicResultCents: 0,
  pairsWithoutCost: 0,
})

/** Folds outcomes into totals, counting the origins they span. */
class TotalsBuilder {
  readonly totals = emptyTotals()
  private readonly origins = new Set<string>()

  add(outcome: PairOutcome): void {
    const f = outcome.following
    const t = this.totals
    this.origins.add(outcome.origin)
    t.covers.pairs++
    t.covers.cycles += f.cycles.length
    t.unitsSold += f.unitsSold
    t.revenueCents += f.revenueCents
    for (const reason of LOSS_REASON_KEYS) t.lostByReason[reason] += f.lostByReason[reason]
    t.lostUnits += f.lostUnits
    t.stockouts += f.stockouts
    if (f.economics.marginCents === null || f.economics.lossCostCents === null || f.economics.contributionCents === null) t.pairsWithoutCost++
    else {
      t.marginCents += f.economics.marginCents
      t.lossCostCents += f.economics.lossCostCents
      t.economicResultCents += f.economics.contributionCents
    }
  }

  build(): Totals {
    return { ...this.totals, covers: { ...this.totals.covers, origins: this.origins.size } }
  }
}

class ActionBuilder {
  readonly following = new TotalsBuilder()
  classes: Record<CoherenceClass, number> = { coherent: 0, incoherent: 0, inconclusive: 0 }
  reasons: Record<string, number> = {}
  assessed = 0
  cycles = 0
  private readonly origins = new Set<string>()
  reduction = { lossesFollowed: { expired: 0, damaged_product: 0, other_reason: 0, total: 0 }, salesFollowedUnits: 0, cyclesAboveTarget: 0, followingCycles: 0, lossPotentiallyAvoidable: 0, salesPotentiallyAtRisk: 0 }

  add(outcome: PairOutcome, action: AssessedAction): void {
    const assessment = outcome.assessments.find(a => a.action === action)
    if (!assessment) return

    this.following.add(outcome)
    this.origins.add(outcome.origin)
    this.assessed++
    this.cycles += assessment.followingCycles
    this.classes[assessment.class]++
    this.reasons[assessment.reason] = (this.reasons[assessment.reason] ?? 0) + 1

    if (assessment.reduction) {
      const r = assessment.reduction
      for (const reason of LOSS_REASON_KEYS) this.reduction.lossesFollowed[reason] += r.lossesFollowed[reason]
      this.reduction.lossesFollowed.total += r.lossesFollowed.total
      this.reduction.salesFollowedUnits += r.salesFollowedUnits
      this.reduction.cyclesAboveTarget += r.cyclesAboveTarget
      this.reduction.followingCycles += r.followingCycles
      this.reduction.lossPotentiallyAvoidable += r.lossPotentiallyAvoidable
      this.reduction.salesPotentiallyAtRisk += r.salesPotentiallyAtRisk
    }
  }

  build(action: AssessedAction): ActionSection {
    return {
      covers: { origins: this.origins.size, pairs: this.assessed, cycles: this.cycles },
      assessed: this.assessed,
      classes: this.classes,
      reasons: this.reasons,
      ...(action === 'reduce' ? { reduction: this.reduction } : {}),
      following: this.following.build(),
    }
  }
}

const ASSESSED: AssessedAction[] = ['keep', 'reduce', 'increase', 'test', 'evaluate_removal']

/**
 * Folds the observations of every store and origin into the stored report. Holds
 * counts, not the engine's full results, so a whole network fits in memory.
 */
export class BacktestAccumulator {
  private readonly coverageSeen = new Set<string>()
  private readonly coverageOverall = emptyCategories()
  private readonly coverageByOrigin = new Map<string, Record<CoverageCategory, number>>()
  private readonly forecastOverall: (ForecastObservation | null)[] = []
  private readonly forecastByOrigin = new Map<string, (ForecastObservation | null)[]>()
  private readonly economicsOverall = new TotalsBuilder()
  private readonly economicsByOrigin = new Map<string, TotalsBuilder>()
  private readonly actions = new Map<AssessedAction, ActionBuilder>(ASSESSED.map(action => [action, new ActionBuilder()]))
  private readonly noEvidence = new TotalsBuilder()
  private readonly baselineByOrigin = new Map<string, { outcomes: number; record: number }>()
  private readonly sensitivity: SensitivityAccumulator
  private sensitivityCycles = 0
  private sensitivityPairs = 0
  private readonly sensitivityOrigins = new Set<string>()
  readonly outcomes: PairOutcome[] = []

  constructor(
    private readonly parameters: Parameters,
    private readonly origins: Date[],
  ) {
    this.sensitivity = new SensitivityAccumulator(configuredRules(parameters))
  }

  add(observation: PairObservation): void {
    if (this.coverageSeen.has(observation.key)) throw new Error(`Backtest: ${observation.key} observed twice`)
    this.coverageSeen.add(observation.key)

    this.coverageOverall[observation.coverage]++
    const forOrigin = this.coverageByOrigin.get(observation.origin) ?? emptyCategories()
    forOrigin[observation.coverage]++
    this.coverageByOrigin.set(observation.origin, forOrigin)

    this.sensitivity.add(observation.sensitivity)
    this.sensitivityPairs++
    this.sensitivityOrigins.add(observation.origin)

    const outcome = observation.outcome
    if (!outcome) return

    this.sensitivityCycles += outcome.following.cycles.length
    this.outcomes.push(outcome)

    this.forecastOverall.push(outcome.forecast)
    const forecasts = this.forecastByOrigin.get(outcome.origin) ?? []
    forecasts.push(outcome.forecast)
    this.forecastByOrigin.set(outcome.origin, forecasts)

    this.economicsOverall.add(outcome)
    const economics = this.economicsByOrigin.get(outcome.origin) ?? new TotalsBuilder()
    economics.add(outcome)
    this.economicsByOrigin.set(outcome.origin, economics)

    const baseline = this.baselineByOrigin.get(outcome.origin) ?? { outcomes: 0, record: 0 }
    baseline.outcomes++
    if (outcome.baseline.ofRecordQuantityOfTheTimeUnknown) baseline.record++
    this.baselineByOrigin.set(outcome.origin, baseline)

    if (outcome.assessments.length === 0) this.noEvidence.add(outcome)
    for (const assessment of outcome.assessments) this.actions.get(assessment.action)?.add(outcome, assessment.action)
  }

  finish(meta: { engineVersion: string; parameterVersionId: number; request: BacktestReport['request']; computedAt: Date; limitations: string[] }): BacktestReport {
    const origins = this.origins.map(origin => origin.toISOString())
    const cyclesOf = (outcomes: PairOutcome[]) => outcomes.reduce((sum, outcome) => sum + outcome.following.cycles.length, 0)
    const coversFor = (outcomes: PairOutcome[]): FigureCoverage => ({ origins: new Set(outcomes.map(o => o.origin)).size, pairs: outcomes.length, cycles: cyclesOf(outcomes) })

    const sensitivity = this.sensitivity.finish()
    const baselineRows = origins.map(origin => ({ origin, outcomes: this.baselineByOrigin.get(origin)?.outcomes ?? 0, outcomesUsingBaselineOfRecord: this.baselineByOrigin.get(origin)?.record ?? 0 }))

    const byAction: BacktestReport['recommendations']['byAction'] = {}
    for (const action of ASSESSED) {
      const builder = this.actions.get(action) as ActionBuilder
      if (builder.assessed > 0) byAction[action] = builder.build(action)
    }

    const p = this.parameters
    const noEvidence = this.noEvidence.build()

    return {
      schemaVersion: BACKTEST_SCHEMA_VERSION,
      status: 'completed',
      computedAt: meta.computedAt.toISOString(),
      engineVersion: meta.engineVersion,
      parameterVersionId: meta.parameterVersionId,
      request: meta.request,
      origins,
      notice: REPORT_NOTICE,
      baselineOfTime: {
        statement: BASELINE_OF_TIME_STATEMENT,
        outcomes: this.outcomes.length,
        outcomesUsingBaselineOfRecord: baselineRows.reduce((sum, row) => sum + row.outcomesUsingBaselineOfRecord, 0),
        byOrigin: baselineRows,
      },
      limitations: meta.limitations,
      coverage: {
        statement:
          'Every Product x Store at every origin falls in exactly one of five categories, which add up to the total considered. Only pairs outside "insufficient_history" are given a recommendation outcome.',
        overall: { ...reportFromCounts(this.coverageOverall), covers: { origins: this.coverageByOrigin.size, pairs: this.coverageSeen.size, cycles: cyclesOf(this.outcomes) } },
        byOrigin: origins.map(origin => ({ origin, ...reportFromCounts(this.coverageByOrigin.get(origin) ?? emptyCategories()) })),
      },
      forecastError: {
        definition:
          'Predicted consumption for the period (median daily rate at the origin x days of the uncensored intervals that ended in it) against the consumption observed between visits. ' +
          'The single metric is the weighted absolute percentage error: sum of absolute differences divided by units observed. Censored intervals (shelf emptied) are counted apart and left out.',
        overall: { ...aggregateForecastError(this.forecastOverall), covers: coversFor(this.outcomes) },
        byOrigin: origins.map(origin => {
          const outcomes = this.outcomes.filter(outcome => outcome.origin === origin)
          return { origin, ...aggregateForecastError(this.forecastByOrigin.get(origin) ?? []), covers: coversFor(outcomes) }
        }),
      },
      recommendations: {
        meaning: COHERENCE_MEANING,
        criteria: {
          minFollowingCycles: p.backtest.minFollowingCycles,
          salesAtRiskShare: p.backtest.salesAtRiskShare,
          recurringLossCycles: RECURRING_LOSS_CYCLES,
          lossLowShare: p.quantity.lossLowShare,
          lowDemandPerWeek: p.mix.lowDemandPerWeek,
          lowContributionShare: p.mix.lowContributionShare,
        },
        byAction,
        noEvidence: { covers: noEvidence.covers, following: noEvidence },
      },
      economics: {
        note: 'Economic result = margin on units sold minus the cost of units lost (expired, damaged, other reason). Each lost unit is counted once and never netted against units sold. Margin uses the single current cost version.',
        overall: this.economicsOverall.build(),
        byOrigin: origins.map(origin => ({ origin, ...(this.economicsByOrigin.get(origin) ?? new TotalsBuilder()).build() })),
      },
      sensitivity: {
        note:
          'The same data recomputed under alternative count rules. This table selects and recommends nothing; the configured values (3 counts considered, 1 minimum, 45 days) stay provisional until the owner has read it. ' +
          'Combinations whose minimum counts exceed the counts considered are skipped and listed.',
        defaultsProvisional: true,
        covers: { origins: this.sensitivityOrigins.size, pairs: this.sensitivityPairs, cycles: this.sensitivityCycles },
        configured: configuredRules(p),
        combinations: sensitivity.combinations,
        skippedCombinations: sensitivity.skipped,
      },
    }
  }
}

export type { BacktestAction }
