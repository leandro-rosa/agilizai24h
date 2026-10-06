import { checkInvoice, checkMove, effectiveDueDate, isLate, isOverdue, nextStage, resolveReceipt } from './order-flow'

describe('stage machine', () => {
  it('moves forward one stage at a time', () => {
    expect(nextStage('requisition')).toBe('awaiting_invoice')
    expect(nextStage('awaiting_receipt')).toBe('received')
    expect(nextStage('received')).toBeNull()
    expect(checkMove('requisition', 'awaiting_invoice')).toBeNull()
    expect(checkMove('invoiced', 'awaiting_receipt')).toBeNull()
  })

  it('refuses to skip a stage, to go back, and any change after received', () => {
    expect(checkMove('requisition', 'received')).toMatch(/one stage at a time/)
    expect(checkMove('invoiced', 'requisition')).toMatch(/one stage at a time/)
    expect(checkMove('received', 'received')).toMatch(/final/)
    expect(checkMove('received', 'requisition')).toMatch(/final/)
  })
})

describe('the invoice requirement', () => {
  it('asks for a number, an NF-e or an explicit "no invoice" from invoiced on', () => {
    expect(checkInvoice('invoiced', {})).toMatch(/invoice number or an imported NF-e/)
    expect(checkInvoice('invoiced', { invoiceNumber: ' ' })).not.toBeNull()
    expect(checkInvoice('invoiced', { invoiceNumber: '123' })).toBeNull()
    expect(checkInvoice('invoiced', { invoiceKey: 'K' })).toBeNull()
    expect(checkInvoice('received', { withoutInvoice: true })).toBeNull()
    expect(checkInvoice('awaiting_receipt', {})).not.toBeNull()
  })

  it('does not ask before invoicing', () => {
    expect(checkInvoice('requisition', {})).toBeNull()
    expect(checkInvoice('awaiting_invoice', {})).toBeNull()
  })
})

describe('resolveReceipt', () => {
  const items = [{ itemId: 1, ordered: 100 }, { itemId: 2, ordered: 20 }]

  it('defaults to what was ordered and shows the difference of what was reported', () => {
    expect(resolveReceipt(items, {})).toEqual({ lines: [{ itemId: 1, ordered: 100, received: 100, difference: 0 }, { itemId: 2, ordered: 20, received: 20, difference: 0 }] })
    expect(resolveReceipt(items, { received: [{ itemId: 1, quantity: 90 }] })).toEqual({
      lines: [{ itemId: 1, ordered: 100, received: 90, difference: 10 }, { itemId: 2, ordered: 20, received: 20, difference: 0 }],
    })
  })

  it('accepts receiving more than ordered (negative difference) and zero, and refuses fractions, negatives and strangers', () => {
    expect(resolveReceipt(items, { received: [{ itemId: 2, quantity: 25 }] })).toMatchObject({ lines: [expect.anything(), { received: 25, difference: -5 }] })
    expect(resolveReceipt(items, { received: [{ itemId: 2, quantity: 0 }] })).toMatchObject({ lines: [expect.anything(), { received: 0, difference: 20 }] })
    expect(resolveReceipt(items, { received: [{ itemId: 1, quantity: 2.5 }] })).toHaveProperty('problem')
    expect(resolveReceipt(items, { received: [{ itemId: 1, quantity: -1 }] })).toHaveProperty('problem')
    expect(resolveReceipt(items, { received: [{ itemId: 99, quantity: 1 }] })).toHaveProperty('problem')
  })
})

describe('payment and delivery dates', () => {
  it('pay on receipt is due on the receipt day; a boleto on its date; unknown stays unknown', () => {
    expect(effectiveDueDate('on_receipt', null, '2026-10-14')).toBe('2026-10-14')
    expect(effectiveDueDate('on_receipt', null, null)).toBeNull()
    expect(effectiveDueDate('due_date', '2026-10-20', '2026-10-14')).toBe('2026-10-20')
    expect(effectiveDueDate(null, '2026-10-20', null)).toBeNull()
  })

  it('flags a late delivery only while not received, and an overdue payment only while pending', () => {
    expect(isLate('awaiting_receipt', '2026-10-10', '2026-10-12')).toBe(true)
    expect(isLate('received', '2026-10-10', '2026-10-12')).toBe(false)
    expect(isLate('invoiced', null, '2026-10-12')).toBe(false)
    expect(isLate('invoiced', '2026-10-12', '2026-10-12')).toBe(false)
    expect(isOverdue('2026-10-10', true, '2026-10-12')).toBe(true)
    expect(isOverdue('2026-10-10', false, '2026-10-12')).toBe(false)
    expect(isOverdue(null, true, '2026-10-12')).toBe(false)
  })
})
