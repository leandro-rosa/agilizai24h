import type { CoverageCategory } from '../engine/engine'

export const COVERAGE_CATEGORIES: CoverageCategory[] = [
  'insufficient_history',
  'conflicting_data',
  'analysable_reliable_balance',
  'analysable_unreliable_balance',
  'analysable_not_enough_counts',
]

export interface CoverageReport {
  /** Product x Store considered. The five categories below always add up to it. */
  total: number
  categories: Record<CoverageCategory, number>
  /** The three analysable categories together: how many pairs can be analysed. */
  analysable: number
}

export const emptyCategories = (): Record<CoverageCategory, number> => Object.fromEntries(COVERAGE_CATEGORIES.map(category => [category, 0])) as Record<CoverageCategory, number>

export function reportFromCounts(categories: Record<CoverageCategory, number>): CoverageReport {
  const total = COVERAGE_CATEGORIES.reduce((sum, category) => sum + categories[category], 0)

  return {
    total,
    categories: { ...categories },
    analysable: categories.analysable_reliable_balance + categories.analysable_unreliable_balance + categories.analysable_not_enough_counts,
  }
}

/**
 * The coverage of the analysis: every Product x Store lands in exactly one of the
 * five exclusive categories (the engine's `coverageCategory` decides which, with
 * conflicting data winning over the balance status). A key seen twice is a bug in
 * the caller, so it throws rather than being counted twice.
 */
export function buildCoverageReport(entries: { key: string; category: CoverageCategory }[]): CoverageReport {
  const seen = new Set<string>()
  const counts = emptyCategories()

  for (const entry of entries) {
    if (seen.has(entry.key)) throw new Error(`Coverage: ${entry.key} appears more than once`)
    seen.add(entry.key)
    counts[entry.category]++
  }

  return reportFromCounts(counts)
}
