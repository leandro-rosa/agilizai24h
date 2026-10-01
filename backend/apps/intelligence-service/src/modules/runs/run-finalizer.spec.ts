import { dataThroughOf, monthEnded } from './run-finalizer'

const store = (months: Record<string, [boolean, boolean]>) => Object.entries(months).map(([month, [supplyPresent, salesPresent]]) => ({ month, supplyPresent, salesPresent }))
const ASOF = new Date('2026-10-05T00:00:00Z')

describe('monthEnded', () => {
  it('is true only once the whole month has passed', () => {
    expect(monthEnded('2026-08', ASOF)).toBe(true)
    expect(monthEnded('2026-10', ASOF)).toBe(false)
    expect(monthEnded('2026-09', new Date('2026-09-30T12:00:00Z'))).toBe(false)
    expect(monthEnded('2026-09', new Date('2026-10-01T00:00:00Z'))).toBe(true)
  })
})

describe('dataThroughOf — a month counts only when supply AND sales are present for the configured share of stores', () => {
  const full = store({ '2026-07': [true, true], '2026-08': [true, true] })

  it('is the latest month every store has both for', () => {
    expect(dataThroughOf([full, full, full], 0.9, '2026-09', ASOF)).toBe('2026-08')
  })

  it('does not claim a month whose sales are missing at most stores', () => {
    const noSales = store({ '2026-07': [true, true], '2026-08': [true, false] })

    expect(dataThroughOf([noSales, noSales, full], 0.9, '2026-09', ASOF)).toBe('2026-07')
  })

  it('tolerates a few late stores up to the share', () => {
    const late = store({ '2026-07': [true, true], '2026-08': [true, false] })
    const stores = [...Array(9).fill(full), late]

    expect(dataThroughOf(stores, 0.9, '2026-09', ASOF)).toBe('2026-08')
    expect(dataThroughOf(stores, 1, '2026-09', ASOF)).toBe('2026-07')
  })

  it('never claims a month beyond the requested range', () => {
    expect(dataThroughOf([store({ '2026-08': [true, true], '2026-09': [true, true] })], 0.9, '2026-08', ASOF)).toBe('2026-08')
  })

  it('never claims a month that has not ended before the reference date', () => {
    expect(dataThroughOf([store({ '2026-09': [true, true] })], 0.9, '2026-09', new Date('2026-09-20T00:00:00Z'))).toBeNull()
  })

  it('is null with no store or no qualifying month', () => {
    expect(dataThroughOf([], 0.9, '2026-08', ASOF)).toBeNull()
    expect(dataThroughOf([store({ '2026-08': [false, false] })], 0.9, '2026-08', ASOF)).toBeNull()
  })
})
