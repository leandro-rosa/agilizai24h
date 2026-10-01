import { COVERAGE_CATEGORIES } from './coverage-report'
import type { BacktestReport } from './report'

const pct = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`)
const reais = (cents: number) => `R$ ${(cents / 100).toFixed(2)}`
const day = (iso: string) => iso.slice(0, 10)
const covers = (c: { origins: number; pairs: number; cycles: number }) => `[${c.origins} origins, ${c.pairs} pairs, ${c.cycles} cycles]`

/**
 * A readable plain-text rendering of a stored report. It only formats what the
 * report holds: it adds no judgement, no pass mark and no recommendation.
 */
export function summarizeReport(id: string, report: BacktestReport): string {
  const lines: string[] = []
  const add = (text = '') => lines.push(text)

  add(`BACKTEST ${id}`)
  add(`Engine ${report.engineVersion}, parameter version ${report.parameterVersionId}. Data through ${report.request.dataThrough}. Computed ${report.computedAt}.`)
  add(`Origins replayed: ${report.origins.map(day).join(', ') || 'none'}.`)
  add()
  for (const line of report.notice) add(line)
  add()
  add('QUANTITY OF THE TIME')
  add(report.baselineOfTime.statement)
  add(`${report.baselineOfTime.outcomesUsingBaselineOfRecord} of ${report.baselineOfTime.outcomes} recorded outcomes use the baseline of record.`)

  add()
  add(`COVERAGE ${covers(report.coverage.overall.covers)}`)
  add(report.coverage.statement)
  for (const category of COVERAGE_CATEGORIES) add(`  ${category}: ${report.coverage.overall.categories[category]}`)
  add(`  total considered: ${report.coverage.overall.total} (analysable: ${report.coverage.overall.analysable})`)
  for (const row of report.coverage.byOrigin) add(`  ${day(row.origin)}: total ${row.total}, analysable ${row.analysable}`)

  add()
  add(`DEMAND FORECAST ERROR ${covers(report.forecastError.overall.covers)}`)
  add(report.forecastError.definition)
  const fe = report.forecastError.overall
  add(`  weighted absolute error: ${pct(fe.wape)} over ${fe.pairs} pairs (predicted ${fe.predictedUnits.toFixed(0)} units, observed ${fe.observedUnits.toFixed(0)} units)`)
  add(`  censored intervals counted apart and left out: ${fe.censoredIntervals} (lower bound ${fe.censoredLowerBoundUnits.toFixed(0)} units)`)
  for (const row of report.forecastError.byOrigin) add(`  ${day(row.origin)}: ${pct(row.wape)} over ${row.pairs} pairs`)

  add()
  add('COMPATIBILITY OF RECOMMENDATIONS WITH WHAT FOLLOWED (estimates)')
  const c = report.recommendations.criteria
  add(`Criteria: at least ${c.minFollowingCycles} following cycles; sales at risk material from ${pct(c.salesAtRiskShare)} of units sold; loss recurring from ${c.recurringLossCycles} cycles; low loss up to ${pct(c.lossLowShare)} of units restocked.`)
  add(`  coherent: ${report.recommendations.meaning.coherent}`)
  add(`  incoherent: ${report.recommendations.meaning.incoherent}`)
  add(`  inconclusive: ${report.recommendations.meaning.inconclusive}`)
  for (const [action, section] of Object.entries(report.recommendations.byAction)) {
    add()
    add(`  ${action} ${covers(section.covers)}: coherent ${section.classes.coherent}, incoherent ${section.classes.incoherent}, inconclusive ${section.classes.inconclusive}`)
    for (const [reason, count] of Object.entries(section.reasons)) add(`      ${reason}: ${count}`)
    if (section.reduction) {
      const r = section.reduction
      add('      evidence shown separately, never as one score:')
      add(`        losses that followed: ${r.lossesFollowed.total} units (expired ${r.lossesFollowed.expired}, damaged ${r.lossesFollowed.damaged_product}, other ${r.lossesFollowed.other_reason})`)
      add(`        sales that followed: ${r.salesFollowedUnits} units`)
      add(`        following cycles in which demand exceeded the suggested quantity: ${r.cyclesAboveTarget} of ${r.followingCycles}`)
      add(`        loss units potentially avoidable (upper bound, estimate): ${r.lossPotentiallyAvoidable.toFixed(0)}`)
      add(`        sales units potentially at risk (estimate): ${r.salesPotentiallyAtRisk.toFixed(0)}`)
    }
  }
  add(`  no suggestion to assess ${covers(report.recommendations.noEvidence.covers)}`)

  add()
  const e = report.economics.overall
  add(`ECONOMIC RESULT OF THE FOLLOWING PERIODS ${covers(e.covers)}`)
  add(report.economics.note)
  add(`  sold ${e.unitsSold} units, revenue ${reais(e.revenueCents)}, margin ${reais(e.marginCents)}`)
  add(`  lost ${e.lostUnits} units (expired ${e.lostByReason.expired}, damaged ${e.lostByReason.damaged_product}, other ${e.lostByReason.other_reason}), cost of loss ${reais(e.lossCostCents)}`)
  add(`  economic result ${reais(e.economicResultCents)}; stock-outs (censored intervals) ${e.stockouts}; pairs without cost: ${e.pairsWithoutCost}`)

  add()
  const s = report.sensitivity
  add(`COUNT-RULE SENSITIVITY ${covers(s.covers)}`)
  add(s.note)
  add(`  configured: ${s.configured.windowCounts} counts considered, ${s.configured.minCounts} minimum, ${s.configured.maxAgeDays} days, tolerance ${pct(s.configured.tolerancePct)} or ${s.configured.toleranceUnits} units (provisional)`)
  add(`  ${s.combinations.length} combinations computed, ${s.skippedCombinations.length} count pairs skipped as invalid (minimum counts above counts considered).`)
  add('  counts considered / minimum / max age / tolerance: within, outside, not verifiable | gate releases | reliable, unreliable, not enough counts (all origins)')
  for (const combo of s.combinations) {
    const t = combo.overall.tolerance
    add(
      `  ${combo.configured ? '* ' : '  '}${combo.windowCounts} / ${combo.minCounts} / ${combo.maxAgeDays}d / ${pct(combo.tolerancePct)} or ${combo.toleranceUnits}u: ` +
        `${t.within_tolerance}, ${t.outside_tolerance}, ${t.not_verifiable} | ${combo.overall.gateReleases} | ` +
        `${combo.overall.coverage.categories.analysable_reliable_balance}, ${combo.overall.coverage.categories.analysable_unreliable_balance}, ${combo.overall.coverage.categories.analysable_not_enough_counts}`,
    )
  }
  add('  (* = the configured combination)')

  add()
  add('LIMITATIONS')
  for (const limitation of report.limitations) add(`  - ${limitation}`)

  return lines.join('\n')
}
