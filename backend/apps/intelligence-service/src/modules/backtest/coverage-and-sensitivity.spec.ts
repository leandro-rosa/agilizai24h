import { coverageCategory, type CoverageCategory } from '../engine/engine'
import type { VisitPoint } from '../engine/engine.types'
import { DEFAULT_PARAMETERS } from '../parameters/parameters.defaults'
import { buildCoverageReport, COVERAGE_CATEGORIES } from './coverage-report'
import { buildCombinations, configuredRules, SENSITIVITY_GRID, SensitivityAccumulator, type SensitivityEntry } from './sensitivity'

const visit = (at: string, balanceBefore: number, confirmedCount: number | null): VisitPoint => ({ endedAt: new Date(at), balanceBefore, confirmedCount, restocked: 0, removedTotal: 0, adjustment: 0, balanceAfter: balanceBefore })

describe('coverage report', () => {
  it('adds the five exclusive categories up to the total considered', () => {
    const entries = COVERAGE_CATEGORIES.flatMap((category, index) => Array.from({ length: index + 1 }, (_, n) => ({ key: `${category}|${n}`, category })))
    const report = buildCoverageReport(entries)

    expect(report.total).toBe(15)
    expect(COVERAGE_CATEGORIES.reduce((sum, category) => sum + report.categories[category], 0)).toBe(report.total)
    expect(report.analysable).toBe(3 + 4 + 5)
  })

  it('refuses to count a Product x Store twice', () => {
    expect(() =>
      buildCoverageReport([
        { key: '1|5012', category: 'conflicting_data' },
        { key: '1|5012', category: 'analysable_reliable_balance' },
      ]),
    ).toThrow(/more than once/)
  })

  it('puts conflicting data ahead of the balance status', () => {
    expect(coverageCategory({ isNew: false, uncensoredObservations: 9, minObservations: 3, conflicts: 1, tolerance: 'within_tolerance' })).toBe('conflicting_data')
  })

  it('puts insufficient history ahead of conflicts', () => {
    expect(coverageCategory({ isNew: true, uncensoredObservations: 9, minObservations: 3, conflicts: 2, tolerance: 'within_tolerance' })).toBe('insufficient_history')
  })

  it('splits the analysable ones by tolerance status', () => {
    const analysable = (tolerance: 'within_tolerance' | 'outside_tolerance' | 'not_verifiable'): CoverageCategory =>
      coverageCategory({ isNew: false, uncensoredObservations: 9, minObservations: 3, conflicts: 0, tolerance })

    expect(analysable('within_tolerance')).toBe('analysable_reliable_balance')
    expect(analysable('outside_tolerance')).toBe('analysable_unreliable_balance')
    expect(analysable('not_verifiable')).toBe('analysable_not_enough_counts')
  })
})

describe('count-rule sensitivity', () => {
  const configured = configuredRules(DEFAULT_PARAMETERS)

  it('covers the whole grid, skipping and listing the invalid combinations', () => {
    const { rules, skipped } = buildCombinations(configured)

    expect(rules).toHaveLength(4 * 3 * 4 * 3 - 3 * 12) // minCounts above windowCounts skipped: (1,2) (1,3) (2,3)
    expect(skipped.map(s => [s.windowCounts, s.minCounts])).toEqual([[1, 2], [1, 3], [2, 3]])
    expect(skipped.every(s => s.combinationsSkipped === 12 && s.reason.length > 0)).toBe(true)
  })

  it('marks the configured defaults as one of the combinations', () => {
    const { rules } = buildCombinations(configured)
    const marked = rules.filter(rule => rule.configured)

    expect(marked).toHaveLength(1)
    expect(marked[0]).toMatchObject({ windowCounts: 3, minCounts: 1, maxAgeDays: 45, tolerancePct: 0.1, toleranceUnits: 3, inGrid: true })
  })

  it('adds the configured rules when they are not on the grid, marked as off-grid', () => {
    const { rules } = buildCombinations({ windowCounts: 4, minCounts: 2, maxAgeDays: 50, tolerancePct: 0.1, toleranceUnits: 3 })

    expect(rules.filter(rule => rule.configured)).toEqual([expect.objectContaining({ windowCounts: 4, inGrid: false })])
  })

  it('the grid is exactly the one considered', () => {
    expect(SENSITIVITY_GRID.windowCounts).toEqual([1, 2, 3, 5])
    expect(SENSITIVITY_GRID.minCounts).toEqual([1, 2, 3])
    expect(SENSITIVITY_GRID.maxAgeDays).toEqual([30, 45, 60, 90])
    expect(SENSITIVITY_GRID.tolerance).toEqual([{ pct: 0.05, units: 2 }, { pct: 0.1, units: 3 }, { pct: 0.15, units: 5 }])
  })

  const entry = (over: Partial<SensitivityEntry>): SensitivityEntry => ({
    origin: '2026-06-01T00:00:00.000Z',
    asOf: new Date('2026-06-01T00:00:00Z'),
    countedVisits: [],
    isNew: false,
    uncensoredObservations: 9,
    minObservations: 3,
    conflicts: 0,
    everStocked: true,
    ...over,
  })

  it('recomputes the split on the same data and every cell adds up to the pairs added', () => {
    const acc = new SensitivityAccumulator(configured)
    // a fresh in-tolerance count, a stale one, an out-of-tolerance one, none, a conflicting one, a new product
    acc.add(entry({ countedVisits: [visit('2026-05-25T00:00:00Z', 10, 10)] }))
    acc.add(entry({ countedVisits: [visit('2026-03-01T00:00:00Z', 10, 10)] }))
    acc.add(entry({ countedVisits: [visit('2026-05-25T00:00:00Z', 10, 30)] }))
    acc.add(entry({}))
    acc.add(entry({ countedVisits: [visit('2026-05-25T00:00:00Z', 10, 10)], conflicts: 1 }))
    acc.add(entry({ isNew: true }))
    const { combinations } = acc.finish()
    const defaults = combinations.find(combo => combo.configured)!

    expect(defaults.overall.coverage.total).toBe(6)
    expect(defaults.overall.tolerance.within_tolerance + defaults.overall.tolerance.outside_tolerance + defaults.overall.tolerance.not_verifiable).toBe(6)
    expect(defaults.overall.coverage.categories).toMatchObject({ analysable_reliable_balance: 1, analysable_unreliable_balance: 1, analysable_not_enough_counts: 2, conflicting_data: 1, insufficient_history: 1 })
    // the conflicting pair is within tolerance yet does not release the gate
    expect(defaults.overall.tolerance.within_tolerance).toBe(2)
    expect(defaults.overall.gateReleases).toBe(1)

    for (const combo of combinations) expect(combo.overall.coverage.total).toBe(6)
  })

  it('a longer maximum age and a wider tolerance release at least as many as stricter ones', () => {
    const acc = new SensitivityAccumulator(configured)
    acc.add(entry({ countedVisits: [visit('2026-04-20T00:00:00Z', 10, 10)] })) // 42 days old
    acc.add(entry({ countedVisits: [visit('2026-05-25T00:00:00Z', 20, 25)] })) // 5 off: only the 15% / 5u rule takes it

    const { combinations } = acc.finish()
    const pick = (maxAgeDays: number, tolerancePct: number) => combinations.find(c => c.windowCounts === 3 && c.minCounts === 1 && c.maxAgeDays === maxAgeDays && c.tolerancePct === tolerancePct)!

    expect(pick(30, 0.1).overall.gateReleases).toBe(0) // the 42-day-old count is too old for 30 days; the 5-unit one is out at 10% / 3u
    expect(pick(45, 0.1).overall.gateReleases).toBe(1)
    expect(pick(45, 0.15).overall.gateReleases).toBe(2)
  })

  it('reports and selects nothing: no key reads like a choice', () => {
    const acc = new SensitivityAccumulator(configured)
    acc.add(entry({}))
    const keys = JSON.stringify(acc.finish(), (_, v) => v).match(/"[A-Za-z_]+":/g)!.join('')

    expect(keys).not.toMatch(/recommend|best|chosen|selected|winner|optimal|verdict/i)
  })

  it('keeps the latest origin apart from the overall tally', () => {
    const acc = new SensitivityAccumulator(configured)
    acc.add(entry({ origin: '2026-05-01T00:00:00.000Z' }))
    acc.add(entry({ origin: '2026-06-01T00:00:00.000Z' }))
    acc.add(entry({ origin: '2026-06-01T00:00:00.000Z' }))
    const combo = acc.finish().combinations[0]

    expect(combo.overall.coverage.total).toBe(3)
    expect(combo.latestOrigin.coverage.total).toBe(2)
  })
})
