import { DEFAULT_PARAMETERS } from '../parameters/parameters.defaults'
import { compareMovements, movementOf, referenceOf, situationOf, storeRows, variationOf, type Cell, type MonthFacts } from './analysis.metrics'
import type { Figure } from './analysis.types'

const P = DEFAULT_PARAMETERS.analysis
const cell = (restocked: number, sold: number, lost: number, revenueCents = 0): Cell => ({ restocked, sold, lost, revenueCents })

function facts(overrides: Partial<MonthFacts> & { stores: Record<number, Record<string, Cell>> }): MonthFacts {
  const { stores, ...rest } = overrides

  return {
    month: '2026-10',
    cells: new Map(Object.entries(stores).map(([id, skus]) => [Number(id), new Map(Object.entries(skus))])),
    storesMissingSupply: [],
    storesMissingSales: [],
    storeCount: Object.keys(stores).length,
    ...rest,
  }
}

const ok = (value: number): Figure => ({ available: true, value })

describe('movementOf', () => {
  const month = facts({ stores: { 1: { A: cell(30, 24, 2, 24000), B: cell(10, 5, 1, 5000) }, 2: { A: cell(30, 5, 8, 5000) } } })
  const cost = (sku: string) => (sku === 'A' ? 600 : 300)

  it('sums restocked, sold, lost and revenue over the supplier SKUs and values the loss at cost', () => {
    const m = movementOf(month, new Set(['A']), cost, null)

    expect(m.restocked).toEqual(ok(60))
    expect(m.sold).toEqual(ok(29))
    expect(m.lost).toEqual(ok(10))
    expect(m.revenueCents).toEqual(ok(29000))
    expect(m.lossCents).toEqual(ok(6000))
  })

  it('reports purchases as unavailable — never zero — when no purchase source has data', () => {
    const m = movementOf(month, new Set(['A']), cost, null)

    expect(m.purchasedUnits).toEqual({ available: false, reason: 'no_purchase_history' })
    expect(m.purchasedCents).toEqual({ available: false, reason: 'no_purchase_history' })
  })

  it('fills purchases when a source has them, counting only the requested SKUs', () => {
    const m = movementOf(month, new Set(['A']), cost, new Map([['A', { units: 300, cents: 180000 }], ['Z', { units: 9, cents: 9 }]]))

    expect(m.purchasedUnits).toEqual(ok(300))
    expect(m.purchasedCents).toEqual(ok(180000))
  })

  it('marks a figure partial when some stores were never ingested, and unavailable when all were', () => {
    const partial = movementOf({ ...month, storesMissingSales: [3] }, new Set(['A']), cost, null)
    expect(partial.sold).toEqual({ available: true, value: 29, partial: true })
    expect(partial.restocked).toEqual(ok(60))

    const none = movementOf({ ...month, storesMissingSales: [1, 2] }, new Set(['A']), cost, null)
    expect(none.sold).toEqual({ available: false, reason: 'never_ingested' })
  })

  it('computes margin only over sold SKUs with a cost and flags it partial when one lacks a cost', () => {
    const withGap = movementOf(month, new Set(['A', 'B']), sku => (sku === 'A' ? 600 : null), null)

    expect(withGap.marginShare.available).toBe(true)
    expect((withGap.marginShare as { partial?: boolean }).partial).toBe(true)

    const noCost = movementOf(month, new Set(['A']), () => null, null)
    expect(noCost.marginShare).toEqual({ available: false, reason: 'no_cost' })
  })
})

describe('movementOf under a store filter', () => {
  const month = facts({ stores: { 1: { A: cell(30, 24, 2, 24000) }, 2: { A: cell(30, 5, 8, 5000) } } })

  it('sums only that store and does not attribute network purchases to it', () => {
    const m = movementOf(month, new Set(['A']), () => 600, new Map([['A', { units: 300, cents: 1 }]]), 2)

    expect(m.restocked).toEqual(ok(30))
    expect(m.sold).toEqual(ok(5))
    expect(m.purchasedUnits).toEqual({ available: false, reason: 'no_base' })
  })
})

describe('variationOf / referenceOf', () => {
  it('gives no percentage against a zero reference instead of infinity', () => {
    expect(variationOf(ok(10), ok(0)).change).toEqual({ available: false, reason: 'no_base' })
  })

  it('computes the relative change', () => {
    expect(variationOf(ok(118), ok(100)).change).toEqual({ available: true, value: 0.18 })
  })

  it('carries an unavailable side through', () => {
    const none: Figure = { available: false, reason: 'no_purchase_history' }

    expect(variationOf(ok(5), none).change).toEqual(none)
    expect(variationOf(none, ok(5)).change).toEqual(none)
  })

  it('uses the previous month, or the mean of the available last 3 months, flagging a short history', () => {
    expect(referenceOf([ok(10), ok(20)], 'prev_month')).toEqual(ok(20))
    expect(referenceOf([ok(10), ok(20), ok(30), ok(40)], 'avg_3m')).toEqual(ok(30))
    expect(referenceOf([ok(10), ok(20)], 'avg_3m')).toEqual({ available: true, value: 15, partial: true })
    expect(referenceOf([], 'prev_month')).toEqual({ available: false, reason: 'no_base' })
  })

  it('compares every movement key', () => {
    const m = movementOf(facts({ stores: { 1: { A: cell(10, 8, 1, 1000) } } }), new Set(['A']), () => 100, null)
    const earlier = movementOf(facts({ stores: { 1: { A: cell(5, 4, 1, 500) } } }), new Set(['A']), () => 100, null)

    expect(compareMovements(m, [earlier], 'prev_month').sold.change).toEqual({ available: true, value: 1 })
    expect(compareMovements(m, [earlier], 'prev_month').purchasedUnits.change).toEqual({ available: false, reason: 'no_purchase_history' })
  })
})

describe('situationOf', () => {
  it.each([
    [30, 24, 2, 'good'],
    [30, 6, 8, 'attention'],
    [30, 0, 6, 'critical'],
  ])('%p restocked, %p sold, %p lost', (restocked, sold, lost, expected) => {
    expect(situationOf(restocked, sold, lost, P).situation).toBe(expected)
  })

  it('does not rate a store restocked with too few units — null, not "good"', () => {
    expect(situationOf(4, 4, 0, P)).toEqual({ situation: null, reason: 'below_min_restocked' })
  })

  it('lifts a good seller with heavy loss to attention', () => {
    expect(situationOf(30, 20, 6, P).situation).toBe('attention')
  })
})

describe('storeRows', () => {
  it('lists the worst sell-through first and carries the ratio', () => {
    const month = facts({ stores: { 1: { A: cell(30, 24, 2) }, 2: { A: cell(30, 0, 6) }, 3: { A: cell(30, 5, 8) } } })
    const rows = storeRows(month, new Set(['A']), new Map([[2, 'Franco da Rocha']]), P)

    expect(rows.map(r => r.storeId)).toEqual([2, 3, 1])
    expect(rows[0]).toMatchObject({ storeName: 'Franco da Rocha', sellThrough: 0, situation: 'critical' })
    expect(rows[1].sellThrough).toBeCloseTo(5 / 30)
  })
})
