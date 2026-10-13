import { keySales, receiptIdOf, type SaleFact } from './consignment-sale-key'

const fact = (over: Partial<SaleFact> = {}): SaleFact => ({ storeId: 1, sku: 'A', occurredAt: new Date('2026-10-01T15:00:00Z'), quantity: 1, result: 'OK', receiptId: 'C-1', ...over })

describe('receiptIdOf — the receipt identifier', () => {
  it('prefers coupon, then internal code, then acquirer code, ignoring blanks', () => {
    expect(receiptIdOf({ coupon: ' C-9 ', internalCode: 'I-1', acquirerCode: 'A-1' })).toBe('C-9')
    expect(receiptIdOf({ coupon: '  ', internalCode: 'I-1' })).toBe('I-1')
    expect(receiptIdOf({ coupon: null, internalCode: null, acquirerCode: 'A-1' })).toBe('A-1')
    expect(receiptIdOf({})).toBeNull()
  })
})

describe('keySales — one stable key per sale row', () => {
  it('builds store|sku|instant|receipt|ordinal', () => {
    const { keyed } = keySales([fact()])

    expect(keyed[0].key).toBe('1|A|2026-10-01T15:00:00.000Z|C-1|0')
  })

  it('numbers identical rows of one receipt deterministically, whatever the input order', () => {
    const a = keySales([fact({ quantity: 2 }), fact({ quantity: 1 })]).keyed
    const b = keySales([fact({ quantity: 1 }), fact({ quantity: 2 })]).keyed

    expect(a.map(s => [s.key, s.quantity])).toEqual(b.map(s => [s.key, s.quantity]))
    expect(new Set(a.map(s => s.key)).size).toBe(2)
  })

  it('a row that later turns non-OK keeps its key (so the change is seen as a cancellation, not a new sale)', () => {
    const before = keySales([fact()]).keyed[0].key
    const after = keySales([fact({ result: 'CANCELADO' })]).keyed[0].key

    expect(after).toBe(before)
  })

  it('sets aside rows without an instant or without a receipt identifier — never keyed, never dropped', () => {
    const rows = [fact({ occurredAt: null }), fact({ receiptId: null }), fact()]
    const { keyed, unidentified } = keySales(rows)

    expect(keyed).toHaveLength(1)
    expect(unidentified).toHaveLength(2)
  })
})
