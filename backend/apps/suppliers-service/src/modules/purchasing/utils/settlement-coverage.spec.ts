import { daysOverlap, findOverlap, lastDay, weekInterval } from './settlement-coverage'

describe('settlement coverage — which days a settlement already covers', () => {
  it('a week covers Monday through Sunday, the next Monday being the exclusive end', () => {
    expect(weekInterval('2026-10-05')).toEqual({ from: '2026-10-05', until: '2026-10-12' })
    expect(lastDay(weekInterval('2026-10-05'))).toBe('2026-10-11')
  })

  it('adjacent intervals do not overlap; one shared day does', () => {
    const legacy = { from: '2026-09-22', until: '2026-09-30' }

    expect(daysOverlap(legacy, { from: '2026-09-30', until: '2026-10-07' })).toBe(false)
    expect(daysOverlap(legacy, { from: '2026-09-29', until: '2026-10-06' })).toBe(true)
  })

  it('the week of 21/09 overlaps a settlement of 22/09 to 29/09 (the real case)', () => {
    expect(daysOverlap(weekInterval('2026-09-21'), { from: '2026-09-22', until: '2026-09-30' })).toBe(true)
  })

  it('returns the id of the first covered interval it touches, or null', () => {
    const existing = [{ id: 1, from: '2026-09-01', until: '2026-09-08' }, { id: 2, from: '2026-09-22', until: '2026-09-30' }]

    expect(findOverlap({ from: '2026-09-28', until: '2026-10-05' }, existing)).toBe(2)
    expect(findOverlap({ from: '2026-09-30', until: '2026-10-07' }, existing)).toBeNull()
    expect(findOverlap({ from: '2026-10-01', until: '2026-10-08' }, [])).toBeNull()
  })
})
