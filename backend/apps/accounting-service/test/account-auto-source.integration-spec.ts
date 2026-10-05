import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'

/** Pins the 15 real accounts this migration maps, and that nothing else got mapped by accident. */
describe('account auto_source seed', () => {
  let app: TestingModule
  let prisma: PrismaClientService

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    }).compile()
    app = await moduleRef.init()
    prisma = app.get(PrismaClientService)
  }, 60000)

  afterAll(async () => {
    await app?.close()
  })

  it('maps exactly the 12 treasury_category accounts the spec names', async () => {
    const rows = await prisma.account.findMany({
      where: { auto_source: 'treasury_category' },
      select: { code: true, treasury_category: true },
      orderBy: { code: 'asc' },
    })

    expect(rows.map(r => r.code)).toEqual([
      '3.1.03', '3.2.01', '4.1.02', '4.1.03', '4.2.04', '4.2.05',
      '4.2.08', '4.3.01', '4.3.02', '4.3.03', '4.3.04', '4.4.01',
    ])
    expect(rows.find(r => r.code === '4.3.04')?.treasury_category).toBe('Luz')
  })

  it('maps the 3 per-store accounts to their own source, and never 4.2.01/4.2.03', async () => {
    const rows = await prisma.account.findMany({
      where: { code: { in: ['3.1.01', '4.1.01', '4.2.02', '4.2.01', '4.2.03'] } },
      select: { code: true, auto_source: true },
    })
    const byCode = new Map(rows.map(r => [r.code, r.auto_source]))

    expect(byCode.get('3.1.01')).toBe('sales_revenue')
    expect(byCode.get('4.1.01')).toBe('finance_cogs')
    expect(byCode.get('4.2.02')).toBe('finance_loss')
    expect(byCode.get('4.2.01')).toBeNull()
    expect(byCode.get('4.2.03')).toBeNull()
  })
})
