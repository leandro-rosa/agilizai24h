import type { PaymentMethod, PaymentTerm } from '../constants/purchase-vocabulary'
import { effectiveDueDate } from './order-flow'

/**
 * The payables screen, as pure functions over what the purchases say (no I/O here, so the rules are testable). Only items whose
 * condition is `paid` are payables: bonus owes nothing and on-sale items are quitted by the weekly settlement.
 */
export interface PayableItem {
  id: number
  sku: string
  description: string | null
  quantity: number
  received_quantity: number | null
  unit_cost_cents: number
  payment_status: string
  paid_on: string | null
  paid_method: string | null
}

export interface PayablePurchase {
  id: number
  supplier_id: number
  supplier_name: string | null
  status: string
  invoice_number: string | null
  invoice_key: string | null
  without_invoice: boolean
  expected_delivery_on: string | null
  received_on: string | null
  payment_term: PaymentTerm | null
  payment_due_on: string | null
  payment_method: PaymentMethod | null
  /** Only the items whose condition is `paid`. */
  items: PayableItem[]
}

export type PayableState = 'overdue' | 'due_today' | 'upcoming' | 'on_delivery' | 'undated' | 'paid'
/** How it is paid, for the filter and the tag: on delivery (the term), or the method; null when nobody said. */
export type PayableForm = 'on_delivery' | PaymentMethod | null

export interface PayableOrder {
  purchase_id: number
  supplier_id: number
  supplier_name: string | null
  invoice_number: string | null
  status: string
  form: PayableForm
  /** The due day, or the expected delivery for "on delivery" not yet received. */
  due_on: string | null
  /** `due_on` is the expected delivery, not a payment date: an ESTIMATE. */
  estimated: boolean
  state: PayableState
  open_cents: number
  paid_cents: number
  paid_on: string | null
  items: { item_id: number; sku: string; description: string | null; quantity: number; total_cents: number; payment_status: string; paid_on: string | null }[]
}

const quantityOf = (status: string, item: PayableItem) => (status === 'received' ? (item.received_quantity ?? item.quantity) : item.quantity)
const valueOf = (status: string, item: PayableItem) => quantityOf(status, item) * item.unit_cost_cents
const monthOf = (day: string) => day.slice(0, 7)

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)

  return date.toISOString().slice(0, 10)
}

export function addMonths(month: string, delta: number): string {
  const [year, number] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, number - 1 + delta, 1))

  return date.toISOString().slice(0, 7)
}

export function payableForm(purchase: Pick<PayablePurchase, 'payment_term' | 'payment_method'>): PayableForm {
  if (purchase.payment_term === 'on_receipt') return 'on_delivery'

  return purchase.payment_method ?? (purchase.payment_term === 'due_date' ? 'boleto' : null)
}

/** One row per purchase that has something open, or paid in `month`. Requisitions are not payables yet. */
export function buildOrders(purchases: PayablePurchase[], today: string, month: string): PayableOrder[] {
  const orders: PayableOrder[] = []

  for (const purchase of purchases) {
    if (purchase.status === 'requisition' || purchase.items.length === 0) continue
    const pending = purchase.items.filter(i => i.payment_status !== 'paid')
    const paid = purchase.items.filter(i => i.payment_status === 'paid')
    const paidInMonth = paid.some(i => i.paid_on && monthOf(i.paid_on) === month)
    if (pending.length === 0 && !paidInMonth) continue

    const dueByTerm = effectiveDueDate(purchase.payment_term, purchase.payment_due_on, purchase.received_on)
    const waitingDelivery = purchase.payment_term === 'on_receipt' && purchase.status !== 'received'
    const due = waitingDelivery ? purchase.expected_delivery_on : dueByTerm
    const open = pending.reduce((s, i) => s + valueOf(purchase.status, i), 0)
    const state: PayableState =
      pending.length === 0 ? 'paid' : waitingDelivery ? 'on_delivery' : dueByTerm === null ? 'undated' : dueByTerm < today ? 'overdue' : dueByTerm === today ? 'due_today' : 'upcoming'

    orders.push({
      purchase_id: purchase.id,
      supplier_id: purchase.supplier_id,
      supplier_name: purchase.supplier_name,
      invoice_number: purchase.invoice_number,
      status: purchase.status,
      form: payableForm(purchase),
      due_on: due,
      estimated: waitingDelivery && due !== null,
      state,
      open_cents: open,
      paid_cents: paid.reduce((s, i) => s + valueOf(purchase.status, i), 0),
      paid_on: paid.map(i => i.paid_on).filter((d): d is string => d !== null).sort().at(-1) ?? null,
      items: purchase.items.map(i => ({ item_id: i.id, sku: i.sku, description: i.description, quantity: quantityOf(purchase.status, i), total_cents: valueOf(purchase.status, i), payment_status: i.payment_status, paid_on: i.paid_on })),
    })
  }

  return orders.sort((a, b) => (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999') || a.purchase_id - b.purchase_id)
}

export interface PayablesSummary {
  open_cents: number
  open_orders: number
  overdue_cents: number
  overdue_orders: number
  due_7d_cents: number
  due_7d_orders: number
  on_delivery_cents: number
  on_delivery_orders: number
  paid_month_cents: number
  paid_month_orders: number
  /** Open + paid in the month, as the screen's "total previsto no mês" says. */
  forecast_month_cents: number
}

export function summarize(purchases: PayablePurchase[], orders: PayableOrder[], today: string, month: string): PayablesSummary {
  const open = orders.filter(o => o.state !== 'paid')
  const sum = (list: PayableOrder[]) => list.reduce((s, o) => s + o.open_cents, 0)
  const overdue = open.filter(o => o.state === 'overdue')
  const horizon = addDays(today, 7)
  const due7 = open.filter(o => (o.state === 'upcoming' || o.state === 'due_today') && o.due_on !== null && o.due_on >= today && o.due_on <= horizon)
  const onDelivery = open.filter(o => o.state === 'on_delivery')

  let paidCents = 0
  const paidOrders = new Set<number>()
  for (const purchase of purchases) {
    for (const item of purchase.items) {
      if (item.payment_status === 'paid' && item.paid_on && monthOf(item.paid_on) === month) {
        paidCents += valueOf(purchase.status, item)
        paidOrders.add(purchase.id)
      }
    }
  }

  return {
    open_cents: sum(open),
    open_orders: open.length,
    overdue_cents: sum(overdue),
    overdue_orders: overdue.length,
    due_7d_cents: sum(due7),
    due_7d_orders: due7.length,
    on_delivery_cents: sum(onDelivery),
    on_delivery_orders: onDelivery.length,
    paid_month_cents: paidCents,
    paid_month_orders: paidOrders.size,
    forecast_month_cents: sum(open) + paidCents,
  }
}

export interface SeriesPoint {
  month: string
  paid_cents: number
  to_pay_cents: number
  overdue_cents: number
  on_delivery_cents: number
}

/** Six months ending at `month`: what was paid, and what is open by the month it falls due (overdue and on-delivery apart). */
export function buildSeries(purchases: PayablePurchase[], orders: PayableOrder[], today: string, month: string, months = 6): SeriesPoint[] {
  const points = new Map<string, SeriesPoint>()
  for (let i = months - 1; i >= 0; i--) {
    const m = addMonths(month, -i)
    points.set(m, { month: m, paid_cents: 0, to_pay_cents: 0, overdue_cents: 0, on_delivery_cents: 0 })
  }

  for (const purchase of purchases) {
    for (const item of purchase.items) {
      if (item.payment_status !== 'paid' || !item.paid_on) continue
      const point = points.get(monthOf(item.paid_on))
      if (point) point.paid_cents += valueOf(purchase.status, item)
    }
  }
  for (const order of orders) {
    if (order.state === 'paid') continue
    // An on-delivery order with no expected date is read as "this month": it will be paid when it arrives.
    const when = order.state === 'undated' ? null : (order.due_on ?? today)
    const point = when ? points.get(monthOf(when)) : undefined
    if (!point) continue
    if (order.state === 'overdue') point.overdue_cents += order.open_cents
    else if (order.state === 'on_delivery') point.on_delivery_cents += order.open_cents
    else point.to_pay_cents += order.open_cents
  }

  return [...points.values()]
}

export interface Reconciliation {
  funnel: { orders: number; invoiced: number; received: number; paid: number }
  received_without_payment: { count: number; cents: number; purchase_ids: number[] }
  paid_without_invoice: { count: number; purchase_ids: number[] }
  awaiting_receipt: { count: number; purchase_ids: number[] }
  awaiting_invoice: { count: number; purchase_ids: number[] }
}

const hasInvoice = (p: PayablePurchase) => Boolean(p.invoice_number?.trim() || p.invoice_key?.trim() || p.without_invoice)

/** Order → invoice → receipt → payment, and what is out of step. Over the purchases that have something to pay, opened or paid. */
export function reconcile(purchases: PayablePurchase[]): Reconciliation {
  const list = purchases.filter(p => p.status !== 'requisition' && p.items.length > 0)
  const open = (p: PayablePurchase) => p.items.some(i => i.payment_status !== 'paid')
  const receivedUnpaid = list.filter(p => p.status === 'received' && open(p))
  const paidNoInvoice = list.filter(p => p.items.some(i => i.payment_status === 'paid') && !hasInvoice(p))
  const waitingReceipt = list.filter(p => p.status === 'awaiting_receipt')
  const waitingInvoice = list.filter(p => p.status === 'awaiting_invoice')

  return {
    funnel: {
      orders: list.length,
      invoiced: list.filter(hasInvoice).length,
      received: list.filter(p => p.status === 'received').length,
      paid: list.filter(p => !open(p)).length,
    },
    received_without_payment: { count: receivedUnpaid.length, cents: receivedUnpaid.reduce((s, p) => s + p.items.filter(i => i.payment_status !== 'paid').reduce((x, i) => x + valueOf(p.status, i), 0), 0), purchase_ids: receivedUnpaid.map(p => p.id) },
    paid_without_invoice: { count: paidNoInvoice.length, purchase_ids: paidNoInvoice.map(p => p.id) },
    awaiting_receipt: { count: waitingReceipt.length, purchase_ids: waitingReceipt.map(p => p.id) },
    awaiting_invoice: { count: waitingInvoice.length, purchase_ids: waitingInvoice.map(p => p.id) },
  }
}
