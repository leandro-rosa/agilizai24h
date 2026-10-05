import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { AccountingService } from '../src/modules/accounting/services/accounting.service'
import { UpstreamClient } from '../src/modules/accounting/services/upstream.client'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'

describe('closeMonth', () => {
  let app: TestingModule
  let accounting: AccountingService
  let prisma: PrismaClientService
  const period = '2099-05'

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
    await prisma.pnlSnapshot.deleteMany({ where: { period } })
    await prisma.ledgerEntry.deleteMany({ where: { period } })
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await app?.close()
  })

  it('closing the network closes every active store too, and reports who synced', async () => {
    upstream.activeStores.mockResolvedValue([{ id: 601, name: 'Loja A' }, { id: 602, name: 'Loja B' }])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map())
    upstream.salesRevenueCents.mockResolvedValue(100000)
    upstream.financeFor.mockResolvedValue(null)

    const result = await accounting.closeMonth(period, undefined, 2, true)

    expect(result.synced).toEqual({ stores_ok: [601, 602], stores_failed: [], close_failed: [] })
    expect(result.status).toBe('closed')
    expect(result.store_id).toBeNull()

    const storeSnapshotA = await prisma.pnlSnapshot.findFirst({ where: { period, store_id: 601 } })
    const storeSnapshotB = await prisma.pnlSnapshot.findFirst({ where: { period, store_id: 602 } })
    expect(storeSnapshotA?.status).toBe('closed')
    expect(storeSnapshotB?.status).toBe('closed')
  })

  it('closing ONE store from its own view only touches that store, never the network or siblings', async () => {
    upstream.activeStores.mockResolvedValue([{ id: 603, name: 'Loja C' }])
    upstream.salesRevenueCents.mockResolvedValue(50000)
    upstream.financeFor.mockResolvedValue(null)
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map())

    const result = await accounting.closeMonth(period, 603, 1, true)

    expect(result.store_id).toBe(603)
    expect(upstream.activeStores).not.toHaveBeenCalled()
    const network = await prisma.pnlSnapshot.findFirst({ where: { period, store_id: null } })
    expect(network).toBeNull()
  })

  it('excludes a failed-sync store from the per-store close loop', async () => {
    upstream.activeStores.mockResolvedValue([{ id: 604, name: 'Loja D' }, { id: 605, name: 'Loja E' }])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map())
    upstream.financeFor.mockResolvedValue(null)
    upstream.salesRevenueCents.mockImplementation((storeId: number) => {
      if (storeId === 605) throw new Error('ECONNREFUSED')
      return Promise.resolve(100000)
    })

    const result = await accounting.closeMonth(period, undefined, 2, true)

    expect(result.synced.stores_ok).toEqual([604])
    expect(result.synced.stores_failed).toEqual([605])
    expect(result.synced.close_failed).toEqual([])

    const snapshotD = await prisma.pnlSnapshot.findFirst({ where: { period, store_id: 604 } })
    const snapshotE = await prisma.pnlSnapshot.findFirst({ where: { period, store_id: 605 } })
    expect(snapshotD?.status).toBe('closed')
    expect(snapshotE).toBeNull()
  })

  it('aborts the whole close when syncFromUpstreams itself throws, writing nothing', async () => {
    upstream.activeStores.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(accounting.closeMonth(period, undefined, 1, true)).rejects.toThrow('ECONNREFUSED')

    const network = await prisma.pnlSnapshot.findFirst({ where: { period, store_id: null } })
    expect(network).toBeNull()
  })

  it('contains a mid-loop computeSnapshot failure: other stores still close, failed one is reported', async () => {
    upstream.activeStores.mockResolvedValue([{ id: 606, name: 'Loja F' }, { id: 607, name: 'Loja G' }])
    upstream.treasuryCategoryTotals.mockResolvedValue(new Map())
    upstream.financeFor.mockResolvedValue(null)
    upstream.salesRevenueCents.mockResolvedValue(100000)

    const real = accounting.computeSnapshot.bind(accounting)
    jest.spyOn(accounting, 'computeSnapshot').mockImplementation((p, storeId, count, c) => {
      if (storeId === 607) return Promise.reject(new Error('conexão perdida'))
      return real(p, storeId, count, c)
    })

    const result = await accounting.closeMonth(period, undefined, 2, true)

    expect(result.synced.stores_ok).toEqual([606, 607])
    expect(result.synced.close_failed).toEqual([607])
    expect(result.status).toBe('closed') // network snapshot still closes

    const snapshotF = await prisma.pnlSnapshot.findFirst({ where: { period, store_id: 606 } })
    expect(snapshotF?.status).toBe('closed')
    const snapshotG = await prisma.pnlSnapshot.findFirst({ where: { period, store_id: 607 } })
    expect(snapshotG).toBeNull()

    jest.restoreAllMocks()
  })
})
