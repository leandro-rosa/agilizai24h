import { INestApplicationContext } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { getQueueToken } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { HoldItModule } from '@app/hold-it'
import { AwsModule } from '@app/aws'
import { ElasticsearchModule } from '@app/elasticsearch'
import { DbClientModule } from '../../db-client/db-client.module'
import { QuoteSharedModule } from '../quote-shared.module'
import { QUOTE_MATCH_ITEM_QUEUE, QUOTE_PROCESS_UPLOAD_QUEUE } from './quote-job-envelope'
import { ProcessUploadProducer } from './process-upload.producer'
import { MatchItemProducer } from './match-item.producer'
import { ProcessUploadWorker } from './process-upload.worker'
import { MatchItemWorker } from './match-item.worker'

/**
 * Integration test against a real Redis instance (no mocks) — see
 * backend/CLAUDE.md for how to start one locally for this test.
 */
describe('quote job workers (integration, real Redis)', () => {
  let app: INestApplicationContext
  let processUploadQueue: Queue
  let matchItemQueue: Queue
  let processUploadProducer: ProcessUploadProducer
  let matchItemProducer: MatchItemProducer

  const queueTestId = (suffix: number) => 1_000_000_000 + (Date.now() % 100_000_000) * 10 + suffix

  beforeAll(async () => {
    process.env.REDIS_QUEUE_HOST = process.env.REDIS_QUEUE_HOST ?? 'localhost'
    process.env.REDIS_QUEUE_PORT = process.env.REDIS_QUEUE_PORT ?? '6379'
    process.env.WITH_KAFKA_BROKERS = 'false'

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DbClientModule,
        AwsModule,
        ElasticsearchModule,
        QuoteSharedModule,
        HoldItModule.register([QUOTE_PROCESS_UPLOAD_QUEUE, QUOTE_MATCH_ITEM_QUEUE]),
        HoldItModule.registerWorker({ processors: [ProcessUploadWorker, MatchItemWorker] }),
      ],
      providers: [ProcessUploadProducer, MatchItemProducer],
    }).compile()

    app = await moduleRef.init()
    processUploadQueue = app.get<Queue>(getQueueToken(QUOTE_PROCESS_UPLOAD_QUEUE))
    matchItemQueue = app.get<Queue>(getQueueToken(QUOTE_MATCH_ITEM_QUEUE))
    processUploadProducer = app.get(ProcessUploadProducer)
    matchItemProducer = app.get(MatchItemProducer)
  }, 30000)

  afterAll(async () => {
    await processUploadQueue.obliterate({ force: true })
    await matchItemQueue.obliterate({ force: true })
    // Closes the BullMQ Workers too (via @nestjs/bullmq's shutdown hooks) —
    // closing only the Queue handles above leaves worker connections open
    // and Jest never exits.
    await app.close()
  }, 15000)

  async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 10000, intervalMs = 50): Promise<void> {
    const start = Date.now()
    while (!(await predicate())) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('waitFor: condition not met before timeout')
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs))
    }
  }

  it('processes a quote.process-upload job end-to-end and marks it completed', async () => {
    const quoteId = queueTestId(1)
    await processUploadProducer.enqueue(quoteId, { sourceFileName: 'planilha.xlsx' })

    await waitFor(async () => {
      const job = await processUploadQueue.getJob(`${quoteId}.process-upload`)
      return (await job?.getState()) === 'completed'
    })
  }, 15000)

  it('processes a quote.match-item job end-to-end and marks it completed', async () => {
    const quoteId = queueTestId(2)
    const itemId = quoteId + 1
    await matchItemProducer.enqueue(quoteId, { itemId })

    await waitFor(async () => {
      const job = await matchItemQueue.getJob(`${quoteId}.match-item.${itemId}`)
      return (await job?.getState()) === 'completed'
    })
  }, 15000)

  it('fails a job carrying an unsupported schemaVersion instead of silently accepting it', async () => {
    const quoteId = queueTestId(4)
    await processUploadQueue.add(
      `${quoteId}.process-upload`,
      { schemaVersion: 2, quoteId, emittedAt: new Date().toISOString(), payload: { sourceFileName: 'planilha.xlsx' } },
      { jobId: `${quoteId}.process-upload`, attempts: 1 },
    )

    await waitFor(async () => {
      const job = await processUploadQueue.getJob(`${quoteId}.process-upload`)
      return (await job?.getState()) === 'failed'
    })

    const job = await processUploadQueue.getJob(`${quoteId}.process-upload`)
    expect(job?.failedReason).toMatch(/Unsupported quote\.process-upload schemaVersion: 2/)
  }, 15000)
})
