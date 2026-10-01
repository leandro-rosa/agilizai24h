import { monthAvailability, summarizeAvailability, type MonthEvidence } from './availability'
import { endOfMonth, lastEndedMonth, monthDistance, monthEnded, shiftMonth } from './months'

const both = { supplyPresent: true, salesPresent: true }
const supplyOnly = { supplyPresent: true, salesPresent: false }
const nothing = { supplyPresent: false, salesPresent: false }
const stores = (counts: { both?: number; supplyOnly?: number; nothing?: number }) => [
  ...Array(counts.both ?? 0).fill(both),
  ...Array(counts.supplyOnly ?? 0).fill(supplyOnly),
  ...Array(counts.nothing ?? 0).fill(nothing),
]
const NOW = new Date('2026-10-05T00:00:00Z')

describe('month helpers', () => {
  it('shifts and measures calendar months across a year boundary', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-11', 3)).toBe('2027-02')
    expect(monthDistance('2026-08', '2026-11')).toBe(3)
    expect(monthDistance('2025-12', '2026-02')).toBe(2)
  })

  it('knows the last ended month and the instant a month ends', () => {
    expect(lastEndedMonth(NOW)).toBe('2026-09')
    expect(lastEndedMonth(new Date('2026-01-15T00:00:00Z'))).toBe('2025-12')
    expect(endOfMonth('2026-09').toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(monthEnded('2026-09', endOfMonth('2026-09'))).toBe(true)
  })
})

describe('monthAvailability — ended AND supply and sales imported for the configured share of active stores', () => {
  it('is available when the month ended and every active store has both', () => {
    expect(monthAvailability({ month: '2026-09', stores: stores({ both: 10 }) }, 0.9, NOW)).toMatchObject({ ended: true, activeStores: 10, importedStores: 10, share: 1, available: true })
  })

  it('a partially imported month is available only from the configured share up', () => {
    const nine = monthAvailability({ month: '2026-09', stores: stores({ both: 9, nothing: 1 }) }, 0.9, NOW)
    const eight = monthAvailability({ month: '2026-09', stores: stores({ both: 8, nothing: 2 }) }, 0.9, NOW)

    expect(nine).toMatchObject({ importedStores: 9, share: 0.9, available: true })
    expect(eight).toMatchObject({ importedStores: 8, share: 0.8, available: false })
  })

  it('a store with supply but no sales does not count as imported', () => {
    expect(monthAvailability({ month: '2026-09', stores: stores({ both: 5, supplyOnly: 5 }) }, 0.9, NOW)).toMatchObject({ importedStores: 5, available: false })
  })

  it('a month that has not ended is never available, however complete its data looks', () => {
    expect(monthAvailability({ month: '2026-10', stores: stores({ both: 10 }) }, 0.9, NOW)).toMatchObject({ ended: false, available: false })
    expect(monthAvailability({ month: '2026-09', stores: stores({ both: 10 }) }, 0.9, new Date('2026-09-30T23:59:59Z'))).toMatchObject({ ended: false, available: false })
  })

  it('a month with no active store is never available', () => {
    expect(monthAvailability({ month: '2026-09', stores: [] }, 0.9, NOW)).toMatchObject({ activeStores: 0, share: 0, available: false })
  })
})

describe('summarizeAvailability — dataThrough and pendingImport', () => {
  const evidence = (rows: Record<string, ReturnType<typeof stores>>): MonthEvidence[] => Object.entries(rows).map(([month, list]) => ({ month, stores: list }))

  it('dataThrough is the latest available month; the ended months after it are pendingImport with the figures', () => {
    const summary = summarizeAvailability(evidence({ '2026-07': stores({ both: 10 }), '2026-08': stores({ both: 10 }), '2026-09': stores({ both: 6, nothing: 4 }) }), 0.9, NOW)

    expect(summary.dataThrough).toBe('2026-08')
    expect(summary.pendingImport).toEqual([expect.objectContaining({ month: '2026-09', importedStores: 6, activeStores: 10, share: 0.6, requiredShare: 0.9 })])
  })

  it('an open month is neither available nor pending: it has not ended', () => {
    const summary = summarizeAvailability(evidence({ '2026-09': stores({ both: 10 }), '2026-10': stores({ both: 10 }) }), 0.9, NOW)

    expect(summary).toEqual({ dataThrough: '2026-09', pendingImport: [] })
  })

  it('with nothing available every ended month is pending and dataThrough is null', () => {
    const summary = summarizeAvailability(evidence({ '2026-08': stores({ nothing: 10 }), '2026-09': stores({ nothing: 10 }) }), 0.9, NOW)

    expect(summary.dataThrough).toBeNull()
    expect(summary.pendingImport.map(month => month.month)).toEqual(['2026-08', '2026-09'])
  })

  it('does not depend on the order the months are given in', () => {
    const rows = evidence({ '2026-09': stores({ both: 10 }), '2026-08': stores({ both: 10 }) })

    expect(summarizeAvailability(rows, 0.9, NOW).dataThrough).toBe(summarizeAvailability([...rows].reverse(), 0.9, NOW).dataThrough)
  })
})
