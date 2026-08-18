import { deriveLoss, type ClassifiedRemoval } from './derive-loss'

const removal = (sku: string, reasonKey: string, countsAsLoss: boolean, quantityRemoved: number): ClassifiedRemoval => ({
  sku,
  reasonKey,
  countsAsLoss,
  quantityRemoved,
})

describe('deriveLoss', () => {
  it('counts only the loss portion of a mixed-reason removal', () => {
    // THE defining case: a reported line of "-6 Devolução, -3 Outro motivo" is
    // 9 units removed but only 3 units of real loss. Classifying the line as a
    // whole — in either direction — is the failure this whole service exists to
    // prevent.
    const result = deriveLoss([
      removal('A', 'return', false, 6),
      removal('A', 'other_reason', true, 3),
    ])

    expect(result.total).toBe(3)
  })

  it('counts every loss-counting reason', () => {
    const result = deriveLoss([
      removal('A', 'expired', true, 4),
      removal('A', 'damaged_product', true, 2),
      removal('A', 'other_reason', true, 1),
    ])

    expect(result.total).toBe(7)
  })

  it('counts no non-loss reason', () => {
    const result = deriveLoss([
      removal('A', 'return', false, 6),
      removal('A', 'transfer', false, 5),
      removal('A', 'internal_use', false, 4),
    ])

    expect(result.total).toBe(0)
  })

  it('breaks loss down by reason, excluding non-loss ones entirely', () => {
    const result = deriveLoss([
      removal('A', 'expired', true, 4),
      removal('A', 'return', false, 6),
      removal('B', 'expired', true, 1),
    ])

    expect(result.byReason).toEqual([{ reason: 'expired', quantity: 5 }])
  })

  it('breaks loss down by SKU', () => {
    const result = deriveLoss([
      removal('B', 'expired', true, 2),
      removal('A', 'other_reason', true, 3),
      removal('A', 'expired', true, 1),
    ])

    expect(result.bySku).toEqual([
      { sku: 'A', quantity: 4 },
      { sku: 'B', quantity: 2 },
    ])
  })

  it('makes both breakdowns sum to the total', () => {
    const removals = [
      removal('A', 'expired', true, 4),
      removal('A', 'other_reason', true, 3),
      removal('B', 'damaged_product', true, 2),
      removal('B', 'return', false, 9),
    ]

    const result = deriveLoss(removals)

    expect(result.byReason.reduce((sum, r) => sum + r.quantity, 0)).toBe(result.total)
    expect(result.bySku.reduce((sum, r) => sum + r.quantity, 0)).toBe(result.total)
  })

  it('yields zero for an empty period rather than throwing', () => {
    expect(deriveLoss([])).toEqual({ total: 0, byReason: [], bySku: [] })
  })
})
