import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { NullPurchaseSource } from '../src/modules/analysis/purchase-source'
import { PricingParametersInvalidError, DEFAULT_ACCOUNT_BEHAVIOR } from '../src/modules/pricing/pricing.parameters'
import { PricingParametersService } from '../src/modules/pricing/pricing-parameters.service'
import { PricingRunsService } from '../src/modules/pricing/pricing-runs.service'
import { PricingService, type PricingReport } from '../src/modules/pricing/pricing.service'
import { resetDisposableDb } from './support/reset-db'

/**
 * The rules (with the class of each account) persisted and read back from a real, disposable Postgres, and a report that
 * uses them: an unclassified expense makes the calculation incomplete, classifying it persists as a NEW rules version and
 * the next calculation is validated. Sources are stubs (they belong to other services); the database is real.
 */
describe('pricing classification (real Postgres)', () => {
  let app: TestingModule
  let prisma: PrismaClientService
  let parameters: PricingParametersService
  const MONTHS = ['2026-07', '2026-08', '2026-09']

  const acct = (code: string, label: string, amount_cents: number) => ({ code, label, section: '', amount_cents, children: [] })
  const pnl = (period: string) => ({
    period,
    store_id: null,
    sections: [
      { section: 'gross_revenue', amount_cents: 1_000_000, accounts: [acct('3.1.01', 'Vendas lojas', 1_000_000)] },
      { section: 'variable_expenses', amount_cents: 0, accounts: [acct('4.2.01', 'Repasse de vendas', 20_000), acct('4.2.03', 'Deslocamento', 10_000), acct('4.2.07', 'Marketing', 30_000)] },
      { section: 'fixed_expenses', amount_cents: 0, accounts: [acct('4.3.01', 'Mensalidade touchpay', 40_000)] },
    ],
  })

  function service(): PricingService {
    const sales = {
      period: async () => [{ sku: 'T-1', quantity_sold: 100, revenue_cents: 59_000 }],
      paymentMix: async () => ({ from: MONTHS[0], to: MONTHS[2], store_id: null, rows: [{ method: 'Pix', acquirer: 'PagBank', card_brand: null, receipt_lines: 100, units: 100, tickets: 100, lines_without_coupon: 100, amount_paid_cents: 59_000 }], total_amount_paid_cents: 59_000, periods_without_transactions: [] }),
    }
    const supply = {
      period: async () => ({ store_id: 1, period: 'x', restocks: [{ sku: 'T-1', quantity_restocked: 100 }], removals: [], adjustments: [] }),
      visitCounts: async () => ({ from: MONTHS[0], to: MONTHS[2], unit: 'x', rows: MONTHS.map(period => ({ store_id: 1, period, restocking_visits: 4, count_only_visits: 0 })) }),
    }
    const products = {
      categories: async () => [{ key: 'beverage', name: 'Bebida', status: 'active' }],
      products: async () => [{ id: 1, sku: 'T-1', name: 'Produto de teste', category: 'beverage' }],
      costsAsOf: async (_skus: string[], asOf: string) => ({ as_of: asOf, resolved: [{ sku: 'T-1', product_id: 1, cost_cents: 300, effective_from: '2026-08-15', source: 'invoice', invoice_number: null }], unresolved: [], complete: true }),
      pricesAsOf: async (_skus: string[], asOf: string) => ({ resolved: [{ sku: 'T-1', product_id: 1, price_cents: 590, effective_from: '2026-01-01' }], unresolved: [], complete: true, asOf }),
    }
    const treasury = { feesInForce: async (on: string) => ({ on, rates: [{ acquirer: 'PagBank', payment_method: 'pix', rate_bps: 69, effective_from: '2026-01-01' }], methods_without_rate: [] }) }

    return new PricingService(
      supply as never,
      sales as never,
      products as never,
      { stores: async () => [{ id: 1, name: 'Loja 1' }] } as never,
      treasury as never,
      { pnl: async (period: string) => pnl(period) } as never,
      { suppliers: async () => [] } as never,
      new NullPurchaseSource(),
      parameters,
    )
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule] }).compile()
    app = await moduleRef.init()
    prisma = app.get(PrismaClientService)
    await resetDisposableDb(prisma) // refuses a database that looks real
    await prisma.$executeRawUnsafe('TRUNCATE TABLE pricing_run, pricing_decision, pricing_parameter_version RESTART IDENTITY CASCADE')
    parameters = new PricingParametersService(prisma)
    await parameters.ensureInitial()
    await parameters.createVersion({ taxRateBps: 707 }, 'tax confirmed')
  }, 60000)

  afterAll(async () => {
    await app?.close()
  }, 30000)

  it('the first calculation is incomplete: Marketing has no class, and nothing is validated', async () => {
    const report = await service().report({ period: '2026-09' })

    expect(report.meta.validated).toBe(false)
    expect(report.meta.operating?.unclassified).toEqual([{ code: '4.2.07', label: 'Marketing', amountCents: 90_000 }])
    expect(report.meta.notes.join(' ')).toContain('Cálculo incompleto')
    expect(report.products[0].validated).toBe(false)
    expect(report.products[0].validationNotes.join(' ')).toMatch(/R\$ 900,00.*rede.*4\.2\.07 Marketing/)
  })

  it('classifying the account saves a NEW rules version; the previous one stays readable exactly as it was', async () => {
    const before = await parameters.current()
    const created = await parameters.createVersion({ operating: { accountBehavior: { ...DEFAULT_ACCOUNT_BEHAVIOR, '4.2.07': 'fixed' } } }, 'Marketing é custo fixo')

    expect(created.id).toBeGreaterThan(before.id)
    expect((await parameters.byId(before.id)).values.operating.accountBehavior['4.2.07']).toBeUndefined()
    expect((await parameters.byId(created.id)).values.operating.accountBehavior['4.2.07']).toBe('fixed')
    expect((await parameters.list()).map(row => row.id)).toEqual([created.id, before.id, ...(await parameters.list()).slice(2).map(row => row.id)])
  })

  it('the class survives a restart: a new service instance reads it back from the database', async () => {
    const reread = await new PricingParametersService(prisma).current()

    expect(reread.values.operating.accountBehavior['4.2.07']).toBe('fixed')
    expect(reread.values.operating.accountBehavior['4.2.01']).toBe('percent_of_sales')
    expect(reread.values.taxRateBps).toBe(707)
  })

  it('the next calculation uses it: validated, Marketing outside the price, and the report names the rules version it used', async () => {
    const report = await service().report({ period: '2026-09' })
    const current = await parameters.current()

    expect(report.meta.validated).toBe(true)
    expect(report.meta.parameterVersion).toBe(current.id)
    expect(report.meta.operating?.unclassified).toEqual([])
    expect(report.meta.operating?.classes.fixed.accounts.map(account => account.code)).toEqual(expect.arrayContaining(['4.2.07', '4.3.01']))
    expect(report.products[0].structure?.operatingShare).toBeCloseTo(0.02, 10) // repasse only
  })

  it('a locked account cannot be mapped elsewhere and nothing is saved', async () => {
    const count = (await parameters.list()).length

    await expect(parameters.createVersion({ operating: { accountBehavior: { ...DEFAULT_ACCOUNT_BEHAVIOR, '4.2.02': 'percent_of_sales' } } })).rejects.toBeInstanceOf(PricingParametersInvalidError)
    expect((await parameters.list()).length).toBe(count)
  })

  it('a version stored before the classification existed is read with the proposal filling the gap, and the row is untouched', async () => {
    const legacyValues = { ...(await parameters.current()).values } as Record<string, unknown>
    delete legacyValues.operating
    const row = await prisma.pricingParameterVersion.create({ data: { note: 'pricing-3 era', values: legacyValues as never } })

    const read = await parameters.byId(row.id)
    expect(read.values.operating.accountBehavior['4.2.01']).toBe('percent_of_sales')
    expect((await prisma.pricingParameterVersion.findUnique({ where: { id: row.id } }))?.values).not.toHaveProperty('operating')
  })

  it('recalculating stores a new run and leaves the earlier one exactly as it was', async () => {
    const runs = new PricingRunsService(prisma, parameters, { holdIt: async () => undefined } as never)
    const oldReport = { meta: { parameterVersion: 1, engineVersion: 'pricing-3' }, summary: {}, categories: [], products: [{ sku: 'T-1', currentMargin: 0.16 }] } as unknown as PricingReport
    const first = (await runs.start({ period: '2026-08' })).run.id
    await runs.complete(first, oldReport)
    const stored = JSON.stringify(await prisma.pricingRun.findUnique({ where: { id: first } }))

    await new Promise(resolve => setTimeout(resolve, 10))
    const second = (await runs.start({ period: '2026-08' })).run.id
    await runs.complete(second, await service().report({ period: '2026-08' }))

    expect(JSON.stringify(await prisma.pricingRun.findUnique({ where: { id: first } }))).toBe(stored)
    const history = await runs.history({ period: '2026-08' })
    expect(history.map(run => [run.id, run.engineVersion])).toEqual([[second, 'pricing-4'], [first, 'pricing-3']])
    expect((await runs.getWithReport(first))?.report?.products).toEqual([{ sku: 'T-1', currentMargin: 0.16 }])
    expect((await runs.latest({ period: '2026-08' })).run?.id).toBe(second)
  })
})
