import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { DbClientModule } from '../db-client.module'
import { PrismaClientService } from '../prisma-client.service'
import { QuoteRepository } from './quote.repository'

/**
 * Integration test against a real Postgres instance (no mocks). Requires
 * DATABASE_URL to point at a reachable database with the Quote/QuoteItem
 * migration applied (see backend/apps/quote/src/modules/db-client/prisma/migrations).
 */
describe('QuoteRepository (integration, real Postgres)', () => {
  let prisma: PrismaClientService
  let repository: QuoteRepository
  const createdQuoteIds: number[] = []

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ?? 'postgresql://quote:quote@localhost:5432/quote?schema=public'

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule],
    }).compile()

    const app = await moduleRef.init()
    prisma = app.get(PrismaClientService)
    repository = app.get(QuoteRepository)
  }, 30000)

  afterAll(async () => {
    if (createdQuoteIds.length > 0) {
      await prisma.quoteItem.deleteMany({ where: { quote_id: { in: createdQuoteIds } } })
      await prisma.quote.deleteMany({ where: { id: { in: createdQuoteIds } } })
    }
    await prisma.$disconnect()
  }, 15000)

  it('creates a Quote with nested QuoteItem rows and reads them back', async () => {
    const created = await repository.create({
      name: 'Cotação de teste — integração',
      status: 'draft',
      items: {
        create: [{ raw_input: { sku: 'ABC-123', description: 'Filtro de óleo' } }, { raw_input: { sku: 'DEF-456' } }],
      },
    } as any)

    createdQuoteIds.push((created as { id: number }).id)

    const found = (await repository.findUnique({
      where: { id: (created as { id: number }).id },
      include: { items: true },
    } as any)) as any

    expect(found).not.toBeNull()
    expect(found.status).toBe('draft')
    expect(found.items).toHaveLength(2)
    expect(found.items.map((item: { raw_input: unknown }) => item.raw_input)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sku: 'ABC-123' }),
        expect.objectContaining({ sku: 'DEF-456' }),
      ]),
    )
  }, 15000)
})
