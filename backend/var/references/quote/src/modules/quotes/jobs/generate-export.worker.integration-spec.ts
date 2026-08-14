import { INestApplicationContext } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { getQueueToken } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import * as XLSX from 'xlsx'
import { HoldItModule } from '@app/hold-it'
import { AwsModule, S3Service } from '@app/aws'
import { ElasticsearchModule } from '@app/elasticsearch'
import { AxiosHttpClient } from '@app/http-client'
import { DbClientModule } from '../../db-client/db-client.module'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { QuoteRepository } from '../../db-client/repository/quote.repository'
import { QuoteItemRepository } from '../../db-client/repository/quote-item.repository'
import { QuoteExportRepository } from '../../db-client/repository/quote-export.repository'
import { QuoteSharedModule } from '../quote-shared.module'
import { QUOTE_GENERATE_EXPORT_QUEUE } from './quote-job-envelope'
import { GenerateExportProducer } from './generate-export.producer'
import { GenerateExportWorker } from './generate-export.worker'

/**
 * Integration test against real Postgres, real Redis, and real (LocalStack)
 * S3 (no mocks for those three) — see backend/apps/quote/CLAUDE.md for how
 * to start them locally. `apps/quote`'s one outbound HTTP call
 * (SearchCatalogService -> apps/search) is doubled via AxiosHttpClient,
 * consistent with tasks.md 5.3 ("doubling the HTTP call") — apps/search's
 * real Elasticsearch cluster reachability is intermittent in this sandbox
 * (see backend/apps/search/CLAUDE.md), so asserting on its live data here
 * would make this suite flaky for a reason unrelated to what it tests.
 *
 * If a real `quote-api` container is also running against the same shared
 * Redis (`docker compose up` from backend/apps/quote/), it registers its
 * own competing consumer on this exact queue name — BullMQ hands each job
 * to whichever consumer's connection happens to poll first, so some of
 * this suite's jobs would silently be processed by that live container's
 * (unmocked) worker instead of this test's, never touching `httpClientSend`
 * and produce confusing false negatives. Stop that container (or point it
 * at a different Redis) before running this suite locally.
 */
describe('GenerateExportWorker (integration, real Postgres + Redis + S3)', () => {
  let app: INestApplicationContext
  let prisma: PrismaClientService
  let quoteRepository: QuoteRepository
  let quoteItemRepository: QuoteItemRepository
  let quoteExportRepository: QuoteExportRepository
  let s3Service: S3Service
  let exportQueue: Queue
  let producer: GenerateExportProducer
  let httpClientSend: jest.Mock
  const createdQuoteIds: number[] = []

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://quote:quote@localhost:5432/quote?schema=public'
    process.env.REDIS_QUEUE_HOST = process.env.REDIS_QUEUE_HOST ?? 'localhost'
    process.env.REDIS_QUEUE_PORT = process.env.REDIS_QUEUE_PORT ?? '6379'
    process.env.WITH_KAFKA_BROKERS = 'false'
    process.env.AWS_REGION = process.env.AWS_REGION ?? 'us-east-1'
    process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID ?? 'localstack'
    process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY ?? 'localstack'
    process.env.AWS_S3_ENDPOINT = process.env.AWS_S3_ENDPOINT ?? 'http://localhost:4566'
    process.env.AWS_S3_FORCE_PATH_STYLE = process.env.AWS_S3_FORCE_PATH_STYLE ?? 'true'
    process.env.AWS_S3_BUCKET = process.env.AWS_S3_BUCKET ?? 'quote-uploads'

    httpClientSend = jest.fn()

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DbClientModule,
        AwsModule,
        ElasticsearchModule,
        QuoteSharedModule,
        HoldItModule.register([QUOTE_GENERATE_EXPORT_QUEUE]),
        HoldItModule.registerWorker({ processors: [GenerateExportWorker] }),
      ],
      providers: [GenerateExportProducer],
    })
      .overrideProvider(AxiosHttpClient)
      .useValue({ send: httpClientSend })
      .compile()

    app = await moduleRef.init()
    prisma = app.get(PrismaClientService)
    quoteRepository = app.get(QuoteRepository)
    quoteItemRepository = app.get(QuoteItemRepository)
    quoteExportRepository = app.get(QuoteExportRepository)
    s3Service = app.get(S3Service)
    exportQueue = app.get<Queue>(getQueueToken(QUOTE_GENERATE_EXPORT_QUEUE))
    producer = app.get(GenerateExportProducer)
  }, 30000)

  afterAll(async () => {
    if (createdQuoteIds.length > 0) {
      await prisma.quoteExport.deleteMany({ where: { quote_id: { in: createdQuoteIds } } })
      await prisma.quoteActivityEvent.deleteMany({ where: { quote_id: { in: createdQuoteIds } } })
      await prisma.quoteItem.deleteMany({ where: { quote_id: { in: createdQuoteIds } } })
      await prisma.quote.deleteMany({ where: { id: { in: createdQuoteIds } } })
    }
    await exportQueue.obliterate({ force: true })
    await app.close()
  }, 20000)

  beforeEach(() => {
    httpClientSend.mockReset()
  })

  async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 15000, intervalMs = 100): Promise<void> {
    const start = Date.now()
    while (!(await predicate())) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('waitFor: condition not met before timeout')
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs))
    }
  }

  async function seedQuoteWithItem(rawInput: Record<string, unknown>, candidateProductId: string) {
    const quote = await quoteRepository.create({
      name: 'Cotação de teste — exportação',
      source: 'partner_api' as any,
      status: 'reviewed',
      total_rows: 1,
    } as any)
    createdQuoteIds.push((quote as { id: number }).id)

    await quoteItemRepository.create({
      quote_id: (quote as { id: number }).id,
      row_number: 1,
      raw_input: rawInput as any,
      candidates: [{ productId: candidateProductId, name: 'Filtro snapshot', brand: 'Bosch', sku: 'SNAP-1' }] as any,
      selected_candidate_id: candidateProductId,
      match_score: 92,
      match_status: 'exact',
      review_status: 'reviewed',
      review_decision: 'approved',
      reviewed_by: 'ana@empresa.com',
      reviewed_at: new Date(),
    } as any)

    return (quote as { id: number }).id
  }

  it('generates an XLSX export end-to-end and marks it completed', async () => {
    const quoteId = await seedQuoteWithItem({ sku: 'OC90' }, '1')
    httpClientSend.mockResolvedValue({
      response: { data: { items: [{ id: 1, product_name: 'Filtro Real', brand_mapped_name: 'Bosch Real' }] } },
    })

    const exportRecord = await quoteExportRepository.create({
      quote_id: quoteId,
      status: 'preparing',
      format: 'xlsx',
      selected_fields: ['product_name', 'brand_name', 'match_score'],
    } as any)
    const exportId = (exportRecord as { id: number }).id

    await producer.enqueue(quoteId, { exportId })

    await waitFor(async () => {
      const job = await exportQueue.getJob(`${quoteId}.generate-export.${exportId}`)
      return (await job?.getState()) === 'completed'
    })

    const updated = await quoteExportRepository.findUnique({ where: { id: exportId } } as any)
    expect(updated).toMatchObject({ status: 'completed' })
    expect((updated as { file_s3_key?: string }).file_s3_key).toBe(`quotes/${quoteId}/exports/${exportId}.xlsx`)
    expect(httpClientSend).toHaveBeenCalledTimes(1)

    const { body } = await s3Service.getFile((updated as { file_s3_key: string }).file_s3_key)
    const workbook = XLSX.read(body, { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]])
    expect(rows).toEqual([{ sku: 'OC90', product_name: 'Filtro Real', brand_name: 'Bosch Real', match_score: 92 }])
  }, 20000)

  it('falls back to the stored candidate snapshot and still completes when the catalog fetch fails', async () => {
    const quoteId = await seedQuoteWithItem({ sku: 'OC91' }, '2')
    httpClientSend.mockRejectedValue(new Error('search-api unreachable'))

    const exportRecord = await quoteExportRepository.create({
      quote_id: quoteId,
      status: 'preparing',
      format: 'xlsx',
      selected_fields: ['product_name'],
    } as any)
    const exportId = (exportRecord as { id: number }).id

    await producer.enqueue(quoteId, { exportId })

    await waitFor(async () => {
      const job = await exportQueue.getJob(`${quoteId}.generate-export.${exportId}`)
      return (await job?.getState()) === 'completed'
    })

    const updated = await quoteExportRepository.findUnique({ where: { id: exportId } } as any)
    expect(updated).toMatchObject({ status: 'completed' })

    const { body } = await s3Service.getFile((updated as { file_s3_key: string }).file_s3_key)
    const workbook = XLSX.read(body, { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]])
    expect(rows).toEqual([{ sku: 'OC91', product_name: 'Filtro snapshot' }])
  }, 20000)

  it('resolves a custom mapped_attributes column end-to-end, combining value and unit', async () => {
    const quoteId = await seedQuoteWithItem({ sku: 'OC93' }, '3')
    httpClientSend.mockResolvedValue({
      response: {
        data: {
          items: [
            {
              id: 3,
              mapped_attributes: {
                peso_liquido: { golden_record: { value: 1.5 } },
                peso_liquido_unidade: { golden_record: { value: 'kg' } },
              },
            },
          ],
        },
      },
    })

    const exportRecord = await quoteExportRepository.create({
      quote_id: quoteId,
      status: 'preparing',
      format: 'xlsx',
      selected_fields: [],
      custom_attribute_fields: [{ label: 'Peso líquido', attribute_key: 'peso_liquido', unit_attribute_key: 'peso_liquido_unidade' }],
    } as any)
    const exportId = (exportRecord as { id: number }).id

    await producer.enqueue(quoteId, { exportId })

    await waitFor(async () => {
      const job = await exportQueue.getJob(`${quoteId}.generate-export.${exportId}`)
      return (await job?.getState()) === 'completed'
    })

    const updated = await quoteExportRepository.findUnique({ where: { id: exportId } } as any)
    expect(updated).toMatchObject({ status: 'completed' })
    expect(httpClientSend).toHaveBeenCalledTimes(1)

    const { body } = await s3Service.getFile((updated as { file_s3_key: string }).file_s3_key)
    const workbook = XLSX.read(body, { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]])
    expect(rows).toEqual([{ sku: 'OC93', 'Peso líquido': '1.5 kg' }])
  }, 20000)

  it('fails a job carrying an unsupported schemaVersion instead of silently accepting it', async () => {
    const quoteId = await seedQuoteWithItem({ sku: 'OC92' }, '3')
    const exportRecord = await quoteExportRepository.create({
      quote_id: quoteId,
      status: 'preparing',
      format: 'xlsx',
      selected_fields: ['product_name'],
    } as any)
    const exportId = (exportRecord as { id: number }).id

    await exportQueue.add(
      `${quoteId}.generate-export.${exportId}`,
      { schemaVersion: 2, quoteId, emittedAt: new Date().toISOString(), payload: { exportId } },
      { jobId: `${quoteId}.generate-export.${exportId}`, attempts: 1 },
    )

    await waitFor(async () => {
      const job = await exportQueue.getJob(`${quoteId}.generate-export.${exportId}`)
      return (await job?.getState()) === 'failed'
    })

    const job = await exportQueue.getJob(`${quoteId}.generate-export.${exportId}`)
    expect(job?.failedReason).toMatch(/Unsupported quote\.generate-export schemaVersion: 2/)
  }, 20000)
})
