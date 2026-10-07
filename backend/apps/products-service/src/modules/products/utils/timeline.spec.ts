import { buildMarginIntervals, buildTimeline, type CostRow, type PriceRow } from './timeline'

const cost = (id: number, date: string, cents: number, over: Partial<CostRow> = {}): CostRow => ({
  id, effective_from: new Date(date), source: 'invoice', cost_cents: cents, actor: null, reason: null, supplier_id: 130, purchase_id: id, invoice_number: id === 1 ? '12345' : '13021',
  purchase_quantity: 150, purchase_total_cents: cents * 150, created_at: new Date(`${date}T12:00:00Z`), ...over,
})
const price = (id: number, date: string, cents: number, over: Partial<PriceRow> = {}): PriceRow => ({
  id, effective_from: new Date(date), source: 'manual', price_cents: cents, actor: 'barbara@agiliz.ai', reason: null, source_ref: null, created_at: new Date(`${date}T12:00:00Z`), ...over,
})

// The owner's example: cost 5,70 from 01/08 and 6,20 from 10/10; price 11,90 from 01/08, 12,50 from 16/09.
const costs = [cost(1, '2026-08-01', 570), cost(2, '2026-10-10', 620)]
const prices = [price(1, '2026-08-01', 1190), price(2, '2026-09-16', 1250, { source: 'pricing_intelligence', source_ref: 'decision-7' })]

describe('buildMarginIntervals — the margin of each period', () => {
  it('splits at every change of cost or price and reproduces the owner example: 52,1%, 54,4%, 50,4%', () => {
    const intervals = buildMarginIntervals(costs, prices)

    expect(intervals.map(i => [i.from, i.to, i.price_cents, i.cost_cents, Number((i.margin! * 100).toFixed(1))])).toEqual([
      ['2026-08-01', '2026-09-15', 1190, 570, 52.1],
      ['2026-09-16', '2026-10-09', 1250, 570, 54.4],
      ['2026-10-10', null, 1250, 620, 50.4],
    ])
  })

  it('an earlier interval does not change when a later cost is recorded (the acceptance case)', () => {
    const before = buildMarginIntervals([costs[0]], prices)
    const after = buildMarginIntervals(costs, prices)

    expect(after.slice(0, 2).map(i => i.margin)).toEqual(before.slice(0, 2).map(i => i.margin))
    expect(before[0].margin).toBeCloseTo(0.521, 3)
  })

  it('carries where each side came from', () => {
    const intervals = buildMarginIntervals(costs, prices)

    expect(intervals[1]).toMatchObject({ price_source: 'pricing_intelligence', cost_source: 'invoice', cost_invoice_number: '12345', cost_supplier_id: 130 })
    expect(intervals[2]).toMatchObject({ cost_invoice_number: '13021' })
  })

  it('has no margin where cost or price is missing, never zero', () => {
    const onlyPrice = buildMarginIntervals([cost(1, '2026-09-01', 570)], [price(1, '2026-08-01', 1190)])

    expect(onlyPrice[0]).toMatchObject({ from: '2026-08-01', cost_cents: null, margin: null, markup: null })
    expect(onlyPrice[1]).toMatchObject({ from: '2026-09-01', margin: expect.any(Number) })
  })

  it('a version that changes nothing visible does not open a new interval', () => {
    const intervals = buildMarginIntervals(costs, [...prices, price(3, '2026-09-20', 1250, { id: 2 })])

    expect(intervals).toHaveLength(3)
  })

  it('a same-date correction replaces what is in force and the earlier one never shows', () => {
    const corrected = buildMarginIntervals([cost(1, '2026-08-01', 570, { source: 'catalogue_sync' }), cost(5, '2026-08-01', 580, { source: 'manual', actor: 'a', reason: 'b' })], [price(1, '2026-08-01', 1190)])

    expect(corrected).toHaveLength(1)
    expect(corrected[0].cost_cents).toBe(580)
  })

  it('is empty without versions', () => {
    expect(buildMarginIntervals([], [])).toEqual([])
  })
})

describe('buildTimeline — one history of the product', () => {
  it('lists cost and price events newest first, each with the value it replaced', () => {
    const { events } = buildTimeline(costs, prices)

    expect(events.map(e => [e.date, e.kind, e.previous_value_cents, e.value_cents])).toEqual([
      ['2026-10-10', 'cost', 570, 620],
      ['2026-09-16', 'price', 1190, 1250],
      ['2026-08-01', 'cost', null, 570],
      ['2026-08-01', 'price', null, 1190],
    ])
  })

  it('shows the origin, the user and the invoice of each event', () => {
    const { events } = buildTimeline(costs, prices)

    expect(events[0]).toMatchObject({ source: 'invoice', invoice_number: '13021', supplier_id: 130 })
    expect(events[1]).toMatchObject({ source: 'pricing_intelligence', actor: 'barbara@agiliz.ai', source_ref: 'decision-7' })
  })

  it('says where the history starts and asserts nothing before it', () => {
    expect(buildTimeline(costs, prices).history_available_from).toBe('2026-08-01')
    expect(buildTimeline([], [])).toEqual({ history_available_from: null, events: [] })
  })

  it('keeps a same-date correction visible, flagged as superseded', () => {
    const { events } = buildTimeline([cost(1, '2026-10-10', 620), cost(2, '2026-10-10', 640, { source: 'manual', actor: 'a', reason: 'b' })], [])

    expect(events.find(e => e.value_cents === 640)?.superseded).toBe(true)
    expect(events.find(e => e.value_cents === 620)?.superseded).toBe(false)
  })
})
