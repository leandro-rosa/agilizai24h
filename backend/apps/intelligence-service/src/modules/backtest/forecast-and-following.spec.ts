import type { Interval } from '../engine/intervals'
import { inputFromReal } from '../engine/engine.testing'
import { REAL_PAIRS } from '../engine/real-pairs.fixture'
import { aggregateForecastError, forecastObservation } from './forecast-error'
import { allocateLoss, followingFacts, followingMonths } from './following'

const interval = (over: Partial<Interval>): Interval => ({
  from: new Date('2026-06-01T00:00:00Z'),
  to: new Date('2026-06-08T00:00:00Z'),
  days: 7,
  consumption: 7,
  censored: false,
  noStock: false,
  rise: false,
  restockedAtStart: 10,
  removedAtStart: 0,
  startBalance: 10,
  ...over,
})

describe('forecast error', () => {
  it('compares predicted with observed consumption and leaves censored observations out, counting them apart', () => {
    const obs = forecastObservation(1, [interval({ consumption: 7 }), interval({ consumption: 4, days: 7 }), interval({ consumption: 10, censored: true })])!

    expect(obs.predictedUnits).toBe(14) // 1 per day over the 14 uncensored days
    expect(obs.observedUnits).toBe(11)
    expect(obs.absoluteError).toBe(3)
    expect(obs.intervals).toBe(2)
    expect(obs.censoredIntervals).toBe(1)
    expect(obs.censoredLowerBoundUnits).toBe(10)
  })

  it('a following period that ended in a stock-out is counted as censored and excluded from the error', () => {
    const only = forecastObservation(1, [interval({ consumption: 10, censored: true })])!
    const agg = aggregateForecastError([only])

    expect(only.intervals).toBe(0)
    expect(agg.pairs).toBe(0)
    expect(agg.wape).toBeNull()
    expect(agg.censoredIntervals).toBe(1)
    expect(agg.pairsWithoutObservation).toBe(1)
  })

  it('excludes rises (data conflicts) and stretches with no stock', () => {
    const obs = forecastObservation(1, [interval({ rise: true, consumption: 0 }), interval({ noStock: true, consumption: 0 }), interval({ consumption: 7 })])!

    expect(obs.intervals).toBe(1)
    expect(obs.excludedConflicts).toBe(1)
  })

  it('has no forecast when the engine had no uncensored demand', () => {
    expect(forecastObservation(null, [interval({})])).toBeNull()
    expect(aggregateForecastError([null]).pairsWithoutForecast).toBe(1)
  })

  it('is one metric: sum of absolute differences over units observed', () => {
    const a = forecastObservation(1, [interval({ consumption: 10 })])! // predicted 7, observed 10
    const b = forecastObservation(2, [interval({ consumption: 10 })])! // predicted 14, observed 10
    const agg = aggregateForecastError([a, b])

    expect(agg.wape).toBeCloseTo((3 + 4) / 20)
    expect(agg.pairs).toBe(2)
  })
})

describe('following period', () => {
  it('splits the months of the period up to the next origin, and the last one through the data-through month', () => {
    expect(followingMonths(new Date('2026-05-01T00:00:00Z'), new Date('2026-06-01T00:00:00Z'), '2026-08')).toEqual(['2026-05'])
    expect(followingMonths(new Date('2026-08-01T00:00:00Z'), null, '2026-08')).toEqual(['2026-08'])
  })

  it('places the loss in cycles in proportion to the removals recorded at visits, or says it could not', () => {
    expect(allocateLoss([-6, -2], 8)).toEqual({ loss: [6, 2], how: 'proportional_to_visit_removals' })
    expect(allocateLoss([0, 0], 5)).toEqual({ loss: [5, 0], how: 'monthly_total_in_first_cycle' })
    expect(allocateLoss([-3], 0).how).toBe('none')
  })

  it('reads sales, loss by reason and the economic result of the real following month, counting each lost unit once', () => {
    const full = inputFromReal(REAL_PAIRS.cheetos_adm, { baseline: 5 })
    const origin = new Date('2026-06-01T00:00:00Z')
    const facts = followingFacts(full, origin, new Date('2026-06-30T23:59:59.999Z'), ['2026-06'])
    const june = full.monthly.find(month => month.month === '2026-06')!

    expect(facts.unitsSold).toBe(june.sold)
    expect(facts.lostByReason.expired).toBe(june.removals.expired ?? 0)
    expect(facts.lostUnits).toBe(facts.lostByReason.expired + facts.lostByReason.damaged_product + facts.lostByReason.other_reason)
    const cost = full.costCents as number
    expect(facts.economics.contributionCents).toBe(june.revenueCents - cost * june.sold - cost * facts.lostUnits)
    expect(facts.intervals.every(i => i.to.getTime() >= origin.getTime() && i.to.getTime() <= new Date('2026-06-30T23:59:59.999Z').getTime())).toBe(true)
  })
})
