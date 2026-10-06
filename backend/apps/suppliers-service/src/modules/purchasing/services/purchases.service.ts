import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { ProductsClient } from '../clients/products.client'
import type { Condition, Origin, PaymentStatus } from '../constants/purchase-vocabulary'
import type { CreatePurchaseDto, UpdatePurchaseItemDto } from '../dto/purchase.dto'
import { isDay } from '../utils/week'

export interface PurchaseItemView {
  id: number
  sku: string
  description: string | null
  quantity: number
  unit_cost_cents: number
  condition: Condition
  payment_status: PaymentStatus
  paid_on: string | null
  payment_note: string | null
  /** Quantity × unit cost. For a bonus item it is the reference value, and is NOT counted as spend. */
  total_cents: number
}

export interface PurchaseView {
  id: number
  supplier_id: number
  supplier_name: string | null
  ordered_on: string
  origin: Origin
  invoice_number: string | null
  invoice_key: string | null
  notes: string | null
  items: PurchaseItemView[]
  /** Spend: paid items at cost. On-sale items are owed only as they sell (see the settlement); bonus items cost nothing. */
  paid_cents: number
  on_sale_cents: number
  bonus_units: number
}

/** What a month of purchases says about each SKU, for the analysis. `null`/absent rows mean "no purchase record", never zero. */
export interface MonthSummary {
  month: string
  /** First month with any purchase, or null while there is none. */
  base_from: string | null
  orders: number
  invoices: number
  rows: { sku: string; units_paid: number; units_on_sale: number; bonus_units: number; cents_paid: number; cents_on_sale: number }[]
}

const day = (date: Date | null): string | null => (date ? date.toISOString().slice(0, 10) : null)

type PurchaseRow = {
  id: number
  supplier_id: number
  ordered_on: Date
  origin: string
  invoice_number: string | null
  invoice_key: string | null
  notes: string | null
  supplier?: { name: string } | null
  items: {
    id: number
    sku: string
    description: string | null
    quantity: number
    unit_cost_cents: number
    condition: string
    payment_status: string
    paid_on: Date | null
    payment_note: string | null
  }[]
}

export function toView(row: PurchaseRow): PurchaseView {
  const items = row.items.map(
    (item): PurchaseItemView => ({
      id: item.id,
      sku: item.sku,
      description: item.description,
      quantity: item.quantity,
      unit_cost_cents: item.unit_cost_cents,
      condition: item.condition as Condition,
      payment_status: item.payment_status as PaymentStatus,
      paid_on: day(item.paid_on),
      payment_note: item.payment_note,
      total_cents: item.quantity * item.unit_cost_cents,
    }),
  )
  const sum = (condition: Condition) => items.filter(i => i.condition === condition).reduce((s, i) => s + i.total_cents, 0)

  return {
    id: row.id,
    supplier_id: row.supplier_id,
    supplier_name: row.supplier?.name ?? null,
    ordered_on: day(row.ordered_on) as string,
    origin: row.origin as Origin,
    invoice_number: row.invoice_number,
    invoice_key: row.invoice_key,
    notes: row.notes,
    items,
    paid_cents: sum('paid'),
    on_sale_cents: sum('on_sale'),
    bonus_units: items.filter(i => i.condition === 'bonus').reduce((s, i) => s + i.quantity, 0),
  }
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaClientService,
    private readonly products: ProductsClient,
  ) {}

  async create(dto: CreatePurchaseDto, correlationId?: string): Promise<PurchaseView> {
    if (!isDay(dto.ordered_on)) throw new BadRequestException('ordered_on must be a real date, YYYY-MM-DD')

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

    const created = await this.prisma.purchase.create({
      data: {
        supplier_id: dto.supplier_id,
        ordered_on: new Date(`${dto.ordered_on}T00:00:00Z`),
        origin: dto.origin ?? (dto.invoice_key ? 'nfe' : 'manual'),
        invoice_number: invoiceNumber,
        invoice_key: dto.invoice_key,
        invoice_object_key: dto.invoice_object_key,
        notes: dto.notes,
        items: {
          create: dto.items.map(item => ({
            sku: item.sku,
            description: item.description,
            quantity: item.quantity,
            unit_cost_cents: item.unit_cost_cents,
            condition: item.condition,
          })),
        },
      },
      include: { items: { orderBy: { id: 'asc' } }, supplier: true },
    })

    return toView(created)
  }

  async list(filter: { supplierId?: number; from?: string; to?: string; invoicesOnly?: boolean } = {}): Promise<PurchaseView[]> {
    for (const value of [filter.from, filter.to]) if (value && !isDay(value)) throw new BadRequestException('from and to must be YYYY-MM-DD')

    const rows = await this.prisma.purchase.findMany({
      where: {
        ...(filter.supplierId ? { supplier_id: filter.supplierId } : {}),
        ...(filter.from || filter.to
          ? { ordered_on: { ...(filter.from ? { gte: new Date(`${filter.from}T00:00:00Z`) } : {}), ...(filter.to ? { lte: new Date(`${filter.to}T00:00:00Z`) } : {}) } }
          : {}),
        ...(filter.invoicesOnly ? { invoice_number: { not: null } } : {}),
      },
      include: { items: { orderBy: { id: 'asc' } }, supplier: true },
      orderBy: [{ ordered_on: 'desc' }, { id: 'desc' }],
      take: 500,
    })

    return rows.map(toView)
  }

  async findById(id: number): Promise<PurchaseView> {
    const row = await this.prisma.purchase.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } }, supplier: true } })
    if (!row) throw new NotFoundException(`Purchase ${id} not found`)

    return toView(row)
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
        ...(dto.payment_status === 'paid' ? { paid_on: new Date(`${dto.paid_on ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`) } : {}),
        ...(dto.payment_status === 'pending' ? { paid_on: null } : {}),
        ...(dto.payment_note !== undefined ? { payment_note: dto.payment_note } : {}),
      },
    })

    return toView({ ...item.purchase, items: [updated], supplier: null, supplier_id: item.purchase.supplier_id }).items[0]
  }

  /** True when a confirmed or paid settlement of the supplier lists the item. */
  async isSettled(supplierId: number, itemId: number): Promise<boolean> {
    const settlements = await this.prisma.settlement.findMany({ where: { supplier_id: supplierId, state: { in: ['confirmed', 'paid'] } }, select: { evidence: true } })

    return settlements.some(s => ((s.evidence as { lines?: { itemId: number }[] } | null)?.lines ?? []).some(line => line.itemId === itemId))
  }

  /** One calendar month of purchases by SKU, plus the first month any purchase exists (the base the analysis reports from). */
  async summary(month: string): Promise<MonthSummary> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('month must be YYYY-MM')

    const [year, number] = month.split('-').map(Number)
    const from = new Date(Date.UTC(year, number - 1, 1))
    const to = new Date(Date.UTC(year, number, 1))
    const [rows, first] = await Promise.all([
      this.prisma.purchase.findMany({ where: { ordered_on: { gte: from, lt: to } }, include: { items: true } }),
      this.prisma.purchase.findFirst({ orderBy: { ordered_on: 'asc' }, select: { ordered_on: true } }),
    ])

    const bySku = new Map<string, MonthSummary['rows'][number]>()
    for (const purchase of rows)
      for (const item of purchase.items) {
        const row = bySku.get(item.sku) ?? { sku: item.sku, units_paid: 0, units_on_sale: 0, bonus_units: 0, cents_paid: 0, cents_on_sale: 0 }
        const cents = item.quantity * item.unit_cost_cents
        if (item.condition === 'paid') {
          row.units_paid += item.quantity
          row.cents_paid += cents
        } else if (item.condition === 'on_sale') {
          row.units_on_sale += item.quantity
          row.cents_on_sale += cents
        } else row.bonus_units += item.quantity
        bySku.set(item.sku, row)
      }

    return {
      month,
      base_from: first ? (day(first.ordered_on) as string).slice(0, 7) : null,
      orders: rows.length,
      invoices: rows.filter(r => r.invoice_number).length,
      rows: [...bySku.values()],
    }
  }
}
