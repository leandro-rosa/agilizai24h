import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import type { PaymentMethod, PaymentTerm } from '../constants/purchase-vocabulary'
import type { PayDto, UndoPayDto } from '../dto/payables.dto'
import { isDay } from '../utils/week'
import { buildOrders, buildSeries, reconcile, summarize, type PayablePurchase } from '../utils/payables'

const day = (date: Date | null): string | null => (date ? date.toISOString().slice(0, 10) : null)
const asDate = (value: string) => new Date(`${value}T00:00:00Z`)

/**
 * The payables screen: what is owed for purchases whose items are `paid` (not bonus, not on-sale: the weekly settlement quits those),
 * when, how it was or will be paid, and what is out of step. The system only RECORDS a payment — it never pays.
 */
@Injectable()
export class PayablesService {
  constructor(private readonly prisma: PrismaClientService) {}

  /** `YYYY-MM-DD` of today; one place so tests can pin it. */
  today(): string {
    return new Date().toISOString().slice(0, 10)
  }

  private async load(): Promise<PayablePurchase[]> {
    const rows = await this.prisma.purchase.findMany({
      where: { items: { some: { condition: 'paid' } } },
      include: { items: { where: { condition: 'paid' }, orderBy: { id: 'asc' } }, supplier: true },
      take: 2000,
    })

    return rows.map(row => ({
      id: row.id,
      supplier_id: row.supplier_id,
      supplier_name: row.supplier?.name ?? null,
      status: row.status,
      invoice_number: row.invoice_number,
      invoice_key: row.invoice_key,
      without_invoice: row.without_invoice,
      expected_delivery_on: day(row.expected_delivery_on),
      received_on: day(row.received_on),
      payment_term: (row.payment_term as PaymentTerm | null) ?? null,
      payment_due_on: day(row.payment_due_on),
      payment_method: (row.payment_method as PaymentMethod | null) ?? null,
      items: row.items.map(item => ({
        id: item.id,
        sku: item.sku,
        description: item.description,
        quantity: item.quantity,
        received_quantity: item.received_quantity,
        unit_cost_cents: item.unit_cost_cents,
        payment_status: item.payment_status,
        paid_on: day(item.paid_on),
        paid_method: item.paid_method,
      })),
    }))
  }

  async overview(month?: string) {
    const today = this.today()
    const selected = month ?? today.slice(0, 7)
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selected)) throw new BadRequestException('month must be YYYY-MM')

    const purchases = await this.load()
    const orders = buildOrders(purchases, today, selected)
    const horizon30 = new Date(`${today}T00:00:00Z`)
    horizon30.setUTCDate(horizon30.getUTCDate() + 30)
    const within30 = horizon30.toISOString().slice(0, 10)
    const dated = orders.filter(o => o.state !== 'paid' && o.state !== 'overdue' && o.due_on !== null && o.due_on >= today)
    const summary = summarize(purchases, orders, today, selected)

    return {
      month: selected,
      today,
      summary,
      series: buildSeries(purchases, orders, today, selected),
      /** The next payments, soonest first (the "agenda"). */
      upcoming: dated.slice(0, 8),
      commitments: {
        next_7_days_cents: summary.due_7d_cents,
        next_30_days_cents: dated.filter(o => (o.due_on as string) <= within30).reduce((s, o) => s + o.open_cents, 0),
        paid_month_cents: summary.paid_month_cents,
      },
      orders,
      reconciliation: reconcile(purchases),
    }
  }

  /** Records the payment of every open `paid` item of the given purchases. */
  async pay(dto: PayDto): Promise<{ paid_items: number; paid_cents: number }> {
    const today = this.today()
    const paidOn = dto.paid_on ?? today
    if (!isDay(paidOn)) throw new BadRequestException('paid_on must be a real date, YYYY-MM-DD')
    if (paidOn > today) throw new BadRequestException('A payment cannot be recorded on a future day')

    const purchases = await this.prisma.purchase.findMany({ where: { id: { in: dto.purchase_ids } }, include: { items: { where: { condition: 'paid', payment_status: 'pending' } } } })
    const missing = dto.purchase_ids.filter(id => !purchases.some(p => p.id === id))
    if (missing.length > 0) throw new NotFoundException(`Purchases not found: ${missing.join(', ')}`)
    const requisitions = purchases.filter(p => p.status === 'requisition')
    if (requisitions.length > 0) throw new BadRequestException(`A requisition owes nothing yet: ${requisitions.map(p => p.id).join(', ')}`)

    let items = 0
    let cents = 0
    for (const purchase of purchases) {
      if (purchase.items.length === 0) continue
      const method = dto.method ?? (purchase.payment_method as PaymentMethod | null) ?? undefined
      await this.prisma.$transaction(async tx => {
        for (const item of purchase.items) {
          await tx.purchaseItem.update({ where: { id: item.id }, data: { payment_status: 'paid', paid_on: asDate(paidOn), paid_method: method, ...(dto.note ? { payment_note: dto.note } : {}) } })
          items += 1
          cents += (purchase.status === 'received' ? (item.received_quantity ?? item.quantity) : item.quantity) * item.unit_cost_cents
        }
        await tx.purchaseEvent.create({ data: { purchase_id: purchase.id, from_status: purchase.status, to_status: purchase.status, actor: dto.actor, note: `payment recorded: ${purchase.items.length} item(s) on ${paidOn}${method ? ` via ${method}` : ''}` } })
      })
    }
    if (items === 0) throw new BadRequestException('Nothing open to pay in the chosen purchases')

    return { paid_items: items, paid_cents: cents }
  }

  /** Undoes a recorded payment (a wrong click): the items go back to pending. */
  async undo(dto: UndoPayDto): Promise<{ reopened_items: number }> {
    const purchases = await this.prisma.purchase.findMany({ where: { id: { in: dto.purchase_ids } }, include: { items: { where: { condition: 'paid', payment_status: 'paid' } } } })
    let reopened = 0
    for (const purchase of purchases) {
      if (purchase.items.length === 0) continue
      await this.prisma.$transaction(async tx => {
        for (const item of purchase.items) await tx.purchaseItem.update({ where: { id: item.id }, data: { payment_status: 'pending', paid_on: null, paid_method: null } })
        await tx.purchaseEvent.create({ data: { purchase_id: purchase.id, from_status: purchase.status, to_status: purchase.status, actor: dto.actor, note: `payment undone: ${purchase.items.length} item(s)` } })
      })
      reopened += purchase.items.length
    }
    if (reopened === 0) throw new BadRequestException('No recorded payment to undo in the chosen purchases')

    return { reopened_items: reopened }
  }
}
