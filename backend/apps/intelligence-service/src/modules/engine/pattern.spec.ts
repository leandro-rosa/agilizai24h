import { DEFAULT_PARAMETERS } from '../parameters/parameters.defaults'
import { classifyPattern, classifySeries, kendallTau } from './pattern'
import type { Interval } from './intervals'

const p = DEFAULT_PARAMETERS.pattern

describe('classifySeries — the three series of the brief', () => {
  it('20 19 21 18 20 21 is stable', () => expect(classifySeries([20, 19, 21, 18, 20, 21], p)).toBe('stable'))
  it('20 17 14 10 7 4 is declining, not volatile', () => expect(classifySeries([20, 17, 14, 10, 7, 4], p)).toBe('declining'))
  it('3 18 4 16 5 20 is volatile', () => expect(classifySeries([3, 18, 4, 16, 5, 20], p)).toBe('volatile'))
  it('a steady rise is growing', () => expect(classifySeries([3, 5, 8, 12, 15, 21], p)).toBe('growing'))
  it('too few points is insufficient', () => expect(classifySeries([4, 9], p)).toBe('insufficient'))
})

describe('kendallTau', () => {
  it('is +1, −1 and 0 at the extremes', () => {
    expect(kendallTau([1, 2, 3, 4])).toBe(1)
    expect(kendallTau([4, 3, 2, 1])).toBe(-1)
    expect(kendallTau([2, 2, 2])).toBe(0)
  })
})

describe('classifyPattern', () => {
  const interval = (rate: number, censored = false): Interval => ({
    from: new Date('2026-06-01T00:00:00Z'),
    to: new Date('2026-06-08T00:00:00Z'),
    days: 7,
    consumption: rate * 7,
    censored,
    noStock: false,
    rise: false,
    restockedAtStart: 0,
    removedAtStart: 0,
    startBalance: 10,
  })

  it('is "new" while the SKU has been restocked no more than the new window — an approximation of being tested', () => {
    expect(classifyPattern([interval(1), interval(1), interval(1)], 2, p, 6)).toBe('new')
  })

  it('classifies the last uncensored rates once it is past the new window', () => {
    const rates = [3, 18, 4, 16, 5, 20].map(rate => interval(rate))

    expect(classifyPattern(rates, 6, p, 6)).toBe('volatile')
  })

  it('ignores censored intervals when reading the pattern', () => {
    const intervals = [interval(1), interval(1), interval(1), interval(50, true)]

    expect(classifyPattern(intervals, 6, p, 6)).toBe('stable')
  })
})
