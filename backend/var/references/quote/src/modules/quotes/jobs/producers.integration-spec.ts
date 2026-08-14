import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { getQueueToken } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { HoldItModule } from '@app/hold-it'
import { QUOTE_MATCH_ITEM_QUEUE, QUOTE_PROCESS_UPLOAD_QUEUE } from './quote-job-envelope'
import { ProcessUploadProducer } from './process-upload.producer'
import { MatchItemProducer } from './match-item.producer'

/**
 * Integration test against a real Redis instance (no mocks) — see
 * backend/CLAUDE.md for how to start one locally for this test.
 */
describe('quote job producers (integration, real Redis)', () => {
  let processUploadQueue: Queue
  let matchItemQueue: Queue

  const queueTestId = (suffix: number) => 1_000_000_000 + (Date.now() % 100_000_000) * 10 + suffix
  let processUploadProducer: ProcessUploadProducer
  let matchItemProducer: MatchItemProducer

  beforeAll(async () => {
    process.env.REDIS_QUEUE_HOST = process.env.REDIS_QUEUE_HOST ?? 'localhost'
    process.env.REDIS_QUEUE_PORT = process.env.REDIS_QUEUE_PORT ?? '6379'
    process.env.WITH_KAFKA_BROKERS = 'false'

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        HoldItModule.register([QUOTE_PROCESS_UPLOAD_QUEUE, QUOTE_MATCH_ITEM_QUEUE]),
      ],
      providers: [ProcessUploadProducer, MatchItemProducer],
    }).compile()

    const app = await moduleRef.init()
    processUploadQueue = app.get<Queue>(getQueueToken(QUOTE_PROCESS_UPLOAD_QUEUE))
    matchItemQueue = app.get<Queue>(getQueueToken(QUOTE_MATCH_ITEM_QUEUE))
    processUploadProducer = app.get(ProcessUploadProducer)
    matchItemProducer = app.get(MatchItemProducer)
  }, 30000)

  afterAll(async () => {
    await processUploadQueue.obliterate({ force: true })
    await matchItemQueue.obliterate({ force: true })
    await processUploadQueue.close()
    await matchItemQueue.close()
  }, 15000)

  it('publishes a versioned envelope to quote.process-upload', async () => {
    const quoteId = queueTestId(1)
    const envelope = await processUploadProducer.enqueue(quoteId, { sourceFileName: 'planilha.xlsx' })

    const job = await processUploadQueue.getJob(`${quoteId}.process-upload`)

    expect(job).not.toBeNull()
    expect(job?.data).toEqual(envelope)
    expect(job?.data.schemaVersion).toBe(1)
    expect(job?.opts.attempts).toBe(3)
  })

  it('publishes a versioned envelope to quote.match-item', async () => {
    const quoteId = queueTestId(2)
    const itemId = quoteId + 1
    const envelope = await matchItemProducer.enqueue(quoteId, { itemId })

    const job = await matchItemQueue.getJob(`${quoteId}.match-item.${itemId}`)

    expect(job).not.toBeNull()
    expect(job?.data).toEqual(envelope)
  })

  it('does not duplicate a job when the same quoteId/step is enqueued twice', async () => {
    const quoteId = queueTestId(4)

    await processUploadProducer.enqueue(quoteId, { sourceFileName: 'first.xlsx' })
    await processUploadProducer.enqueue(quoteId, { sourceFileName: 'second.xlsx' })

    const jobsWithThisId = await processUploadQueue.getJobs(['waiting', 'active', 'completed', 'delayed'])
    const matching = jobsWithThisId.filter(job => job.id === `${quoteId}.process-upload`)

    // BullMQ keeps the first job when a duplicate jobId is added — the
    // second enqueue is a no-op, so exactly one job exists and it still
    // carries the original payload.
    expect(matching).toHaveLength(1)
    expect(matching[0].data.payload.sourceFileName).toBe('first.xlsx')
  })
})
