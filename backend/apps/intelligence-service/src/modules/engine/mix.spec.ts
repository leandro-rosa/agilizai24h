import { DEFAULT_PARAMETERS } from '../parameters/parameters.defaults'
import type { DemandEstimate } from './demand'
import { DAY_MS, type MonthlyFacts, type VisitPoint } from './engine.types'
import type { Interval } from './intervals'
import { classifyPresence, computeEconomics, contributionIsLow, decideMix, everHadStock, networkRemovalPattern } from './mix'

const P = DEFAULT_PARAMETERS
const ASOF = new Date('2026-08-31T00:00:00Z')
const month = (m: string, over: Partial<MonthlyFacts> = {}): MonthlyFacts => ({ month: m, salesPresent: true, sold: 0, revenueCents: 0, removals: {}, restocked: 0, ...over })

describe('computeEconomics', () => {
  it('counts a lost unit once: contribution = margin − cost of units lost', () => {
    // 10 sold at R$ 6.90 (cost 3.40) and 3 lost to "other reason"
    const e = computeEconomics([month('2026-07', { sold: 10, revenueCents: 6900, removals: { other_reason: 3 } })], 340)

    expect(e.marginCents).toBe(6900 - 340 * 10)
    expect(e.lossCostCents).toBe(340 * 3)
    expect(e.contributionCents).toBe(6900 - 3400 - 1020)
  })

  it('does not count a return or a transfer as loss', () => {
    const e = computeEconomics([month('2026-07', { sold: 5, revenueCents: 3450, removals: { return: 6, transfer: 4, internal_use: 2, expired: 1 } })], 340)

    expect(e.lostUnits).toBe(1)
  })

  it('has no margin and no contribution when the cost is unresolved — never computed with a zero cost', () => {
    const e = computeEconomics([month('2026-07', { sold: 10, revenueCents: 6900 })], null)

    expect(e.marginCents).toBeNull()
    expect(e.contributionCents).toBeNull()
    expect(e.revenueCents).toBe(6900)
  })

  it('leaves a month without imported sales out of revenue and units sold', () => {
    const e = computeEconomics([month('2026-06', { salesPresent: false, sold: 0 }), month('2026-07', { sold: 4, revenueCents: 2760 })], 340)

    expect(e.monthsCounted).toBe(1)
    expect(e.unitsSold).toBe(4)
  })
})

describe('contributionIsLow', () => {
  const e = (contribution: number | null, revenue: number) => ({ monthsCounted: 1, revenueCents: revenue, unitsSold: 1, lostUnits: 0, marginCents: contribution, lossCostCents: 0, contributionCents: contribution })

  it('is true for a negative or near-zero contribution and false for a healthy one', () => {
    expect(contributionIsLow(e(-100, 5000), P.mix)).toBe(true)
    expect(contributionIsLow(e(100, 5000), P.mix)).toBe(true) // 2% of revenue, below the 5% share
    expect(contributionIsLow(e(2000, 5000), P.mix)).toBe(false)
  })

  it('is unknown, not low, when the cost is unknown', () => {
    expect(contributionIsLow(e(null, 5000), P.mix)).toBeNull()
  })
})

describe('everHadStock', () => {
  const v = (before: number, restocked: number, after: number): VisitPoint => ({ endedAt: ASOF, balanceBefore: before, confirmedCount: null, restocked, removedTotal: 0, adjustment: 0, balanceAfter: after })

  it('is false for a line that never carried stock and true as soon as any visit did', () => {
    expect(everHadStock([v(0, 0, 0), v(0, 0, 0)])).toBe(false)
    expect(everHadStock([])).toBe(false)
    expect(everHadStock([v(0, 0, 0), v(0, 6, 6)])).toBe(true)
  })
})

describe('classifyPresence', () => {
  const demand = (over: Partial<DemandEstimate> = {}): DemandEstimate => ({ rateLow: 0.1, rateMid: 0.1, rateHigh: 0.2, rateStd: 0, observations: 8, censoredShare: 0, demandCensored: false, censoredLowerBoundRate: null, ...over })
  const interval = (rate: number, over: Partial<Interval> = {}): Interval => ({
    from: new Date(ASOF.getTime() - 14 * DAY_MS),
    to: new Date(ASOF.getTime() - 7 * DAY_MS),
    days: 7,
    consumption: rate * 7,
    censored: false,
    noStock: false,
    rise: false,
    restockedAtStart: 6,
    removedAtStart: 0,
    startBalance: 6,
    ...over,
  })
  const events = (n: number) => Array.from({ length: n }, (_, i) => new Date(ASOF.getTime() - (n - i) * 7 * DAY_MS))
  const visitsWithStock: VisitPoint[] = [{ endedAt: ASOF, balanceBefore: 2, confirmedCount: null, restocked: 6, removedTotal: 0, adjustment: 0, balanceAfter: 8 }]
  const base = { visits: visitsWithStock, intervals: [interval(0.05), interval(0.05), interval(0.05)], restockEvents: events(6), demand: demand(), intervalDays: 7, asOf: ASOF, parameters: P }

  it('never tested: no stock ever is NOT low adherence', () => {
    expect(classifyPresence({ ...base, visits: [], restockEvents: [] })).toBe('never_tested')
  })

  it('insufficient data for a SKU restocked only a couple of times, even if it sold nothing yet', () => {
    expect(classifyPresence({ ...base, restockEvents: events(2) })).toBe('insufficient_data')
  })

  it('low adherence needs enough exposure AND recurrently low demand', () => {
    expect(classifyPresence(base)).toBe('low_adherence')
    expect(classifyPresence({ ...base, restockEvents: events(3) })).not.toBe('low_adherence')
  })

  it('a SKU restocked repeatedly while selling nothing is "restocked without sales"', () => {
    const zero = [interval(0), interval(0), interval(0)]

    expect(classifyPresence({ ...base, intervals: zero })).toBe('restocked_without_sales')
  })

  it('sells when demand is consistent', () => {
    expect(classifyPresence({ ...base, intervals: [interval(1.5), interval(1.4), interval(1.6)], demand: demand({ rateMid: 1.5 }) })).toBe('sells')
  })

  it('no recent restock: good history but the last restock is much older than the interval', () => {
    const old = [new Date(ASOF.getTime() - 120 * DAY_MS), new Date(ASOF.getTime() - 113 * DAY_MS), new Date(ASOF.getTime() - 106 * DAY_MS), new Date(ASOF.getTime() - 99 * DAY_MS), new Date(ASOF.getTime() - 92 * DAY_MS)]

    expect(classifyPresence({ ...base, restockEvents: old, intervals: [interval(1.5), interval(1.4)], demand: demand({ rateMid: 1.5 }) })).toBe('no_recent_restock')
  })
})

describe('decideMix', () => {
  const econ = (contribution: number | null, revenue = 5000) => ({ monthsCounted: 3, revenueCents: revenue, unitsSold: 5, lostUnits: 0, marginCents: contribution, lossCostCents: 0, contributionCents: contribution })
  const input = (over: Record<string, unknown> = {}) => ({ presence: 'sells' as const, isNew: false, economics: econ(2000), expiredRecurrent: false, parameters: P.mix, ...over })

  it('keeps a product that sells', () => {
    expect(decideMix(input())).toMatchObject({ mix: 'keep', removalPattern: false })
  })

  it('a new product is test, never penalised', () => {
    expect(decideMix(input({ isNew: true, presence: 'insufficient_data' })).mix).toBe('test')
  })

  it('never tested is not a verdict', () => {
    expect(decideMix(input({ presence: 'never_tested' })).mix).toBe('insufficient_data')
  })

  it('low adherence AND a low contribution → evaluate removal (never automatic)', () => {
    expect(decideMix(input({ presence: 'low_adherence', economics: econ(-200) }))).toMatchObject({ mix: 'evaluate_removal', removalPattern: true })
  })

  it('low adherence AND recurrent expiry → evaluate removal', () => {
    expect(decideMix(input({ presence: 'low_adherence', expiredRecurrent: true })).mix).toBe('evaluate_removal')
  })

  it('low sales alone do not remove a profitable product', () => {
    expect(decideMix(input({ presence: 'low_adherence', economics: econ(2000) }))).toMatchObject({ mix: 'keep', reason: 'low_adherence_but_contribution_not_low' })
  })

  it('low adherence with an unknown cost is not removal either', () => {
    expect(decideMix(input({ presence: 'low_adherence', economics: econ(null) }))).toMatchObject({ mix: 'keep', reason: 'low_adherence_but_contribution_unknown' })
  })

  it('high loss with good sales keeps the product', () => {
    expect(decideMix(input({ presence: 'sells', expiredRecurrent: true })).mix).toBe('keep')
  })
})

describe('networkRemovalPattern', () => {
  it('needs MORE than half of the stores where the SKU was exposed', () => {
    expect(networkRemovalPattern({ exposedStores: 10, storesWithRemovalPattern: 6, storesWithDamage: 0 }, P.mix)).toBe(true)
    expect(networkRemovalPattern({ exposedStores: 10, storesWithRemovalPattern: 5, storesWithDamage: 0 }, P.mix)).toBe(false)
  })

  it('is false with no network evidence or no exposure', () => {
    expect(networkRemovalPattern(null, P.mix)).toBe(false)
    expect(networkRemovalPattern({ exposedStores: 0, storesWithRemovalPattern: 0, storesWithDamage: 0 }, P.mix)).toBe(false)
  })
})
