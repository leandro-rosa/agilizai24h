import { DEFAULT_PARAMETERS } from '../parameters/parameters.defaults'
import { assessCoherence, COHERENCE_MEANING, RECURRING_LOSS_CYCLES } from './coherence'
import type { AssessedAction } from './backtest.types'
import type { FollowCycle, FollowFacts } from './following'

const cycle = (over: Partial<FollowCycle> = {}): FollowCycle => ({ days: 7, consumption: 4, censored: false, startBalance: 10, loss: 0, ...over })

function follow(cycles: FollowCycle[], over: Partial<FollowFacts> = {}): FollowFacts {
  const lost = cycles.reduce((sum, c) => sum + c.loss, 0)
  return {
    periodStart: '2026-06-01T00:00:00.000Z',
    periodEnd: '2026-06-30T23:59:59.999Z',
    months: ['2026-06'],
    salesMonthsMissing: [],
    unitsSold: cycles.reduce((sum, c) => sum + c.consumption, 0),
    revenueCents: 100_000,
    lostByReason: { expired: lost, damaged_product: 0, other_reason: 0 },
    lostUnits: lost,
    restockedUnits: 40,
    economics: { monthsCounted: 1, revenueCents: 100_000, unitsSold: 20, lostUnits: lost, marginCents: 40_000, lossCostCents: lost * 100, contributionCents: 40_000 - lost * 100 },
    intervals: [],
    cycles,
    stockouts: cycles.filter(c => c.censored).length,
    observedRate: 0.5,
    lossAllocation: 'proportional_to_visit_removals',
    ...over,
  }
}

const assess = (action: AssessedAction, f: FollowFacts, over: { baseline?: number | null; target?: number | null; originRate?: number | null } = {}) =>
  assessCoherence({ action, baseline: over.baseline === undefined ? 21 : over.baseline, target: over.target === undefined ? 10 : over.target, follow: f, originRate: over.originRate === undefined ? 0.6 : over.originRate, parameters: DEFAULT_PARAMETERS })

describe('reduce', () => {
  it('is compatible with the data when units were lost and no cycle went above the suggested quantity', () => {
    const a = assess('reduce', follow([cycle({ consumption: 6, loss: 5 }), cycle({ consumption: 5, loss: 0 })]))

    expect(a.class).toBe('coherent')
    expect(a.label).toBe('estimate')
    expect(a.reason).toBe('loss_followed_and_demand_stayed_within_target')
    expect(a.reduction).toMatchObject({ cyclesAboveTarget: 0, salesPotentiallyAtRisk: 0, lossPotentiallyAvoidable: 5 })
    expect(a.meaning).toMatch(/compatible with this recommendation under the criteria shown/)
  })

  it('limits the avoidable loss by the headroom between baseline and suggestion (an upper bound)', () => {
    const a = assess('reduce', follow([cycle({ consumption: 4, loss: 30 }), cycle({ consumption: 4, loss: 30 })]), { baseline: 21, target: 15 })

    expect(a.reduction?.headroom).toBe(6)
    expect(a.reduction?.lossPotentiallyAvoidable).toBe(12) // min(30, 6) per cycle, not the 60 lost
    expect(a.reduction?.lossesFollowed.total).toBe(60)
  })

  it('is inconclusive with mixed evidence: a loss followed AND one cycle consumed more than the suggestion', () => {
    const a = assess('reduce', follow([cycle({ consumption: 14, loss: 0 }), cycle({ consumption: 3, loss: 6 })]), { baseline: 21, target: 10 })

    expect(a.class).toBe('inconclusive')
    expect(a.reason).toBe('conflicting_criteria_loss_and_demand_above_target')
    // each piece of evidence is shown on its own, never merged into one score
    expect(a.reduction).toEqual({
      lossesFollowed: { expired: 6, damaged_product: 0, other_reason: 0, total: 6 },
      salesFollowedUnits: 17,
      followingCycles: 2,
      cyclesAboveTarget: 1,
      lossPotentiallyAvoidable: 6,
      salesPotentiallyAtRisk: 4,
      headroom: 11,
    })
  })

  it('is incoherent when nothing was lost and demand went above the suggestion', () => {
    const a = assess('reduce', follow([cycle({ consumption: 16 }), cycle({ consumption: 15 })]), { baseline: 21, target: 10 })

    expect(a.class).toBe('incoherent')
    expect(a.reduction).toMatchObject({ cyclesAboveTarget: 2, lossPotentiallyAvoidable: 0, salesPotentiallyAtRisk: 11 })
    expect(a.meaning).toMatch(/point against this recommendation under the criteria shown/)
  })

  it('counts a cycle that emptied the shelf with more stock than the suggestion as demand above it', () => {
    const a = assess('reduce', follow([cycle({ consumption: 8, censored: true, startBalance: 21 }), cycle({ consumption: 8 })]), { baseline: 21, target: 10 })

    expect(a.reduction?.cyclesAboveTarget).toBe(1)
  })

  it('treats a negligible amount above the suggestion as not material, as the design allows', () => {
    // 1 unit above the target against 200 sold is below the 10% share
    const a = assess('reduce', follow([cycle({ consumption: 11, loss: 4 }), cycle({ consumption: 8 })], { unitsSold: 200 }), { baseline: 21, target: 10 })

    expect(a.reduction?.cyclesAboveTarget).toBe(1)
    expect(a.class).toBe('coherent')
  })

  it('is inconclusive when no loss followed and demand stayed within the suggestion: the data say nothing either way', () => {
    const a = assess('reduce', follow([cycle({ consumption: 5 }), cycle({ consumption: 6 })]))

    expect(a.class).toBe('inconclusive')
    expect(a.reason).toBe('no_loss_and_no_material_demand_above_target')
  })
})

describe('increase and test', () => {
  it('is compatible when a stock-out followed with low loss', () => {
    const a = assess('increase', follow([cycle({ consumption: 9, censored: true }), cycle()]), { baseline: 8, target: 12 })

    expect(a.class).toBe('coherent')
  })

  it('is compatible when consumption reached the baseline with low loss (test)', () => {
    const a = assess('test', follow([cycle({ consumption: 8 }), cycle()]), { baseline: 8, target: 12 })

    expect(a.class).toBe('coherent')
  })

  it('is inconclusive when the shortage is there but so is a high loss', () => {
    const a = assess('increase', follow([cycle({ consumption: 9, censored: true, loss: 15 }), cycle()]), { baseline: 8, target: 12 })

    expect(a.class).toBe('inconclusive')
    expect(a.reason).toBe('conflicting_criteria_shortage_and_loss')
  })

  it('is incoherent when no stock-out followed and demand fell (an unsupported increase)', () => {
    const a = assess('increase', follow([cycle({ consumption: 2 }), cycle({ consumption: 3 })], { observedRate: 0.2 }), { baseline: 8, target: 12, originRate: 0.7 })

    expect(a.class).toBe('incoherent')
    expect(a.reason).toBe('no_stockout_and_demand_fell')
  })

  it('is inconclusive when neither happened but demand did not fall', () => {
    const a = assess('increase', follow([cycle({ consumption: 2 }), cycle({ consumption: 3 })], { observedRate: 0.8 }), { baseline: 8, target: 12, originRate: 0.7 })

    expect(a.class).toBe('inconclusive')
  })
})

describe('keep', () => {
  it('is compatible without stock-outs or recurring loss', () => {
    expect(assess('keep', follow([cycle(), cycle({ loss: 2 })]), { target: 21 }).class).toBe('coherent')
  })

  it('is incoherent with both a stock-out and a recurring loss', () => {
    const a = assess('keep', follow([cycle({ censored: true, loss: 2 }), cycle({ loss: 3 })]), { target: 21 })

    expect(a.class).toBe('incoherent')
    expect(RECURRING_LOSS_CYCLES).toBe(2)
  })

  it('is inconclusive when only one of them happened', () => {
    expect(assess('keep', follow([cycle({ censored: true }), cycle()]), { target: 21 }).class).toBe('inconclusive')
    expect(assess('keep', follow([cycle({ loss: 2 }), cycle({ loss: 2 })]), { target: 21 }).class).toBe('inconclusive')
  })
})

describe('evaluate removal', () => {
  it('is compatible when demand and the economic result stayed low', () => {
    const f = follow([cycle({ consumption: 0 }), cycle({ consumption: 1 })], {
      observedRate: 0.05,
      revenueCents: 1000,
      economics: { monthsCounted: 1, revenueCents: 1000, unitsSold: 1, lostUnits: 3, marginCents: 400, lossCostCents: 600, contributionCents: -200 },
    })

    expect(assess('evaluate_removal', f).class).toBe('coherent')
  })

  it('is incoherent when both recovered', () => {
    const f = follow([cycle({ consumption: 7 }), cycle({ consumption: 8 })], { observedRate: 1.5 })

    expect(assess('evaluate_removal', f).class).toBe('incoherent')
  })

  it('is inconclusive when demand stayed low but the economic result did not', () => {
    const f = follow([cycle({ consumption: 1 }), cycle({ consumption: 0 })], { observedRate: 0.05 })

    expect(assess('evaluate_removal', f).class).toBe('inconclusive')
  })
})

describe('too little afterwards', () => {
  it.each<AssessedAction>(['reduce', 'increase', 'test', 'keep', 'evaluate_removal'])('%s with fewer following cycles than the minimum is inconclusive', action => {
    const a = assess(action, follow([cycle({ consumption: 20, loss: 9 })]))

    expect(a.class).toBe('inconclusive')
    expect(a.reason).toBe('too_few_following_cycles')
    expect(a.criteria[0]).toMatchObject({ code: 'following_cycles_at_least_minimum', value: 1 })
  })
})

describe('wording', () => {
  const CLAIMS = /correct|proven|proof|validated|approved|accepted|verdict|would have worked|passed|failed/i

  it('never claims correctness, validation or that it would have worked, in any class or criterion', () => {
    const outputs = [
      assess('reduce', follow([cycle({ consumption: 6, loss: 5 }), cycle()])),
      assess('reduce', follow([cycle({ consumption: 16 }), cycle({ consumption: 15 })])),
      assess('increase', follow([cycle({ consumption: 9, censored: true }), cycle()]), { baseline: 8, target: 12 }),
      assess('keep', follow([cycle(), cycle()]), { target: 21 }),
      assess('evaluate_removal', follow([cycle(), cycle()])),
      assess('keep', follow([cycle()])),
    ]

    for (const text of [...Object.values(COHERENCE_MEANING), ...outputs.flatMap(a => [a.meaning, a.reason, ...a.criteria.map(c => c.description)])]) expect(text).not.toMatch(CLAIMS)
    for (const a of outputs) expect(a.label).toBe('estimate')
  })

  it('shows the criteria beside every class', () => {
    expect(assess('keep', follow([cycle(), cycle()]), { target: 21 }).criteria.length).toBeGreaterThanOrEqual(3)
  })
})
