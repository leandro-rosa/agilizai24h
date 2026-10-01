import { ENGINE_VERSION } from '../engine/engine'
import { inputFromReal } from '../engine/engine.testing'
import { REAL_PAIRS } from '../engine/real-pairs.fixture'
import { DEFAULT_PARAMETERS } from '../parameters/parameters.defaults'
import { COVERAGE_CATEGORIES } from './coverage-report'
import { monthEnd, originsFor } from './history-view'
import { BacktestAccumulator, type BacktestReport } from './report'
import { replayPair } from './replay'
import { STANDING_LIMITATIONS } from './backtest.runner'
import { summarizeReport } from './summary'

/**
 * The whole replay on the compact REAL fixtures (10 real Product x Store pairs,
 * January to August 2026): no database, nothing synthetic.
 */
const ORIGINS = originsFor(new Date('2026-01-09T00:00:00Z'), '2026-08')
const CTX = {
  origins: ORIGINS,
  endOfData: new Date(monthEnd('2026-08') - 1),
  dataThrough: '2026-08',
  parameters: DEFAULT_PARAMETERS,
  // before the baseline existed: the baseline of record stands in, and says so
  baselineAt: () => ({ quantity: 12, ofRecord: true }),
}

function build(): { report: BacktestReport; accumulator: BacktestAccumulator; views: ReturnType<typeof replayPair>['view'][] } {
  const accumulator = new BacktestAccumulator(DEFAULT_PARAMETERS, ORIGINS)
  const views: ReturnType<typeof replayPair>['view'][] = []

  for (const pair of Object.values(REAL_PAIRS)) {
    const { observations, view } = replayPair(inputFromReal(pair, { baseline: 12 }), CTX)
    views.push(view)
    for (const observation of observations) accumulator.add(observation)
  }

  const report = accumulator.finish({
    engineVersion: ENGINE_VERSION,
    parameterVersionId: 1,
    request: { rangeFrom: '2026-01', rangeTo: '2026-08', dataThrough: '2026-08', asOf: '2026-09-01T00:00:00.000Z' },
    computedAt: new Date('2026-10-01T00:00:00Z'),
    limitations: STANDING_LIMITATIONS,
  })

  return { report, accumulator, views }
}

const walk = (value: unknown, visit: (key: string | null, value: unknown) => void, key: string | null = null): void => {
  visit(key, value)
  if (Array.isArray(value)) value.forEach(item => walk(item, visit, null))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, visit, k)
}

describe('backtest over real fixtures', () => {
  const { report, accumulator, views } = build()

  it('replays April to August', () => {
    expect(report.origins.map(origin => origin.slice(0, 10))).toEqual(['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'])
  })

  it('never reads a date at or after an origin for that origin', () => {
    // every pair's view was asked for all five origins; per origin the cut is strictly earlier
    for (const origin of ORIGINS) {
      for (const pair of Object.values(REAL_PAIRS)) {
        const cut = inputFromReal(pair, { baseline: 12 })
        const { observations } = replayPair(cut, { ...CTX, origins: [origin] })
        for (const o of observations) expect(o.sensitivity.countedVisits.every(visit => visit.endedAt.getTime() < origin.getTime())).toBe(true)
      }
    }
    for (const view of views) expect((view.latestDateRead as Date).getTime()).toBeLessThan(ORIGINS[ORIGINS.length - 1].getTime())
  })

  it('coverage: the five exclusive categories add up to the pairs considered, overall and per origin', () => {
    const c = report.coverage.overall
    expect(COVERAGE_CATEGORIES.reduce((sum, category) => sum + c.categories[category], 0)).toBe(c.total)
    expect(c.total).toBe(c.covers.pairs)
    expect(c.total).toBeGreaterThan(0)
    for (const row of report.coverage.byOrigin) expect(COVERAGE_CATEGORIES.reduce((sum, category) => sum + row.categories[category], 0)).toBe(row.total)
    expect(report.coverage.byOrigin.reduce((sum, row) => sum + row.total, 0)).toBe(c.total)
  })

  it('gives a recommendation outcome only to pairs outside insufficient history', () => {
    expect(accumulator.outcomes.length).toBe(report.coverage.overall.total - report.coverage.overall.categories.insufficient_history)
    expect(accumulator.outcomes.every(outcome => outcome.coverage !== 'insufficient_history')).toBe(true)
  })

  it('records, per outcome, the baseline, quantity, H, action, Mix and what followed', () => {
    const outcome = accumulator.outcomes[0]

    expect(outcome).toEqual(
      expect.objectContaining({
        baseline: expect.objectContaining({ quantity: 12, ofRecordQuantityOfTheTimeUnknown: true }),
        quantity: expect.objectContaining({ intervalDays: expect.anything() }),
        mix: expect.objectContaining({ value: expect.any(String) }),
        action: expect.any(String),
      }),
    )
    expect(outcome.following).toEqual(
      expect.objectContaining({ unitsSold: expect.any(Number), lostByReason: expect.any(Object), stockouts: expect.any(Number), cycles: expect.any(Array), economics: expect.any(Object) }),
    )
  })

  it('every aggregate states the origins, pairs and cycles it covers', () => {
    const sections: { covers: { origins: number; pairs: number; cycles: number } }[] = [
      report.coverage.overall,
      report.forecastError.overall,
      ...report.forecastError.byOrigin,
      ...Object.values(report.recommendations.byAction),
      report.recommendations.noEvidence,
      report.economics.overall,
      ...report.economics.byOrigin,
      report.sensitivity,
    ]

    for (const section of sections) expect(section.covers).toEqual({ origins: expect.any(Number), pairs: expect.any(Number), cycles: expect.any(Number) })
    expect(report.forecastError.overall.covers.pairs).toBe(accumulator.outcomes.length)
  })

  it('states the baseline-of-the-time limitation first and counts the results that depend on it', () => {
    expect(report.baselineOfTime.statement).toMatch(/QUANTITY OF THE TIME IS UNKNOWN/)
    expect(report.baselineOfTime.outcomesUsingBaselineOfRecord).toBe(accumulator.outcomes.length)
    expect(summarizeReport('x', report)).toMatch(/QUANTITY OF THE TIME[\s\S]*COVERAGE/)
  })

  it('the sensitivity report contains the configured defaults and no choice', () => {
    const configured = report.sensitivity.combinations.filter(combo => combo.configured)

    expect(configured).toHaveLength(1)
    expect(configured[0]).toMatchObject({ windowCounts: 3, minCounts: 1, maxAgeDays: 45 })
    expect(report.sensitivity.defaultsProvisional).toBe(true)
    expect(report.sensitivity.skippedCombinations.length).toBeGreaterThan(0)
    walk(report.sensitivity, key => {
      if (key !== null) expect(key).not.toMatch(/recommend|best|chosen|selected|winner|optimal/i)
    })
  })

  it('no key in the whole report reads like pass / fail / accepted / verdict / approved', () => {
    walk(report, key => {
      if (key !== null) expect(key).not.toMatch(/pass|fail|accept|verdict|approv|reject|threshold|frozen|score|grade/i)
    })
  })

  it('no wording in the report or its summary claims correctness, validation or approval', () => {
    const text: string[] = [summarizeReport('x', report)]
    walk(report, (_, value) => {
      if (typeof value === 'string') text.push(value)
    })

    // "coherent" is a descriptive class and must never be glossed as an approval
    for (const line of text) expect(line).not.toMatch(/\b(correct|proven|proof|validated|approved|accepted|verdict|would have worked|passed|failed|good|bad)\b/i)
    expect(report.notice.join(' ')).toMatch(/decides nothing/)
    expect(report.notice.join(' ')).toMatch(/only that the data that followed are compatible/)
  })

  it('every stored assessment is labelled an estimate and shows its criteria', () => {
    const assessments = accumulator.outcomes.flatMap(outcome => outcome.assessments)

    expect(assessments.length).toBeGreaterThan(0)
    for (const a of assessments) {
      expect(a.label).toBe('estimate')
      expect(a.criteria.length).toBeGreaterThan(0)
      expect(['coherent', 'incoherent', 'inconclusive']).toContain(a.class)
    }
  })

  it('counts per action are descriptive: the three classes add up to the assessments', () => {
    for (const section of Object.values(report.recommendations.byAction)) expect(section.classes.coherent + section.classes.incoherent + section.classes.inconclusive).toBe(section.assessed)
  })

  it('is deterministic: the same history gives the same report', () => {
    const again = build().report

    expect(JSON.stringify(again)).toBe(JSON.stringify(report))
  })

  it('the summary is readable text that holds no JSON braces and names its coverage', () => {
    const text = summarizeReport('abc', report)

    expect(text).toMatch(/^BACKTEST abc/)
    expect(text).toMatch(/\[\d+ origins, \d+ pairs, \d+ cycles\]/)
    expect(text).toMatch(/\* = the configured combination/)
    expect(text).not.toMatch(/[{}]/)
  })
})
