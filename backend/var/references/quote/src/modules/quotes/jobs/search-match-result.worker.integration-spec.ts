import { INestApplicationContext } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { getQueueToken } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { HoldItModule, HoldItBullMQBroker } from '@app/hold-it'
import { ElasticsearchModule } from '@app/elasticsearch'
import {
  SEARCH_MATCH_RESULT_QUEUE,
  createSearchMatchJobEnvelope,
  createSearchMatchJobEnvelopeV2,
} from '@app/quote-search-match'
import { DbClientModule } from '../../db-client/db-client.module'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { QuoteRepository } from '../../db-client/repository/quote.repository'
import { QuoteItemRepository } from '../../db-client/repository/quote-item.repository'
import { QuoteSharedModule } from '../quote-shared.module'
import { SearchMatchResultWorker } from './search-match-result.worker'

/**
 * Integration test against real Postgres and real Redis (no mocks) — see
 * backend/CLAUDE.md for how to start both locally for this test.
 */
describe('SearchMatchResultWorker (integration, real Postgres + Redis)', () => {
  let app: INestApplicationContext
  let prisma: PrismaClientService
  let quoteRepository: QuoteRepository
  let quoteItemRepository: QuoteItemRepository
  let resultQueue: Queue
  let broker: HoldItBullMQBroker
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
        ElasticsearchModule,
        QuoteSharedModule,
        HoldItModule.register([SEARCH_MATCH_RESULT_QUEUE]),
        HoldItModule.registerWorker({ processors: [SearchMatchResultWorker] }),
      ],
    }).compile()

    app = await moduleRef.init()
    prisma = app.get(PrismaClientService)
    quoteRepository = app.get(QuoteRepository)
    quoteItemRepository = app.get(QuoteItemRepository)
    resultQueue = app.get<Queue>(getQueueToken(SEARCH_MATCH_RESULT_QUEUE))
    broker = app.get(HoldItBullMQBroker)
  }, 30000)

  afterAll(async () => {
    if (createdQuoteIds.length > 0) {
      await prisma.quoteActivityEvent.deleteMany({ where: { quote_id: { in: createdQuoteIds } } })
      await prisma.quoteItem.deleteMany({ where: { quote_id: { in: createdQuoteIds } } })
      await prisma.quote.deleteMany({ where: { id: { in: createdQuoteIds } } })
    }
    await resultQueue.obliterate({ force: true })
    await app.close()
  }, 20000)

  async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 10000, intervalMs = 50): Promise<void> {
    const start = Date.now()
    while (!(await predicate())) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('waitFor: condition not met before timeout')
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs))
    }
  }

  async function seedPartnerQuoteWithItem(
    originalFields: Array<{ key: string; value: string }>,
    matchRevision = 0,
    matchingConfig?: object,
  ) {
    const quote = await quoteRepository.create({
      name: 'Cotação de teste — matching',
      source: 'partner_api' as any,
      status: 'awaiting_review',
      total_rows: 1,
      matching_config_revision: matchRevision,
      ...(matchingConfig ? { matching_config: matchingConfig } : {}),
    } as any)
    createdQuoteIds.push(quote.id)

    const item = await quoteItemRepository.create({
      quote_id: quote.id,
      row_number: 1,
      raw_input: originalFields as any,
      candidates: [],
      match_status: 'pending',
      review_status: 'pending',
      match_revision: matchRevision,
      normalized_data: Object.fromEntries(originalFields.map(field => [field.key, field.value])),
    } as any)

    return { quoteId: quote.id, itemId: item.id }
  }

  it('auto-approves a QuoteItem in Postgres when the best real candidate scores above 80', async () => {
    const { quoteId, itemId } = await seedPartnerQuoteWithItem([{ key: 'sku', value: 'OC90' }])

    const message = createSearchMatchJobEnvelope(quoteId, {
      itemId,
      candidates: [
        { productId: 'p-1', name: 'Filtro OC90', brand: 'Bosch', sku: 'OC90', ean: '', mainCode: '', category: '', stock: 1 },
      ],
    })
    await broker.holdIt({
      queueName: SEARCH_MATCH_RESULT_QUEUE,
      message,
      options: { jobId: `${quoteId}.search-match-result.${itemId}`, attempts: 1 },
    })

    await waitFor(async () => {
      const job = await resultQueue.getJob(`${quoteId}.search-match-result.${itemId}`)
      return (await job?.getState()) === 'completed'
    })

    // Simulates BullMQ redelivery after transaction commit with another job ID.
    await broker.holdIt({
      queueName: SEARCH_MATCH_RESULT_QUEUE,
      message,
      options: { jobId: `${quoteId}.search-match-result.${itemId}.redelivery`, attempts: 1 },
    })
    await waitFor(async () => {
      const job = await resultQueue.getJob(`${quoteId}.search-match-result.${itemId}.redelivery`)
      return (await job?.getState()) === 'completed'
    })

    const item = await quoteItemRepository.findUnique({ where: { id: itemId } } as any)
    expect(item).toMatchObject({
      review_status: 'reviewed',
      review_decision: 'approved',
      selected_candidate_id: 'p-1',
      reviewed_by: 'system:auto-match',
    })

    const quote = await quoteRepository.findUnique({ where: { id: quoteId } } as any)
    expect(quote).toMatchObject({
      status: 'reviewed',
      processed_rows: 1,
      matched_rows: 1,
      reviewed_rows: 1,
    })

    const activityCount = await prisma.quoteActivityEvent.count({
      where: { quote_id: quoteId, kind: 'item_auto_matched' },
    })
    expect(activityCount).toBe(1)
  }, 15000)

  it('leaves a QuoteItem pending in Postgres when no candidate scores above 80', async () => {
    const { quoteId, itemId } = await seedPartnerQuoteWithItem([{ key: 'name', value: 'Filtro de oleo' }])

    const message = createSearchMatchJobEnvelope(quoteId, {
      itemId,
      candidates: [
        {
          productId: 'p-2',
          name: 'Componente sem relação',
          brand: 'Outra Marca',
          sku: 'ZZ',
          ean: '',
          mainCode: '',
          category: '',
          stock: 1,
        },
      ],
    })
    await broker.holdIt({
      queueName: SEARCH_MATCH_RESULT_QUEUE,
      message,
      options: { jobId: `${quoteId}.search-match-result.${itemId}`, attempts: 1 },
    })

    await waitFor(async () => {
      const job = await resultQueue.getJob(`${quoteId}.search-match-result.${itemId}`)
      return (await job?.getState()) === 'completed'
    })

    const item = await quoteItemRepository.findUnique({ where: { id: itemId } } as any)
    expect(item).toMatchObject({ review_status: 'pending', selected_candidate_id: null })
  }, 15000)

  it('ignores stale v2 results and applies safe evidence only at the active revision', async () => {
    const matchRevision = 4
    const matchingConfig = {
      version: 1 as const,
      field_weights: { sku: 0, ean: 0, main_code: 0, oem: 10, trade_number: 0, name: 0, brand: 0 },
      synonyms: [],
      precision: 'balanced' as const,
      typo_tolerance: false,
      max_candidates: 5,
      minimum_score: 90,
      auto_approve: true,
      auto_approve_threshold: 80,
    }
    const { quoteId, itemId } = await seedPartnerQuoteWithItem(
      [{ key: 'oem', value: 'PROTECTED' }],
      matchRevision,
      matchingConfig,
    )
    const candidate = {
      productId: 'p-v2',
      name: 'Produto protegido por evidência',
      brand: '',
      sku: '',
      ean: '',
      mainCode: '',
      category: '',
      stock: 1,
      evidence: [{ targetField: 'oem' as const, kind: 'exact' as const, searchFieldIndex: 0 }],
    }

    for (const revision of [matchRevision - 1, matchRevision]) {
      const message = createSearchMatchJobEnvelopeV2(quoteId, {
        itemId,
        matchRevision: revision,
        searchFields: [{ targetField: 'oem', value: 'PROTECTED', priority: 2 }],
        matchingConfig,
        candidates: [candidate],
      })
      const jobId = `${quoteId}.search-match-result.${itemId}.${revision}`
      await broker.holdIt({ queueName: SEARCH_MATCH_RESULT_QUEUE, message, options: { jobId, attempts: 1 } })
      await waitFor(async () => {
        const queued = await resultQueue.getJob(jobId)
        return (await queued?.getState()) === 'completed'
      })

      const item = await quoteItemRepository.findUnique({ where: { id: itemId } } as any)
      if (revision < matchRevision) {
        expect(item).toMatchObject({ match_status: 'pending', selected_candidate_id: null })
      } else {
        expect(item).toMatchObject({
          match_revision: matchRevision,
          match_score: 100,
          review_status: 'reviewed',
          selected_candidate_id: 'p-v2',
        })
        expect(JSON.stringify(item?.candidates)).not.toContain('PROTECTED')
      }
    }
  }, 20000)
})
