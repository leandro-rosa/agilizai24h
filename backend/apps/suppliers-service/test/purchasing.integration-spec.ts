import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { PayablesService } from '../src/modules/purchasing/services/payables.service'
import { PurchaseImportService } from '../src/modules/purchasing/services/purchase-import.service'
import { ProductsClient } from '../src/modules/purchasing/clients/products.client'
import { SalesClient } from '../src/modules/purchasing/clients/sales.client'
import { PurchasesService } from '../src/modules/purchasing/services/purchases.service'
import { MailTransport } from '../src/modules/purchasing/mail/mail-transport'
import { OrderEmailService } from '../src/modules/purchasing/mail/order-email.service'
import { SettlementService } from '../src/modules/purchasing/services/settlement.service'

/**
 * Exercises the real SQL (nested create, unique invoice per supplier, upsert of a week, JSON evidence) with SYNTHETIC data.
 * It writes purchases, so it runs ONLY against a throwaway database: set PURCHASING_IT_THROWAWAY_DB=true and point DATABASE_URL at it.
 * Skipped otherwise — a purchase from a test must never reach the real database (the purchase history base would move).
 */
const throwaway = process.env.PURCHASING_IT_THROWAWAY_DB === 'true'

;(throwaway ? describe : describe.skip)('purchasing integration (throwaway database, synthetic data)', () => {
  let app: TestingModule
  let prisma: PrismaClientService
  let purchases: PurchasesService
  let settlements: SettlementService
  let supplierId: number

  const fakeMail = { from: () => 'pedidos@agiliz.local', send: jest.fn(async () => ({ messageId: '<sint@mail>' })) }
  let emails: OrderEmailService
  let importer: PurchaseImportService
  let payables: PayablesService
  const sold = { from: '2026-10-05', to: '2026-10-11', rows: [{ sku: 'SINT-1', quantity: 62, revenue_cents: 1 }], months_without_dated_receipts: [] as string[], stores_missing: 0 }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule] })
      .overrideProvider(ProductsClient)
      .useValue({ products: async () => [{ id: 1, sku: 'SINT-1', name: '[SINTÉTICO] produto' }] })
      .overrideProvider(SalesClient)
      .useValue({ soldBySku: async () => sold })
      .overrideProvider(MailTransport)
      .useValue(fakeMail)
      .compile()
    app = await moduleRef.init()
    prisma = app.get(PrismaClientService)
    purchases = app.get(PurchasesService)
    settlements = app.get(SettlementService)
    emails = app.get(OrderEmailService)
    importer = app.get(PurchaseImportService)
    payables = app.get(PayablesService)
    supplierId = (await prisma.supplier.create({ data: { name: '[SINTÉTICO] fornecedor', category: 'grocery' } })).id
  }, 60000)

  afterAll(async () => {
    await prisma?.settlement.deleteMany({ where: { supplier_id: supplierId } })
    await prisma?.purchase.deleteMany({ where: { supplier_id: supplierId } })
    await prisma?.supplier.deleteMany({ where: { id: supplierId } })
    await app?.close()
  })

  it('records purchases, keeps one invoice number per supplier, and lets purchases without a number coexist', async () => {
    const first = await purchases.create({ supplier_id: supplierId, ordered_on: '2026-10-05', invoice_number: 'SINT-NF-1', items: [{ sku: 'SINT-1', quantity: 100, unit_cost_cents: 500, condition: 'on_sale' }] })
    expect(first.items[0]).toMatchObject({ quantity: 100, unit_cost_cents: 500, condition: 'on_sale' })

    await expect(purchases.create({ supplier_id: supplierId, ordered_on: '2026-10-06', invoice_number: 'SINT-NF-1', items: [{ sku: 'SINT-1', quantity: 1, unit_cost_cents: 1, condition: 'paid' }] })).rejects.toThrow(/already recorded/)
    await purchases.create({ supplier_id: supplierId, ordered_on: '2026-10-07', items: [{ sku: 'SINT-1', quantity: 5, unit_cost_cents: 500, condition: 'bonus' }] })
    await purchases.create({ supplier_id: supplierId, ordered_on: '2026-10-08', items: [{ sku: 'SINT-1', quantity: 5, unit_cost_cents: 500, condition: 'paid' }] })

    const listed = await purchases.list({ supplierId })
    expect(listed).toHaveLength(3)
    expect(listed[0].ordered_on).toBe('2026-10-08')
  })

  it('summarises a month by condition and reports the base month', async () => {
    const october = await purchases.summary('2026-10')

    expect(october.rows.find(r => r.sku === 'SINT-1')).toMatchObject({ units_paid: 5, units_on_sale: 100, bonus_units: 5, cents_paid: 2500, cents_on_sale: 50000 })
    expect(october.invoices).toBe(1)
    expect((await purchases.summary('2026-09')).rows).toEqual([])
  })

  it('computes, confirms and pays a settlement with the real tables, and keeps the confirmed week final', async () => {
    const proposal = await settlements.propose({ supplier_id: supplierId, week_start: '2026-10-07' })
    expect(proposal).toMatchObject({ state: 'proposal', owed_cents: 31000, week_start: '2026-10-05' })

    // recomputing a proposal replaces it (same week), it does not add a second row
    const again = await settlements.propose({ supplier_id: supplierId, week_start: '2026-10-05' })
    expect(again.id).toBe(proposal.id)

    expect(await settlements.confirm(proposal.id)).toMatchObject({ state: 'confirmed' })
    await expect(settlements.propose({ supplier_id: supplierId, week_start: '2026-10-05' })).rejects.toThrow(/already confirmed/)
    expect(await settlements.markPaid(proposal.id, '2026-10-14')).toMatchObject({ state: 'paid', paid_on: '2026-10-14' })

    // the item the settlement counted can no longer change its condition
    const item = (await purchases.list({ supplierId })).flatMap(p => p.items).find(i => i.condition === 'on_sale')!
    await expect(purchases.updateItem(item.id, { condition: 'paid' })).rejects.toThrow(/already counted/)
  })

  it('walks an order through every stage with the real tables: history, received quantity, who, and only received counts', async () => {
    const order = await purchases.create({
      supplier_id: supplierId,
      ordered_on: '2026-11-03',
      stage: 'requisition',
      actor: 'sint@agiliz.ai',
      expected_delivery_on: '2026-11-10',
      payment_term: 'due_date',
      payment_due_on: '2026-11-20',
      items: [{ sku: 'SINT-1', quantity: 100, unit_cost_cents: 100, condition: 'paid' }],
    })
    expect((await purchases.summary('2026-11')).rows).toEqual([]) // a requisition is not bought

    await purchases.transition(order.id, { to: 'awaiting_invoice', actor: 'sint@agiliz.ai' })
    await purchases.transition(order.id, { to: 'invoiced', invoice_number: 'SINT-NF-ST', actor: 'sint@agiliz.ai' })
    await purchases.transition(order.id, { to: 'awaiting_receipt' })
    const received = await purchases.transition(order.id, { to: 'received', received_on: '2026-11-09', received: [{ item_id: order.items[0].id, quantity: 90 }], actor: 'recebedor@agiliz.ai' })

    expect(received).toMatchObject({ status: 'received', received_on: '2026-11-09', received_by: 'recebedor@agiliz.ai' })
    expect(received.items[0]).toMatchObject({ quantity: 100, received_quantity: 90, difference: 10, total_cents: 9000 })
    expect((await purchases.history(order.id)).map(e => `${e.from_status ?? '-'}>${e.to_status}`)).toEqual(['->requisition', 'requisition>awaiting_invoice', 'awaiting_invoice>invoiced', 'invoiced>awaiting_receipt', 'awaiting_receipt>received'])
    expect((await purchases.summary('2026-11')).rows[0]).toMatchObject({ sku: 'SINT-1', units_paid: 90, cents_paid: 9000 })
    await expect(purchases.transition(order.id, { to: 'requisition' })).rejects.toThrow(/final/)
  })

  it('lists pending payments by due day from the real rows', async () => {
    const pending = await purchases.pendingPayments()

    expect(pending.groups.some(g => g.due_on === '2026-10-14' || g.due_on === '2026-11-20')).toBe(true)
  })

  it('logs a send and a failed send, refuses a repeat, and moves the stage only on success', async () => {
    const order = await purchases.create({ supplier_id: supplierId, ordered_on: '2026-11-05', stage: 'requisition', actor: 'sint', items: [{ sku: 'SINT-1', quantity: 5, unit_cost_cents: 100, condition: 'paid' }] })
    fakeMail.send.mockRejectedValueOnce(new Error('421 try later'))

    await expect(emails.send(order.id, { to: 'sint@example.com', actor: 'sint' })).rejects.toThrow(/could not be sent/)
    expect((await purchases.findById(order.id)).status).toBe('requisition')

    const sent = await emails.send(order.id, { to: 'sint@example.com', actor: 'sint' })
    expect(sent.order.status).toBe('awaiting_invoice')
    await expect(emails.send(order.id, { to: 'sint@example.com' })).rejects.toThrow(/already sent/)
    expect((await emails.log(order.id)).map(e => e.result)).toEqual(['sent', 'failed'])
  })

  it('remembers the supplier code the operator picked, so the next invoice resolves the line alone (real SQL)', async () => {
    await prisma.supplier.update({ where: { id: supplierId }, data: { tax_id: '99.999.999/0001-99' } })
    const line = { line: 1, code: 'SINT-COD-7', ean: null, description: 'PRODUTO SINT 473ML', unit: 'CX', quantity: 2, quantityIsWhole: true, unitCostCents: 1000, totalCents: 2000 }
    const invoice = (number: string) => ({ key: null, number, issuedOn: '2026-10-05', issuer: { taxId: '99999999000199', name: 'EMITENTE SINT' }, items: [line] })

    expect((await importer.preview(invoice('SINT-NF-A'))).items[0]).toMatchObject({ sku: null, matched_by: null })
    await purchases.create({ supplier_id: supplierId, ordered_on: '2026-10-05', invoice_number: 'SINT-NF-A', items: [{ sku: 'SINT-1', supplier_code: 'SINT-COD-7', quantity: 2, unit_cost_cents: 1000, condition: 'paid' }] })

    expect((await importer.preview(invoice('SINT-NF-B'))).items[0]).toMatchObject({ sku: 'SINT-1', matched_by: 'supplier_code' })

    // A purchase that is refused leaves no link behind.
    await expect(purchases.create({ supplier_id: supplierId, ordered_on: '2026-10-05', invoice_number: 'SINT-NF-A', items: [{ sku: 'SINT-1', supplier_code: 'SINT-COD-8', quantity: 1, unit_cost_cents: 1, condition: 'paid' }] })).rejects.toThrow()
    expect(await prisma.supplierProductCode.count({ where: { supplier_id: supplierId, code: 'SINT-COD-8' } })).toBe(0)
  })

  it('edits an order in real SQL: items added, changed and removed together with the header, history kept', async () => {
    const order = await purchases.create({ supplier_id: supplierId, ordered_on: '2026-10-20', stage: 'requisition', actor: 'sint', items: [{ sku: 'SINT-1', quantity: 10, unit_cost_cents: 100, condition: 'paid' }, { sku: 'SINT-1', quantity: 3, unit_cost_cents: 100, condition: 'bonus' }] })

    const edited = await purchases.updateOrder(order.id, { actor: 'sint', ordered_on: '2026-10-21', notes: 'editado', items: [{ id: order.items[0].id, sku: 'SINT-1', quantity: 12, unit_cost_cents: 90, condition: 'paid' }, { sku: 'SINT-1', quantity: 1, unit_cost_cents: 50, condition: 'on_sale' }] })

    expect(edited).toMatchObject({ ordered_on: '2026-10-21', notes: 'editado' })
    expect(edited.items.map(i => [i.quantity, i.unit_cost_cents, i.condition])).toEqual([[12, 90, 'paid'], [1, 50, 'on_sale']])
    expect((await purchases.history(order.id)).at(-1)).toMatchObject({ actor: 'sint', note: expect.stringContaining('edited: ') })
  })

  it('payables in real SQL: overview, recording a payment (with the method), the month total and undoing it', async () => {
    jest.spyOn(payables, 'today').mockReturnValue('2026-11-10')
    const own = (rows: { purchase_id: number }[], id: number) => rows.find(r => r.purchase_id === id)
    const boleto = await purchases.create({ supplier_id: supplierId, ordered_on: '2026-11-01', stage: 'invoiced', invoice_number: 'SINT-PAY-1', payment_term: 'due_date', payment_due_on: '2026-11-05', payment_method: 'transfer', items: [{ sku: 'SINT-1', quantity: 10, unit_cost_cents: 200, condition: 'paid' }] })
    const delivery = await purchases.create({ supplier_id: supplierId, ordered_on: '2026-11-02', stage: 'awaiting_receipt', invoice_number: 'SINT-PAY-2', payment_term: 'on_receipt', expected_delivery_on: '2026-11-14', items: [{ sku: 'SINT-1', quantity: 5, unit_cost_cents: 100, condition: 'paid' }] })

    const before = await payables.overview('2026-11')
    expect(own(before.orders, boleto.id)).toMatchObject({ state: 'overdue', form: 'transfer', open_cents: 2000 })
    expect(own(before.orders, delivery.id)).toMatchObject({ state: 'on_delivery', form: 'on_delivery', due_on: '2026-11-14', estimated: true, open_cents: 500 })
    expect(before.summary.overdue_cents).toBeGreaterThanOrEqual(2000)

    expect(await payables.pay({ purchase_ids: [boleto.id], paid_on: '2026-11-09', actor: 'sint' })).toEqual({ paid_items: 1, paid_cents: 2000 })
    const after = await payables.overview('2026-11')
    expect(own(after.orders, boleto.id)).toMatchObject({ state: 'paid', paid_cents: 2000, paid_on: '2026-11-09' })
    expect(after.summary.paid_month_cents).toBe(before.summary.paid_month_cents + 2000)
    await expect(payables.pay({ purchase_ids: [boleto.id] })).rejects.toThrow(/Nothing open/)
    await expect(payables.pay({ purchase_ids: [boleto.id], paid_on: '2026-12-01' })).rejects.toThrow(/future/)

    expect(await payables.undo({ purchase_ids: [boleto.id], actor: 'sint' })).toEqual({ reopened_items: 1 })
    expect(own((await payables.overview('2026-11')).orders, boleto.id)).toMatchObject({ state: 'overdue' })
    expect((await purchases.history(boleto.id)).map(e => e.note)).toEqual(expect.arrayContaining([expect.stringContaining('payment recorded'), expect.stringContaining('payment undone')]))
  })
})
