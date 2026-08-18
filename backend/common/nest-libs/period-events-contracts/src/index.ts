/**
 * The "a store's period changed" event family.
 *
 * Scoped by event family rather than by service pair, deliberately: this fans
 * out to finance and inventory today and may reach more later, so a pairwise
 * package (the `quote-search-match` precedent) would not generalise.
 */

export const PERIOD_EVENT_QUEUES = {
  /** Published by supply-service when a store's period data is created or replaced. */
  PERIOD_DATA_UPDATED: 'period.data-updated',
} as const

/**
 * Carries identifiers only — never computed figures.
 *
 * This is what keeps supply-service from knowing how reconciliation works. If
 * the event carried loss totals or monetary values, changing the reconciliation
 * formula would mean changing the publisher, and the two would be coupled
 * through the message bus — the exact coupling the event exists to avoid. It
 * also sidesteps stale-payload bugs: the consumer reads current state when it
 * processes the event, rather than trusting a snapshot taken at publish time.
 */
export interface PeriodDataUpdatedEvent {
  schemaVersion: 1
  storeId: number
  /** The month, as YYYY-MM. */
  period: string
  /** Which domain changed — lets a consumer skip work it does not care about. */
  source: 'supply' | 'sales'
  /** Traces the originating operator upload across services. */
  correlationId?: string
  /** ISO timestamp of the change, for ordering and staleness checks. */
  changedAt: string
}
