import { closingStockAsOf, deriveStockSeries, type PeriodMovements } from './derive-stock'

const movement = (
  period: string,
  restocked: number,
  sold: number,
  removed: number,
  adjustment = 0,
  recordedClosingBalance: number | null = null,
): PeriodMovements => ({
  period,
  restocked,
  sold,
  removed,
  adjustment,
  recordedClosingBalance,
})

describe('deriveStockSeries', () => {
  it('derives stock as restocked minus sold minus removed', () => {
    const [result] = deriveStockSeries([movement('2026-03', 100, 60, 5)])

    expect(result.closingStock).toBe(35)
  })

  it('carries the balance forward across periods', () => {
    const series = deriveStockSeries([movement('2026-03', 100, 60, 5), movement('2026-04', 20, 10, 0)])

    expect(series.map(entry => entry.closingStock)).toEqual([35, 45])
  })

  it('orders chronologically regardless of input order', () => {
    const series = deriveStockSeries([movement('2026-04', 20, 10, 0), movement('2026-03', 100, 60, 5)])

    expect(series.map(entry => entry.period)).toEqual(['2026-03', '2026-04'])
    expect(series.map(entry => entry.closingStock)).toEqual([35, 45])
  })

  it('counts every removal, whatever its reason', () => {
    // A returned bottle is as gone from the shelf as an expired one. The loss
    // classification must not leak into the quantity.
    const [result] = deriveStockSeries([movement('2026-03', 100, 0, 9)])

    expect(result.closingStock).toBe(91)
  })

  it('reports a negative balance rather than clamping it to zero', () => {
    // Negative means the movement data is wrong; clamping hides the very
    // inconsistency that needs fixing while looking plausible.
    const [result] = deriveStockSeries([movement('2026-03', 10, 15, 0)])

    expect(result.closingStock).toBe(-5)
  })

  it('lets a later period recover from a negative balance', () => {
    const series = deriveStockSeries([movement('2026-03', 10, 15, 0), movement('2026-04', 20, 0, 0)])

    expect(series.map(entry => entry.closingStock)).toEqual([-5, 15])
  })

  it('keeps a period of no movement at the carried balance', () => {
    const series = deriveStockSeries([movement('2026-03', 100, 60, 5), movement('2026-04', 0, 0, 0)])

    expect(series[1].closingStock).toBe(35)
  })

  it('returns nothing for no movements at all', () => {
    expect(deriveStockSeries([])).toEqual([])
  })
})

describe('the inventory adjustment', () => {
  it('an inbound adjustment increases stock', () => {
    const [result] = deriveStockSeries([movement('2026-03', 0, 0, 0, 12)])

    expect(result.closingStock).toBe(12)
  })

  it('an outbound adjustment decreases stock', () => {
    const [result] = deriveStockSeries([movement('2026-03', 20, 0, 0, -5)])

    expect(result.closingStock).toBe(15)
  })

  it('carries forward across periods same as any other movement', () => {
    const series = deriveStockSeries([movement('2026-03', 0, 0, 0, 10), movement('2026-04', 0, 0, 0)])

    expect(series.map(entry => entry.closingStock)).toEqual([10, 10])
  })
})

describe('the recorded balance (design D5 — stored, not cross-checked)', () => {
  it('is carried through alongside the derived balance', () => {
    const [result] = deriveStockSeries([movement('2026-03', 100, 60, 5, 0, 35)])

    expect(result.closingStock).toBe(35)
    expect(result.recordedClosingBalance).toBe(35)
  })

  it('is carried through even when it differs from the derived balance', () => {
    // A visit-moment reading legitimately differs from the month-end derived
    // total whenever anything sold after the last restocking visit — the
    // common case, not an error. No comparison is made between the two.
    const [result] = deriveStockSeries([movement('2026-03', 100, 60, 5, 0, 999)])

    expect(result.closingStock).toBe(35)
    expect(result.recordedClosingBalance).toBe(999)
  })

  it('is null when no recorded balance exists for the period', () => {
    const [result] = deriveStockSeries([movement('2026-03', 100, 60, 5)])

    expect(result.recordedClosingBalance).toBeNull()
  })
})

describe('closingStockAsOf', () => {
  const series = deriveStockSeries([
    movement('2026-03', 100, 60, 5),
    movement('2026-04', 20, 10, 0),
    movement('2026-05', 0, 5, 0),
  ])

  it('reads the closing balance of a past period', () => {
    expect(closingStockAsOf(series, '2026-03')?.closingStock).toBe(35)
  })

  it('does not change a past period when later ones exist', () => {
    // The same property the dated-cost rule protects: re-reading history must
    // not be affected by data recorded afterwards.
    const withMore = deriveStockSeries([
      movement('2026-03', 100, 60, 5),
      movement('2026-04', 20, 10, 0),
      movement('2026-05', 0, 5, 0),
      movement('2026-06', 500, 0, 0),
    ])

    expect(closingStockAsOf(withMore, '2026-03')?.closingStock).toBe(35)
  })

  it('falls back to the latest period at or before the requested one', () => {
    expect(closingStockAsOf(series, '2026-04')?.closingStock).toBe(45)
  })

  it('returns null before any known period, rather than zero', () => {
    // Zero would be indistinguishable from a SKU that sold out.
    expect(closingStockAsOf(series, '2026-01')).toBeNull()
  })
})

describe('deriveStockSeries with an opening balance', () => {
  it('carries an opening balance into the first period', () => {
    // Lets a rebuild start mid-history rather than re-deriving every month a
    // store has ever had.
    const [result] = deriveStockSeries([movement('2026-04', 20, 10, 0)], 35)

    expect(result.closingStock).toBe(45)
  })

  it('defaults to zero when no opening balance is given', () => {
    const [result] = deriveStockSeries([movement('2026-04', 20, 10, 0)])

    expect(result.closingStock).toBe(10)
  })

  it('keeps a SKU with an opening balance but no movement at that balance', () => {
    expect(deriveStockSeries([], 35)).toEqual([])
  })
})
