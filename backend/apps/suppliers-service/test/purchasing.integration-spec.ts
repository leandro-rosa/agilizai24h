import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { PayablesService } from '../src/modules/purchasing/services/payables.service'
import { PurchaseImportService } from '../src/modules/purchasing/services/purchase-import.service'
import { AccountingClient } from '../src/modules/purchasing/clients/accounting.client'
import { CostSyncService } from '../src/modules/purchasing/services/cost-sync.service'
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

  /** products-service: answers like the real one (`unchanged` when the cost already in force is the same). */
  let costInForce: number | null = 570
  const recordInvoiceCost = jest.fn(async (_sku: string, input: { cost_cents: number; purchase_item_id: number }) => {
    const previous = costInForce
    if (previous === input.cost_cents) return { created: false, unchanged: true, version_id: null, cost_cents: input.cost_cents, previous_cost_cents: previous }
    costInForce = input.cost_cents

    return { created: true, unchanged: false, version_id: 500 + input.purchase_item_id, cost_cents: input.cost_cents, previous_cost_cents: previous }
  })
  const fakeMail = { from: () => 'pedidos@agiliz.local', send: jest.fn(async () => ({ messageId: '<sint@mail>' })) }
  let emails: OrderEmailService
  let importer: PurchaseImportService
  let payables: PayablesService
  const sold = { from: '2026-10-05', to: '2026-10-11', rows: [{ sku: 'SINT-1', quantity: 62, revenue_cents: 1 }], months_without_dated_receipts: [] as string[], stores_missing: 0 }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule] })
      .overrideProvider(ProductsClient)
      .useValue({ products: async () => [{ id: 1, sku: 'SINT-1', name: '[SINTÉTICO] produto' }], resolveEans: async () => ({ resolved: [], unresolved: [] }), recordInvoiceCost })
      .overrideProvider(AccountingClient)
      .useValue({ monthStatus: async (period: string) => (period === '2026-09' ? 'closed' : 'open') })
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

    // By day: only the payments made that day, with the value paid that day.
    const dayOnly = await payables.overview(undefined, '2026-11-09', '2026-11-09')
    expect(dayOnly.period).toEqual({ from: '2026-11-09', to: '2026-11-09' })
    expect(own(dayOnly.orders, boleto.id)).toMatchObject({ state: 'paid', paid_cents: 2000, paid_on: '2026-11-09' })
    expect(dayOnly.summary.paid_month_cents).toBe(2000)
    expect(own((await payables.overview(undefined, '2026-11-08', '2026-11-08')).orders, boleto.id)).toBeUndefined()
    await expect(payables.overview(undefined, '2026-11-09', '2026-11-01')).rejects.toThrow(/from not after to/)

    expect(await payables.undo({ purchase_ids: [boleto.id], actor: 'sint' })).toEqual({ reopened_items: 1 })
    expect(own((await payables.overview('2026-11')).orders, boleto.id)).toMatchObject({ state: 'overdue' })
    expect((await purchases.history(boleto.id)).map(e => e.note)).toEqual(expect.arrayContaining([expect.stringContaining('payment recorded'), expect.stringContaining('payment undone')]))
  })

  it('keeps the original of the packaging and the invoice issue date in real SQL, and lists a product\'s purchases newest first', async () => {
    const box = await purchases.create({
      supplier_id: supplierId,
      ordered_on: '2026-12-02',
      invoice_number: 'SINT-PACK-1',
      invoice_issued_on: '2026-12-01',
      items: [{ sku: 'SINT-1', quantity: 210, unit_cost_cents: 300, condition: 'paid', pack_quantity: 10, pack_unit_price_cents: 6300, units_per_pack: 21, purchase_unit: 'CX' }],
    })
    const row = await prisma.purchaseItem.findFirstOrThrow({ where: { purchase_id: box.id } })
    expect(row).toMatchObject({ pack_quantity: 10, pack_unit_price_cents: 6300, units_per_pack: 21, purchase_unit: 'CX' })
    expect((await prisma.purchase.findUniqueOrThrow({ where: { id: box.id } })).invoice_issued_on?.toISOString().slice(0, 10)).toBe('2026-12-01')

    await purchases.create({ supplier_id: supplierId, ordered_on: '2026-12-09', invoice_number: 'SINT-PACK-2', items: [{ sku: 'SINT-1', quantity: 5, unit_cost_cents: 310, condition: 'paid' }] })
    const byProduct = await purchases.list({ supplierId, sku: 'SINT-1' })
    expect(byProduct[0].ordered_on).toBe('2026-12-09')
    expect(byProduct.every(p => p.items.every(i => i.sku === 'SINT-1'))).toBe(true)
    expect(await purchases.list({ supplierId, sku: 'OUTRO' })).toEqual([])

    // The database itself refuses a half-recorded original.
    await expect(prisma.purchaseItem.create({ data: { purchase_id: box.id, sku: 'SINT-1', quantity: 1, unit_cost_cents: 1, condition: 'paid', pack_quantity: 3 } })).rejects.toThrow()
  })

  describe('invoice cost outbox (real SQL)', () => {
    const sync = () => app.get(CostSyncService)

    it('receiving marks the items in the same transaction, sends the cost dated on the receipt and stores what came back', async () => {
      costInForce = 570
      const order = await purchases.create({ supplier_id: supplierId, ordered_on: '2026-10-01', stage: 'awaiting_receipt', invoice_number: 'SINT-OUT-1', items: [{ sku: 'SINT-1', quantity: 150, unit_cost_cents: 620, condition: 'paid' }, { sku: 'SINT-1', quantity: 12, unit_cost_cents: 620, condition: 'bonus' }] })
      expect(order.items.map(i => i.cost_sync.state)).toEqual([null, null])

      const received = await purchases.transition(order.id, { to: 'received', received_on: '2026-10-10', actor: 'ana@agiliz.ai' })

      const [paid, bonus] = received.items
      expect(paid.cost_sync).toMatchObject({ state: 'synced', version_id: 500 + paid.id, previous_cost_cents: 570, variation_bps: 877, alerts: [] })
      expect(bonus.cost_sync.state).toBe('skipped_bonus')
      expect(recordInvoiceCost).toHaveBeenCalledWith('SINT-1', expect.objectContaining({ effective_from: '2026-10-10', cost_cents: 620, purchase_item_id: paid.id, source_ref: `purchase-item:${paid.id}:2026-10-10:620` }), undefined)
      expect(recordInvoiceCost.mock.calls.some(([, input]) => (input as { purchase_item_id: number }).purchase_item_id === bonus.id)).toBe(false)
    })

    it('the same cost afterwards is unchanged; a failure is kept with its error and a manual retry sends it', async () => {
      costInForce = 620
      const same = await purchases.create({ supplier_id: supplierId, ordered_on: '2026-10-12', invoice_number: 'SINT-OUT-2', items: [{ sku: 'SINT-1', quantity: 10, unit_cost_cents: 620, condition: 'paid' }] })
      expect(same.items[0].cost_sync.state).toBe('unchanged')

      recordInvoiceCost.mockRejectedValueOnce(new Error('POST /products/SINT-1/costs -> 503'))
      const failing = await purchases.create({ supplier_id: supplierId, ordered_on: '2026-10-13', invoice_number: 'SINT-OUT-3', items: [{ sku: 'SINT-1', quantity: 10, unit_cost_cents: 700, condition: 'paid' }] })
      expect(failing.items[0].cost_sync).toMatchObject({ state: 'failed', attempts: 1, error: expect.stringContaining('503') })

      await purchases.retryCostSync(failing.id)
      const healed = await purchases.findById(failing.id)
      expect(healed.items[0].cost_sync).toMatchObject({ state: 'synced', error: null, alerts: ['large_variation'] })
      await expect(purchases.retryCostSync(999999)).rejects.toThrow('not found')
    })

    it('a cost dated in a closed month is flagged, and the background loop drains what the receipt left pending', async () => {
      costInForce = 600
      const closed = await purchases.create({ supplier_id: supplierId, ordered_on: '2026-09-20', invoice_number: 'SINT-OUT-4', items: [{ sku: 'SINT-1', quantity: 10, unit_cost_cents: 610, condition: 'paid' }] })
      expect(closed.items[0].cost_sync.alerts).toEqual(['closed_month'])

      // Left pending by a crash between commit and send: the loop (not the request) picks it up.
      const row = closed.items[0]
      await prisma.purchaseItem.update({ where: { id: row.id }, data: { cost_sync: 'pending', cost_sync_attempts: 0 } })
      costInForce = 600
      expect((await sync().drain()).sent).toBeGreaterThanOrEqual(1)
      expect((await purchases.findById(closed.id)).items[0].cost_sync.state).toBe('synced')
    })

    it('the database refuses a state outside the vocabulary', async () => {
      const any = await prisma.purchaseItem.findFirstOrThrow({ where: { cost_sync: 'synced' } })
      await expect(prisma.purchaseItem.update({ where: { id: any.id }, data: { cost_sync: 'bogus' } })).rejects.toThrow()
    })
  })

  describe('pending invoice lines (real SQL)', () => {
    const line = (over: Record<string, unknown> = {}) => ({ description: 'Novo sabor de marmita', ean: '7891000100103', supplier_code: 'FORN-77', quantity: 20, unit_cost_cents: 850, condition: 'paid' as const, ...over })

    it('keeps a line without a product on the purchase, whole, creating no item and sending no cost', async () => {
      recordInvoiceCost.mockClear()
      const order = await purchases.create({ supplier_id: supplierId, ordered_on: '2026-10-15', invoice_number: 'SINT-PEND-1', received_on: '2026-10-15', items: [{ sku: 'SINT-1', quantity: 5, unit_cost_cents: 100, condition: 'paid' }], pending_lines: [line()] })

      expect(order.awaiting_product_registration).toBe(1)
      expect(order.pending_lines[0]).toMatchObject({ status: 'pending', description: 'Novo sabor de marmita', ean: '7891000100103', quantity: 20, unit_cost_cents: 850, total_cents: 17000, sku: null })
      expect(order.items).toHaveLength(1)
      expect(recordInvoiceCost.mock.calls.map(([, input]) => (input as { cost_cents: number }).cost_cents)).not.toContain(850)
    })

    it('a purchase of only pending lines is accepted; an empty one is not', async () => {
      const only = await purchases.create({ supplier_id: supplierId, ordered_on: '2026-10-16', invoice_number: 'SINT-PEND-2', stage: 'awaiting_receipt', items: [], pending_lines: [line()] })
      expect(only.items).toEqual([])
      expect(only.awaiting_product_registration).toBe(1)

      await expect(purchases.create({ supplier_id: supplierId, ordered_on: '2026-10-16', invoice_number: 'SINT-PEND-3', items: [] })).rejects.toThrow(/at least one line/)
    })

    it('resolving in a received purchase creates the item, sends its first cost on the receipt day and remembers the supplier code', async () => {
      costInForce = null
      recordInvoiceCost.mockClear()
      const order = await purchases.create({ supplier_id: supplierId, ordered_on: '2026-10-17', invoice_number: 'SINT-PEND-4', received_on: '2026-10-18', items: [{ sku: 'SINT-1', quantity: 1, unit_cost_cents: 100, condition: 'paid' }], pending_lines: [line()] })

      const resolved = await purchases.resolvePendingLine(order.id, order.pending_lines[0].id, { sku: 'SINT-1', actor: 'ana@agiliz.ai' })

      expect(resolved.awaiting_product_registration).toBe(0)
      expect(resolved.pending_lines[0]).toMatchObject({ status: 'resolved', sku: 'SINT-1', resolved_by: 'ana@agiliz.ai' })
      const created = resolved.items.find(i => i.id === resolved.pending_lines[0].item_id)
      expect(created).toMatchObject({ sku: 'SINT-1', quantity: 20, unit_cost_cents: 850, received_quantity: 20, cost_sync: { state: 'synced', previous_cost_cents: 100 } })
      expect(recordInvoiceCost).toHaveBeenCalledWith('SINT-1', expect.objectContaining({ effective_from: '2026-10-18', cost_cents: 850, purchase_quantity: 20, purchase_total_cents: 17000 }), undefined)
      expect(await prisma.supplierProductCode.findFirst({ where: { supplier_id: supplierId, code: 'FORN-77' } })).toMatchObject({ sku: 'SINT-1' })
    })

    it('resolving in a purchase not received yet creates no cost; the cost goes out at receipt', async () => {
      recordInvoiceCost.mockClear()
      const order = await purchases.create({ supplier_id: supplierId, ordered_on: '2026-10-19', invoice_number: 'SINT-PEND-5', stage: 'awaiting_receipt', items: [], pending_lines: [line({ supplier_code: undefined })] })
      const resolved = await purchases.resolvePendingLine(order.id, order.pending_lines[0].id, { sku: 'SINT-1' })

      expect(resolved.items[0].cost_sync.state).toBeNull()
      expect(recordInvoiceCost).not.toHaveBeenCalled()

      const received = await purchases.transition(order.id, { to: 'received', received_on: '2026-10-20', actor: 'ana@agiliz.ai' })
      expect(received.items[0].cost_sync.state).toMatch(/synced|unchanged/)
      expect(recordInvoiceCost).toHaveBeenCalledWith('SINT-1', expect.objectContaining({ effective_from: '2026-10-20', cost_cents: 850 }), undefined)
    })

    it('a line resolves once, to an existing product only, and the purchase stays intact otherwise', async () => {
      const order = await purchases.create({ supplier_id: supplierId, ordered_on: '2026-10-21', invoice_number: 'SINT-PEND-6', stage: 'awaiting_receipt', items: [], pending_lines: [line({ supplier_code: undefined })] })
      const lineId = order.pending_lines[0].id

      await expect(purchases.resolvePendingLine(order.id, lineId, { sku: 'NAO-EXISTE' })).rejects.toThrow(/Unknown product/)
      expect((await purchases.findById(order.id)).awaiting_product_registration).toBe(1)

      await purchases.resolvePendingLine(order.id, lineId, { sku: 'SINT-1' })
      await expect(purchases.resolvePendingLine(order.id, lineId, { sku: 'SINT-1' })).rejects.toThrow(/already resolved/)
      await expect(purchases.resolvePendingLine(order.id, 999999, { sku: 'SINT-1' })).rejects.toThrow(/does not belong/)
      expect((await purchases.findById(order.id)).items).toHaveLength(1)
    })

    it('the database refuses a resolved line without its product', async () => {
      const order = await purchases.create({ supplier_id: supplierId, ordered_on: '2026-10-22', invoice_number: 'SINT-PEND-7', stage: 'awaiting_receipt', items: [], pending_lines: [line()] })
      await expect(prisma.pendingLine.update({ where: { id: order.pending_lines[0].id }, data: { status: 'resolved' } })).rejects.toThrow()
    })
  })
})
