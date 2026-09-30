import type { AuditBands, AuditVisit, AuditVisitLine, StoreMonthSales } from './audit-types'
import { computeBalanceAudit } from './balance-audit'
import { DEFAULT_BANDS } from './bands'

const at = (iso: string) => new Date(`${iso}Z`)

const line = (over: Partial<AuditVisitLine> & { sku: string }): AuditVisitLine => ({
  balanceBefore: 0,
  confirmedCount: null,
  restocked: 0,
  balanceAfter: 0,
  capacity: null,
  ...over,
})

const visit = (storeId: number, end: string, lines: AuditVisitLine[]): AuditVisit => ({ storeId, endedAt: at(end), lines })

const sales = (storeId: number, month: string, bySku: Record<string, number> | null): StoreMonthSales => ({
  storeId,
  month,
  present: bySku !== null,
  bySku: new Map(Object.entries(bySku ?? {})),
})

const audit = (visits: AuditVisit[], salesRows: StoreMonthSales[] = [], bands: AuditBands = DEFAULT_BANDS, range = ['2026-03', '2026-04']) =>
  computeBalanceAudit({ from: range[0], to: range[1], visits, sales: salesRows, bands })

describe('count versus system balance', () => {
  it('reports counted lines, the share equal, and the difference in units and relative', () => {
    const result = audit([
      visit(1, '2026-03-05T10:00:00', [
        line({ sku: 'A', balanceBefore: 10, confirmedCount: 10 }),
        line({ sku: 'B', balanceBefore: 10, confirmedCount: 10 }),
        line({ sku: 'C', balanceBefore: 10, confirmedCount: 8 }),
        line({ sku: 'D', balanceBefore: 4, confirmedCount: 5 }),
      ]),
    ])

    const overall = result.count_vs_system.overall
    expect(overall.lines).toBe(4)
    expect(overall.share_zero).toBe(0.5)
    expect(overall.absolute_bins.find(bin => bin.label === '0')!.lines).toBe(2)
    expect(overall.absolute_bins.find(bin => bin.label === '≤1')!.lines).toBe(1)
    expect(overall.absolute_bins.find(bin => bin.label === '≤2')!.lines).toBe(1)
    // |−2|/10 = 20% falls in ≤25%, |1|/4 = 25% also ≤25%.
    expect(overall.relative_bins.find(bin => bin.label === '≤25%')!.lines).toBe(2)
  })

  it('never treats a line without a count as equal to the system balance', () => {
    const result = audit([
      visit(1, '2026-03-05T10:00:00', [
        line({ sku: 'A', balanceBefore: 10, confirmedCount: null }),
        line({ sku: 'B', balanceBefore: 10, confirmedCount: 10 }),
      ]),
    ])

    expect(result.count_vs_system.lines_total).toBe(2)
    expect(result.count_vs_system.lines_counted).toBe(1)
    expect(result.count_vs_system.lines_uncounted).toBe(1)
    expect(result.count_vs_system.overall.lines).toBe(1)
  })

  it('keeps a genuine count of zero as a count', () => {
    const result = audit([visit(1, '2026-03-05T10:00:00', [line({ sku: 'A', balanceBefore: 3, confirmedCount: 0 })])])

    expect(result.count_vs_system.lines_counted).toBe(1)
    expect(result.count_vs_system.overall.absolute_bins.find(bin => bin.label === '≤5')!.lines).toBe(1)
  })

  it('stratifies by turnover band, each with its own line count', () => {
    const result = audit(
      [
        visit(1, '2026-03-05T10:00:00', [
          line({ sku: 'FAST', balanceBefore: 10, confirmedCount: 9 }),
          line({ sku: 'SLOW', balanceBefore: 10, confirmedCount: 10 }),
          line({ sku: 'SLOW2', balanceBefore: 6, confirmedCount: 6 }),
        ]),
      ],
      [sales(1, '2026-03', { FAST: 40, SLOW: 2, SLOW2: 1 }), sales(1, '2026-04', { FAST: 40, SLOW: 2, SLOW2: 1 })],
    )

    expect(result.count_vs_system.by_turnover.high.lines).toBe(1)
    expect(result.count_vs_system.by_turnover.low.lines).toBe(2)
    expect(result.count_vs_system.by_turnover.medium.lines).toBe(0)
  })

  it('says "unknown", not "no sales", when the store has no imported sales month', () => {
    const result = audit([visit(1, '2026-03-05T10:00:00', [line({ sku: 'A', balanceBefore: 10, confirmedCount: 10 })])], [
      sales(1, '2026-03', null),
    ])

    expect(result.count_vs_system.by_turnover.unknown.lines).toBe(1)
    expect(result.count_vs_system.by_turnover.no_sales.lines).toBe(0)
  })

  it('stratifies by balance band', () => {
    const result = audit([
      visit(1, '2026-03-05T10:00:00', [
        line({ sku: 'A', balanceBefore: 0, confirmedCount: 0 }),
        line({ sku: 'B', balanceBefore: 3, confirmedCount: 3 }),
        line({ sku: 'C', balanceBefore: 50, confirmedCount: 48 }),
      ]),
    ])

    expect(result.count_vs_system.by_balance['0'].lines).toBe(1)
    expect(result.count_vs_system.by_balance['1–5'].lines).toBe(1)
    expect(result.count_vs_system.by_balance['41+'].lines).toBe(1)
  })

  it('counts a zero system balance with a non-zero count as relative-undefined, not infinite', () => {
    const result = audit([visit(1, '2026-03-05T10:00:00', [line({ sku: 'A', balanceBefore: 0, confirmedCount: 2 })])])

    expect(result.count_vs_system.overall.relative_undefined).toBe(1)
  })
})

describe('count coverage', () => {
  it('reports, per store and month, operations with a count and the share of positive-balance lines counted', () => {
    const result = audit([
      visit(1, '2026-03-05T10:00:00', [
        line({ sku: 'A', balanceBefore: 10, confirmedCount: 10 }),
        line({ sku: 'B', balanceBefore: 5, confirmedCount: null }),
        line({ sku: 'C', balanceBefore: 0, confirmedCount: null }),
      ]),
      visit(1, '2026-03-12T10:00:00', [line({ sku: 'A', balanceBefore: 8, confirmedCount: null })]),
    ])

    expect(result.count_coverage).toEqual([
      {
        store_id: 1,
        month: '2026-03',
        operations: 2,
        operations_with_count: 1,
        lines: 4,
        counted_lines: 1,
        positive_balance_lines: 3,
        counted_positive_balance_lines: 1,
        share_positive_balance_counted: 1 / 3,
      },
    ])
  })

  it('leaves the share null when a month had no positive-balance lines', () => {
    const result = audit([visit(1, '2026-03-05T10:00:00', [line({ sku: 'A', balanceBefore: 0 })])])

    expect(result.count_coverage[0].share_positive_balance_counted).toBeNull()
  })
})

describe('consumption between visits against registered sales', () => {
  // A chain that wholly covers March: visits on 25 Feb and on 2 Apr.
  const chainVisits = (before2: number) => [
    visit(1, '2026-02-25T00:00:00', [line({ sku: 'A', balanceBefore: 0, balanceAfter: 30 })]),
    visit(1, '2026-04-02T00:00:00', [line({ sku: 'A', balanceBefore: before2, balanceAfter: before2 })]),
  ]

  it('compares the consumption of a fully covered month with its registered sales', () => {
    // Interval 25 Feb → 2 Apr is 36 days (Feb 4 days + March 31 + Apr 1). Consumption 30−0=30 prorated.
    const result = audit(chainVisits(0), [sales(1, '2026-03', { A: 26 }), sales(1, '2026-04', { A: 1 })])

    expect(result.consumption_vs_sales.compared_sku_months).toBe(1)
    const row = result.consumption_vs_sales.store_months[0]
    expect(row).toMatchObject({ store_id: 1, month: '2026-03', sku_months: 1, sales_units: 26 })
    expect(row.consumption_units).toBeCloseTo((30 * 31) / 36, 5)
    expect(row.ratio).toBeCloseTo(row.consumption_units / 26, 5)
  })

  it('does not compare a month the chain covers only in part', () => {
    const result = audit(chainVisits(0), [sales(1, '2026-03', { A: 26 }), sales(1, '2026-04', { A: 1 })])

    expect(result.consumption_vs_sales.store_months.map(row => row.month)).toEqual(['2026-03'])
  })

  it('reports a balance rise as its own count and never as negative consumption', () => {
    const result = audit(chainVisits(35), [sales(1, '2026-03', { A: 26 }), sales(1, '2026-04', { A: 1 })])

    expect(result.gaps.balance_rises_without_event).toEqual({ pairs: 1, units: 5, sku_months_excluded: 1 })
    expect(result.consumption_vs_sales.compared_sku_months).toBe(0)
    expect(result.consumption_vs_sales.overall.lines).toBe(0)
  })

  it('lists a store-month with consumption and no sales as a gap and keeps it out of the distributions', () => {
    const result = audit(chainVisits(0), [sales(1, '2026-03', null), sales(1, '2026-04', null)])

    expect(result.gaps.store_months_without_sales).toHaveLength(1)
    expect(result.gaps.store_months_without_sales[0]).toMatchObject({ store_id: 1, month: '2026-03', sku_months: 1 })
    expect(result.gaps.store_months_without_sales[0].consumption_units).toBeGreaterThan(0)
    expect(result.consumption_vs_sales.compared_sku_months).toBe(0)
    expect(result.consumption_vs_sales.overall.lines).toBe(0)
  })

  it('treats a SKU absent from a month that has sales as zero sold, not as a gap', () => {
    const result = audit(chainVisits(0), [sales(1, '2026-03', { OTHER: 5 }), sales(1, '2026-04', { OTHER: 5 })])

    expect(result.gaps.store_months_without_sales).toEqual([])
    expect(result.consumption_vs_sales.store_months[0].sales_units).toBe(0)
    expect(result.consumption_vs_sales.store_months[0].ratio).toBeNull()
  })
})

describe('data gaps and coverage of the audit itself', () => {
  it('reports capacity as not available when it is always empty or zero', () => {
    const result = audit([
      visit(1, '2026-03-05T10:00:00', [line({ sku: 'A', capacity: null }), line({ sku: 'B', capacity: 0 })]),
    ])

    expect(result.gaps.capacity).toEqual({ lines: 2, lines_with_capacity: 0, share_with_capacity: 0, available: false })
  })

  it('reports the share of lines that carry a capacity when some do', () => {
    const result = audit([visit(1, '2026-03-05T10:00:00', [line({ sku: 'A', capacity: 12 }), line({ sku: 'B', capacity: 0 })])])

    expect(result.gaps.capacity).toMatchObject({ lines_with_capacity: 1, share_with_capacity: 0.5, available: true })
  })

  it('reports the period the visits cover', () => {
    const result = audit([
      visit(1, '2026-03-05T10:00:00', [line({ sku: 'A' })]),
      visit(2, '2026-04-20T10:00:00', [line({ sku: 'A' })]),
    ])

    expect(result.covered).toMatchObject({
      stores: 2,
      visits: 2,
      lines: 2,
      first_visit_end: '2026-03-05T10:00:00.000Z',
      last_visit_end: '2026-04-20T10:00:00.000Z',
    })
  })
})

describe('an empty system', () => {
  it('returns an empty audit, not an error and not zero differences', () => {
    const result = audit([])

    expect(result.covered).toEqual({ stores: 0, visits: 0, lines: 0, first_visit_end: null, last_visit_end: null })
    expect(result.count_vs_system.lines_total).toBe(0)
    expect(result.count_vs_system.overall.share_zero).toBeNull()
    expect(result.count_vs_system.overall.quantiles).toBeNull()
    expect(result.count_coverage).toEqual([])
    expect(result.consumption_vs_sales.median_ratio).toBeNull()
    expect(result.gaps.capacity.share_with_capacity).toBeNull()
  })
})

describe('the audit sets no tolerance', () => {
  const forbidden = /verdict|tolerance|tolerancia|pass|fail|accept|approv|reprov|aprov|status|ok$/i

  const keysOf = (value: unknown, path = ''): string[] => {
    if (Array.isArray(value)) return value.flatMap(item => keysOf(item, path))
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.entries(value).flatMap(([key, child]) => [`${path}.${key}`, ...keysOf(child, `${path}.${key}`)])
    }
    return []
  }

  it('has no key that reads like a verdict or a threshold, on a populated audit', () => {
    const result = audit(
      [
        visit(1, '2026-02-25T00:00:00', [line({ sku: 'A', balanceBefore: 0, balanceAfter: 30, confirmedCount: 0 })]),
        visit(1, '2026-04-02T00:00:00', [line({ sku: 'A', balanceBefore: 3, balanceAfter: 3, confirmedCount: 4, capacity: 10 })]),
      ],
      [sales(1, '2026-03', { A: 26 }), sales(1, '2026-04', { A: 1 })],
    )

    const offending = keysOf(result).filter(key => forbidden.test(key.split('.').pop()!))
    expect(offending).toEqual([])
  })

  it('has none on an empty audit either', () => {
    expect(keysOf(audit([])).filter(key => forbidden.test(key.split('.').pop()!))).toEqual([])
  })

  it('computing the audit does not mutate its inputs', () => {
    const visits = [visit(1, '2026-03-05T10:00:00', [line({ sku: 'A', balanceBefore: 4, confirmedCount: 4 })])]
    const before = JSON.stringify(visits)

    audit(visits)

    expect(JSON.stringify(visits)).toBe(before)
  })
})
