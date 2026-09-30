import type { AuditVisit } from './audit-types'
import { buildChains, fullyCoveredMonths, prorateByMonth } from './consumption'

const at = (iso: string) => new Date(`${iso}Z`)

const visit = (storeId: number, end: string, lines: { sku: string; before: number; after: number }[]): AuditVisit => ({
  storeId,
  endedAt: at(end),
  lines: lines.map(line => ({
    sku: line.sku,
    balanceBefore: line.before,
    confirmedCount: null,
    restocked: 0,
    balanceAfter: line.after,
    capacity: null,
  })),
})

describe('buildChains', () => {
  it('pairs consecutive visits as balance after minus balance before the next', () => {
    const chains = buildChains([
      visit(1, '2026-03-01T10:00:00', [{ sku: 'A', before: 5, after: 29 }]),
      visit(1, '2026-03-08T10:00:00', [{ sku: 'A', before: 20, after: 25 }]),
    ])

    expect(chains).toHaveLength(1)
    expect(chains[0].pairs.map(pair => pair.consumption)).toEqual([9])
  })

  it('orders by end instant whatever order the visits arrive in', () => {
    const chains = buildChains([
      visit(1, '2026-03-08T10:00:00', [{ sku: 'A', before: 20, after: 25 }]),
      visit(1, '2026-03-01T10:00:00', [{ sku: 'A', before: 5, after: 29 }]),
    ])

    expect(chains[0].pairs[0].consumption).toBe(9)
  })

  it('keeps stores and SKUs apart', () => {
    const chains = buildChains([
      visit(1, '2026-03-01T10:00:00', [{ sku: 'A', before: 0, after: 10 }]),
      visit(2, '2026-03-01T10:00:00', [{ sku: 'A', before: 0, after: 99 }]),
      visit(1, '2026-03-08T10:00:00', [{ sku: 'A', before: 4, after: 4 }]),
    ])

    expect(chains).toHaveLength(1)
    expect(chains[0]).toMatchObject({ storeId: 1, sku: 'A' })
    expect(chains[0].pairs[0].consumption).toBe(6)
  })

  it('pairs across a visit that did not list the SKU', () => {
    const chains = buildChains([
      visit(1, '2026-03-01T10:00:00', [{ sku: 'A', before: 0, after: 10 }]),
      visit(1, '2026-03-04T10:00:00', [{ sku: 'B', before: 0, after: 3 }]),
      visit(1, '2026-03-08T10:00:00', [{ sku: 'A', before: 4, after: 4 }]),
    ])

    const chain = chains.find(entry => entry.sku === 'A')!
    expect(chain.pairs).toHaveLength(1)
    expect(chain.pairs[0].consumption).toBe(6)
  })

  it('keeps a balance rise as a negative consumption for the caller to report apart', () => {
    const chains = buildChains([
      visit(1, '2026-03-01T10:00:00', [{ sku: 'A', before: 0, after: 10 }]),
      visit(1, '2026-03-08T10:00:00', [{ sku: 'A', before: 12, after: 12 }]),
    ])

    expect(chains[0].pairs[0].consumption).toBe(-2)
  })

  it('makes no chain from a single reading', () => {
    expect(buildChains([visit(1, '2026-03-01T10:00:00', [{ sku: 'A', before: 0, after: 10 }])])).toEqual([])
  })
})

describe('prorateByMonth', () => {
  it('splits an interval spanning two months by the time spent in each', () => {
    // 29 March 00:00 → 8 April 00:00 is 10 days: 3 in March, 7 in April.
    const parts = prorateByMonth({ from: at('2026-03-29T00:00:00'), to: at('2026-04-08T00:00:00'), consumption: 10 })

    expect(parts.get('2026-03')).toBeCloseTo(3)
    expect(parts.get('2026-04')).toBeCloseTo(7)
  })

  it('keeps an interval inside one month in that month', () => {
    const parts = prorateByMonth({ from: at('2026-03-02T00:00:00'), to: at('2026-03-09T00:00:00'), consumption: 6 })

    expect([...parts.entries()]).toEqual([['2026-03', 6]])
  })

  it('spreads across more than two months and sums back to the consumption', () => {
    const parts = prorateByMonth({ from: at('2026-01-15T00:00:00'), to: at('2026-04-15T00:00:00'), consumption: 90 })

    expect([...parts.keys()]).toEqual(['2026-01', '2026-02', '2026-03', '2026-04'])
    expect([...parts.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(90)
  })

  it('puts a zero-length interval wholly in its month', () => {
    const instant = at('2026-03-09T10:00:00')

    expect([...prorateByMonth({ from: instant, to: instant, consumption: 4 }).entries()]).toEqual([['2026-03', 4]])
  })
})

describe('fullyCoveredMonths', () => {
  const chain = (firstEnd: string, lastEnd: string) => ({ firstEnd: at(firstEnd), lastEnd: at(lastEnd) })

  it('includes only the months the chain spans wholly', () => {
    expect(fullyCoveredMonths(chain('2026-02-20T00:00:00', '2026-05-10T00:00:00'), '2026-01', '2026-06')).toEqual([
      '2026-03',
      '2026-04',
    ])
  })

  it('leaves out the month in which the chain ends', () => {
    expect(fullyCoveredMonths(chain('2026-02-20T00:00:00', '2026-03-15T00:00:00'), '2026-01', '2026-06')).toEqual([])
  })

  it('counts a month whose first instant is exactly the first reading', () => {
    expect(fullyCoveredMonths(chain('2026-03-01T00:00:00', '2026-04-01T00:00:00'), '2026-03', '2026-03')).toEqual(['2026-03'])
  })
})
