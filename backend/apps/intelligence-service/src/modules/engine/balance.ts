import type { Parameters } from '../parameters/parameters.types'
import { DAY_MS, type VisitPoint } from './engine.types'
import { sortVisits } from './intervals'

export type ToleranceStatus = 'within_tolerance' | 'outside_tolerance' | 'not_verifiable'

/**
 * A count is acceptable when the difference from the system balance is within
 * the LARGER of the percentage limit and the unit limit — so a difference of
 * one or two units never blocks only because of the percentage.
 */
export function withinTolerance(confirmed: number, systemBalance: number, p: Parameters['tolerance']): boolean {
  return Math.abs(confirmed - systemBalance) <= Math.max(p.pct * Math.abs(systemBalance), p.units)
}

export interface CountEvaluation {
  at: string
  confirmed: number
  systemBalance: number
  difference: number
  withinTolerance: boolean
}

export interface ToleranceResult {
  status: ToleranceStatus
  /** Why it is not verifiable, or what put it outside. */
  reason: string | null
  /** The counts the verdict was based on (the most recent `windowCounts`), oldest first. */
  window: CountEvaluation[]
  totalCounts: number
  lastCountAt: string | null
  lastCountAgeDays: number | null
}

/**
 * Status of a Product x Store over its most recent counts:
 * - fewer than `minCounts` counts, or the latest older than `maxAgeDays` → not_verifiable;
 * - any count of the window outside both limits → outside_tolerance;
 * - otherwise within_tolerance.
 * The count made at a visit is compared with the balance the system held BEFORE it.
 */
export function classifyTolerance(visits: VisitPoint[], asOf: Date, p: Parameters['tolerance']): ToleranceResult {
  const counted = sortVisits(visits).filter(visit => visit.confirmedCount !== null && visit.endedAt.getTime() <= asOf.getTime())
  const window = counted.slice(-p.windowCounts).map<CountEvaluation>(visit => ({
    at: visit.endedAt.toISOString(),
    confirmed: visit.confirmedCount as number,
    systemBalance: visit.balanceBefore,
    difference: (visit.confirmedCount as number) - visit.balanceBefore,
    withinTolerance: withinTolerance(visit.confirmedCount as number, visit.balanceBefore, p),
  }))

  const last = counted[counted.length - 1]
  const lastCountAgeDays = last ? (asOf.getTime() - last.endedAt.getTime()) / DAY_MS : null
  const base = { window, totalCounts: counted.length, lastCountAt: last ? last.endedAt.toISOString() : null, lastCountAgeDays }

  if (counted.length < p.minCounts) return { ...base, status: 'not_verifiable', reason: counted.length === 0 ? 'no_counts' : 'not_enough_counts' }
  if (lastCountAgeDays !== null && lastCountAgeDays > p.maxAgeDays) return { ...base, status: 'not_verifiable', reason: 'last_count_too_old' }
  if (window.some(count => !count.withinTolerance)) return { ...base, status: 'outside_tolerance', reason: 'a_recent_count_exceeds_both_limits' }

  return { ...base, status: 'within_tolerance', reason: null }
}

export interface BalanceEstimate {
  /** An ESTIMATE, never "stock": last balance after a visit minus the demand since. Null without any visit. */
  estimated: number | null
  anchor: { at: string; type: 'counted' | 'system'; balanceAfter: number } | null
  daysSinceAnchor: number | null
  tolerance: ToleranceResult
  conflicting: boolean
  /** True only when within tolerance AND free of conflicting data. */
  releasesBalanceUse: boolean
  label: 'saldo estimado' | 'saldo estimado — baixa confiabilidade'
  /** Why the gate is closed, when it is. */
  gateReason: string | null
}

export function estimateBalance(
  visits: VisitPoint[],
  asOf: Date,
  rateMid: number | null,
  conflicting: boolean,
  p: Parameters['tolerance'],
  everStocked = true,
): BalanceEstimate {
  const sorted = sortVisits(visits).filter(visit => visit.endedAt.getTime() <= asOf.getTime())
  const last = sorted[sorted.length - 1]
  const tolerance = classifyTolerance(visits, asOf, p)

  const daysSinceAnchor = last ? (asOf.getTime() - last.endedAt.getTime()) / DAY_MS : null
  const estimated =
    last && daysSinceAnchor !== null ? Math.max(0, Math.round((last.balanceAfter - (rateMid ?? 0) * daysSinceAnchor) * 10) / 10) : null

  const releases = tolerance.status === 'within_tolerance' && !conflicting && everStocked
  const gateReason = releases ? null : !everStocked ? 'never_stocked' : conflicting ? 'conflicting_data' : tolerance.status === 'outside_tolerance' ? 'outside_tolerance' : (tolerance.reason ?? 'not_verifiable')

  return {
    estimated,
    anchor: last ? { at: last.endedAt.toISOString(), type: last.confirmedCount !== null ? 'counted' : 'system', balanceAfter: last.balanceAfter } : null,
    daysSinceAnchor,
    tolerance,
    conflicting,
    releasesBalanceUse: releases,
    label: releases ? 'saldo estimado' : 'saldo estimado — baixa confiabilidade',
    gateReason,
  }
}
