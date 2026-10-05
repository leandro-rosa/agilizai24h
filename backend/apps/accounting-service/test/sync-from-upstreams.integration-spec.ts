import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { AccountingService } from '../src/modules/accounting/services/accounting.service'
import { UpstreamClient } from '../src/modules/accounting/services/upstream.client'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'

describe('syncFromUpstreams', () => {
  let app: TestingModule
  let accounting: AccountingService
  let prisma: PrismaClientService
  const period = '2099-04'
  const luzAccountCode = '4.3.04' // real seeded account, auto_source: treasury_category, category "Luz"
  const vendasAccountCode = '3.1.01' // real seeded account, auto_source: sales_revenue, per_store

  const upstream = {
    activeStores: jest.fn(),
    salesRevenueCents: jest.fn(),
    financeFor: jest.fn(),
    treasuryCategoryTotals: jest.fn(),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    })
      .overrideProvider(UpstreamClient)
      .useValue(upstream)
      .compile()

    app = await moduleRef.init()
    accounting = app.get(AccountingService)
    prisma = app.get(PrismaClientService)
  }, 60000)

  afterEach(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { period } })
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await app?.close()
  })

  it('writes the network treasury_category accounts and the per-store accounts for every active store', async () => {
    upstream.activeStores.mockResolvedValue([{ id: 501, name: 'Loja Teste' }])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map([['Luz', 16800]]))
    upstream.salesRevenueCents.mockResolvedValue(500000)
    upstream.financeFor.mockResolvedValue({ cogs_cents: 200000, loss_value_cents: 5000 })

    const result = await accounting.syncFromUpstreams(period)

    expect(result).toEqual({ stores_ok: [501], stores_failed: [] })

    const luz = await prisma.account.findUnique({ where: { code: luzAccountCode } })
    const luzEntry = await prisma.ledgerEntry.findFirst({ where: { account_id: luz!.id, period, store_id: null } })
    expect(luzEntry).toMatchObject({ amount_cents: 16800, origin: 'treasury' })

    const vendas = await prisma.account.findUnique({ where: { code: vendasAccountCode } })
    const vendasEntry = await prisma.ledgerEntry.findFirst({ where: { account_id: vendas!.id, period, store_id: 501 } })
    expect(vendasEntry).toMatchObject({ amount_cents: 500000, origin: 'sales' })
  })

  it('never overwrites an account whose current entry is origin: manual', async () => {
    const luz = await prisma.account.findUnique({ where: { code: luzAccountCode } })
    await accounting.putEntry({ account_id: luz!.id, period, amount_cents: 999900, origin: 'manual' })

    upstream.activeStores.mockResolvedValue([])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map([['Luz', 16800]]))

    await accounting.syncFromUpstreams(period)

    const entry = await prisma.ledgerEntry.findFirst({ where: { account_id: luz!.id, period, store_id: null } })
    expect(entry?.amount_cents).toBe(999900)
    expect(entry?.origin).toBe('manual')
  })

  it('leaves a store with no sales/finance data untouched and does not count it as failed', async () => {
    upstream.activeStores.mockResolvedValue([{ id: 502, name: 'Loja Sem Dado' }])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map())
    upstream.salesRevenueCents.mockResolvedValue(0) // UpstreamClient's own 404 fallback
    upstream.financeFor.mockResolvedValue(null) // UpstreamClient's own 404 fallback

    const result = await accounting.syncFromUpstreams(period)

    expect(result).toEqual({ stores_ok: [502], stores_failed: [] })
    const vendas = await prisma.account.findUnique({ where: { code: vendasAccountCode } })
    const entry = await prisma.ledgerEntry.findFirst({ where: { account_id: vendas!.id, period, store_id: 502 } })
    expect(entry).toBeNull()
  })

  it('names a store whose upstream call threw, and still syncs the other stores', async () => {
    upstream.activeStores.mockResolvedValue([{ id: 503, name: 'Loja Erro' }, { id: 504, name: 'Loja Ok' }])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map())
    upstream.salesRevenueCents.mockImplementation((storeId: number) => {
      if (storeId === 503) throw new Error('ECONNREFUSED')
      return Promise.resolve(777700)
    })
    upstream.financeFor.mockResolvedValue(null)

    const result = await accounting.syncFromUpstreams(period)

    expect(result.stores_failed).toEqual([503])
    expect(result.stores_ok).toEqual([504])
    const vendas = await prisma.account.findUnique({ where: { code: vendasAccountCode } })
    const okEntry = await prisma.ledgerEntry.findFirst({ where: { account_id: vendas!.id, period, store_id: 504 } })
    expect(okEntry?.amount_cents).toBe(777700)
  })

  it('writes a real zero when the category nets to exactly zero this period — distinct from "category absent" (undefined)', async () => {
    upstream.activeStores.mockResolvedValue([])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map([['Luz', 0]])) // present, reversed to net zero — not "no transaction at all"

    await accounting.syncFromUpstreams(period)

    const luz = await prisma.account.findUnique({ where: { code: luzAccountCode } })
    const entry = await prisma.ledgerEntry.findFirst({ where: { account_id: luz!.id, period, store_id: null } })
    expect(entry).toMatchObject({ amount_cents: 0, origin: 'treasury' })
  })

  it('re-running the sync overwrites a PREVIOUS non-manual value with the newer total', async () => {
    upstream.activeStores.mockResolvedValue([])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map([['Luz', 10000]]))
    await accounting.syncFromUpstreams(period)

    upstream.treasuryCategoryTotals.mockResolvedValue(new Map([['Luz', 24000]]))
    await accounting.syncFromUpstreams(period)

    const luz = await prisma.account.findUnique({ where: { code: luzAccountCode } })
    const entry = await prisma.ledgerEntry.findFirst({ where: { account_id: luz!.id, period, store_id: null } })
    expect(entry).toMatchObject({ amount_cents: 24000, origin: 'treasury' })
  })

  it('never writes 4.2.01 (Repasse de vendas) or 4.2.03 (Deslocamento)', async () => {
    upstream.activeStores.mockResolvedValue([{ id: 505, name: 'Loja' }])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map([['Pedágio', 1000], ['Combustível', 2000]]))
    upstream.salesRevenueCents.mockResolvedValue(0)
    upstream.financeFor.mockResolvedValue(null)

    await accounting.syncFromUpstreams(period)

    const repasse = await prisma.account.findUnique({ where: { code: '4.2.01' } })
    const deslocamento = await prisma.account.findUnique({ where: { code: '4.2.03' } })
    expect(await prisma.ledgerEntry.findFirst({ where: { account_id: repasse!.id, period } })).toBeNull()
    expect(await prisma.ledgerEntry.findFirst({ where: { account_id: deslocamento!.id, period } })).toBeNull()
  })
})
