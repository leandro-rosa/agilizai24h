import { computeSettlement, type OnSaleItem } from './settlement'
import { addDays, isDay, weekRange, weekStartOf } from './week'

const item = (itemId: number, quantity: number, unitCostCents = 500, deliveredOn = '2026-10-05', sku = 'Q1'): OnSaleItem => ({ itemId, deliveredOn, sku, quantity, unitCostCents })

describe('computeSettlement — pays only for what sold', () => {
  it('the Quinoa case: 100 delivered, 62 sold, 8 expired, 30 unsold → R$ 310,00', () => {
    const result = computeSettlement({ items: [item(1, 100)], soldBySku: new Map([['Q1', 62]]), writeOffs: [{ itemId: 1, expired: 8, returned: 0 }], prior: [] })

    expect(result.owedCents).toBe(31000)
    expect(result.lines[0]).toMatchObject({ delivered: 100, sold: 62, expired: 8, returned: 0, unsold: 30, owedUnits: 62 })
  })

  it('keeps a running balance across weeks: only the open units can still be owed', () => {
    const week2 = computeSettlement({
      items: [item(1, 100)],
      soldBySku: new Map([['Q1', 20]]),
      writeOffs: [],
      prior: [{ itemId: 1, owedUnits: 62, writtenOffUnits: 8 }],
    })

    expect(week2.lines[0]).toMatchObject({ openBefore: 30, sold: 20, unsold: 10, owedCents: 10000 })
  })

  it('never owes more than what is open, and reports sales that came from other stock', () => {
    const result = computeSettlement({ items: [item(1, 10)], soldBySku: new Map([['Q1', 25]]), writeOffs: [], prior: [] })

    expect(result.lines[0].owedUnits).toBe(10)
    expect(result.soldNotCovered).toEqual({ Q1: 15 })
  })

  it('applies write-offs before sales: an expired unit cannot also have sold', () => {
    const result = computeSettlement({ items: [item(1, 10)], soldBySku: new Map([['Q1', 10]]), writeOffs: [{ itemId: 1, expired: 4, returned: 2 }], prior: [] })

    expect(result.lines[0]).toMatchObject({ expired: 4, returned: 2, sold: 4, unsold: 0, owedCents: 2000 })
  })

  it('caps write-offs at what is open and says so', () => {
    const result = computeSettlement({ items: [item(1, 5)], soldBySku: new Map(), writeOffs: [{ itemId: 1, expired: 9, returned: 0 }], prior: [] })

    expect(result.lines[0]).toMatchObject({ expired: 5, writeOffCapped: true, owedCents: 0 })
  })

  it('allocates the sales of one SKU to the oldest delivery first', () => {
    const result = computeSettlement({
      items: [item(2, 10, 600, '2026-10-12'), item(1, 10, 500, '2026-10-05')],
      soldBySku: new Map([['Q1', 14]]),
      writeOffs: [],
      prior: [],
    })

    const byId = Object.fromEntries(result.lines.map(l => [l.itemId, l]))
    expect(byId[1]).toMatchObject({ sold: 10, owedCents: 5000 })
    expect(byId[2]).toMatchObject({ sold: 4, owedCents: 2400, unsold: 6 })
    expect(result.owedCents).toBe(7400)
  })

  it('owes nothing when nothing sold', () => {
    const result = computeSettlement({ items: [item(1, 40)], soldBySku: new Map(), writeOffs: [], prior: [] })

    expect(result.owedCents).toBe(0)
    expect(result.lines[0].unsold).toBe(40)
  })
})

describe('week helpers', () => {
  it('finds the Monday of the ISO week and its range', () => {
    expect(weekStartOf('2026-10-07')).toBe('2026-10-05')
    expect(weekStartOf('2026-10-05')).toBe('2026-10-05')
    expect(weekStartOf('2026-10-11')).toBe('2026-10-05')
    expect(weekRange('2026-10-05')).toEqual({ from: '2026-10-05', to: '2026-10-11' })
  })

  it('adds days across month ends and refuses impossible dates', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(isDay('2026-02-30')).toBe(false)
    expect(isDay('2026-02-28')).toBe(true)
  })
})
