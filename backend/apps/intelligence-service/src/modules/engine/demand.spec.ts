import { estimateDemand, weightedQuantile } from './demand'
import { DAY_MS } from './engine.types'
import type { Interval } from './intervals'
import { DEFAULT_PARAMETERS } from '../parameters/parameters.defaults'

const ASOF = new Date('2026-08-31T00:00:00Z')
const p = DEFAULT_PARAMETERS.demand

/** `rate` units/day over `days`, ending `agoDays` before the as-of date. */
const interval = (rate: number, days: number, agoDays: number, over: Partial<Interval> = {}): Interval => {
  const to = new Date(ASOF.getTime() - agoDays * DAY_MS)
  return {
    from: new Date(to.getTime() - days * DAY_MS),
    to,
    days,
    consumption: rate * days,
    censored: false,
    noStock: false,
    rise: false,
    restockedAtStart: 0,
    removedAtStart: 0,
    startBalance: 20,
    ...over,
  }
}

describe('weightedQuantile', () => {
  it('is deterministic and needs no interpolation', () => {
    const obs = [1, 2, 3, 4, 5].map(rate => ({ rate, weight: 1 }))

    expect(weightedQuantile(obs, 0.5)).toBe(3)
    expect(weightedQuantile(obs, 0.8)).toBe(4)
    expect(weightedQuantile(obs, 0.25)).toBe(2)
  })

  it('returns null with no observations', () => {
    expect(weightedQuantile([], 0.5)).toBeNull()
  })

  it('lets a heavier observation pull the quantile', () => {
    expect(weightedQuantile([{ rate: 1, weight: 1 }, { rate: 9, weight: 10 }], 0.5)).toBe(9)
  })
})

describe('estimateDemand', () => {
  it('estimates a steady SKU close to its rate', () => {
    const intervals = [70, 56, 42, 28, 14, 7].map(ago => interval(1, 7, ago))

    const d = estimateDemand(intervals, ASOF, p)

    expect(d.rateMid).toBeCloseTo(1, 5)
    expect(d.observations).toBe(6)
  })

  it('recency matters: same mean, but the SKU that fell recently is estimated lower than the flat one', () => {
    // Both average 1.0/day over the same span.
    const flat = [60, 50, 40, 30, 20, 10].map(ago => interval(1, 10, ago))
    const falling = [60, 50, 40, 30, 20, 10].map((ago, i) => interval([2, 1.8, 1.4, 0.6, 0.15, 0.05][i], 10, ago))

    const flatMid = estimateDemand(flat, ASOF, p).rateMid!
    const fallingMid = estimateDemand(falling, ASOF, p).rateMid!

    expect(fallingMid).toBeLessThan(flatMid)
    expect(fallingMid).toBeLessThan(0.7)
  })

  it('is not a plain mean: an old burst does not drag the estimate up once it is stale', () => {
    const intervals = [interval(5, 10, 200), interval(0.5, 10, 20), interval(0.5, 10, 10)]

    expect(estimateDemand(intervals, ASOF, p).rateMid).toBeCloseTo(0.5, 5)
  })

  it('never treats a censored interval as demand', () => {
    const intervals = [interval(1, 7, 30), interval(1, 7, 20), interval(9, 7, 10, { censored: true })]

    const d = estimateDemand(intervals, ASOF, p)

    expect(d.rateMid).toBeCloseTo(1, 5)
    expect(d.observations).toBe(2)
  })

  it('flags demand as censored when stock-outs are frequent, and lifts the upper rate to the lower bound', () => {
    const intervals = [
      interval(1, 7, 40),
      interval(1, 7, 30),
      interval(3, 7, 20, { censored: true }),
      interval(4, 7, 10, { censored: true }),
    ]

    const d = estimateDemand(intervals, ASOF, p)

    expect(d.demandCensored).toBe(true)
    expect(d.censoredShare).toBe(0.5)
    expect(d.rateHigh).toBe(4)
    expect(d.censoredLowerBoundRate).toBe(4)
  })

  it('does not lift the upper rate when stock-outs are rare', () => {
    const intervals = [...[60, 50, 40, 30, 20].map(ago => interval(1, 10, ago)), interval(3, 7, 5, { censored: true })]

    const d = estimateDemand(intervals, ASOF, p)

    expect(d.demandCensored).toBe(false)
    expect(d.rateHigh).toBeCloseTo(1, 5)
  })

  it('skips rises and empty-shelf intervals, which say nothing about demand', () => {
    const intervals = [interval(1, 7, 30), interval(0, 7, 20, { noStock: true }), interval(0, 7, 10, { rise: true })]

    expect(estimateDemand(intervals, ASOF, p).observations).toBe(1)
  })

  it('has no estimate at all without an uncensored observation — never a zero', () => {
    const d = estimateDemand([interval(3, 7, 10, { censored: true })], ASOF, p)

    expect(d.rateMid).toBeNull()
    expect(d.rateHigh).toBeNull()
    expect(d.observations).toBe(0)
  })
})
