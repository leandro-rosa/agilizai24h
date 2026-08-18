import { resolveCostAsOf } from './resolve-cost'

const version = (date: string, cents: number) => ({ effective_from: new Date(date), cost_cents: cents })

describe('resolveCostAsOf', () => {
  const january = version('2026-01-01', 250)
  const june = version('2026-06-01', 300)
  const versions = [january, june]

  it('picks the version in effect for a date between two', () => {
    // Valuing March must use the January cost, never the later June one.
    expect(resolveCostAsOf(versions, new Date('2026-03-15'))).toEqual(january)
  })

  it('includes a version effective exactly on the requested date', () => {
    expect(resolveCostAsOf(versions, new Date('2026-06-01'))).toEqual(june)
  })

  it('excludes a version effective the day after', () => {
    expect(resolveCostAsOf(versions, new Date('2026-05-31'))).toEqual(january)
  })

  it('returns null before every known version, rather than falling back', () => {
    // Inventing a price for a period that has none produces a wrong number
    // with nothing to indicate it.
    expect(resolveCostAsOf(versions, new Date('2025-12-31'))).toBeNull()
  })

  it('returns null when there are no versions at all', () => {
    expect(resolveCostAsOf([], new Date('2026-03-15'))).toBeNull()
  })

  it('is order-independent', () => {
    expect(resolveCostAsOf([june, january], new Date('2026-03-15'))).toEqual(january)
  })

  it('treats a recorded zero cost as a real cost, not as absence', () => {
    const free = version('2026-01-01', 0)
    expect(resolveCostAsOf([free], new Date('2026-03-15'))).toEqual(free)
  })
})
