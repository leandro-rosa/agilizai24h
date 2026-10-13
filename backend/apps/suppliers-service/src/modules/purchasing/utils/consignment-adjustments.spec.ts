import { computeAdjustments, type ConfirmedSaleLine } from './consignment-adjustments'
import { periodFromDays } from './consignment-period'
import type { KeyedSale } from './consignment-sale-key'

const covered = [periodFromDays('2026-10-01', '2026-10-07')]
const sale = (key: string, quantity: number, over: Partial<KeyedSale> = {}): KeyedSale => ({ key, storeId: 1, sku: 'A', occurredAt: new Date('2026-10-03T15:00:00Z'), quantity, result: 'OK', receiptId: 'C', ...over })
const line = (saleKey: string, quantity: number, unitCostCents = 730): ConfirmedSaleLine => ({ saleKey, storeId: 1, sku: 'A', quantity, unitCostCents })

describe('computeAdjustments — changes to sales a confirmed closing already counted', () => {
  it('a confirmed sale that turned non-OK becomes a negative adjustment at the ORIGINAL cost', () => {
    const { adjustments } = computeAdjustments({ confirmed: [line('k1', 3, 730)], current: [sale('k1', 3, { result: 'CANCELADO' })], covered })

    expect(adjustments).toEqual([{ saleKey: 'k1', kind: 'adjustment_cancel', storeId: 1, sku: 'A', occurredAt: new Date('2026-10-03T15:00:00Z'), quantity: -3, unitCostCents: 730 }])
  })

  it('a changed quantity becomes the difference', () => {
    const { adjustments } = computeAdjustments({ confirmed: [line('k1', 3)], current: [sale('k1', 5)], covered })

    expect(adjustments[0]).toMatchObject({ kind: 'adjustment_qty', quantity: 2, unitCostCents: 730 })
  })

  it('a sale imported later, dated inside a confirmed period, is a late adjustment (cost resolved by the closing)', () => {
    const { adjustments } = computeAdjustments({ confirmed: [], current: [sale('k9', 4)], covered })

    expect(adjustments).toEqual([{ saleKey: 'k9', kind: 'adjustment_late', storeId: 1, sku: 'A', occurredAt: new Date('2026-10-03T15:00:00Z'), quantity: 4, unitCostCents: null }])
  })

  it('an unconfirmed sale OUTSIDE every confirmed period is a regular sale, not an adjustment', () => {
    const { adjustments } = computeAdjustments({ confirmed: [], current: [sale('k9', 4, { occurredAt: new Date('2026-10-20T15:00:00Z') })], covered })

    expect(adjustments).toEqual([])
  })

  it('an unchanged sale produces nothing, so running it again is idempotent', () => {
    const input = { confirmed: [line('k1', 3)], current: [sale('k1', 3)], covered }

    expect(computeAdjustments(input).adjustments).toEqual([])
  })

  it('a confirmed key absent from the latest import is reported as missing, never presumed cancelled', () => {
    const result = computeAdjustments({ confirmed: [line('gone', 2)], current: [], covered })

    expect(result).toEqual({ adjustments: [], missing: ['gone'] })
  })

  it('a late NON-OK sale is not an adjustment (it was never counted)', () => {
    const { adjustments } = computeAdjustments({ confirmed: [], current: [sale('k9', 4, { result: 'CANCELADO' })], covered })

    expect(adjustments).toEqual([])
  })
})
