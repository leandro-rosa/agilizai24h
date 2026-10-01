import { DEFAULT_PARAMETERS } from '../parameters/parameters.defaults'
import { classifyTolerance, estimateBalance, withinTolerance } from './balance'
import { DAY_MS, type VisitPoint } from './engine.types'

const t = DEFAULT_PARAMETERS.tolerance // 10% or 3 units, window 3, min 1, 45 days
const ASOF = new Date('2026-08-31T00:00:00Z')
const ago = (days: number) => new Date(ASOF.getTime() - days * DAY_MS)

const visit = (daysAgo: number, before: number, confirmed: number | null, restocked = 0, after = before + restocked): VisitPoint => ({
  endedAt: ago(daysAgo),
  balanceBefore: before,
  confirmedCount: confirmed,
  restocked,
  removedTotal: 0,
  adjustment: confirmed === null ? 0 : confirmed - before,
  balanceAfter: after,
})

describe('withinTolerance — the owner rule: the LARGER of 10% of the balance and 3 units', () => {
  it('one or two units never block only because of the percentage (balance 4, count 6)', () => {
    expect(withinTolerance(6, 4, t)).toBe(true)
  })

  it('both limits exceeded is outside (balance 30, count 22: difference 8 > max(3, 3))', () => {
    expect(withinTolerance(22, 30, t)).toBe(false)
  })

  it('the percentage wins on a large balance (balance 100, count 91: 9 <= 10)', () => {
    expect(withinTolerance(91, 100, t)).toBe(true)
    expect(withinTolerance(89, 100, t)).toBe(false)
  })

  it('exactly at the limit is acceptable', () => {
    expect(withinTolerance(7, 4, t)).toBe(true) // diff 3
    expect(withinTolerance(8, 4, t)).toBe(false) // diff 4
  })

  it('a zero balance with a small count is acceptable, with a large one is not', () => {
    expect(withinTolerance(2, 0, t)).toBe(true)
    expect(withinTolerance(4, 0, t)).toBe(false)
  })

  it('follows the configured values, not fixed ones', () => {
    expect(withinTolerance(22, 30, { ...t, pct: 0.3 })).toBe(true)
    expect(withinTolerance(6, 4, { ...t, units: 1, pct: 0.1 })).toBe(false)
  })
})

describe('classifyTolerance', () => {
  it('is not verifiable with no counts at all, and says why', () => {
    const r = classifyTolerance([visit(10, 5, null, 10)], ASOF, t)

    expect(r).toMatchObject({ status: 'not_verifiable', reason: 'no_counts', totalCounts: 0 })
  })

  it('is not verifiable when the minimum of counts is not met', () => {
    const r = classifyTolerance([visit(10, 5, 5)], ASOF, { ...t, minCounts: 2 })

    expect(r).toMatchObject({ status: 'not_verifiable', reason: 'not_enough_counts' })
  })

  it('is not verifiable when the last count is older than the maximum age', () => {
    const r = classifyTolerance([visit(60, 5, 5)], ASOF, t)

    expect(r).toMatchObject({ status: 'not_verifiable', reason: 'last_count_too_old' })
    expect(r.lastCountAgeDays).toBe(60)
  })

  it('is within tolerance when every count of the window is acceptable and recent', () => {
    const r = classifyTolerance([visit(30, 10, 10), visit(20, 8, 9), visit(5, 12, 12)], ASOF, t)

    expect(r.status).toBe('within_tolerance')
    expect(r.window).toHaveLength(3)
  })

  it('is outside tolerance when any count of the window exceeds both limits', () => {
    const r = classifyTolerance([visit(30, 10, 10), visit(20, 30, 22), visit(5, 12, 12)], ASOF, t)

    expect(r).toMatchObject({ status: 'outside_tolerance', reason: 'a_recent_count_exceeds_both_limits' })
  })

  it('only the most recent counts are considered: an old bad count outside the window is forgotten', () => {
    const r = classifyTolerance([visit(40, 30, 10), visit(30, 10, 10), visit(20, 8, 8), visit(5, 12, 12)], ASOF, { ...t, windowCounts: 3 })

    expect(r.status).toBe('within_tolerance')
  })

  it('ignores visits after the reference date and visits without a count', () => {
    const r = classifyTolerance([visit(10, 5, null), { ...visit(0, 5, 5), endedAt: new Date(ASOF.getTime() + DAY_MS) }], ASOF, t)

    expect(r.totalCounts).toBe(0)
  })

  it('compares a count with the balance the system held BEFORE the visit', () => {
    const [count] = classifyTolerance([visit(5, 8, 8, 13, 21)], ASOF, t).window

    expect(count).toMatchObject({ confirmed: 8, systemBalance: 8, difference: 0, withinTolerance: true })
  })

  it('a count of zero is a count', () => {
    expect(classifyTolerance([visit(5, 2, 0)], ASOF, t).totalCounts).toBe(1)
  })
})

describe('estimateBalance', () => {
  it('is the last balance after a visit minus the demand since, labelled an estimate and never "stock"', () => {
    const e = estimateBalance([visit(4, 8, 8, 13, 21)], ASOF, 1.5, false, t)

    expect(e.estimated).toBe(15)
    expect(e.daysSinceAnchor).toBe(4)
    expect(e.label).toMatch(/^saldo estimado/)
    expect(e.label).not.toMatch(/estoque/i)
  })

  it('never goes below zero', () => {
    expect(estimateBalance([visit(40, 2, 2, 0, 2)], ASOF, 2, false, t).estimated).toBe(0)
  })

  it('says whether the anchor is a count or only a system balance', () => {
    expect(estimateBalance([visit(4, 8, 8, 13, 21)], ASOF, 1, false, t).anchor?.type).toBe('counted')
    expect(estimateBalance([visit(4, 8, null, 13, 21)], ASOF, 1, false, t).anchor?.type).toBe('system')
  })

  it('has no estimate without any visit', () => {
    expect(estimateBalance([], ASOF, 1, false, t).estimated).toBeNull()
  })

  it('the gate is released only within tolerance and without conflicting data', () => {
    const counted = [visit(10, 10, 10), visit(4, 8, 8, 13, 21)]

    const open = estimateBalance(counted, ASOF, 1, false, t)
    expect(open).toMatchObject({ releasesBalanceUse: true, label: 'saldo estimado', gateReason: null })

    const conflicting = estimateBalance(counted, ASOF, 1, true, t)
    expect(conflicting).toMatchObject({ releasesBalanceUse: false, gateReason: 'conflicting_data', label: 'saldo estimado — baixa confiabilidade' })
  })

  it('outside tolerance closes the gate with the low-reliability label, still showing the balance for consultation', () => {
    const e = estimateBalance([visit(4, 30, 22, 0, 22)], ASOF, 1, false, t)

    expect(e).toMatchObject({ releasesBalanceUse: false, gateReason: 'outside_tolerance', label: 'saldo estimado — baixa confiabilidade' })
    expect(e.estimated).toBe(18)
  })

  it('a SKU that never held stock never releases the gate, even though a count of zero equals a balance of zero', () => {
    const e = estimateBalance([visit(5, 0, 0), visit(2, 0, 0)], ASOF, null, false, t, false)

    expect(e).toMatchObject({ releasesBalanceUse: false, gateReason: 'never_stocked' })
  })

  it('not verifiable also closes the gate, with the reason', () => {
    const e = estimateBalance([visit(4, 8, null, 13, 21)], ASOF, 1, false, t)

    expect(e).toMatchObject({ releasesBalanceUse: false, gateReason: 'no_counts' })
  })
})
