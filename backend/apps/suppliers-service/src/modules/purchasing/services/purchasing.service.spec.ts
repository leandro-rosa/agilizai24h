import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { PurchasesService } from './purchases.service'
import { SettlementService } from './settlement.service'

/** A tiny in-memory stand-in for the Prisma tables these services touch. No database, no real data. */
function fakePrisma() {
  const db = {
    suppliers: [{ id: 5, name: 'Quinoa' }],
    purchases: [] as any[],
    items: [] as any[],
    settlements: [] as any[],
  }
  let purchaseId = 0
  let itemId = 0
  let settlementId = 0

  const withItems = (p: any) => ({ ...p, items: db.items.filter(i => i.purchase_id === p.id), supplier: db.suppliers.find(s => s.id === p.supplier_id) })
  const prisma = {
    supplier: { findUnique: async ({ where }: any) => db.suppliers.find(s => s.id === where.id) ?? null },
    purchase: {
      findFirst: async ({ where, orderBy }: any) => {
        let rows = db.purchases.filter(p => (!where?.supplier_id || p.supplier_id === where.supplier_id) && (!where?.invoice_number || p.invoice_number === where.invoice_number))
        if (orderBy) rows = [...rows].sort((a, b) => a.ordered_on - b.ordered_on)
        return rows[0] ?? null
      },
      create: async ({ data }: any) => {
        const { items, ...rest } = data
        const row = { id: ++purchaseId, ...rest, invoice_number: rest.invoice_number ?? null, invoice_key: rest.invoice_key ?? null, notes: rest.notes ?? null }
        db.purchases.push(row)
        for (const item of items.create) db.items.push({ id: ++itemId, purchase_id: row.id, payment_status: 'pending', paid_on: null, payment_note: null, description: null, ...item })
        return withItems(row)
      },
      findMany: async ({ where }: any) => {
        const rows = db.purchases.filter(p => (!where?.supplier_id || p.supplier_id === where.supplier_id) && (!where?.ordered_on?.lte || p.ordered_on <= where.ordered_on.lte) && (!where?.ordered_on?.lt || p.ordered_on < where.ordered_on.lt) && (!where?.ordered_on?.gte || p.ordered_on >= where.ordered_on.gte))
        return rows.map(p => ({ ...withItems(p), items: withItems(p).items.filter((i: any) => !where?.condition && true) }))
      },
      findUnique: async ({ where }: any) => (db.purchases.find(p => p.id === where.id) ? withItems(db.purchases.find(p => p.id === where.id)) : null),
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
