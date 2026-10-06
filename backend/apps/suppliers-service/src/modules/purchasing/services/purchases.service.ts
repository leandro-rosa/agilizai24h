import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { ProductsClient } from '../clients/products.client'
import { PAYMENT_TERMS, type Condition, type Origin, type PaymentStatus, type PaymentTerm, type Stage } from '../constants/purchase-vocabulary'
import type { CreatePurchaseDto, EditItemDto, TransitionDto, UpdateOrderDto, UpdatePurchaseItemDto } from '../dto/purchase.dto'
import { checkInvoice, checkMove, effectiveDueDate, isLate, isOverdue, resolveReceipt } from '../utils/order-flow'
import { isDay } from '../utils/week'

export interface PurchaseItemView {
  id: number
  sku: string
  description: string | null
  /** Ordered units. */
  quantity: number
  /** Received units: what was received once the order is `received`, otherwise null. */
  received_quantity: number | null
  /** Ordered minus received, once received (positive = short). */
  difference: number | null
  unit_cost_cents: number
  condition: Condition
  payment_status: PaymentStatus
  paid_on: string | null
  payment_note: string | null
  /** Units × unit cost, on the received units once received. For a bonus item it is the reference value, NOT spend. */
  total_cents: number
}

export interface PurchaseView {
  id: number
  supplier_id: number
  supplier_name: string | null
  ordered_on: string
  origin: Origin
  status: Stage
  invoice_number: string | null
  invoice_key: string | null
  without_invoice: boolean
  notes: string | null
  created_by: string | null
  sent_at: string | null
  sent_by: string | null
  invoiced_at: string | null
  invoiced_by: string | null
  received_on: string | null
  received_at: string | null
  received_by: string | null
  expected_delivery_on: string | null
  payment_term: PaymentTerm | null
  payment_due_on: string | null
  /** The day the payment falls due: the receipt day for "pay on receipt", the boleto date otherwise; null while unknown. */
  payment_due_effective: string | null
  /** Expected delivery passed and not received. */
  late: boolean
  /** A paid item is still pending past its due day. */
  overdue: boolean
  items: PurchaseItemView[]
  /** Spend: paid items at cost. On-sale items are owed only as they sell (see the settlement); bonus items cost nothing. */
  paid_cents: number
  on_sale_cents: number
  bonus_units: number
}

/** What a month of RECEIVED purchases says about each SKU, for the analysis. Open orders are counted apart, never as bought. */
export interface MonthSummary {
  month: string
  /** First month with any received purchase, or null while there is none. */
  base_from: string | null
  orders: number
  invoices: number
  /** Orders not received yet (information only). */
  open_orders: number
  rows: { sku: string; units_paid: number; units_on_sale: number; bonus_units: number; cents_paid: number; cents_on_sale: number }[]
}

export interface PendingPaymentGroup {
  /** Day the payment falls due; null = pay on receipt, not received yet. */
  due_on: string | null
  total_cents: number
  overdue: boolean
  items: { purchase_id: number; item_id: number; supplier_name: string | null; sku: string; description: string | null; quantity: number; total_cents: number }[]
}

const day = (date: Date | null): string | null => (date ? date.toISOString().slice(0, 10) : null)
const at = (date: Date | null): string | null => (date ? date.toISOString() : null)
const asDate = (value: string) => new Date(`${value}T00:00:00Z`)

type ItemRow = {
  id: number
  sku: string
  description: string | null
  quantity: number
  received_quantity: number | null
  unit_cost_cents: number
  condition: string
  payment_status: string
  paid_on: Date | null
  payment_note: string | null
}

type PurchaseRow = {
  id: number
  supplier_id: number
  ordered_on: Date
  origin: string
  status: string
  invoice_number: string | null
  invoice_key: string | null
  without_invoice: boolean
  notes: string | null
  created_by: string | null
  sent_at: Date | null
  sent_by: string | null
  invoiced_at: Date | null
  invoiced_by: string | null
  received_on: Date | null
  received_at: Date | null
  received_by: string | null
  expected_delivery_on: Date | null
  payment_term: string | null
  payment_due_on: Date | null
  supplier?: { name: string } | null
  items: ItemRow[]
}

/** Units that count: the received units once received, otherwise what was ordered. */
const effectiveQuantity = (status: string, item: { quantity: number; received_quantity: number | null }) => (status === 'received' ? (item.received_quantity ?? item.quantity) : item.quantity)

export function toView(row: PurchaseRow, today: string = new Date().toISOString().slice(0, 10)): PurchaseView {
  const status = row.status as Stage
  const items = row.items.map(
    (item): PurchaseItemView => ({
      id: item.id,
      sku: item.sku,
      description: item.description,
      quantity: item.quantity,
      received_quantity: status === 'received' ? (item.received_quantity ?? item.quantity) : null,
      difference: status === 'received' ? item.quantity - (item.received_quantity ?? item.quantity) : null,
      unit_cost_cents: item.unit_cost_cents,
      condition: item.condition as Condition,
      payment_status: item.payment_status as PaymentStatus,
      paid_on: day(item.paid_on),
      payment_note: item.payment_note,
      total_cents: effectiveQuantity(status, item) * item.unit_cost_cents,
    }),
  )
  const sum = (condition: Condition) => items.filter(i => i.condition === condition).reduce((s, i) => s + i.total_cents, 0)
  const due = effectiveDueDate((row.payment_term as PaymentTerm | null) ?? null, day(row.payment_due_on), day(row.received_on))
  const pending = items.some(i => i.condition === 'paid' && i.payment_status === 'pending')

  return {
    id: row.id,
    supplier_id: row.supplier_id,
    supplier_name: row.supplier?.name ?? null,
    ordered_on: day(row.ordered_on) as string,
    origin: row.origin as Origin,
    status,
    invoice_number: row.invoice_number,
    invoice_key: row.invoice_key,
    without_invoice: row.without_invoice,
    notes: row.notes,
    created_by: row.created_by,
    sent_at: at(row.sent_at),
    sent_by: row.sent_by,
    invoiced_at: at(row.invoiced_at),
    invoiced_by: row.invoiced_by,
    received_on: day(row.received_on),
    received_at: at(row.received_at),
    received_by: row.received_by,
    expected_delivery_on: day(row.expected_delivery_on),
    payment_term: (row.payment_term as PaymentTerm | null) ?? null,
    payment_due_on: day(row.payment_due_on),
    payment_due_effective: due,
    late: isLate(status, day(row.expected_delivery_on), today),
    overdue: isOverdue(due, pending, today),
    items,
    paid_cents: sum('paid'),
    on_sale_cents: sum('on_sale'),
    bonus_units: items.filter(i => i.condition === 'bonus').reduce((s, i) => s + (i.received_quantity ?? i.quantity), 0),
  }
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaClientService,
    private readonly products: ProductsClient,
  ) {}

  /** `YYYY-MM-DD` of today; one place so tests can pin it. */
  today(): string {
    return new Date().toISOString().slice(0, 10)
  }

  /**
   * Records a purchase at any stage: the owner often records only after the order was placed and the invoice issued.
   * Omitting `stage` keeps the old behaviour (a purchase already received). From `invoiced` on it needs the invoice number or an
   * NF-e, or an explicit "this supplier issues no invoice".
   */
  async create(dto: CreatePurchaseDto, correlationId?: string): Promise<PurchaseView> {
    if (!isDay(dto.ordered_on)) throw new BadRequestException('ordered_on must be a real date, YYYY-MM-DD')
    for (const [name, value] of [['expected_delivery_on', dto.expected_delivery_on], ['payment_due_on', dto.payment_due_on], ['received_on', dto.received_on]] as const) {
      if (value && !isDay(value)) throw new BadRequestException(`${name} must be a real date, YYYY-MM-DD`)
    }
    if (dto.payment_term && !(PAYMENT_TERMS as readonly string[]).includes(dto.payment_term)) throw new BadRequestException('payment_term must be on_receipt or due_date')
    if (dto.payment_term === 'due_date' && !dto.payment_due_on) throw new BadRequestException('A due date is needed when the payment term is a boleto (due_date)')

    const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplier_id } })
    if (!supplier) throw new NotFoundException(`Supplier ${dto.supplier_id} not found`)

    // An unknown product is refused, not stored with a placeholder.
    const known = new Set((await this.products.products(correlationId)).map(p => p.sku))
    const unknown = [...new Set(dto.items.map(i => i.sku).filter(sku => !known.has(sku)))]
    if (unknown.length > 0) throw new BadRequestException(`Unknown products: ${unknown.join(', ')}`)

    const invoiceNumber = dto.invoice_number?.trim() || undefined
    if (invoiceNumber) {
      const existing = await this.prisma.purchase.findFirst({ where: { supplier_id: dto.supplier_id, invoice_number: invoiceNumber } })
      if (existing) throw new ConflictException(`Invoice ${invoiceNumber} of this supplier is already recorded (purchase ${existing.id})`)
    }

    const stage: Stage = dto.stage ?? 'received'
    // The old call (no stage, no number) meant "a purchase from a supplier with no invoice".
    const withoutInvoice = dto.without_invoice ?? (dto.stage === undefined && !invoiceNumber && !dto.invoice_key?.trim())
    const invoiceProblem = checkInvoice(stage, { invoiceNumber, invoiceKey: dto.invoice_key, withoutInvoice })
    if (invoiceProblem) throw new BadRequestException(invoiceProblem)

    const received = stage === 'received'
    const now = new Date()
    const beyondRequisition = stage !== 'requisition'
    const beyondSent = stage !== 'requisition' && stage !== 'awaiting_invoice'

    const created = await this.prisma.purchase.create({
      data: {
        supplier_id: dto.supplier_id,
        ordered_on: asDate(dto.ordered_on),
        origin: dto.origin ?? (dto.invoice_key ? 'nfe' : 'manual'),
        status: stage,
        invoice_number: invoiceNumber,
        invoice_key: dto.invoice_key,
        invoice_object_key: dto.invoice_object_key,
        without_invoice: withoutInvoice,
        notes: dto.notes,
        created_by: dto.actor,
        ...(beyondRequisition ? { sent_at: now, sent_by: dto.actor } : {}),
        ...(beyondSent ? { invoiced_at: now, invoiced_by: dto.actor } : {}),
        ...(received ? { received_on: asDate(dto.received_on ?? dto.ordered_on), received_at: now, received_by: dto.actor } : {}),
        expected_delivery_on: dto.expected_delivery_on ? asDate(dto.expected_delivery_on) : undefined,
        payment_term: dto.payment_term,
        payment_due_on: dto.payment_due_on ? asDate(dto.payment_due_on) : undefined,
        items: {
          create: dto.items.map(item => ({
            sku: item.sku,
            description: item.description,
            quantity: item.quantity,
            received_quantity: received ? (item.received_quantity ?? item.quantity) : undefined,
            unit_cost_cents: item.unit_cost_cents,
            condition: item.condition,
          })),
        },
        events: { create: [{ from_status: null, to_status: stage, actor: dto.actor, note: `created at ${stage}` }] },
      },
      include: { items: { orderBy: { id: 'asc' } }, supplier: true },
    })

    // Once the purchase is recorded, the operator's OK on each manual pick sticks: the operator picked a product for a line the invoice did not resolve: remember it for this supplier's next invoices.
    for (const item of dto.items) {
      const code = item.supplier_code?.trim()
      if (!code) continue
      await this.prisma.supplierProductCode.upsert({ where: { supplier_id_code: { supplier_id: dto.supplier_id, code } }, create: { supplier_id: dto.supplier_id, code, sku: item.sku }, update: { sku: item.sku } })
    }

    return toView(created, this.today())
  }

  async list(filter: { supplierId?: number; from?: string; to?: string; invoicesOnly?: boolean; status?: Stage; openOnly?: boolean } = {}): Promise<PurchaseView[]> {
    for (const value of [filter.from, filter.to]) if (value && !isDay(value)) throw new BadRequestException('from and to must be YYYY-MM-DD')

    const rows = await this.prisma.purchase.findMany({
      where: {
        ...(filter.supplierId ? { supplier_id: filter.supplierId } : {}),
        ...(filter.from || filter.to
          ? { ordered_on: { ...(filter.from ? { gte: asDate(filter.from) } : {}), ...(filter.to ? { lte: asDate(filter.to) } : {}) } }
          : {}),
        ...(filter.invoicesOnly ? { invoice_number: { not: null } } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.openOnly ? { status: { not: 'received' } } : {}),
      },
      include: { items: { orderBy: { id: 'asc' } }, supplier: true },
      orderBy: [{ ordered_on: 'desc' }, { id: 'desc' }],
      take: 500,
    })
    const today = this.today()

    return rows.map(row => toView(row, today))
  }

  async findById(id: number): Promise<PurchaseView> {
    const row = await this.prisma.purchase.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } }, supplier: true } })
    if (!row) throw new NotFoundException(`Purchase ${id} not found`)

    return toView(row, this.today())
  }

  /** The stage history of an order, oldest first. */
  async history(id: number): Promise<{ from_status: string | null; to_status: string; actor: string | null; note: string | null; created_at: string }[]> {
    const rows = await this.prisma.purchaseEvent.findMany({ where: { purchase_id: id }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] })

    return rows.map(r => ({ from_status: r.from_status, to_status: r.to_status, actor: r.actor, note: r.note, created_at: r.created_at.toISOString() }))
  }

  /**
   * Moves an order to the NEXT stage (never skips, never goes back, nothing after received). Each step asks for what it needs: invoicing
   * needs the invoice number, an NF-e or "no invoice"; receiving records the quantity received per item (default: ordered) and the day.
   * The stage change and its history row are written together.
   */
  async transition(id: number, dto: TransitionDto): Promise<PurchaseView> {
    const order = await this.prisma.purchase.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } }, supplier: true } })
    if (!order) throw new NotFoundException(`Purchase ${id} not found`)

    const from = order.status as Stage
    const moveProblem = checkMove(from, dto.to)
    if (moveProblem) throw new ConflictException(moveProblem)

    const invoiceNumber = dto.invoice_number?.trim() || order.invoice_number || undefined
    const invoiceKey = dto.invoice_key?.trim() || order.invoice_key || undefined
    const withoutInvoice = dto.without_invoice ?? order.without_invoice
    const invoiceProblem = checkInvoice(dto.to, { invoiceNumber, invoiceKey, withoutInvoice })
    if (invoiceProblem) throw new BadRequestException(invoiceProblem)

    if (dto.invoice_number && dto.invoice_number.trim() !== order.invoice_number) {
      const clash = await this.prisma.purchase.findFirst({ where: { supplier_id: order.supplier_id, invoice_number: dto.invoice_number.trim() } })
      if (clash && clash.id !== id) throw new ConflictException(`Invoice ${dto.invoice_number.trim()} of this supplier is already recorded (purchase ${clash.id})`)
    }

    const now = new Date()
    const data: Record<string, unknown> = { status: dto.to }
    if (dto.to === 'awaiting_invoice') Object.assign(data, { sent_at: now, sent_by: dto.actor })
    if (dto.to === 'invoiced') Object.assign(data, { invoiced_at: now, invoiced_by: dto.actor, invoice_number: invoiceNumber, invoice_key: invoiceKey, without_invoice: withoutInvoice })

    let receipt: ReturnType<typeof resolveReceipt> | null = null
    if (dto.to === 'received') {
      if (dto.received_on && !isDay(dto.received_on)) throw new BadRequestException('received_on must be a real date, YYYY-MM-DD')
      receipt = resolveReceipt(order.items.map(i => ({ itemId: i.id, ordered: i.quantity })), { received: dto.received?.map(r => ({ itemId: r.item_id, quantity: r.quantity })) })
      if ('problem' in receipt) throw new BadRequestException(receipt.problem)
      Object.assign(data, { received_on: asDate(dto.received_on ?? this.today()), received_at: now, received_by: dto.actor })
    }

    const updated = await this.prisma.$transaction(async tx => {
      if (receipt && 'lines' in receipt) for (const line of receipt.lines) await tx.purchaseItem.update({ where: { id: line.itemId }, data: { received_quantity: line.received } })
      await tx.purchase.update({ where: { id }, data })
      await tx.purchaseEvent.create({ data: { purchase_id: id, from_status: from, to_status: dto.to, actor: dto.actor, note: dto.note } })

      return tx.purchase.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } }, supplier: true } })
    })

    return toView(updated as PurchaseRow, this.today())
  }

  /** Delivery deadline, payment term and notes: changeable at any stage (they are plans, not facts). */
  async updateOrder(id: number, dto: UpdateOrderDto, correlationId?: string): Promise<PurchaseView> {
    const order = await this.prisma.purchase.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } })
    if (!order) throw new NotFoundException(`Purchase ${id} not found`)
    for (const [name, value] of [['expected_delivery_on', dto.expected_delivery_on], ['payment_due_on', dto.payment_due_on], ['ordered_on', dto.ordered_on], ['received_on', dto.received_on]] as const) {
      if (value && !isDay(value)) throw new BadRequestException(`${name} must be a real date, YYYY-MM-DD`)
    }
    const term = dto.payment_term ?? order.payment_term
    if (term === 'due_date' && !(dto.payment_due_on ?? order.payment_due_on)) throw new BadRequestException('A due date is needed when the payment term is a boleto (due_date)')

    const received = order.status === 'received'
    if (dto.supplier_id !== undefined && dto.supplier_id !== order.supplier_id) {
      if (received) throw new ConflictException('The supplier of a received purchase can no longer change')
      if (!(await this.prisma.supplier.findUnique({ where: { id: dto.supplier_id } }))) throw new NotFoundException(`Supplier ${dto.supplier_id} not found`)
    }
    if (dto.received_on && !received) throw new BadRequestException('received_on only applies to a received purchase')

    // The invoice, as it will be after the edit, still has to satisfy the stage the order is in.
    const invoiceNumber = dto.invoice_number !== undefined ? dto.invoice_number.trim() || null : order.invoice_number
    const invoiceKey = dto.invoice_key !== undefined ? dto.invoice_key.trim() || null : order.invoice_key
    const withoutInvoice = dto.without_invoice ?? (invoiceNumber && invoiceNumber !== order.invoice_number ? false : order.without_invoice)
    const invoiceProblem = checkInvoice(order.status as Stage, { invoiceNumber: invoiceNumber ?? undefined, invoiceKey: invoiceKey ?? undefined, withoutInvoice })
    if (invoiceProblem) throw new BadRequestException(invoiceProblem)
    const supplierId = dto.supplier_id ?? order.supplier_id
    if (invoiceNumber && (invoiceNumber !== order.invoice_number || supplierId !== order.supplier_id)) {
      const existing = await this.prisma.purchase.findFirst({ where: { supplier_id: supplierId, invoice_number: invoiceNumber } })
      if (existing && existing.id !== id) throw new ConflictException(`Invoice ${invoiceNumber} of this supplier is already recorded (purchase ${existing.id})`)
    }

    const itemChanges = dto.items ? await this.planItemEdit(order, dto.items, received, correlationId) : null
    if (received && (itemChanges?.touched || dto.received_on) && (await this.anySettled(order))) {
      throw new ConflictException('This purchase was already counted in a confirmed settlement: its items and receipt date can no longer change')
    }

    const notes = [
      dto.supplier_id !== undefined && dto.supplier_id !== order.supplier_id ? 'supplier' : null,
      dto.ordered_on || dto.received_on ? 'dates' : null,
      dto.invoice_number !== undefined || dto.invoice_key !== undefined || dto.without_invoice !== undefined ? 'invoice' : null,
      dto.expected_delivery_on || dto.payment_term || dto.payment_due_on ? 'terms' : null,
      itemChanges?.touched ? `items (+${itemChanges.created.length} -${itemChanges.removed.length} ~${itemChanges.updated.length})` : null,
      dto.notes !== undefined ? 'notes' : null,
    ].filter(Boolean)

    await this.prisma.$transaction(async tx => {
      if (itemChanges) {
        if (itemChanges.removed.length > 0) await tx.purchaseItem.deleteMany({ where: { id: { in: itemChanges.removed } } })
        for (const change of itemChanges.updated) await tx.purchaseItem.update({ where: { id: change.id }, data: change.data })
        for (const data of itemChanges.created) await tx.purchaseItem.create({ data: { purchase_id: id, ...data } })
      }
      await tx.purchase.update({
        where: { id },
        data: {
          ...(dto.supplier_id !== undefined ? { supplier_id: dto.supplier_id } : {}),
          ...(dto.ordered_on ? { ordered_on: asDate(dto.ordered_on) } : {}),
          ...(dto.received_on ? { received_on: asDate(dto.received_on) } : {}),
          ...(dto.invoice_number !== undefined ? { invoice_number: invoiceNumber } : {}),
          ...(dto.invoice_key !== undefined ? { invoice_key: invoiceKey } : {}),
          ...(dto.invoice_number !== undefined || dto.invoice_key !== undefined || dto.without_invoice !== undefined ? { without_invoice: withoutInvoice } : {}),
          ...(dto.expected_delivery_on ? { expected_delivery_on: asDate(dto.expected_delivery_on) } : {}),
          ...(dto.payment_term ? { payment_term: dto.payment_term } : {}),
          ...(dto.payment_due_on ? { payment_due_on: asDate(dto.payment_due_on) } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
      })
      if (notes.length > 0) await tx.purchaseEvent.create({ data: { purchase_id: id, from_status: order.status, to_status: order.status, actor: dto.actor, note: `edited: ${notes.join(', ')}` } })
    })

    return this.findById(id)
  }

  /**
   * Deletes a purchase with its items, history and e-mail log (a wrong entry, a test). A purchase whose items a confirmed or paid
   * settlement already counted stays: the settlement's evidence points at them. Who deleted what is logged.
   */
  async remove(id: number, actor?: string): Promise<void> {
    const order = await this.prisma.purchase.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } })
    if (!order) throw new NotFoundException(`Purchase ${id} not found`)
    if (await this.anySettled(order)) throw new ConflictException('This purchase was already counted in a confirmed settlement and cannot be deleted')

    await this.prisma.purchase.delete({ where: { id } })
    new Logger(PurchasesService.name).warn(`purchase ${id} (supplier ${order.supplier_id}, status ${order.status}, ${order.items.length} items, invoice ${order.invoice_number ?? '-'}) deleted by ${actor ?? 'unknown'}`)
  }

  /**
   * What an edited item list does to the stored one: lines with an id are updated, lines without are new, ids left out are removed.
   * A line already marked as paid cannot be changed or removed (the money was recorded against it); an unknown product is refused.
   */
  private async planItemEdit(order: { items: { id: number; sku: string; quantity: number; unit_cost_cents: number; condition: string; payment_status: string; received_quantity: number | null; description: string | null }[] }, edited: EditItemDto[], received: boolean, correlationId?: string) {
    const known = new Set((await this.products.products(correlationId)).map(p => p.sku))
    const unknown = [...new Set(edited.map(i => i.sku).filter(sku => !known.has(sku)))]
    if (unknown.length > 0) throw new BadRequestException(`Unknown products: ${unknown.join(', ')}`)

    const stored = new Map(order.items.map(i => [i.id, i]))
    const keep = new Set<number>()
    const updated: { id: number; data: Record<string, unknown> }[] = []
    const created: { sku: string; description?: string; quantity: number; unit_cost_cents: number; condition: string; received_quantity?: number }[] = []
    for (const line of edited) {
      if (line.id === undefined) {
        created.push({ sku: line.sku, description: line.description, quantity: line.quantity, unit_cost_cents: line.unit_cost_cents, condition: line.condition, received_quantity: received ? (line.received_quantity ?? line.quantity) : undefined })
        continue
      }
      const before = stored.get(line.id)
      if (!before) throw new BadRequestException(`Item ${line.id} does not belong to this purchase`)
      keep.add(line.id)
      const receivedQuantity = received ? (line.received_quantity ?? (line.quantity !== before.quantity ? line.quantity : before.received_quantity)) : null
      const changed = before.sku !== line.sku || before.quantity !== line.quantity || before.unit_cost_cents !== line.unit_cost_cents || before.condition !== line.condition || (received && receivedQuantity !== before.received_quantity)
      if (!changed) continue
      if (before.payment_status === 'paid') throw new ConflictException(`Item ${line.sku} is already marked as paid: undo the payment record before changing it`)
      updated.push({
        id: line.id,
        data: { sku: line.sku, description: line.description ?? before.description, quantity: line.quantity, unit_cost_cents: line.unit_cost_cents, condition: line.condition, ...(received ? { received_quantity: receivedQuantity } : {}), ...(line.condition !== before.condition ? { payment_status: 'pending', paid_on: null } : {}) },
      })
    }
    const removed = order.items.filter(i => !keep.has(i.id)).map(i => i.id)
    for (const gone of order.items.filter(i => removed.includes(i.id))) {
      if (gone.payment_status === 'paid') throw new ConflictException(`Item ${gone.sku} is already marked as paid: undo the payment record before removing it`)
    }

    return { updated, created, removed, touched: updated.length + created.length + removed.length > 0 }
  }

  private async anySettled(order: { supplier_id: number; items: { id: number }[] }): Promise<boolean> {
    for (const item of order.items) if (await this.isSettled(order.supplier_id, item.id)) return true

    return false
  }

  /**
   * Condition and payment status of one item. The condition cannot change once a confirmed or paid settlement counted the item;
   * the payment status is the operator's record for `paid` items only (on-sale items are quitted by the settlement, bonus owes nothing).
   */
  async updateItem(itemId: number, dto: UpdatePurchaseItemDto): Promise<PurchaseItemView> {
    const item = await this.prisma.purchaseItem.findUnique({ where: { id: itemId }, include: { purchase: true } })
    if (!item) throw new NotFoundException(`Purchase item ${itemId} not found`)

    const nextCondition = dto.condition ?? (item.condition as Condition)
    if (dto.condition && dto.condition !== item.condition && (await this.isSettled(item.purchase.supplier_id, itemId))) {
      throw new ConflictException('This item was already counted in a confirmed settlement: its condition can no longer change')
    }
    if (dto.payment_status && nextCondition !== 'paid') {
      throw new BadRequestException('Payment status is recorded for paid items; on-sale items are settled weekly and bonus items owe nothing')
    }
    if (dto.paid_on && !isDay(dto.paid_on)) throw new BadRequestException('paid_on must be a real date, YYYY-MM-DD')

    const status = dto.payment_status ?? (dto.condition && dto.condition !== 'paid' ? 'pending' : undefined)
    const updated = await this.prisma.purchaseItem.update({
      where: { id: itemId },
      data: {
        ...(dto.condition ? { condition: dto.condition } : {}),
        ...(status ? { payment_status: status } : {}),
        ...(dto.payment_status === 'paid' ? { paid_on: asDate(dto.paid_on ?? this.today()) } : {}),
        ...(dto.payment_status === 'pending' ? { paid_on: null } : {}),
        ...(dto.payment_note !== undefined ? { payment_note: dto.payment_note } : {}),
      },
    })

    return toView({ ...item.purchase, items: [updated], supplier: null }, this.today()).items[0]
  }

  /** True when a confirmed or paid settlement of the supplier lists the item. */
  async isSettled(supplierId: number, itemId: number): Promise<boolean> {
    const settlements = await this.prisma.settlement.findMany({ where: { supplier_id: supplierId, state: { in: ['confirmed', 'paid'] } }, select: { evidence: true } })

    return settlements.some(s => ((s.evidence as { lines?: { itemId: number }[] } | null)?.lines ?? []).some(line => line.itemId === itemId))
  }

  /**
   * One calendar month of RECEIVED purchases by SKU (dated by the receipt, on the received units), plus the first month any purchase was
   * received (the base the analysis reports from). Orders in earlier stages are only counted as open: they are not bought yet.
   */
  async summary(month: string): Promise<MonthSummary> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('month must be YYYY-MM')

    const [year, number] = month.split('-').map(Number)
    const from = new Date(Date.UTC(year, number - 1, 1))
    const to = new Date(Date.UTC(year, number, 1))
    const [rows, first, open] = await Promise.all([
      this.prisma.purchase.findMany({ where: { status: 'received', received_on: { gte: from, lt: to } }, include: { items: true } }),
      this.prisma.purchase.findFirst({ where: { status: 'received' }, orderBy: { received_on: 'asc' }, select: { received_on: true } }),
      this.prisma.purchase.count({ where: { status: { not: 'received' } } }),
    ])

    const bySku = new Map<string, MonthSummary['rows'][number]>()
    for (const purchase of rows)
      for (const item of purchase.items) {
        const row = bySku.get(item.sku) ?? { sku: item.sku, units_paid: 0, units_on_sale: 0, bonus_units: 0, cents_paid: 0, cents_on_sale: 0 }
        const units = item.received_quantity ?? item.quantity
        const cents = units * item.unit_cost_cents
        if (item.condition === 'paid') {
          row.units_paid += units
          row.cents_paid += cents
        } else if (item.condition === 'on_sale') {
          row.units_on_sale += units
          row.cents_on_sale += cents
        } else row.bonus_units += units
        bySku.set(item.sku, row)
      }

    return {
      month,
      base_from: first?.received_on ? (day(first.received_on) as string).slice(0, 7) : null,
      orders: rows.length,
      invoices: rows.filter(r => r.invoice_number).length,
      open_orders: open,
      rows: [...bySku.values()],
    }
  }

  /**
   * What is still to be paid, by due day: paid-condition items of orders already sent to the supplier. A boleto falls due on its date;
   * "pay on receipt" falls due the day it is received (until then it has no date). On-sale items are paid by the weekly settlement instead.
   */
  async pendingPayments(): Promise<{ total_cents: number; groups: PendingPaymentGroup[] }> {
    const rows = await this.prisma.purchase.findMany({
      where: { status: { not: 'requisition' } },
      include: { items: { where: { condition: 'paid', payment_status: 'pending' } }, supplier: true },
    })
    const today = this.today()
    const groups = new Map<string, PendingPaymentGroup>()

    for (const purchase of rows) {
      if (purchase.items.length === 0) continue
      const due = effectiveDueDate((purchase.payment_term as PaymentTerm | null) ?? null, day(purchase.payment_due_on), day(purchase.received_on))
      const key = due ?? 'on_receipt'
      const group = groups.get(key) ?? { due_on: due, total_cents: 0, overdue: isOverdue(due, true, today), items: [] }
      for (const item of purchase.items) {
        const total = effectiveQuantity(purchase.status, item) * item.unit_cost_cents
        group.total_cents += total
        group.items.push({ purchase_id: purchase.id, item_id: item.id, supplier_name: purchase.supplier?.name ?? null, sku: item.sku, description: item.description, quantity: effectiveQuantity(purchase.status, item), total_cents: total })
      }
      groups.set(key, group)
    }

    const ordered = [...groups.values()].sort((a, b) => (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999'))

    return { total_cents: ordered.reduce((s, g) => s + g.total_cents, 0), groups: ordered }
  }
}
