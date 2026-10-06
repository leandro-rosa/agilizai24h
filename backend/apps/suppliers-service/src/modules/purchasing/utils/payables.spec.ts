import { buildOrders, buildSeries, monthPeriod, reconcile, summarize, type PayablePurchase } from './payables'

const TODAY = '2026-10-10'
const item = (over: Record<string, unknown> = {}) => ({ id: 1, sku: 'A', description: null, quantity: 10, received_quantity: null, unit_cost_cents: 100, payment_status: 'pending', paid_on: null, paid_method: null, ...over })
const purchase = (over: Partial<PayablePurchase> = {}): PayablePurchase => ({
  id: 1, supplier_id: 5, supplier_name: 'Quinoa', status: 'invoiced', invoice_number: 'NF1', invoice_key: null, without_invoice: false,
  expected_delivery_on: null, received_on: null, payment_term: 'due_date', payment_due_on: '2026-10-15', payment_method: null, items: [item()], ...over,
})

describe('payables — orders', () => {
  it('one row per order, with the state by the due day and the form (boleto by default for a dated term)', () => {
    const rows = buildOrders(
      [purchase({ id: 1, payment_due_on: '2026-10-05' }), purchase({ id: 2, payment_due_on: '2026-10-15', payment_method: 'transfer' }), purchase({ id: 3, payment_term: null, payment_due_on: null })],
      TODAY, monthPeriod('2026-10'),
    )

    expect(rows.map(r => [r.purchase_id, r.state, r.form, r.open_cents])).toEqual([[1, 'overdue', 'boleto', 1000], [2, 'upcoming', 'transfer', 1000], [3, 'undated', null, 1000]])
  })

  it('"on delivery" before the receipt waits on the expected delivery (an estimate); after it, it is due on the receipt day', () => {
    const waiting = buildOrders([purchase({ status: 'awaiting_receipt', payment_term: 'on_receipt', payment_due_on: null, expected_delivery_on: '2026-10-14' })], TODAY, monthPeriod('2026-10'))[0]
    expect(waiting).toMatchObject({ state: 'on_delivery', form: 'on_delivery', due_on: '2026-10-14', estimated: true })

    const received = buildOrders([purchase({ status: 'received', payment_term: 'on_receipt', payment_due_on: null, received_on: '2026-10-08', items: [item({ received_quantity: 8 })] })], TODAY, monthPeriod('2026-10'))[0]
    expect(received).toMatchObject({ state: 'overdue', due_on: '2026-10-08', estimated: false, open_cents: 800 })
  })

  it('leaves out requisitions, and an order with everything paid outside the month', () => {
    const paid = purchase({ id: 4, items: [item({ payment_status: 'paid', paid_on: '2026-09-20' })] })
    expect(buildOrders([purchase({ status: 'requisition' }), paid], TODAY, monthPeriod('2026-10'))).toEqual([])
    expect(buildOrders([paid], TODAY, monthPeriod('2026-09'))[0]).toMatchObject({ state: 'paid', paid_cents: 1000, paid_on: '2026-09-20' })
  })
})

describe('payables — by day', () => {
  it('a single day shows only the payments made that day, with the value paid that day', () => {
    const split = purchase({ id: 9, items: [item({ id: 1, payment_status: 'paid', paid_on: '2026-10-03' }), item({ id: 2, unit_cost_cents: 300, payment_status: 'paid', paid_on: '2026-10-07' })] })
    const day = (d: string) => buildOrders([split], TODAY, { from: d, to: d })

    expect(day('2026-10-03')[0]).toMatchObject({ state: 'paid', paid_cents: 1000, paid_on: '2026-10-03' })
    expect(day('2026-10-07')[0]).toMatchObject({ paid_cents: 3000, paid_on: '2026-10-07' })
    expect(day('2026-10-05')).toEqual([])
    expect(summarize([split], day('2026-10-03'), TODAY, { from: '2026-10-03', to: '2026-10-03' })).toMatchObject({ paid_month_cents: 1000, paid_month_orders: 1 })
  })
})

describe('payables — due today', () => {
  it('received today and paid on delivery is due TODAY (not overdue, not "to fall due"), and counts in the next 7 days', () => {
    const received = purchase({ status: 'received', payment_term: 'on_receipt', payment_due_on: null, received_on: TODAY })
    const orders = buildOrders([received], TODAY, monthPeriod('2026-10'))

    expect(orders[0]).toMatchObject({ state: 'due_today', due_on: TODAY })
    expect(summarize([received], orders, TODAY, monthPeriod('2026-10'))).toMatchObject({ due_7d_cents: 1000, overdue_cents: 0 })
  })
})

describe('payables — summary, series, reconciliation', () => {
  const list: PayablePurchase[] = [
    purchase({ id: 1, payment_due_on: '2026-10-05' }),
    purchase({ id: 2, payment_due_on: '2026-10-12' }),
    purchase({ id: 3, status: 'awaiting_receipt', payment_term: 'on_receipt', payment_due_on: null, expected_delivery_on: '2026-10-20', items: [item({ unit_cost_cents: 300 })] }),
    purchase({ id: 4, items: [item({ payment_status: 'paid', paid_on: '2026-10-02', unit_cost_cents: 500 })] }),
    purchase({ id: 5, status: 'received', invoice_number: null, without_invoice: false, payment_term: null, payment_due_on: null, received_on: '2026-10-03', items: [item({ payment_status: 'paid', paid_on: '2026-09-28' })] }),
  ]
  const orders = buildOrders(list, TODAY, monthPeriod('2026-10'))

  it('totals: open, overdue, in 7 days, on delivery, paid in the month, and forecast = open + paid', () => {
    expect(summarize(list, orders, TODAY, monthPeriod('2026-10'))).toEqual({
      open_cents: 1000 + 1000 + 3000, open_orders: 3, overdue_cents: 1000, overdue_orders: 1, due_7d_cents: 1000, due_7d_orders: 1,
      on_delivery_cents: 3000, on_delivery_orders: 1, paid_month_cents: 5000, paid_month_orders: 1, forecast_month_cents: 10000,
    })
  })

  it('series: six months, paid by the day of payment, open by the month it falls due', () => {
    const series = buildSeries(list, orders, TODAY, '2026-10')

    expect(series).toHaveLength(6)
    expect(series[0].month).toBe('2026-05')
    expect(series.find(p => p.month === '2026-09')).toMatchObject({ paid_cents: 1000 })
    expect(series.find(p => p.month === '2026-10')).toMatchObject({ paid_cents: 5000, overdue_cents: 1000, to_pay_cents: 1000, on_delivery_cents: 3000 })
  })

  it('reconciliation: received but unpaid, paid without an invoice, waiting for receipt, and the funnel', () => {
    const gaps = reconcile([...list, purchase({ id: 6, status: 'received', items: [item()] }), purchase({ id: 7, status: 'awaiting_invoice', invoice_number: null, without_invoice: false, items: [item()] })])

    expect(gaps.received_without_payment).toMatchObject({ count: 1, cents: 1000, purchase_ids: [6] })
    expect(gaps.paid_without_invoice.purchase_ids).toEqual([5])
    expect(gaps.awaiting_receipt.purchase_ids).toEqual([3])
    expect(gaps.awaiting_invoice.purchase_ids).toEqual([7])
    expect(gaps.funnel).toEqual({ orders: 7, invoiced: 5, received: 2, paid: 2 })
  })
})
