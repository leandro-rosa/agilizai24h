import { DEFAULT_PARAMETERS } from '../parameters/parameters.defaults'
import type { BalanceEstimate } from './balance'
import { buildConfidence, type ConfidenceInput } from './confidence'
import type { DemandEstimate } from './demand'
import type { QuantityDecision } from './quantity'

const P = DEFAULT_PARAMETERS
const demand = (over: Partial<DemandEstimate> = {}): DemandEstimate => ({ rateLow: 1, rateMid: 1, rateHigh: 1.2, rateStd: 0, observations: 10, censoredShare: 0, demandCensored: false, censoredLowerBoundRate: null, ...over })
const balance = (status: 'within_tolerance' | 'outside_tolerance' | 'not_verifiable', type: 'counted' | 'system' = 'counted'): BalanceEstimate => ({
  estimated: 8,
  anchor: { at: '2026-08-20T00:00:00.000Z', type, balanceAfter: 21 },
  daysSinceAnchor: 4,
  tolerance: { status, reason: status === 'within_tolerance' ? null : 'a_recent_count_exceeds_both_limits', window: [], totalCounts: 3, lastCountAt: null, lastCountAgeDays: 10 },
  conflicting: false,
  releasesBalanceUse: status === 'within_tolerance',
  label: status === 'within_tolerance' ? 'saldo estimado' : 'saldo estimado — baixa confiabilidade',
  gateReason: null,
})
const quantity = (over: Partial<QuantityDecision> = {}): QuantityDecision => ({ action: 'reduce', from: 21, to: 12, delta: -9, intervalDays: 19, leadDays: 2, qLow: 8, qHigh: 12, reason: 'baseline_above_demand_band', requiresSplitting: null, baselineIsOfRecord: false, ...over })
const input = (over: Partial<ConfidenceInput> = {}): ConfidenceInput => ({
  demand: demand(),
  pattern: 'stable',
  salesMonthsMissing: [],
  conflicting: false,
  balance: balance('within_tolerance'),
  quantity: quantity(),
  economics: { monthsCounted: 3, revenueCents: 1, unitsSold: 1, lostUnits: 0, marginCents: 0, lossCostCents: 0, contributionCents: 0 },
  costCents: 340,
  recentLostUnits: 0,
  parameters: P,
  ...over,
})

describe('recommendation confidence', () => {
  it('is high with many uncensored intervals and nothing weakening it', () => {
    expect(buildConfidence(input()).recommendation.level).toBe('high')
  })

  it('is medium with a few intervals and low with very few', () => {
    expect(buildConfidence(input({ demand: demand({ observations: 5 }) })).recommendation.level).toBe('medium')
    expect(buildConfidence(input({ demand: demand({ observations: 2 }) })).recommendation.level).toBe('low')
  })

  it('caps only lower it, each with its reason', () => {
    const missing = buildConfidence(input({ salesMonthsMissing: ['2026-05'] }))
    expect(missing.recommendation.level).toBe('medium')
    expect(missing.recommendation.reasons.join()).toMatch(/sales missing/)

    expect(buildConfidence(input({ pattern: 'volatile' })).recommendation.level).toBe('medium')
    expect(buildConfidence(input({ demand: demand({ demandCensored: true }) })).recommendation.level).toBe('medium')
    expect(buildConfidence(input({ conflicting: true })).recommendation.level).toBe('low')
  })

  it('a cap never raises a level that is already lower', () => {
    expect(buildConfidence(input({ demand: demand({ observations: 2 }), salesMonthsMissing: ['2026-05'] })).recommendation.level).toBe('low')
  })

  it('the baseline of record, used because the baseline of the time is unknown, caps it and says so', () => {
    const c = buildConfidence(input({ quantity: quantity({ baselineIsOfRecord: true }) }))

    expect(c.recommendation.level).toBe('medium')
    expect(c.recommendation.reasons.join()).toMatch(/baseline of the time is unknown/)
  })
})

describe('balance reliability', () => {
  it('is high within tolerance with a counted anchor', () => {
    expect(buildConfidence(input()).balanceReliability.level).toBe('high')
  })

  it('is medium within tolerance when the anchor is only a system balance', () => {
    expect(buildConfidence(input({ balance: balance('within_tolerance', 'system') })).balanceReliability.level).toBe('medium')
  })

  it('is low outside tolerance, not verifiable or conflicting', () => {
    expect(buildConfidence(input({ balance: balance('outside_tolerance') })).balanceReliability.level).toBe('low')
    expect(buildConfidence(input({ balance: balance('not_verifiable') })).balanceReliability.level).toBe('low')
    expect(buildConfidence(input({ conflicting: true })).balanceReliability.level).toBe('low')
  })

  it('HIGH recommendation confidence with LOW balance reliability is a valid combination', () => {
    const c = buildConfidence(input({ balance: balance('outside_tolerance') }))

    expect(c.recommendation.level).toBe('high')
    expect(c.balanceReliability.level).toBe('low')
  })
})

describe('priority', () => {
  it('values excess units and recent loss at cost, independently of both confidences', () => {
    const c = buildConfidence(input({ recentLostUnits: 4 }))

    // 9 excess units + 4 lost units, at R$ 3.40
    expect(c.priority.valueCents).toBe(340 * 13)
    expect(c.priority.level).toBe('low') // R$ 44.20 is below the provisional R$ 100 cut for medium
    expect(buildConfidence(input({ recentLostUnits: 40 })).priority.level).toBe('medium') // R$ 166.60
    expect(buildConfidence(input({ recentLostUnits: 90 })).priority.level).toBe('high') // R$ 336.60

  })

  it('does not change with the confidences', () => {
    const high = buildConfidence(input()).priority.valueCents
    const low = buildConfidence(input({ conflicting: true, balance: balance('outside_tolerance') })).priority.valueCents

    expect(low).toBe(high)
  })

  it('is unvalued, not zero, when the cost is unresolved', () => {
    const c = buildConfidence(input({ costCents: null }))

    expect(c.priority).toMatchObject({ valueCents: null, level: null })
    expect(c.priority.reasons.join()).toMatch(/cost unresolved/)
  })

  it('counts only a reduction as excess stock', () => {
    expect(buildConfidence(input({ quantity: quantity({ action: 'keep', to: 21, delta: 0 }) })).priority.valueCents).toBe(0)
  })
})
