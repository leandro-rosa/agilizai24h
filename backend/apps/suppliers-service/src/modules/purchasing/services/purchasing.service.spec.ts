import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { OrderEmailService } from '../mail/order-email.service'
import { PurchasesService } from './purchases.service'
import { SettlementService } from './settlement.service'

/** A tiny in-memory stand-in for the Prisma tables these services touch. No database, no real data. */
function fakePrisma() {
  const db = {
    suppliers: [{ id: 5, name: 'Quinoa', email: 'vendas@quinoa.com.br' as string | null }],
    purchases: [] as any[],
    items: [] as any[],
    settlements: [] as any[],
    events: [] as any[],
    emails: [] as any[],
  }
  let purchaseId = 0
  let itemId = 0
  let settlementId = 0

  const withItems = (p: any) => ({ ...p, items: db.items.filter(i => i.purchase_id === p.id), supplier: db.suppliers.find(s => s.id === p.supplier_id) })
  const matches = (p: any, where: any = {}): boolean => {
    if (where.supplier_id && p.supplier_id !== where.supplier_id) return false
    if (where.invoice_number && typeof where.invoice_number === 'string' && p.invoice_number !== where.invoice_number) return false
    if (where.status) {
      if (typeof where.status === 'string' && p.status !== where.status) return false
      if (where.status.not && p.status === where.status.not) return false
    }
    for (const field of ['ordered_on', 'received_on'] as const) {
      const range = where[field]
      if (!range) continue
      if (!p[field]) return false
      if (range.lte && p[field] > range.lte) return false
      if (range.lt && p[field] >= range.lt) return false
      if (range.gte && p[field] < range.gte) return false
    }
    return true
  }
  const prisma: any = {
    supplier: {
      findUnique: async ({ where }: any) => db.suppliers.find(s => s.id === where.id) ?? null,
      update: async ({ where, data }: any) => Object.assign(db.suppliers.find(s => s.id === where.id)!, data),
    },
    purchaseEmail: {
      create: async ({ data }: any) => (db.emails.push({ id: db.emails.length + 1, created_at: new Date(Date.now() + db.emails.length), error: null, message_id: null, ...data }), data),
      findMany: async ({ where }: any) => db.emails.filter((e: any) => e.purchase_id === where.purchase_id).reverse(),
    },
    purchase: {
      findFirst: async ({ where, orderBy }: any) => {
        let rows = db.purchases.filter(p => matches(p, where))
        if (orderBy) rows = [...rows].sort((a, b) => (a.received_on ?? a.ordered_on) - (b.received_on ?? b.ordered_on))
        return rows[0] ?? null
      },
      count: async ({ where }: any) => db.purchases.filter(p => matches(p, where)).length,
      create: async ({ data }: any) => {
        const { items, events, ...rest } = data
        const row = { id: ++purchaseId, invoice_number: null, invoice_key: null, notes: null, created_by: null, sent_at: null, sent_by: null, invoiced_at: null, invoiced_by: null, received_on: null, received_at: null, received_by: null, expected_delivery_on: null, payment_term: null, payment_due_on: null, without_invoice: false, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) }
        db.purchases.push(row)
        for (const item of items.create) db.items.push({ id: ++itemId, purchase_id: row.id, payment_status: 'pending', paid_on: null, payment_note: null, description: null, received_quantity: null, ...Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined)) })
        for (const event of events?.create ?? []) db.events.push({ id: db.events.length + 1, purchase_id: row.id, created_at: new Date(), note: null, ...event })
        return withItems(row)
      },
      update: async ({ where, data }: any) => Object.assign(db.purchases.find(p => p.id === where.id), data),
      findMany: async ({ where, include }: any) =>
        db.purchases.filter(p => matches(p, where)).map(p => {
          const full = withItems(p)
          const itemWhere = include?.items?.where
          return itemWhere ? { ...full, items: full.items.filter((i: any) => Object.entries(itemWhere).every(([k, v]) => i[k] === v)) } : full
        }),
      findUnique: async ({ where }: any) => (db.purchases.find(p => p.id === where.id) ? withItems(db.purchases.find(p => p.id === where.id)) : null),
    },
    purchaseEvent: {
      create: async ({ data }: any) => (db.events.push({ id: db.events.length + 1, created_at: new Date(), note: null, ...data }), data),
      findMany: async ({ where }: any) => db.events.filter((e: any) => e.purchase_id === where.purchase_id),
    },
    purchaseItem: {
      findUnique: async ({ where }: any) => {
        const item = db.items.find(i => i.id === where.id)
        return item ? { ...item, purchase: db.purchases.find(p => p.id === item.purchase_id) } : null
      },
      update: async ({ where, data }: any) => Object.assign(db.items.find(i => i.id === where.id), data),
    },
    settlement: {
      findMany: async ({ where }: any) =>
        db.settlements.filter(
          s => (!where?.supplier_id || s.supplier_id === where.supplier_id) && (!where?.state?.in || where.state.in.includes(s.state)) && (!where?.week_start?.lt || s.week_start < where.week_start.lt),
        ).map(s => ({ ...s, supplier: db.suppliers.find(x => x.id === s.supplier_id) })),
      findUnique: async ({ where }: any) => {
        const found = where.id ? db.settlements.find(s => s.id === where.id) : db.settlements.find(s => s.supplier_id === where.supplier_id_week_start.supplier_id && +s.week_start === +where.supplier_id_week_start.week_start)
        return found ? { ...found, supplier: db.suppliers.find(x => x.id === found.supplier_id) } : null
      },
      upsert: async ({ where, create, update }: any) => {
        const key = where.supplier_id_week_start
        const found = db.settlements.find(s => s.supplier_id === key.supplier_id && +s.week_start === +key.week_start)
        const row = found ? Object.assign(found, update) : (db.settlements.push({ id: ++settlementId, confirmed_at: null, paid_on: null, payment_note: null, ...create }), db.settlements[db.settlements.length - 1])
        return { ...row, supplier: db.suppliers[0] }
      },
      update: async ({ where, data }: any) => ({ ...Object.assign(db.settlements.find(s => s.id === where.id), data), supplier: db.suppliers[0] }),
    },
  }
  prisma.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)

  return { prisma, db }
}

const catalogue = { products: async () => [{ id: 1, sku: 'Q1', name: 'Quinoa wrap' }, { id: 2, sku: 'Q2', name: 'Quinoa bar' }] }
const item = (over: Record<string, unknown> = {}) => ({ sku: 'Q1', quantity: 100, unit_cost_cents: 500, condition: 'on_sale' as const, ...over })

describe('PurchasesService', () => {
  const make = () => {
    const { prisma, db } = fakePrisma()

    return { service: new PurchasesService(prisma as never, catalogue as never), db }
  }

  it('records a manual purchase with no invoice number', async () => {
    const { service } = make()
    const view = await service.create({ supplier_id: 5, ordered_on: '2026-10-05', items: [item({ condition: 'paid' })] })

    expect(view).toMatchObject({ supplier_id: 5, origin: 'manual', invoice_number: null, ordered_on: '2026-10-05', paid_cents: 50000, on_sale_cents: 0 })
    expect(view.items[0]).toMatchObject({ sku: 'Q1', quantity: 100, unit_cost_cents: 500, condition: 'paid', payment_status: 'pending' })
  })

  it('refuses an unknown supplier, an unknown product and an impossible date', async () => {
    const { service } = make()

    await expect(service.create({ supplier_id: 9, ordered_on: '2026-10-05', items: [item()] })).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.create({ supplier_id: 5, ordered_on: '2026-10-05', items: [item({ sku: 'NOPE' })] })).rejects.toThrow(/Unknown products: NOPE/)
    await expect(service.create({ supplier_id: 5, ordered_on: '2026-02-30', items: [item()] })).rejects.toBeInstanceOf(BadRequestException)
  })

  it('does not duplicate a repeated invoice of the same supplier', async () => {
    const { service } = make()
    await service.create({ supplier_id: 5, ordered_on: '2026-10-05', invoice_number: '123', items: [item()] })

    await expect(service.create({ supplier_id: 5, ordered_on: '2026-10-05', invoice_number: '123', items: [item()] })).rejects.toBeInstanceOf(ConflictException)
  })

  it('counts a bonus item as no spend and reports its units', async () => {
    const { service } = make()
    const view = await service.create({ supplier_id: 5, ordered_on: '2026-10-05', items: [item({ condition: 'bonus', unit_cost_cents: 0, quantity: 12 })] })

    expect(view).toMatchObject({ paid_cents: 0, on_sale_cents: 0, bonus_units: 12 })
  })

  it('summarises a month by SKU and condition, and reports the first month as the base', async () => {
    const { service } = make()
    await service.create({ supplier_id: 5, ordered_on: '2026-10-05', invoice_number: 'A', items: [item({ condition: 'paid', quantity: 10 }), item({ sku: 'Q2', condition: 'bonus', unit_cost_cents: 0, quantity: 3 })] })
    await service.create({ supplier_id: 5, ordered_on: '2026-11-02', items: [item({ quantity: 7 })] })
    const october = await service.summary('2026-10')

    expect(october).toMatchObject({ base_from: '2026-10', orders: 1, invoices: 1 })
    expect(october.rows).toEqual(expect.arrayContaining([{ sku: 'Q1', units_paid: 10, units_on_sale: 0, bonus_units: 0, cents_paid: 5000, cents_on_sale: 0 }, { sku: 'Q2', units_paid: 0, units_on_sale: 0, bonus_units: 3, cents_paid: 0, cents_on_sale: 0 }]))
    expect((await service.summary('2026-09')).rows).toEqual([])
    expect((await service.summary('2026-09')).base_from).toBe('2026-10')
  })

  it('records payment only for paid items, and sets the date', async () => {
    const { service } = make()
    const bought = await service.create({ supplier_id: 5, ordered_on: '2026-10-05', items: [item({ condition: 'paid' }), item({ sku: 'Q2' })] })

    const paid = await service.updateItem(bought.items[0].id, { payment_status: 'paid', paid_on: '2026-10-12', payment_note: 'PIX' })
    expect(paid).toMatchObject({ payment_status: 'paid', paid_on: '2026-10-12', payment_note: 'PIX' })
    await expect(service.updateItem(bought.items[1].id, { payment_status: 'paid' })).rejects.toThrow(/Payment status is recorded for paid items/)
  })
})

describe('SettlementService — the Quinoa case', () => {
  const setup = async (sold: unknown) => {
    const { prisma, db } = fakePrisma()
    const purchases = new PurchasesService(prisma as never, catalogue as never)
    const sales = { soldBySku: jest.fn(async () => sold) }
    const settlements = new SettlementService(prisma as never, sales as never)
    const bought = await purchases.create({ supplier_id: 5, ordered_on: '2026-10-05', items: [item()] })

    return { settlements, purchases, sales, db, itemId: bought.items[0].id }
  }
  const complete = { from: '2026-10-05', to: '2026-10-11', rows: [{ sku: 'Q1', quantity: 62, revenue_cents: 99999 }], months_without_dated_receipts: [], stores_missing: 0 }

  it('proposes R$ 310,00 for 100 delivered, 62 sold, 8 expired — as a proposal, not owed yet', async () => {
    const { settlements, itemId } = await setup(complete)
    const view = await settlements.propose({ supplier_id: 5, week_start: '2026-10-07', write_offs: [{ item_id: itemId, expired: 8 }] })

    expect(view).toMatchObject({ week_start: '2026-10-05', week_end: '2026-10-11', state: 'proposal', counts_as_owed: false, owed_cents: 31000, partial: false })
    expect(view.evidence.lines[0]).toMatchObject({ delivered: 100, sold: 62, expired: 8, unsold: 30, owedCents: 31000 })
  })

  it('confirms, then marks paid, and a week once confirmed cannot be recomputed', async () => {
    const { settlements, itemId } = await setup(complete)
    const proposal = await settlements.propose({ supplier_id: 5, week_start: '2026-10-05', write_offs: [{ item_id: itemId, expired: 8 }] })
    const confirmed = await settlements.confirm(proposal.id)

    expect(confirmed).toMatchObject({ state: 'confirmed', counts_as_owed: true })
    expect(await settlements.openTotal()).toEqual({ confirmed_cents: 31000, proposals: 0 })
    await expect(settlements.propose({ supplier_id: 5, week_start: '2026-10-05' })).rejects.toBeInstanceOf(ConflictException)

    const paid = await settlements.markPaid(proposal.id, '2026-10-14', 'PIX')
    expect(paid).toMatchObject({ state: 'paid', paid_on: '2026-10-14' })
    expect(await settlements.openTotal()).toEqual({ confirmed_cents: 0, proposals: 0 })
  })

  it('carries the balance to the next week: only what is still open can be owed', async () => {
    const { settlements, sales, itemId } = await setup(complete)
    const week1 = await settlements.propose({ supplier_id: 5, week_start: '2026-10-05', write_offs: [{ item_id: itemId, expired: 8 }] })
    await settlements.confirm(week1.id)

    sales.soldBySku.mockResolvedValueOnce({ ...complete, rows: [{ sku: 'Q1', quantity: 50, revenue_cents: 1 }] } as never)
    const week2 = await settlements.propose({ supplier_id: 5, week_start: '2026-10-12' })

    expect(week2.evidence.lines[0]).toMatchObject({ openBefore: 30, sold: 30, unsold: 0, owedCents: 15000 })
    expect(week2.evidence.soldNotCovered).toEqual({ Q1: 20 })
  })

  it('a week without dated receipts owes nothing, says why, and needs accept_partial to confirm', async () => {
    const { settlements } = await setup({ ...complete, months_without_dated_receipts: ['2026-10'] })
    const view = await settlements.propose({ supplier_id: 5, week_start: '2026-10-05' })

    expect(view).toMatchObject({ partial: true, owed_cents: 0 })
    expect(view.evidence.quality).toMatchObject({ salesUnknown: true, monthsWithoutDatedReceipts: ['2026-10'] })
    await expect(settlements.confirm(view.id)).rejects.toThrow(/partial/)
    await expect(settlements.confirm(view.id, true)).resolves.toMatchObject({ state: 'confirmed' })
  })

  it('refuses a supplier with no on-sale items, and write-offs for items that are not on sale', async () => {
    const { settlements } = await setup(complete)

    await expect(settlements.propose({ supplier_id: 9, week_start: '2026-10-05' })).rejects.toBeInstanceOf(NotFoundException)
    await expect(settlements.propose({ supplier_id: 5, week_start: '2026-10-05', write_offs: [{ item_id: 999, expired: 1 }] })).rejects.toThrow(/not on sale/)
  })

  it('does not let the condition of a settled item change', async () => {
    const { settlements, purchases, itemId } = await setup(complete)
    const proposal = await settlements.propose({ supplier_id: 5, week_start: '2026-10-05' })
    await settlements.confirm(proposal.id)

    await expect(purchases.updateItem(itemId, { condition: 'paid' })).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('order stages', () => {
  const make = () => {
    const { prisma, db } = fakePrisma()
    const service = new PurchasesService(prisma as never, catalogue as never)
    jest.spyOn(service, 'today').mockReturnValue('2026-10-12')

    return { service, db, prisma }
  }
  const lines = [item({ condition: 'paid', quantity: 100 }), item({ sku: 'Q2', condition: 'on_sale', quantity: 20 })]

  it('creates a requisition with no invoice and records who and at which stage', async () => {
    const { service, db } = make()
    const order = await service.create({ supplier_id: 5, ordered_on: '2026-10-05', stage: 'requisition', actor: 'ana@agiliz.ai', items: lines })

    expect(order).toMatchObject({ status: 'requisition', created_by: 'ana@agiliz.ai', received_on: null })
    expect(db.events[0]).toMatchObject({ from_status: null, to_status: 'requisition', actor: 'ana@agiliz.ai', note: 'created at requisition' })
  })

  it('enters directly at a later stage — the invoice is often issued before anything is recorded', async () => {
    const { service } = make()
    const invoiced = await service.create({ supplier_id: 5, ordered_on: '2026-10-05', stage: 'invoiced', invoice_number: '4990356', items: lines })
    expect(invoiced).toMatchObject({ status: 'invoiced', invoice_number: '4990356', invoiced_by: null })

    const received = await service.create({ supplier_id: 5, ordered_on: '2026-10-05', stage: 'received', received_on: '2026-10-09', without_invoice: true, items: lines })
    expect(received).toMatchObject({ status: 'received', received_on: '2026-10-09', without_invoice: true })
    expect(received.items[0]).toMatchObject({ quantity: 100, received_quantity: 100, difference: 0 })
  })

  it('refuses invoiced or later with neither a number, an NF-e nor "no invoice"', async () => {
    const { service } = make()

    await expect(service.create({ supplier_id: 5, ordered_on: '2026-10-05', stage: 'invoiced', items: lines })).rejects.toThrow(/invoice number or an imported NF-e/)
    await expect(service.create({ supplier_id: 5, ordered_on: '2026-10-05', stage: 'requisition', items: lines })).resolves.toBeDefined()
  })

  it('moves one stage at a time with the history, and asks each step for what it needs', async () => {
    const { service, db } = make()
    const order = await service.create({ supplier_id: 5, ordered_on: '2026-10-05', stage: 'requisition', actor: 'ana', items: lines })

    await expect(service.transition(order.id, { to: 'received' })).rejects.toThrow(/one stage at a time/)
    await expect(service.transition(order.id, { to: 'awaiting_invoice', actor: 'ana' })).resolves.toMatchObject({ status: 'awaiting_invoice', sent_by: 'ana' })
    await expect(service.transition(order.id, { to: 'invoiced' })).rejects.toThrow(/invoice number or an imported NF-e/)
    await expect(service.transition(order.id, { to: 'invoiced', invoice_number: 'NF-9', actor: 'bia' })).resolves.toMatchObject({ status: 'invoiced', invoice_number: 'NF-9', invoiced_by: 'bia' })
    await service.transition(order.id, { to: 'awaiting_receipt', actor: 'bia' })

    expect(db.events.map((e: any) => `${e.from_status ?? '-'}>${e.to_status}`)).toEqual(['-' + '>requisition', 'requisition>awaiting_invoice', 'awaiting_invoice>invoiced', 'invoiced>awaiting_receipt'])
  })

  it('receives with the quantity per item, shows the difference, and the order is then final', async () => {
    const { service } = make()
    const order = await service.create({ supplier_id: 5, ordered_on: '2026-10-05', stage: 'awaiting_receipt', invoice_number: 'NF-1', items: lines })

    const received = await service.transition(order.id, { to: 'received', received_on: '2026-10-11', received: [{ item_id: order.items[0].id, quantity: 90 }], actor: 'caio' })
    expect(received).toMatchObject({ status: 'received', received_on: '2026-10-11', received_by: 'caio' })
    expect(received.items[0]).toMatchObject({ quantity: 100, received_quantity: 90, difference: 10, total_cents: 90 * 500 })
    expect(received.items[1]).toMatchObject({ received_quantity: 20, difference: 0 })
    await expect(service.transition(order.id, { to: 'received' })).rejects.toThrow(/final/)
  })

  it('only RECEIVED orders count as purchases, dated by the receipt and on the received units', async () => {
    const { service } = make()
    await service.create({ supplier_id: 5, ordered_on: '2026-09-28', stage: 'awaiting_receipt', invoice_number: 'OPEN', items: [item({ condition: 'paid', quantity: 50 })] })
    const received = await service.create({ supplier_id: 5, ordered_on: '2026-09-28', stage: 'awaiting_receipt', invoice_number: 'GOT', items: [item({ condition: 'paid', quantity: 100 })] })
    await service.transition(received.id, { to: 'received', received_on: '2026-10-02', received: [{ item_id: received.items[0].id, quantity: 90 }] })

    const october = await service.summary('2026-10')
    expect(october.rows).toEqual([{ sku: 'Q1', units_paid: 90, units_on_sale: 0, bonus_units: 0, cents_paid: 45000, cents_on_sale: 0 }])
    expect(october).toMatchObject({ base_from: '2026-10', orders: 1, open_orders: 1 })
    // ordered in September, received in October: it is October's purchase, not September's
    expect((await service.summary('2026-09')).rows).toEqual([])
  })

  it('shows late deliveries and overdue payments, and "pay on receipt" is due on the receipt day', async () => {
    const { service } = make()
    const late = await service.create({ supplier_id: 5, ordered_on: '2026-10-01', stage: 'awaiting_receipt', invoice_number: 'L', expected_delivery_on: '2026-10-10', payment_term: 'due_date', payment_due_on: '2026-10-11', items: [item({ condition: 'paid' })] })
    expect(late).toMatchObject({ late: true, overdue: true, payment_due_effective: '2026-10-11' })

    const onReceipt = await service.create({ supplier_id: 5, ordered_on: '2026-10-01', stage: 'awaiting_receipt', invoice_number: 'R', payment_term: 'on_receipt', items: [item({ condition: 'paid' })] })
    expect(onReceipt).toMatchObject({ payment_due_effective: null, overdue: false })
    const got = await service.transition(onReceipt.id, { to: 'received', received_on: '2026-10-09' })
    expect(got).toMatchObject({ payment_due_effective: '2026-10-09', late: false, overdue: true })
  })

  it('refuses a boleto without a due date', async () => {
    const { service } = make()

    await expect(service.create({ supplier_id: 5, ordered_on: '2026-10-01', payment_term: 'due_date', items: lines })).rejects.toThrow(/due date is needed/)
  })

  it('lists what is to be paid by due day, with a group for pay-on-receipt not received yet, and leaves requisitions and on-sale out', async () => {
    const { service } = make()
    await service.create({ supplier_id: 5, ordered_on: '2026-10-01', stage: 'invoiced', invoice_number: 'A', payment_term: 'due_date', payment_due_on: '2026-10-20', items: [item({ condition: 'paid', quantity: 10, unit_cost_cents: 100 })] })
    await service.create({ supplier_id: 5, ordered_on: '2026-10-01', stage: 'invoiced', invoice_number: 'B', payment_term: 'due_date', payment_due_on: '2026-10-08', items: [item({ condition: 'paid', quantity: 5, unit_cost_cents: 200 }), item({ sku: 'Q2', condition: 'on_sale', quantity: 99 })] })
    await service.create({ supplier_id: 5, ordered_on: '2026-10-01', stage: 'invoiced', invoice_number: 'C', payment_term: 'on_receipt', items: [item({ condition: 'paid', quantity: 2, unit_cost_cents: 300 })] })
    await service.create({ supplier_id: 5, ordered_on: '2026-10-01', stage: 'requisition', payment_term: 'due_date', payment_due_on: '2026-10-09', items: [item({ condition: 'paid', quantity: 1 })] })

    const pending = await service.pendingPayments()

    expect(pending.groups.map(g => [g.due_on, g.total_cents, g.overdue])).toEqual([['2026-10-08', 1000, true], ['2026-10-20', 1000, false], [null, 600, false]])
    expect(pending.total_cents).toBe(2600)
  })

  it('a received purchase is paid once marked paid, and then leaves the pending list', async () => {
    const { service } = make()
    const order = await service.create({ supplier_id: 5, ordered_on: '2026-10-01', stage: 'invoiced', invoice_number: 'P', payment_term: 'due_date', payment_due_on: '2026-10-20', items: [item({ condition: 'paid', quantity: 10, unit_cost_cents: 100 })] })
    expect((await service.pendingPayments()).total_cents).toBe(1000)

    await service.updateItem(order.items[0].id, { payment_status: 'paid', paid_on: '2026-10-12' })
    expect((await service.pendingPayments()).total_cents).toBe(0)
  })
})

describe('settlement counts only received orders', () => {
  it('ignores on-sale items still waiting for receipt, and uses the received quantity', async () => {
    const { prisma } = fakePrisma()
    const purchases = new PurchasesService(prisma as never, catalogue as never)
    const sales = { soldBySku: async () => ({ from: '', to: '', rows: [{ sku: 'Q1', quantity: 95, revenue_cents: 1 }], months_without_dated_receipts: [], stores_missing: 0 }) }
    const settlements = new SettlementService(prisma as never, sales as never)

    const order = await purchases.create({ supplier_id: 5, ordered_on: '2026-10-01', stage: 'awaiting_receipt', invoice_number: 'S1', items: [item({ quantity: 100 })] })
    await expect(settlements.propose({ supplier_id: 5, week_start: '2026-10-05' })).rejects.toThrow(/no on-sale items received/)

    await purchases.transition(order.id, { to: 'received', received_on: '2026-10-02', received: [{ item_id: order.items[0].id, quantity: 90 }] })
    const week = await settlements.propose({ supplier_id: 5, week_start: '2026-10-05' })

    expect(week.evidence.lines[0]).toMatchObject({ delivered: 90, sold: 90, owedCents: 90 * 500 })
    expect(week.evidence.soldNotCovered).toEqual({ Q1: 5 })
  })
})


describe('OrderEmailService — sending an order', () => {
  const PDF = Buffer.from('%PDF-1.4 fake').toString('base64')
  const setup = (transport: Partial<{ from: () => string | null; send: jest.Mock }> = {}) => {
    const { prisma, db } = fakePrisma()
    const purchases = new PurchasesService(prisma as never, catalogue as never)
    const send = transport.send ?? jest.fn(async () => ({ messageId: '<abc@mail>' }))
    const mail = { from: transport.from ?? (() => 'pedidos@agiliz.ai'), send }
    const service = new OrderEmailService(prisma as never, purchases, mail as never)

    return { service, purchases, db, send }
  }
  const requisition = (purchases: PurchasesService) => purchases.create({ supplier_id: 5, ordered_on: '2026-10-05', stage: 'requisition', actor: 'ana', items: [item({ condition: 'paid', quantity: 10 })] })

  it('previews the e-mail with the supplier address and sends nothing', async () => {
    const { service, purchases, send } = setup()
    const order = await requisition(purchases)
    const preview = await service.preview(order.id)

    expect(preview).toMatchObject({ to: 'vendas@quinoa.com.br', supplier_name: 'Quinoa', configured: true, already_sent: false, attachment: { suggested_filename: `pedido-${order.id}.pdf` } })
    expect(preview.html).toContain('<table')
    expect(send).not.toHaveBeenCalled()
  })

  it('sends on confirmation, logs it, and moves a requisition to awaiting invoice with who sent it', async () => {
    const { service, purchases, send, db } = setup()
    const order = await requisition(purchases)
    const result = await service.send(order.id, { to: 'vendas@quinoa.com.br', attachment_base64: PDF, attachment_name: 'pedido 1', actor: 'ana' })

    expect(send).toHaveBeenCalledTimes(1)
    const message = (send.mock.calls[0] as unknown as [{ to: string; from: string; attachments: { filename: string; contentType: string }[] }])[0]
    expect(message).toMatchObject({ to: 'vendas@quinoa.com.br', from: 'pedidos@agiliz.ai' })
    expect(message.attachments[0]).toMatchObject({ filename: 'pedido 1.pdf', contentType: 'application/pdf' })
    expect(result.order).toMatchObject({ status: 'awaiting_invoice', sent_by: 'ana' })
    expect(db.emails[0]).toMatchObject({ to_address: 'vendas@quinoa.com.br', result: 'sent', message_id: '<abc@mail>', has_attachment: true, sent_by: 'ana' })
  })

  it('a failed send leaves the order in its stage, is logged with the error, and can be tried again', async () => {
    const { service, purchases, db } = setup({ send: jest.fn().mockRejectedValueOnce(new Error('550 mailbox unavailable')).mockResolvedValueOnce({ messageId: '<ok>' }) })
    const order = await requisition(purchases)

    await expect(service.send(order.id, { to: 'x@y.com', actor: 'ana' })).rejects.toThrow(/could not be sent: 550 mailbox unavailable/)
    expect((await purchases.findById(order.id)).status).toBe('requisition')
    expect(db.emails[0]).toMatchObject({ result: 'failed', error: '550 mailbox unavailable' })

    // a failure does not count as sent, so no resend flag is needed to try again
    await expect(service.send(order.id, { to: 'x@y.com', actor: 'ana' })).resolves.toMatchObject({ order: { status: 'awaiting_invoice' } })
  })

  it('does not send again by accident: a second send is refused unless asked explicitly, and a resend keeps the stage', async () => {
    const { service, purchases, send } = setup()
    const order = await requisition(purchases)
    await service.send(order.id, { to: 'a@b.com' })

    await expect(service.send(order.id, { to: 'a@b.com' })).rejects.toThrow(/already sent/)
    expect(send).toHaveBeenCalledTimes(1)
    const again = await service.send(order.id, { to: 'a@b.com', resend: true })
    expect(send).toHaveBeenCalledTimes(2)
    expect(again.order.status).toBe('awaiting_invoice')
    expect((await service.preview(order.id)).already_sent).toBe(true)
  })

  it('says so when e-mail is not configured, and sends nothing', async () => {
    const { service, purchases, send } = setup({ from: () => null })
    const order = await requisition(purchases)

    expect((await service.preview(order.id)).configured).toBe(false)
    await expect(service.send(order.id, { to: 'a@b.com' })).rejects.toThrow(/not configured/)
    expect(send).not.toHaveBeenCalled()
  })

  it('accepts only a small PDF as the attachment, and never sends a received order', async () => {
    const { service, purchases, send } = setup()
    const order = await requisition(purchases)

    await expect(service.send(order.id, { to: 'a@b.com', attachment_base64: Buffer.from('not a pdf').toString('base64') })).rejects.toThrow(/must be a PDF/)
    await expect(service.send(order.id, { to: 'a@b.com', attachment_base64: Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(800 * 1024)]).toString('base64') })).rejects.toThrow(/larger than/)
    expect(send).not.toHaveBeenCalled()

    const done = await purchases.create({ supplier_id: 5, ordered_on: '2026-10-05', stage: 'received', without_invoice: true, items: [item({ condition: 'paid' })] })
    await expect(service.send(done.id, { to: 'a@b.com' })).rejects.toThrow(/received order/)
  })

  it('can keep the address in the supplier registry, and only when it differs', async () => {
    const { service, purchases, db } = setup()
    const order = await requisition(purchases)
    await service.send(order.id, { to: 'novo@quinoa.com.br', save_to_supplier: true })

    expect(db.suppliers[0].email).toBe('novo@quinoa.com.br')
  })

  it('a later-stage order that was never e-mailed can still be sent, without moving its stage', async () => {
    const { service, purchases } = setup()
    const invoiced = await purchases.create({ supplier_id: 5, ordered_on: '2026-10-05', stage: 'invoiced', invoice_number: 'N1', items: [item({ condition: 'paid' })] })
    const sent = await service.send(invoiced.id, { to: 'a@b.com' })

    expect(sent.order.status).toBe('invoiced')
  })
})
