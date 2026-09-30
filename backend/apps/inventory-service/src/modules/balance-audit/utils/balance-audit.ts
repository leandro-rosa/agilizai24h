import type { AuditBands, AuditVisit, Distribution, StoreMonthSales, TurnoverBand } from './audit-types'
import { balanceBand, balanceBandLabels, turnoverBand, turnoverBandLabels } from './bands'
import { buildChains, fullyCoveredMonths, prorateByMonth } from './consumption'
import { distributionOf, type Observation } from './distribution'
import { monthKey, monthsBetween } from './months'

export interface BalanceAuditInput {
  from: string
  to: string
  visits: AuditVisit[]
  /** One entry per store × month of the range, `present: false` where the month was never imported. */
  sales: StoreMonthSales[]
  bands: AuditBands
}

export interface CountCoverageRow {
  store_id: number
  month: string
  operations: number
  operations_with_count: number
  lines: number
  counted_lines: number
  positive_balance_lines: number
  counted_positive_balance_lines: number
  /** Share of the lines with a positive system balance that were counted; null when there were none. */
  share_positive_balance_counted: number | null
}

export interface StoreMonthComparison {
  store_id: number
  month: string
  sku_months: number
  consumption_units: number
  sales_units: number
  /** consumption ÷ sales; null when the store-month sold nothing. */
  ratio: number | null
}

export interface StoreMonthGap {
  store_id: number
  month: string
  /** Consumption the visits show for the month, in units. */
  consumption_units: number
  sku_months: number
}

export interface BalanceAudit {
  range: { from: string; to: string }
  covered: {
    stores: number
    visits: number
    lines: number
    first_visit_end: string | null
    last_visit_end: string | null
  }
  count_vs_system: {
    lines_total: number
    lines_counted: number
    /** Lines without a count: excluded from the comparison, never treated as equal to the system. */
    lines_uncounted: number
    overall: Distribution
    by_turnover: Record<string, Distribution>
    by_balance: Record<string, Distribution>
  }
  count_coverage: CountCoverageRow[]
  consumption_vs_sales: {
    compared_sku_months: number
    overall: Distribution
    by_turnover: Record<string, Distribution>
    store_months: StoreMonthComparison[]
    /** Median of the store-month ratios — descriptive, not a target. */
    median_ratio: number | null
  }
  gaps: {
    store_months_without_sales: StoreMonthGap[]
    balance_rises_without_event: {
      pairs: number
      units: number
      /** SKU-months dropped from the comparison because a rise fell inside them. */
      sku_months_excluded: number
    }
    capacity: { lines: number; lines_with_capacity: number; share_with_capacity: number | null; available: boolean }
  }
}

const EMPTY_SPAN = { first: null as Date | null, last: null as Date | null }

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function byBand<K extends string>(labels: K[], observations: Map<K, Observation[]>): Record<string, Distribution> {
  return Object.fromEntries(labels.map(label => [label, distributionOf(observations.get(label) ?? [])]))
}

/**
 * Measures how far the balance the system holds can be trusted, from two
 * independent angles: physical counts against the system balance, and the
 * consumption the visits imply against registered sales.
 *
 * Pure and deterministic. It computes distributions and counts and NOTHING
 * else — no verdict, no tolerance — and it is recomputed on every read because
 * new reports change the figures and a stored copy would become one more
 * balance that disagrees with the others.
 */
export function computeBalanceAudit({ from, to, visits, sales, bands }: BalanceAuditInput): BalanceAudit {
  const turnoverCache = new Map<string, TurnoverBand>()
  const turnoverOf = (storeId: number, sku: string): TurnoverBand => {
    const key = `${storeId}|${sku}`
    if (!turnoverCache.has(key)) turnoverCache.set(key, turnoverBand(storeId, sku, sales, bands))
    return turnoverCache.get(key)!
  }

  const salesByStoreMonth = new Map(sales.map(entry => [`${entry.storeId}|${entry.month}`, entry]))

  // ---- Counts against the system balance, and count coverage ----------------
  const countedObservations: Observation[] = []
  const countedByTurnover = new Map<TurnoverBand, Observation[]>()
  const countedByBalance = new Map<string, Observation[]>()
  const coverage = new Map<string, CountCoverageRow>()

  let linesTotal = 0
  let linesCounted = 0
  let linesWithCapacity = 0
  const span = { ...EMPTY_SPAN }
  const storeIds = new Set<number>()

  for (const visit of visits) {
    storeIds.add(visit.storeId)
    if (span.first === null || visit.endedAt < span.first) span.first = visit.endedAt
    if (span.last === null || visit.endedAt > span.last) span.last = visit.endedAt

    const month = monthKey(visit.endedAt)
    const key = `${visit.storeId}|${month}`
    const row =
      coverage.get(key) ??
      ({
        store_id: visit.storeId,
        month,
        operations: 0,
        operations_with_count: 0,
        lines: 0,
        counted_lines: 0,
        positive_balance_lines: 0,
        counted_positive_balance_lines: 0,
        share_positive_balance_counted: null,
      } as CountCoverageRow)
    coverage.set(key, row)

    row.operations++
    let operationHasCount = false

    for (const line of visit.lines) {
      linesTotal++
      row.lines++
      // Capacity counts only when positive: the real export writes 0 where none is set.
      if (line.capacity !== null && line.capacity > 0) linesWithCapacity++

      const positive = line.balanceBefore > 0
      if (positive) row.positive_balance_lines++

      // A missing count is excluded, never read as "equal to the system".
      if (line.confirmedCount === null) continue

      linesCounted++
      row.counted_lines++
      operationHasCount = true
      if (positive) row.counted_positive_balance_lines++

      const observation: Observation = {
        difference: line.confirmedCount - line.balanceBefore,
        base: Math.max(0, line.balanceBefore),
      }

      countedObservations.push(observation)
      push(countedByTurnover, turnoverOf(visit.storeId, line.sku), observation)
      push(countedByBalance, balanceBand(line.balanceBefore, bands), observation)
    }

    if (operationHasCount) row.operations_with_count++
  }

  for (const row of coverage.values()) {
    row.share_positive_balance_counted =
      row.positive_balance_lines === 0 ? null : row.counted_positive_balance_lines / row.positive_balance_lines
  }

  // ---- Consumption between visits against registered sales ------------------
  const comparedObservations: Observation[] = []
  const comparedByTurnover = new Map<TurnoverBand, Observation[]>()
  const storeMonths = new Map<string, { row: StoreMonthComparison }>()
  const gaps = new Map<string, StoreMonthGap>()
  let risePairs = 0
  let riseUnits = 0
  let riseSkuMonthsExcluded = 0
  let comparedSkuMonths = 0

  for (const chain of buildChains(visits)) {
    const riseMonths = new Set<string>()
    const consumptionByMonth = new Map<string, number>()

    for (const pair of chain.pairs) {
      if (pair.consumption < 0) {
        // The balance rose with no recorded event. Counted and reported apart;
        // it is not consumption, and the months it touches cannot be compared.
        risePairs++
        riseUnits += -pair.consumption
        for (const month of prorateByMonth({ ...pair, consumption: 1 }).keys()) riseMonths.add(month)
        continue
      }

      for (const [month, units] of prorateByMonth(pair)) {
        consumptionByMonth.set(month, (consumptionByMonth.get(month) ?? 0) + units)
      }
    }

    for (const month of fullyCoveredMonths(chain, from, to)) {
      if (riseMonths.has(month)) {
        riseSkuMonthsExcluded++
        continue
      }

      const consumption = consumptionByMonth.get(month) ?? 0
      const storeMonth = salesByStoreMonth.get(`${chain.storeId}|${month}`)
      const key = `${chain.storeId}|${month}`

      if (!storeMonth?.present) {
        // Consumption with no sales loaded for the whole month is a missing
        // import, not a large difference: listed, and kept out of the distributions.
        const gap = gaps.get(key) ?? { store_id: chain.storeId, month, consumption_units: 0, sku_months: 0 }
        gap.consumption_units += consumption
        gap.sku_months++
        gaps.set(key, gap)
        continue
      }

      const sold = storeMonth.bySku.get(chain.sku) ?? 0
      const observation: Observation = { difference: consumption - sold, base: sold }

      comparedSkuMonths++
      comparedObservations.push(observation)
      push(comparedByTurnover, turnoverOf(chain.storeId, chain.sku), observation)

      const entry = storeMonths.get(key) ?? {
        row: { store_id: chain.storeId, month, sku_months: 0, consumption_units: 0, sales_units: 0, ratio: null },
      }
      entry.row.sku_months++
      entry.row.consumption_units += consumption
      entry.row.sales_units += sold
      storeMonths.set(key, entry)
    }
  }

  const storeMonthRows = [...storeMonths.values()]
    .map(({ row }) => ({ ...row, ratio: row.sales_units > 0 ? row.consumption_units / row.sales_units : null }))
    .sort((a, b) => a.store_id - b.store_id || a.month.localeCompare(b.month))

  return {
    range: { from, to },
    covered: {
      stores: storeIds.size,
      visits: visits.length,
      lines: linesTotal,
      first_visit_end: span.first?.toISOString() ?? null,
      last_visit_end: span.last?.toISOString() ?? null,
    },
    count_vs_system: {
      lines_total: linesTotal,
      lines_counted: linesCounted,
      lines_uncounted: linesTotal - linesCounted,
      overall: distributionOf(countedObservations),
      by_turnover: byBand(turnoverBandLabels(), countedByTurnover),
      by_balance: byBand(balanceBandLabels(bands), countedByBalance),
    },
    count_coverage: [...coverage.values()].sort((a, b) => a.store_id - b.store_id || a.month.localeCompare(b.month)),
    consumption_vs_sales: {
      compared_sku_months: comparedSkuMonths,
      overall: distributionOf(comparedObservations),
      by_turnover: byBand(turnoverBandLabels(), comparedByTurnover),
      store_months: storeMonthRows,
      median_ratio: median(storeMonthRows.flatMap(row => (row.ratio === null ? [] : [row.ratio]))),
    },
    gaps: {
      store_months_without_sales: [...gaps.values()].sort((a, b) => a.store_id - b.store_id || a.month.localeCompare(b.month)),
      balance_rises_without_event: { pairs: risePairs, units: riseUnits, sku_months_excluded: riseSkuMonthsExcluded },
      capacity: {
        lines: linesTotal,
        lines_with_capacity: linesWithCapacity,
        share_with_capacity: linesTotal === 0 ? null : linesWithCapacity / linesTotal,
        available: linesWithCapacity > 0,
      },
    },
  }
}

function push<K>(map: Map<K, Observation[]>, key: K, observation: Observation): void {
  if (!map.has(key)) map.set(key, [])
  map.get(key)!.push(observation)
}

export { monthsBetween }
