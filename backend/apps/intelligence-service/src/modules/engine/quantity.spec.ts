import { DEFAULT_PARAMETERS } from '../parameters/parameters.defaults'
import type { DemandEstimate } from './demand'
import { decideQuantity, replenishmentInterval, type QuantityInput } from './quantity'

const q = DEFAULT_PARAMETERS.quantity
const demand = (over: Partial<DemandEstimate> = {}): DemandEstimate => ({
  rateLow: 0.8,
  rateMid: 1,
  rateHigh: 1.2,
  rateStd: 0,
  observations: 8,
  censoredShare: 0,
  demandCensored: false,
  censoredLowerBoundRate: null,
  ...over,
})
const input = (over: Partial<QuantityInput> = {}): QuantityInput => ({
  baseline: 21,
  baselineIsOfRecord: false,
  demand: demand(),
  pattern: 'stable',
  intervalDays: 19,
  lossShare: 0,
  unitsPerPackage: null,
  parameters: q,
  ...over,
})
const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000)

describe('replenishmentInterval', () => {
  it('is the median days between the recent restocks', () => {
    expect(replenishmentInterval([day(0), day(14), day(30), day(45)], 8, null)).toBe(15)
  })

  it('uses the owner override when set', () => {
    expect(replenishmentInterval([day(0), day(14)], 8, 10)).toBe(10)
  })

  it('is null with fewer than two restocks', () => {
    expect(replenishmentInterval([day(0)], 8, null)).toBeNull()
  })

  it('looks only at the most recent restocks', () => {
    // two old, widely spaced restocks then weekly ones
    expect(replenishmentInterval([day(0), day(100), day(107), day(114), day(121)], 4, null)).toBe(7)
  })
})

describe('decideQuantity', () => {
  // qLow = ceil(1 * 21) = 21, qHigh = ceil(1.2 * 21) = 26 for H=19, L=2.
  it('keeps a baseline inside the demand band, stating the interval it assumed', () => {
    const d = decideQuantity(input())

    expect(d).toMatchObject({ action: 'keep', from: 21, to: 21, delta: 0, intervalDays: 19, qLow: 21, qHigh: 26, reason: 'baseline_within_demand_band' })
  })

  it('reduces a baseline above the band without rounding to any package multiple (21 to 12, delta -9)', () => {
    const d = decideQuantity(input({ demand: demand({ rateMid: 0.4, rateHigh: 0.55 }), unitsPerPackage: 21 }))

    // qHigh = ceil(0.55 * 21) = 12
    expect(d).toMatchObject({ action: 'reduce', from: 21, to: 12, delta: -9 })
    // only the operational implication is shown, never a rounded number
    expect(d.requiresSplitting).toEqual({ unitsPerPackage: 21 })
    expect(d.to).not.toBe(21)
  })

  it('does not state a splitting implication when the suggestion is a whole package or the size is unknown', () => {
    expect(decideQuantity(input({ unitsPerPackage: 21 })).requiresSplitting).toBeNull()
    expect(decideQuantity(input({ demand: demand({ rateMid: 0.4, rateHigh: 0.55 }) })).requiresSplitting).toBeNull()
  })

  it('increases on stock-outs when the baseline is below what the demand supports', () => {
    const d = decideQuantity(input({ baseline: 6, demand: demand({ rateMid: 0.6, rateHigh: 1, censoredShare: 0.4 }) }))

    // qLow = ceil(0.6 * 21) = 13
    expect(d).toMatchObject({ action: 'increase', from: 6, to: 13, reason: 'stockouts_with_baseline_below_demand' })
  })

  it('does NOT claim a shortage when there is no stock-out and the pattern is not growing', () => {
    const d = decideQuantity(input({ baseline: 6, demand: demand({ rateMid: 0.6, rateHigh: 1, censoredShare: 0 }) }))

    expect(d.action).toBe('no_evidence')
    expect(d.reason).toBe('below_demand_without_evidence_of_shortage')
    expect(d.to).toBeNull()
  })

  it('suggests testing a larger quantity for growing demand with low loss and no stock-out', () => {
    const d = decideQuantity(input({ baseline: 6, pattern: 'growing', lossShare: 0.02, demand: demand({ rateMid: 0.6, rateHigh: 1 }) }))

    expect(d).toMatchObject({ action: 'test', to: 13, reason: 'growing_demand_with_low_loss' })
  })

  it('does not test a larger quantity when loss is high', () => {
    expect(decideQuantity(input({ baseline: 6, pattern: 'growing', lossShare: 0.4, demand: demand({ rateMid: 0.6, rateHigh: 1 }) })).action).toBe('no_evidence')
  })

  it('refuses to pick a side when there is excess AND stock-outs', () => {
    const d = decideQuantity(input({ demand: demand({ rateMid: 0.4, rateHigh: 0.55, censoredShare: 0.5 }) }))

    expect(d).toMatchObject({ action: 'no_evidence', reason: 'conflicting_stockouts_and_excess' })
  })

  it('never reduces because of loss alone: a baseline within the band stays', () => {
    expect(decideQuantity(input({ lossShare: 0.9 })).action).toBe('keep')
  })

  it.each([
    ['no baseline', { baseline: null }, 'no_baseline'],
    ['no replenishment interval', { intervalDays: null }, 'no_replenishment_interval'],
    ['no uncensored demand', { demand: demand({ rateMid: null, rateHigh: null }) }, 'no_uncensored_demand'],
  ])('gives no evidence with %s', (_name, over, reason) => {
    expect(decideQuantity(input(over as Partial<QuantityInput>))).toMatchObject({ action: 'no_evidence', reason })
  })

  it('carries the baseline-of-record marker through', () => {
    expect(decideQuantity(input({ baselineIsOfRecord: true })).baselineIsOfRecord).toBe(true)
  })

  it('adds the safety term from the volatility of the rate', () => {
    const calm = decideQuantity(input({ demand: demand({ rateStd: 0 }) }))
    const jumpy = decideQuantity(input({ demand: demand({ rateStd: 0.5 }) }))

    expect(jumpy.qHigh!).toBeGreaterThan(calm.qHigh!)
  })
})
