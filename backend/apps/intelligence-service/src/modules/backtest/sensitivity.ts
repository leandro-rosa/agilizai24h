import { classifyTolerance, type ToleranceStatus } from '../engine/balance'
import { coverageCategory, type CoverageCategory } from '../engine/engine'
import type { VisitPoint } from '../engine/engine.types'
import type { Parameters } from '../parameters/parameters.types'
import { emptyCategories, reportFromCounts, type CoverageReport } from './coverage-report'

/** Values considered for the count rules. The grid is a question put to the data; it picks nothing. */
export const SENSITIVITY_GRID = {
  windowCounts: [1, 2, 3, 5],
  minCounts: [1, 2, 3],
  maxAgeDays: [30, 45, 60, 90],
  tolerance: [
    { pct: 0.05, units: 2 },
    { pct: 0.1, units: 3 },
    { pct: 0.15, units: 5 },
  ],
} as const

export interface SensitivityRules {
  windowCounts: number
  minCounts: number
  maxAgeDays: number
  tolerancePct: number
  toleranceUnits: number
}

/** The slice of an engine result the count rules can change; everything else is fixed per pair. */
export interface SensitivityEntry {
  origin: string
  asOf: Date
  /** Visits that carried a count, before the origin. */
  countedVisits: VisitPoint[]
  isNew: boolean
  uncensoredObservations: number
  minObservations: number
  conflicts: number
  everStocked: boolean
}

export interface SensitivityCell {
  coverage: CoverageReport
  tolerance: Record<ToleranceStatus, number>
  /** Pairs whose balance gate would release (within tolerance, no conflict, ever stocked). */
  gateReleases: number
}

export interface SensitivityCombination extends SensitivityRules {
  /** True for the combination currently configured (also added when it is not on the grid). */
  configured: boolean
  inGrid: boolean
  overall: SensitivityCell
  latestOrigin: SensitivityCell
}

export interface SkippedCombination {
  windowCounts: number
  minCounts: number
  combinationsSkipped: number
  reason: string
}

const sameRules = (a: SensitivityRules, b: SensitivityRules) =>
  a.windowCounts === b.windowCounts && a.minCounts === b.minCounts && a.maxAgeDays === b.maxAgeDays && a.tolerancePct === b.tolerancePct && a.toleranceUnits === b.toleranceUnits

export function configuredRules(parameters: Parameters): SensitivityRules {
  const t = parameters.tolerance
  return { windowCounts: t.windowCounts, minCounts: t.minCounts, maxAgeDays: t.maxAgeDays, tolerancePct: t.pct, toleranceUnits: t.units }
}

/**
 * Every valid combination of the grid, plus the configured rules when they are
 * not on it, and the combinations skipped because `minCounts` exceeds
 * `windowCounts` (no balance could ever be verified) — reported, never dropped silently.
 */
export function buildCombinations(configured: SensitivityRules): { rules: (SensitivityRules & { configured: boolean; inGrid: boolean })[]; skipped: SkippedCombination[] } {
  const rules: (SensitivityRules & { configured: boolean; inGrid: boolean })[] = []
  const skipped: SkippedCombination[] = []

  for (const windowCounts of SENSITIVITY_GRID.windowCounts) {
    for (const minCounts of SENSITIVITY_GRID.minCounts) {
      if (minCounts > windowCounts) {
        skipped.push({
          windowCounts,
          minCounts,
          combinationsSkipped: SENSITIVITY_GRID.maxAgeDays.length * SENSITIVITY_GRID.tolerance.length,
          reason: 'minimum counts exceeds the counts considered, so no balance could ever be verified',
        })
        continue
      }
      for (const maxAgeDays of SENSITIVITY_GRID.maxAgeDays) {
        for (const tolerance of SENSITIVITY_GRID.tolerance) {
          const candidate = { windowCounts, minCounts, maxAgeDays, tolerancePct: tolerance.pct, toleranceUnits: tolerance.units }
          rules.push({ ...candidate, configured: sameRules(candidate, configured), inGrid: true })
        }
      }
    }
  }

  if (!rules.some(rule => rule.configured)) rules.push({ ...configured, configured: true, inGrid: false })

  return { rules, skipped }
}

const toleranceParams = (rules: SensitivityRules): Parameters['tolerance'] => ({
  pct: rules.tolerancePct,
  units: rules.toleranceUnits,
  windowCounts: rules.windowCounts,
  minCounts: rules.minCounts,
  maxAgeDays: rules.maxAgeDays,
})

interface Tally {
  categories: Record<CoverageCategory, number>
  tolerance: Record<ToleranceStatus, number>
  gate: number
}

const emptyTally = (): Tally => ({ categories: emptyCategories(), tolerance: { within_tolerance: 0, outside_tolerance: 0, not_verifiable: 0 }, gate: 0 })

const toCell = (tally: Tally): SensitivityCell => ({ coverage: reportFromCounts(tally.categories), tolerance: { ...tally.tolerance }, gateReleases: tally.gate })

/**
 * Recomputes the coverage split and the gate-release count for every combination
 * on the SAME data, one pair at a time, without re-running the engine: only the
 * tolerance status depends on the count rules, and the engine's own
 * `classifyTolerance` and `coverageCategory` are reused so the numbers cannot drift.
 * It reports and selects nothing.
 */
export class SensitivityAccumulator {
  private readonly combos: { rules: SensitivityRules & { configured: boolean; inGrid: boolean }; overall: Tally; byOrigin: Map<string, Tally> }[]
  readonly skipped: SkippedCombination[]
  private latest = ''

  constructor(configured: SensitivityRules) {
    const built = buildCombinations(configured)
    this.skipped = built.skipped
    this.combos = built.rules.map(rules => ({ rules, overall: emptyTally(), byOrigin: new Map() }))
  }

  add(entry: SensitivityEntry): void {
    if (entry.origin > this.latest) this.latest = entry.origin

    for (const combo of this.combos) {
      const tolerance = classifyTolerance(entry.countedVisits, entry.asOf, toleranceParams(combo.rules)).status
      const category = coverageCategory({
        isNew: entry.isNew,
        uncensoredObservations: entry.uncensoredObservations,
        minObservations: entry.minObservations,
        conflicts: entry.conflicts,
        tolerance,
      })
      const releases = tolerance === 'within_tolerance' && entry.conflicts === 0 && entry.everStocked

      const origin = combo.byOrigin.get(entry.origin) ?? emptyTally()
      combo.byOrigin.set(entry.origin, origin)

      for (const tally of [combo.overall, origin]) {
        tally.categories[category]++
        tally.tolerance[tolerance]++
        if (releases) tally.gate++
      }
    }
  }

  finish(): { combinations: SensitivityCombination[]; skipped: SkippedCombination[] } {
    return {
      combinations: this.combos.map(combo => ({
        ...combo.rules,
        overall: toCell(combo.overall),
        latestOrigin: toCell(combo.byOrigin.get(this.latest) ?? emptyTally()),
      })),
      skipped: this.skipped,
    }
  }
}
