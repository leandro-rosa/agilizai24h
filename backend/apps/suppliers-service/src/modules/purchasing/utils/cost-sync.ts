/** States of the outbox column `purchase_item.cost_sync`. NULL = not received yet (nothing to send). */
export const COST_SYNC_STATES = ['pending', 'synced', 'unchanged', 'skipped_bonus', 'failed'] as const
export type CostSyncState = (typeof COST_SYNC_STATES)[number]

/** After this many failed attempts the item stays `failed` until someone retries it (`POST /purchases/:id/cost-sync`). */
export const MAX_COST_SYNC_ATTEMPTS = 8

export const COST_ALERTS = ['large_variation', 'closed_month', 'closed_month_unknown'] as const
export type CostAlert = (typeof COST_ALERTS)[number]

/** A bonus (brinde) never creates a cost: it was not bought. Everything else received does, even on_sale (consigned goods have a cost). */
export function sendsCost(condition: string): boolean {
  return condition !== 'bonus'
}

/** Change of the new cost against the cost it replaces, in basis points of the old one (+1500 = 15% up). Null without a previous cost. */
export function variationBps(previousCents: number | null, nextCents: number): number | null {
  if (previousCents === null || previousCents <= 0) return null

  return Math.round(((nextCents - previousCents) * 10_000) / previousCents)
}

/** Idempotency key. It carries the cost and the day, so correcting an item's cost after receipt creates the corrected version, while resending the same one creates nothing. */
export function costSourceRef(itemId: number, unitCostCents: number, effectiveFrom: string): string {
  return `purchase-item:${itemId}:${effectiveFrom}:${unitCostCents}`
}

/** Seconds to wait before the next attempt: 1 min, 2, 4 ... capped at 30 min. */
export function backoffSeconds(attempts: number): number {
  return Math.min(60 * 2 ** Math.max(0, attempts - 1), 1800)
}

export function dueForRetry(attempts: number, lastAttemptAt: Date | null, now: Date): boolean {
  if (attempts <= 0 || !lastAttemptAt) return true

  return now.getTime() - lastAttemptAt.getTime() >= backoffSeconds(attempts) * 1000
}

/** `YYYY-MM` of a `YYYY-MM-DD`. */
export const monthOf = (day: string): string => day.slice(0, 7)
