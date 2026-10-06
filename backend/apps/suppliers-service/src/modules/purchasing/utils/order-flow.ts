import type { PaymentTerm, Stage } from '../constants/purchase-vocabulary'
import { STAGES } from '../constants/purchase-vocabulary'

/**
 * The stage machine of an order — pure, so the rules can be read and tested without a database.
 * Forward only, one stage at a time, nothing after `received`. Each stage asks for what it needs;
 * a problem comes back as a message, never as a guess.
 */
export const nextStage = (stage: Stage): Stage | null => STAGES[STAGES.indexOf(stage) + 1] ?? null

export function checkMove(from: Stage, to: Stage): string | null {
  if (from === 'received') return 'A received order is final: its stage can no longer change'
  if (to !== nextStage(from)) return `An order moves one stage at a time: from ${from} the next stage is ${nextStage(from)}, not ${to}`

  return null
}

export interface InvoiceState {
  invoiceNumber?: string | null
  invoiceKey?: string | null
  /** The supplier issues no invoice: the invoiced step is accepted without a number. */
  withoutInvoice?: boolean
}

export const hasInvoice = (state: InvoiceState): boolean => Boolean(state.invoiceNumber?.trim() || state.invoiceKey?.trim())

/** The invoice requirement of every stage from `invoiced` on: a number, an NF-e, or an explicit "this supplier issues no invoice". */
export function checkInvoice(to: Stage, state: InvoiceState): string | null {
  const needsInvoice = to === 'invoiced' || to === 'awaiting_receipt' || to === 'received'
  if (needsInvoice && !hasInvoice(state) && !state.withoutInvoice) return 'Invoicing needs the invoice number or an imported NF-e (or mark the supplier as issuing no invoice)'

  return null
}

export interface ReceiptInput {
  receivedOn?: string
  /** Quantity received per item; an item left out defaults to what was ordered. */
  received?: { itemId: number; quantity: number }[]
}

export interface ReceiptItem {
  itemId: number
  ordered: number
}

/** The quantity received per item (default: ordered), with the difference — or a problem when a quantity is not a whole number of units. */
export function resolveReceipt(items: ReceiptItem[], input: ReceiptInput): { lines: { itemId: number; ordered: number; received: number; difference: number }[] } | { problem: string } {
  const given = new Map((input.received ?? []).map(r => [r.itemId, r.quantity]))
  const unknown = [...given.keys()].filter(id => !items.some(i => i.itemId === id))
  if (unknown.length > 0) return { problem: `Received quantities for items that are not in this order: ${unknown.join(', ')}` }

  const lines = items.map(item => {
    const received = given.get(item.itemId) ?? item.ordered

    return { itemId: item.itemId, ordered: item.ordered, received, difference: item.ordered - received }
  })
  const bad = lines.find(l => !Number.isInteger(l.received) || l.received < 0)
  if (bad) return { problem: `The quantity received of item ${bad.itemId} must be a whole number of units, zero or more` }

  return { lines }
}

/** Day the payment is due: the receipt day for "pay on receipt", the boleto date otherwise; null while it is not known yet. */
export function effectiveDueDate(term: PaymentTerm | null, dueOn: string | null, receivedOn: string | null): string | null {
  if (term === 'on_receipt') return receivedOn
  if (term === 'due_date') return dueOn

  return null
}

/** Expected delivery passed and the order is not received. `today` is `YYYY-MM-DD`. */
export const isLate = (stage: Stage, expectedDeliveryOn: string | null, today: string): boolean => stage !== 'received' && expectedDeliveryOn !== null && expectedDeliveryOn < today

/** The payment is pending and its due day passed. */
export const isOverdue = (dueOn: string | null, paymentPending: boolean, today: string): boolean => paymentPending && dueOn !== null && dueOn < today
