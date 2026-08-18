/**
 * The "a store's period changed" event family, and the chain it drives:
 *
 *   supply|sales  ──period.data-updated──▶  inventory  ──inventory.period-derived──▶  finance
 *
 * Chained rather than fanned out to both consumers, because finance values
 * remaining stock from inventory's derived output — see
 * `InventoryPeriodDerivedEvent` for what running them in parallel actually did.
 *
 * Scoped by event family rather than by service pair, deliberately: a pairwise
 * package (the `quote-search-match` precedent) would not generalise.
 */

/**
 * One queue per subscriber, not one queue per event.
 *
 * BullMQ queues are point-to-point: every worker attached to a queue name
 * COMPETES for its jobs, so a single shared `period.data-updated` queue would
 * hand each event to inventory or finance, never both. Measured, not assumed —
 * six events split five/one between the two services.
 *
 * The failure is silent and partial, which is the worst shape: most months
 * would still reconcile, so the gap reads as an unrelated data problem.
 * Fanning out at publish time is the only option `@app/hold-it` offers, since
 * BullMQ has no exchange or topic concept to fan out for us.
 *
 * Adding a subscriber means adding a queue here and to the list below — the
 * publisher then reaches it with no further change.
 */
export const PERIOD_EVENT_QUEUES = {
  /** Consumed by inventory-service. */
  PERIOD_DATA_UPDATED_INVENTORY: 'period.data-updated.inventory',
  /** Consumed by finance-service. */
  INVENTORY_PERIOD_DERIVED_FINANCE: 'inventory.period-derived.finance',
} as const

/**
 * Every queue a period-data-updated event must be published to.
 *
 * Publishers iterate this rather than naming queues, so a new subscriber never
 * requires touching supply-service or sales-service.
 */
export const PERIOD_DATA_UPDATED_SUBSCRIBERS = [PERIOD_EVENT_QUEUES.PERIOD_DATA_UPDATED_INVENTORY] as const

/** Every queue an inventory-period-derived event must be published to. */
export const INVENTORY_PERIOD_DERIVED_SUBSCRIBERS = [
  PERIOD_EVENT_QUEUES.INVENTORY_PERIOD_DERIVED_FINANCE,
] as const

/**
 * Published by inventory-service once a period's stock has actually been
 * derived — the trigger for reconciliation.
 *
 * finance-service listens to THIS rather than to `period.data-updated`, for two
 * measured reasons:
 *
 * 1. **Ordering.** Reconciliation values remaining stock from inventory's
 *    derived closing balance. Recomputing both from the same event runs them
 *    concurrently, so finance reads a balance inventory has not written yet —
 *    observed live: remaining came out 31500 where 29250 was correct, and the
 *    reconciliation still reported itself complete. A wrong figure that calls
 *    itself trustworthy is the worst possible outcome for this service.
 * 2. **Propagation.** Closing stock carries forward, so a correction to March
 *    moves April and every month after it. Inventory already rebuilds that
 *    whole window; emitting one event per rebuilt period is what makes finance
 *    revalue them too, instead of leaving later months quietly stale.
 */
export interface InventoryPeriodDerivedEvent {
  schemaVersion: 1
  storeId: number
  /** One event per rebuilt month, not just the month that changed. */
  period: string
  correlationId?: string
  /**
   * When the ORIGINAL inputs changed, carried through from the period event
   * rather than reset here — otherwise the staleness marker would only say when
   * inventory happened to finish.
   */
  changedAt: string
}

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
