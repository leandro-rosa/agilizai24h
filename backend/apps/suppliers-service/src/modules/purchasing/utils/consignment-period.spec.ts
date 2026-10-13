import { contains, findGaps, overlaps, periodFromDays, spDayOf, spDayStart, suggestNext } from './consignment-period'

describe('consignment periods — America/Sao_Paulo, half-open [start, end)', () => {
  it('a selected day range includes the first and the last day entirely', () => {
    const period = periodFromDays('2026-09-30', '2026-10-06')

    expect(period.start.toISOString()).toBe('2026-09-30T03:00:00.000Z')
    expect(period.end.toISOString()).toBe('2026-10-07T03:00:00.000Z')
    expect(contains(period, new Date('2026-10-07T02:59:59.999Z'))).toBe(true)
  })

  it('an instant exactly on `end` belongs to the next period, not this one', () => {
    const period = periodFromDays('2026-09-30', '2026-10-06')

    expect(contains(period, period.end)).toBe(false)
    expect(contains(period, period.start)).toBe(true)
  })

  it('maps an instant to its Sao Paulo calendar day', () => {
    expect(spDayOf(new Date('2026-10-01T02:59:59Z'))).toBe('2026-09-30')
    expect(spDayOf(new Date('2026-10-01T03:00:00Z'))).toBe('2026-10-01')
    expect(spDayStart('2026-10-01').toISOString()).toBe('2026-10-01T03:00:00.000Z')
  })

  it('rejects impossible days and reversed ranges', () => {
    expect(() => spDayStart('2026-02-30')).toThrow(RangeError)
    expect(() => periodFromDays('2026-10-06', '2026-09-30')).toThrow(RangeError)
  })

  it('adjacent periods do not overlap; shared time does', () => {
    const a = periodFromDays('2026-09-30', '2026-10-06')
    const b = periodFromDays('2026-10-07', '2026-10-13')
    const c = periodFromDays('2026-10-06', '2026-10-08')

    expect(overlaps(a, b)).toBe(false)
    expect(overlaps(a, c)).toBe(true)
  })

  it('reports a gap between non-adjacent periods, even when an earlier one is long', () => {
    const long = periodFromDays('2026-09-30', '2026-10-20')
    const inside = periodFromDays('2026-10-05', '2026-10-06')
    const later = periodFromDays('2026-10-23', '2026-10-25')

    expect(findGaps([long, inside, later])).toEqual([{ start: long.end, end: later.start }])
    expect(findGaps([long, periodFromDays('2026-10-21', '2026-10-22')])).toEqual([])
  })

  it('suggests the first period starting exactly at the cutoff, then each one at the previous end', () => {
    const cutoff = new Date('2026-09-30T00:00:00-03:00')
    const first = suggestNext(null, cutoff, 7)
    const second = suggestNext(first.end, cutoff, 7)

    expect(first.start).toEqual(cutoff)
    expect(first.end.toISOString()).toBe('2026-10-07T03:00:00.000Z')
    expect(second.start).toEqual(first.end)
    expect(second.end.toISOString()).toBe('2026-10-14T03:00:00.000Z')
  })

  it('a mid-day cutoff still starts at the cutoff and ends on a day boundary', () => {
    const cutoff = new Date('2026-09-30T15:00:00-03:00')
    const first = suggestNext(null, cutoff, 7)

    expect(first.start).toEqual(cutoff)
    expect(first.end.toISOString()).toBe('2026-10-07T03:00:00.000Z')
  })
})
