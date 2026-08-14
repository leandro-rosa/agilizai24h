import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { ElasticsearchModule } from '@app/elasticsearch'
import { HoldItModule } from '@app/hold-it'
import { DbClientModule } from '../../db-client/db-client.module'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { QuoteRepository } from '../../db-client/repository/quote.repository'
import { QuoteItemRepository } from '../../db-client/repository/quote-item.repository'
import { QuoteSharedModule } from '../quote-shared.module'
import { QuoteItemsService } from './quote-items.service'

/**
 * Integration test against a real Postgres instance (no mocks) — exercises
 * the item review flow (approve/reject/select-alternate, batch decisions)
 * end-to-end against a `source: partner_api` quote, since before the
 * partner-API matching flow existed this path was only ever exercised
 * manually or by the spreadsheet flow's own tests. Confirms the review
 * flow behaves identically regardless of the quote's source, and that a
 * fully-reviewed quote reaches `status: reviewed` automatically (see
 * utils/quote-progress.util.ts).
 */
describe('QuoteItemsService (integration, real Postgres, partner_api quote)', () => {
  let prisma: PrismaClientService
  let quoteRepository: QuoteRepository
  let quoteItemRepository: QuoteItemRepository
  let service: QuoteItemsService
  const createdQuoteIds: number[] = []

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://quote:quote@localhost:5432/quote?schema=public'
    process.env.REDIS_QUEUE_HOST = process.env.REDIS_QUEUE_HOST ?? 'localhost'
    process.env.REDIS_QUEUE_PORT = process.env.REDIS_QUEUE_PORT ?? '6379'
    process.env.WITH_KAFKA_BROKERS = 'false'

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DbClientModule,
        HoldItModule.register([]),
        ElasticsearchModule,
        QuoteSharedModule,
      ],
      providers: [QuoteItemsService],
    }).compile()

    const app = await moduleRef.init()
    prisma = app.get(PrismaClientService)
    quoteRepository = app.get(QuoteRepository)
    quoteItemRepository = app.get(QuoteItemRepository)
    service = app.get(QuoteItemsService)
  }, 30000)

  afterAll(async () => {
    if (createdQuoteIds.length > 0) {
      await prisma.quoteActivityEvent.deleteMany({ where: { quote_id: { in: createdQuoteIds } } })
      await prisma.quoteItem.deleteMany({ where: { quote_id: { in: createdQuoteIds } } })
      await prisma.quote.deleteMany({ where: { id: { in: createdQuoteIds } } })
    }
    await prisma.$disconnect()
  }, 15000)

  async function seedPartnerQuoteWithItems(count: number) {
    const quote = await quoteRepository.create({
      name: 'Cotação de teste — revisão',
      source: 'partner_api' as any,
      status: 'awaiting_review',
      total_rows: count,
    } as any)
    createdQuoteIds.push((quote as { id: number }).id)

    const items = await Promise.all(
      Array.from({ length: count }, (_, index) =>
        quoteItemRepository.create({
          quote_id: (quote as { id: number }).id,
          row_number: index + 1,
          raw_input: [{ key: 'sku', value: `SKU-${index + 1}` }] as any,
          candidates: [{ productId: `p-${index + 1}`, matchScore: 60 }] as any,
          match_status: 'approximate',
          review_status: 'pending',
        } as any),
      ),
    )

    return { quoteId: (quote as { id: number }).id, items }
  }

  it('approves an item referencing an existing candidate on a partner-API quote', async () => {
    const { quoteId, items } = await seedPartnerQuoteWithItems(1)
    const itemId = (items[0] as { id: number }).id

    const updated = await service.decideItem(
      quoteId,
      itemId,
      { decision: 'approved', selected_candidate_id: 'p-1' } as any,
      'reviewer-1',
    )

    expect(updated).toMatchObject({ review_status: 'reviewed', review_decision: 'approved', selected_candidate_id: 'p-1' })
  }, 15000)

  it('rejects an item without requiring any candidate selection', async () => {
    const { quoteId, items } = await seedPartnerQuoteWithItems(1)
    const itemId = (items[0] as { id: number }).id

    const updated = await service.decideItem(quoteId, itemId, { decision: 'rejected' } as any, 'reviewer-1')

    expect(updated).toMatchObject({ review_status: 'reviewed', review_decision: 'rejected', selected_candidate_id: null })
  }, 15000)

  it('selects a manually-supplied candidate not already on the item', async () => {
    const { quoteId, items } = await seedPartnerQuoteWithItems(1)
    const itemId = (items[0] as { id: number }).id
    const manualCandidate = {
      productId: 'manual-1',
      name: 'Peça encontrada manualmente',
      brand: 'Marca X',
      category: 'Categoria',
      sku: 'MANUAL-1',
      ean: '',
      mainCode: '',
      oemCodes: [],
      tradeNumbers: [],
      stock: 1,
      matchScore: 0,
      matchReasons: [],
    }

    const updated = await service.decideItem(
      quoteId,
      itemId,
      { decision: 'changed', selected_candidate: manualCandidate } as any,
      null,
    )

    expect(updated).toMatchObject({ selected_candidate_id: 'manual-1' })
  }, 15000)

  it('transitions the quote to reviewed once a batch decision reviews every item', async () => {
    const { quoteId, items } = await seedPartnerQuoteWithItems(2)
    const itemIds = items.map(item => (item as { id: number }).id)

    const results = await service.decideItemsBatch(quoteId, itemIds, 'rejected', undefined, 'reviewer-1')
    expect(results).toHaveLength(2)

    const quote = await quoteRepository.findUnique({ where: { id: quoteId } } as any)
    expect(quote).toMatchObject({ status: 'reviewed', reviewed_rows: 2 })
  }, 15000)
})
