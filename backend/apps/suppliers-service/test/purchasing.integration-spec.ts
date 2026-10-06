import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { ProductsClient } from '../src/modules/purchasing/clients/products.client'
import { SalesClient } from '../src/modules/purchasing/clients/sales.client'
import { PurchasesService } from '../src/modules/purchasing/services/purchases.service'
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

  const sold = { from: '2026-10-05', to: '2026-10-11', rows: [{ sku: 'SINT-1', quantity: 62, revenue_cents: 1 }], months_without_dated_receipts: [] as string[], stores_missing: 0 }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule] })
      .overrideProvider(ProductsClient)
      .useValue({ products: async () => [{ id: 1, sku: 'SINT-1', name: '[SINTÉTICO] produto' }] })
      .overrideProvider(SalesClient)
      .useValue({ soldBySku: async () => sold })
      .compile()
    app = await moduleRef.init()
    prisma = app.get(PrismaClientService)
    purchases = app.get(PurchasesService)
    settlements = app.get(SettlementService)
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
})
