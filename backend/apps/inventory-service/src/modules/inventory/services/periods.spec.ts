import { periodsFrom } from './inventory.service'

describe('periodsFrom', () => {
  it('walks forward inclusively', () => {
    expect(periodsFrom('2026-01', '2026-04')).toEqual(['2026-01', '2026-02', '2026-03', '2026-04'])
  })

  it('crosses a year boundary', () => {
    expect(periodsFrom('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })

  it('returns a single period when both ends match', () => {
    expect(periodsFrom('2026-03', '2026-03')).toEqual(['2026-03'])
  })

  it('returns just the start when the end precedes it', () => {
    // A far-future `from` must not make the walk spin.
    expect(periodsFrom('2027-05', '2026-03')).toEqual(['2027-05'])
  })

  it('is bounded, so a bad input cannot loop forever', () => {
    expect(periodsFrom('1900-01', '2500-01').length).toBeLessThanOrEqual(600)
  })
})
