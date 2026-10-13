import type { Adjustment } from './consignment-adjustments'
import { computeClosing, type ClosingInput } from './consignment-closing'
import { periodFromDays } from './consignment-period'
import type { KeyedSale, SaleFact } from './consignment-sale-key'

const CUTOFF = new Date('2026-09-30T00:00:00-03:00')
const period = periodFromDays('2026-09-30', '2026-10-06')
const sale = (key: string, quantity: number, over: Partial<KeyedSale> = {}): KeyedSale => ({ key, storeId: 1, sku: 'A', occurredAt: new Date('2026-10-02T15:00:00Z'), quantity, result: 'OK', receiptId: 'C', ...over })

const base = (over: Partial<ClosingInput> = {}): ClosingInput => ({
  supplierId: 7,
  period,
  cutoff: CUTOFF,
  sales: [],
  unidentifiedSales: [],
  holdersOf: () => [{ supplierId: 7, balance: 50 }],
  manualAssignments: new Map(),
  costs: [{ sku: 'A', validFrom: '2026-09-01', unitCostCents: 730 }, { sku: 'B', validFrom: '2026-09-01', unitCostCents: 595 }],
  claimedKeys: new Set(),
  legacyCovered: [],
  adjustments: [],
  missingKeys: [],
  salesImportedUntil: new Date('2026-10-07T03:00:00Z'),
  partialAccepted: false,
  ...over,
})

describe('computeClosing — what to pay the supplier', () => {
  it('owed = net units sold × the agreed cost, and the reference case pays 18 units (expired units change nothing)', () => {
    const result = computeClosing(base({ sales: [sale('k1', 18)] }))

    expect(result.owedCents).toBe(18 * 730)
    expect(result.lines).toEqual([{ storeId: 1, sku: 'A', costValidFrom: '2026-09-01', unitCostCents: 730, netUnits: 18, totalCents: 13140, saleKeys: ['k1'] }])
    expect(result.confirmable).toBe(true)
  })

  it('splits one SKU by cost vigência instead of showing a single cost that hides the difference', () => {
    const result = computeClosing(base({
      costs: [{ sku: 'A', validFrom: '2026-09-01', unitCostCents: 730 }, { sku: 'A', validFrom: '2026-10-03', unitCostCents: 760 }],
      sales: [sale('k1', 2), sale('k2', 3, { occurredAt: new Date('2026-10-04T15:00:00Z') })],
    }))

    expect(result.lines.map(l => [l.costValidFrom, l.unitCostCents, l.netUnits])).toEqual([['2026-09-01', 730, 2], ['2026-10-03', 760, 3]])
    expect(result.owedCents).toBe(2 * 730 + 3 * 760)
  })

  it('reports cancelled units apart and never charges them', () => {
    const result = computeClosing(base({ sales: [sale('k1', 4), sale('k2', 2, { result: 'CANCELADO' })] }))

    expect(result.owedCents).toBe(4 * 730)
    expect(result.cancellations).toEqual([{ storeId: 1, sku: 'A', units: 2 }])
  })

  it('a sale exactly at the period end belongs to the next closing', () => {
    const result = computeClosing(base({ sales: [sale('edge', 5, { occurredAt: period.end })] }))

    expect(result.owedCents).toBe(0)
    expect(result.lines).toEqual([])
  })

  it('never charges a sale already claimed by a confirmed closing, nor one inside a legacy settled interval', () => {
    const legacy = periodFromDays('2026-10-01', '2026-10-03')
    const result = computeClosing(base({
      sales: [sale('claimed', 5), sale('legacy', 7, { occurredAt: new Date('2026-10-02T20:00:00Z') }), sale('free', 1, { occurredAt: new Date('2026-10-05T15:00:00Z') })],
      claimedKeys: new Set(['claimed']),
      legacyCovered: [legacy],
    }))

    expect(result.lines.map(l => l.saleKeys)).toEqual([['free']])
  })

  it('blocks on a sale without instant or receipt identifier — it is never silently zero', () => {
    const loose: SaleFact = { storeId: 1, sku: 'A', occurredAt: null, quantity: 3, result: 'OK', receiptId: 'C' }
    const result = computeClosing(base({ sales: [sale('k1', 1)], unidentifiedSales: [loose] }))

    expect(result.blockers).toEqual([{ code: 'sale_unidentified', storeId: 1, sku: 'A' }])
    expect(result.confirmable).toBe(false)
  })

  it('blocks when two suppliers hold the SKU and no manual assignment exists; a manual one resolves it', () => {
    const holders = () => [{ supplierId: 7, balance: 5 }, { supplierId: 8, balance: 9 }]
    const blocked = computeClosing(base({ sales: [sale('k1', 2)], holdersOf: holders }))

    expect(blocked.blockers).toEqual([{ code: 'attribution_pending', saleKey: 'k1', storeId: 1, sku: 'A' }])
    expect(blocked.owedCents).toBe(0)

    const resolved = computeClosing(base({ sales: [sale('k1', 2)], holdersOf: holders, manualAssignments: new Map([['k1', 7]]) }))
    expect(resolved.confirmable).toBe(true)
    expect(resolved.owedCents).toBe(2 * 730)
  })

  it('leaves out sales attributed to another supplier, and sales of SKUs nobody holds', () => {
    const result = computeClosing(base({ sales: [sale('other', 2), sale('none', 4, { sku: 'B' })], holdersOf: sale => (sale.sku === 'A' ? [{ supplierId: 8, balance: 5 }] : []) }))

    expect(result.lines).toEqual([])
    expect(result.blockers).toEqual([])
  })

  it('blocks a sale without an agreed cost on its day', () => {
    const result = computeClosing(base({ sales: [sale('k1', 1, { sku: 'Z' })], holdersOf: () => [{ supplierId: 7, balance: 5 }] }))

    expect(result.blockers).toEqual([{ code: 'cost_missing', saleKey: 'k1', storeId: 1, sku: 'Z' }])
  })

  it('blocks a period the imports do not cover yet, unless the partial period was explicitly accepted', () => {
    const early = new Date('2026-10-04T03:00:00Z')

    expect(computeClosing(base({ sales: [sale('k1', 1)], salesImportedUntil: early })).blockers).toEqual([{ code: 'sales_incomplete' }])
    expect(computeClosing(base({ sales: [sale('k1', 1)], salesImportedUntil: null })).blockers).toEqual([{ code: 'sales_incomplete' }])
    expect(computeClosing(base({ sales: [sale('k1', 1)], salesImportedUntil: early, partialAccepted: true })).confirmable).toBe(true)
  })

  describe('adjustments to sales an earlier closing already counted', () => {
    const next = periodFromDays('2026-10-07', '2026-10-13')
    const later = { period: next, salesImportedUntil: new Date('2026-10-14T03:00:00Z') }
    const lateSale = (key: string, over: Partial<KeyedSale> = {}) => sale(key, 4, { occurredAt: new Date('2026-10-02T15:00:00Z'), ...over })
    const lateAdj = (saleKey: string, over: Partial<Adjustment> = {}): Adjustment => ({ saleKey, kind: 'adjustment_late', supplierId: null, storeId: 1, sku: 'A', occurredAt: new Date('2026-10-02T15:00:00Z'), quantity: 4, unitCostCents: null, ...over })

    it('adds priced adjustments: a cancellation at its original cost, a late sale at the cost of its own day', () => {
      const result = computeClosing(base({
        ...later,
        sales: [sale('k1', 2, { occurredAt: new Date('2026-10-08T15:00:00Z') }), lateSale('late')],
        adjustments: [
          { saleKey: 'old', kind: 'adjustment_cancel', supplierId: 7, storeId: 1, sku: 'A', occurredAt: new Date('2026-10-01T15:00:00Z'), quantity: -3, unitCostCents: 700 },
          lateAdj('late'),
        ],
      }))

      expect(result.adjustments).toEqual([
        { saleKey: 'old', kind: 'adjustment_cancel', storeId: 1, sku: 'A', quantity: -3, unitCostCents: 700, totalCents: -2100 },
        { saleKey: 'late', kind: 'adjustment_late', storeId: 1, sku: 'A', quantity: 4, unitCostCents: 730, totalCents: 2920 },
      ])
      expect(result.adjustmentsCents).toBe(820)
      expect(result.owedCents).toBe(2 * 730 + 820)
    })

    it('blocks a late adjustment that has no cost on its day', () => {
      const result = computeClosing(base({ ...later, sales: [lateSale('late', { sku: 'Z' })], adjustments: [lateAdj('late', { sku: 'Z' })] }))

      expect(result.blockers).toEqual([{ code: 'cost_missing', saleKey: 'late', storeId: 1, sku: 'Z' }])
    })

    it('a late sale of a SKU held by two suppliers is pending, not paid by both closings', () => {
      const holders = () => [{ supplierId: 7, balance: 5 }, { supplierId: 8, balance: 9 }]
      const seven = computeClosing(base({ ...later, sales: [lateSale('late')], adjustments: [lateAdj('late')], holdersOf: holders }))
      const eight = computeClosing(base({ ...later, supplierId: 8, sales: [lateSale('late')], adjustments: [lateAdj('late')], holdersOf: holders }))

      expect(seven.blockers).toEqual([{ code: 'attribution_pending', saleKey: 'late', storeId: 1, sku: 'A' }])
      expect(eight.blockers).toEqual(seven.blockers)
      expect(seven.owedCents + eight.owedCents).toBe(0)
    })

    it('a late sale belonging to another supplier is not charged here', () => {
      const result = computeClosing(base({ ...later, sales: [lateSale('late')], adjustments: [lateAdj('late')], holdersOf: () => [{ supplierId: 8, balance: 5 }] }))

      expect(result.adjustments).toEqual([])
      expect(result.owedCents).toBe(0)
    })

    it('never charges a late sale that is already claimed, before the cutoff, or inside a legacy settled interval', () => {
      const legacy = periodFromDays('2026-10-02', '2026-10-02')
      const claimed = computeClosing(base({ ...later, sales: [lateSale('late')], adjustments: [lateAdj('late')], claimedKeys: new Set(['late']) }))
      const old = computeClosing(base({ ...later, sales: [lateSale('late', { occurredAt: new Date('2026-09-20T15:00:00Z') })], adjustments: [lateAdj('late', { occurredAt: new Date('2026-09-20T15:00:00Z') })] }))
      const settled = computeClosing(base({ ...later, sales: [lateSale('late')], adjustments: [lateAdj('late')], legacyCovered: [legacy] }))

      expect(claimed.adjustments).toEqual([])
      expect(old.adjustments).toEqual([])
      expect(settled.adjustments).toEqual([])
    })

    it('ignores a cancellation adjustment that a closing of another supplier owns', () => {
      const result = computeClosing(base({ ...later, adjustments: [{ saleKey: 'old', kind: 'adjustment_cancel', supplierId: 8, storeId: 1, sku: 'A', occurredAt: null, quantity: -3, unitCostCents: 700 }] }))

      expect(result.adjustments).toEqual([])
    })
  })

  it('a confirmed sale key that vanished from the latest import blocks: its replacement could be the same sale again', () => {
    const result = computeClosing(base({ sales: [sale('k1', 1)], missingKeys: ['gone'] }))

    expect(result.blockers).toEqual([{ code: 'sale_missing', saleKey: 'gone' }])
    expect(result.confirmable).toBe(false)
  })

  it('a sale whose holders are listed but have no sellable stock blocks instead of vanishing from the total', () => {
    const result = computeClosing(base({ sales: [sale('k1', 1)], holdersOf: () => [{ supplierId: 7, balance: 0 }] }))

    expect(result.blockers).toEqual([{ code: 'attribution_pending', saleKey: 'k1', storeId: 1, sku: 'A' }])
    expect(result.owedCents).toBe(0)
  })
})
