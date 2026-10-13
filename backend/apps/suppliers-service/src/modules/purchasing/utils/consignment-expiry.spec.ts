import { classifyRemoval, expiryPosition, shelfState, validateReturn } from './consignment-expiry'

describe('classifyRemoval — a withdrawal is expiry only when its reason says so', () => {
  it('maps the supply reasons: expired is expiry, the others are other reasons', () => {
    expect(classifyRemoval('expired')).toBe('expired_withdrawn')
    for (const reason of ['damaged_product', 'other_reason', 'return', 'transfer', 'internal_use']) expect(classifyRemoval(reason)).toBe('other_reason')
  })

  it('a missing or unknown reason is a withdrawal to check — never defaulted to expiry', () => {
    expect(classifyRemoval(null)).toBe('to_check')
    expect(classifyRemoval('')).toBe('to_check')
    expect(classifyRemoval('something_new')).toBe('to_check')
  })
})

describe('shelfState — "still in the store" needs proof', () => {
  it('no expiry reached → not applicable', () => {
    expect(shelfState({ expiryReached: false, removalRegistered: false, traceableUnits: 5 })).toBe('not_applicable')
  })

  it('a registered withdrawal wins', () => {
    expect(shelfState({ expiryReached: true, removalRegistered: true, traceableUnits: 5 })).toBe('withdrawn')
  })

  it('expired and units are traceable there → expired in store', () => {
    expect(shelfState({ expiryReached: true, removalRegistered: false, traceableUnits: 3 })).toBe('expired_in_store')
  })

  it('expired but no withdrawal and no traceable balance → check permanence (absence of a record proves nothing)', () => {
    expect(shelfState({ expiryReached: true, removalRegistered: false, traceableUnits: null })).toBe('check_permanence')
  })

  it('expired, no withdrawal, and a traceable zero → nothing is there to withdraw', () => {
    expect(shelfState({ expiryReached: true, removalRegistered: false, traceableUnits: 0 })).toBe('not_applicable')
  })
})

describe('validateReturn / expiryPosition — partial deliveries to the supplier', () => {
  it('accepts a delivery up to what was written off, in total', () => {
    expect(validateReturn({ writtenOff: 8, alreadyReturned: 5, newQuantity: 3 })).toEqual({ ok: true })
  })

  it('refuses a delivery that would exceed the written-off quantity, and non-positive ones', () => {
    expect(validateReturn({ writtenOff: 8, alreadyReturned: 5, newQuantity: 4 })).toEqual({ ok: false, reason: 'the returned total would exceed the written-off quantity (9 > 8)' })
    expect(validateReturn({ writtenOff: 8, alreadyReturned: 0, newQuantity: 0 })).toEqual({ ok: false, reason: 'the returned quantity must be a positive whole number' })
    expect(validateReturn({ writtenOff: 8, alreadyReturned: 0, newQuantity: 1.5 })).toEqual({ ok: false, reason: 'the returned quantity must be a positive whole number' })
  })

  it('derives the position from the individual deliveries, never from an overwritten total', () => {
    expect(expiryPosition(8, [])).toEqual({ writtenOff: 8, returned: 0, awaitingReturn: 8, status: 'awaiting' })
    expect(expiryPosition(8, [3, 2])).toEqual({ writtenOff: 8, returned: 5, awaitingReturn: 3, status: 'partial' })
    expect(expiryPosition(8, [3, 5])).toEqual({ writtenOff: 8, returned: 8, awaitingReturn: 0, status: 'returned' })
  })
})
