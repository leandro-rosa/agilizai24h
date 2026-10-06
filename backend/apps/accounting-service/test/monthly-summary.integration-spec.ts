import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { AccountingService } from '../src/modules/accounting/services/accounting.service'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

describe('monthly summary versions', () => {
  let app: TestingModule
  let accounting: AccountingService
  let prisma: PrismaClientService
  // Período fictício: nunca colide com dado real e é apagado no fim.
  const period = '2099-07'

  const snapshotData = (computedAt: Date, status = 'closed') => ({
    period,
    store_id: null,
    status,
    store_count: 0,
    gross_revenue_cents: 0,
    deductions_cents: 0,
    net_revenue_cents: 0,
    cogs_cents: 0,
    gross_profit_cents: 0,
    variable_expenses_cents: 0,
    contribution_margin_cents: 0,
    fixed_expenses_cents: 0,
    ebitda_cents: 0,
    financial_expenses_cents: 0,
    operating_profit_cents: 0,
    break_even_cents: -1,
    safety_margin_bps: 0,
    computed_at: computedAt,
  })

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule] }).compile()
    app = await moduleRef.init()
    accounting = app.get(AccountingService)
    prisma = app.get(PrismaClientService)
  }, 60000)

  afterEach(async () => {
    await prisma.monthlySummary.deleteMany({ where: { period } })
    await prisma.pnlSnapshot.deleteMany({ where: { period } })
  })

  afterAll(async () => {
    await app.close()
  })

  it('refuses a month that is not closed on the network', async () => {
    await prisma.pnlSnapshot.create({ data: snapshotData(new Date('2099-08-03T08:00:00Z'), 'open') })
    await expect(accounting.registerMonthlySummary(period, { content_hash: HASH_A, params: {} })).rejects.toThrow(/não está fechado/)
  })

  it('first generation is v1, repeating it reuses v1, new content or a reclosed month makes the next version', async () => {
    const closedAt = new Date('2099-08-03T08:00:00Z')
    await prisma.pnlSnapshot.create({ data: snapshotData(closedAt) })

    const v1 = await accounting.registerMonthlySummary(period, { content_hash: HASH_A, params: { logic_version: 'x' } })
    expect(v1).toMatchObject({ version: 1, reused: false })

    const again = await accounting.registerMonthlySummary(period, { content_hash: HASH_A, params: { logic_version: 'x' } })
    expect(again).toMatchObject({ version: 1, reused: true })

    const changed = await accounting.registerMonthlySummary(period, { content_hash: HASH_B, params: {} })
    expect(changed).toMatchObject({ version: 2, reused: false })

    await prisma.pnlSnapshot.updateMany({ where: { period, store_id: null }, data: { computed_at: new Date('2099-08-09T10:00:00Z') } })
    const reclosed = await accounting.registerMonthlySummary(period, { content_hash: HASH_B, params: {} })
    expect(reclosed).toMatchObject({ version: 3, reused: false })

    const list = await accounting.listMonthlySummaries(period)
    expect(list.map((r) => r.version)).toEqual([3, 2, 1])
    expect(list[0].base_at.toISOString()).toBe('2099-08-09T10:00:00.000Z')
  })

  it('rejects a malformed period', () => {
    expect(() => accounting.listMonthlySummaries('2099-13')).toThrow(/YYYY-MM/)
  })
})
