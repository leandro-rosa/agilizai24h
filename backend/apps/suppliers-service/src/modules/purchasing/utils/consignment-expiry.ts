export type RemovalState = 'expired_withdrawn' | 'other_reason' | 'to_check'

const OTHER_REASONS = new Set(['damaged_product', 'other_reason', 'return', 'transfer', 'internal_use'])

/** Reason keys are the supply-service's six removal reasons. Only `expired` is expiry; a missing reason is never presumed. */
export function classifyRemoval(reason: string | null): RemovalState {
  if (reason === 'expired') return 'expired_withdrawn'

  return reason && OTHER_REASONS.has(reason) ? 'other_reason' : 'to_check'
}

export type ShelfState = 'not_applicable' | 'expired_in_store' | 'check_permanence' | 'withdrawn'

/** `traceableUnits` is null when neither a traceable balance nor a physical count exists. */
export function shelfState(input: { expiryReached: boolean; removalRegistered: boolean; traceableUnits: number | null }): ShelfState {
  if (!input.expiryReached) return 'not_applicable'
  if (input.removalRegistered) return 'withdrawn'
  if (input.traceableUnits === null) return 'check_permanence'

  return input.traceableUnits > 0 ? 'expired_in_store' : 'not_applicable'
}

export function validateReturn(input: { writtenOff: number; alreadyReturned: number; newQuantity: number }): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(input.newQuantity) || input.newQuantity <= 0) return { ok: false, reason: 'the returned quantity must be a positive whole number' }
  const total = input.alreadyReturned + input.newQuantity
  if (total > input.writtenOff) return { ok: false, reason: `the returned total would exceed the written-off quantity (${total} > ${input.writtenOff})` }

  return { ok: true }
}

export interface ExpiryPosition {
  writtenOff: number
  returned: number
  awaitingReturn: number
  status: 'awaiting' | 'partial' | 'returned'
}

/** One entry per delivery to the supplier; the position is always their sum, so nothing is overwritten. */
export function expiryPosition(writtenOff: number, returns: number[]): ExpiryPosition {
  const returned = returns.reduce((sum, quantity) => sum + quantity, 0)

  return { writtenOff, returned, awaitingReturn: writtenOff - returned, status: returned === 0 ? 'awaiting' : returned >= writtenOff ? 'returned' : 'partial' }
}
