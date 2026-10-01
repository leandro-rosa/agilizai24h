import type { Interval } from './intervals'

export type ConflictCode = 'balance_rise_without_event' | 'consumption_without_imported_sales' | 'rejected_at_ingestion' | 'conflicting_baseline'

export interface DataConflict {
  code: ConflictCode
  detail: Record<string, unknown>
}

export interface ConflictInput {
  intervals: Interval[]
  /** Months in which the store has no imported sales but this SKU shows consumption. */
  consumptionMonthsWithoutSales: string[]
  rejectedAtIngestion: boolean
  baselineConflict: boolean
}

/**
 * The facts of a Product x Store contradict each other. Such a pair lists its
 * conflicts and NEVER releases balance-driven use, whatever its tolerance
 * status — a balance that rose with no event cannot be trusted to subtract from.
 */
export function detectConflicts(input: ConflictInput): DataConflict[] {
  const conflicts: DataConflict[] = []

  const rises = input.intervals.filter(interval => interval.rise)
  if (rises.length > 0) {
    conflicts.push({ code: 'balance_rise_without_event', detail: { intervals: rises.map(r => ({ from: r.from.toISOString(), to: r.to.toISOString() })) } })
  }

  if (input.consumptionMonthsWithoutSales.length > 0) {
    conflicts.push({ code: 'consumption_without_imported_sales', detail: { months: input.consumptionMonthsWithoutSales } })
  }

  if (input.rejectedAtIngestion) conflicts.push({ code: 'rejected_at_ingestion', detail: {} })
  if (input.baselineConflict) conflicts.push({ code: 'conflicting_baseline', detail: {} })

  return conflicts
}
