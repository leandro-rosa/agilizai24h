/**
 * Two small queues drive the monthly refresh (the event queue itself,
 * `period.data-updated.intelligence`, is declared in `@app/period-events-contracts`):
 *
 * - CHECK   — a debounced "has dataThrough advanced?" evaluation. One job per time
 *             window collapses the many per-store events of an import into one check.
 * - ADVANCE — a poll of one refresh set: when its engine run has completed it starts
 *             the backtest, when the backtest has completed it promotes the set.
 */
export const REFRESH_QUEUES = {
  CHECK: 'intelligence.refresh-check',
  ADVANCE: 'intelligence.refresh-advance',
} as const

export interface RefreshCheckJob {
  schemaVersion: 1
  correlationId?: string
}

export interface RefreshAdvanceJob {
  schemaVersion: 1
  setId: string
}

/** Events of an import arrive in bursts (one per store-period); they are folded into one check per window. */
export const DEFAULT_DEBOUNCE_SECONDS = 60
/** How often a running set is looked at again. */
export const ADVANCE_DELAY_MS = 15_000
/** A set still running after this long is failed, so the previous current set stays and a new refresh can start. */
export const MAX_RUNNING_MS = 6 * 60 * 60 * 1000

export const RETRY_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: true,
  removeOnFail: { age: 24 * 3600 },
}
