import { DEFAULT_PARAMETERS } from '../parameters/parameters.defaults'
import type { Parameters } from '../parameters/parameters.types'
import type { LossReason, MonthlyFacts, NetworkEvidence, PairInput, VisitPoint } from './engine.types'
import type { RealPair } from './real-pairs.fixture'

/** Builds an engine input from a compact real-history fixture. Test support only. */
export function inputFromReal(
  pair: RealPair,
  over: { baseline: number | null; asOf?: string; parameters?: Parameters; network?: NetworkEvidence | null; baselineIsOfRecord?: boolean; unitsPerPackage?: number | null },
): PairInput {
  const visits: VisitPoint[] = pair.visits.map(([endedAt, balanceBefore, confirmedCount, restocked, removedTotal, adjustment, balanceAfter]) => ({
    endedAt: new Date(endedAt),
    balanceBefore,
    confirmedCount,
    restocked,
    removedTotal,
    adjustment,
    balanceAfter,
  }))

  const monthly: MonthlyFacts[] = pair.monthly.map(([month, salesPresent, sold, revenueCents, removals, restocked]) => ({
    month,
    salesPresent,
    sold,
    revenueCents,
    removals: removals as Partial<Record<LossReason | 'return' | 'transfer' | 'internal_use', number>>,
    restocked,
  }))

  return {
    storeId: pair.storeId,
    sku: pair.sku,
    visits,
    monthly,
    baseline: over.baseline,
    baselineIsOfRecord: over.baselineIsOfRecord ?? true,
    costCents: pair.costCents,
    unitsPerPackage: over.unitsPerPackage ?? null,
    salesMonthsMissing: pair.missingMonths,
    rejectedAtIngestion: false,
    baselineConflict: false,
    plannedRefillIntervalDays: null,
    network: over.network ?? null,
    asOf: new Date(over.asOf ?? '2026-08-31T23:59:59Z'),
    parameters: over.parameters ?? DEFAULT_PARAMETERS,
  }
}
