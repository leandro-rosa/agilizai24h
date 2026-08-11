import { Injectable, INestApplicationContext } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { Job } from 'bullmq'
import { HoldItModule } from '../../../../hold-it.module'
import { HoldItBullMQBroker } from '../index'
import { HoldItProcessor } from '../../../../decorators/hold-it-processor'
import { HoldItWorkerHost } from './index'

/**
 * Integration test against a real Redis instance (no mocks) for the
 * hold-it worker abstraction added in Fase 3: HoldItModule.registerWorker()
 * + @HoldItProcessor + HoldItWorkerHost. Requires REDIS_QUEUE_HOST /
 * REDIS_QUEUE_PORT to point at a reachable Redis (see backend/CLAUDE.md
 * for how to start one locally for this test).
 */

const BASIC_QUEUE = 'test.hold-it-worker-basic'
const CONCURRENCY_QUEUE = 'test.hold-it-worker-concurrency'
const RETRY_QUEUE = 'test.hold-it-worker-retry'

@Injectable()
@HoldItProcessor(BASIC_QUEUE)
class BasicProcessor extends HoldItWorkerHost<{ n: number }> {
  received: number[] = []

  async process(job: Job<{ n: number }>): Promise<number> {
    this.received.push(job.data.n)
    return job.data.n
  }
}

@Injectable()
@HoldItProcessor(CONCURRENCY_QUEUE, { concurrency: 5 })
class ConcurrencyProcessor extends HoldItWorkerHost<{ n: number }> {
  active = 0
  maxObservedConcurrency = 0
  completed: number[] = []

  async process(job: Job<{ n: number }>): Promise<number> {
    this.active += 1
    this.maxObservedConcurrency = Math.max(this.maxObservedConcurrency, this.active)
    await new Promise(resolve => setTimeout(resolve, 150))
    this.active -= 1
    this.completed.push(job.data.n)
    return job.data.n
  }
}

@Injectable()
@HoldItProcessor(RETRY_QUEUE)
class RetryProcessor extends HoldItWorkerHost<{ n: number }> {
  attempts: number[] = []

  async process(job: Job<{ n: number }>): Promise<number> {
    this.attempts.push(job.attemptsMade)
    if (job.attemptsMade < 2) {
      throw new Error('Simulated transient failure')
    }
    return job.data.n
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 10000, intervalMs = 50): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: condition not met before timeout')
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}

describe('HoldItModule.registerWorker (integration, real Redis)', () => {
  let app: INestApplicationContext
  let appClosed = false
  let broker: HoldItBullMQBroker
  let basicProcessor: BasicProcessor
  let concurrencyProcessor: ConcurrencyProcessor
  let retryProcessor: RetryProcessor

  beforeAll(async () => {
    process.env.REDIS_QUEUE_HOST = process.env.REDIS_QUEUE_HOST ?? 'localhost'
    process.env.REDIS_QUEUE_PORT = process.env.REDIS_QUEUE_PORT ?? '6379'
    process.env.WITH_KAFKA_BROKERS = 'false'

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        HoldItModule.register([BASIC_QUEUE, CONCURRENCY_QUEUE, RETRY_QUEUE]),
        HoldItModule.registerWorker({
          processors: [BasicProcessor, ConcurrencyProcessor, RetryProcessor],
        }),
      ],
    }).compile()

    app = await moduleRef.init()

    broker = app.get(HoldItBullMQBroker)
    basicProcessor = app.get(BasicProcessor)
    concurrencyProcessor = app.get(ConcurrencyProcessor)
    retryProcessor = app.get(RetryProcessor)
  }, 30000)

  afterAll(async () => {
    if (!appClosed) {
      await app?.close()
    }
  }, 30000)

  it('processes a job end-to-end through a real Redis-backed worker', async () => {
    await broker.holdIt({ queueName: BASIC_QUEUE, message: { n: 42 }, options: { attempts: 1 } })

    await waitFor(() => basicProcessor.received.includes(42))

    expect(basicProcessor.received).toContain(42)
  }, 15000)

  it('respects the configured worker concurrency', async () => {
    const jobs = Array.from({ length: 10 }, (_, i) => i)
    await Promise.all(
      jobs.map(n => broker.holdIt({ queueName: CONCURRENCY_QUEUE, message: { n }, options: { attempts: 1 } })),
    )

    await waitFor(() => concurrencyProcessor.completed.length === jobs.length, 15000)

    expect(concurrencyProcessor.maxObservedConcurrency).toBeGreaterThan(1)
    expect(concurrencyProcessor.maxObservedConcurrency).toBeLessThanOrEqual(5)
  }, 20000)

  it('retries a failing job according to explicit job options', async () => {
    await broker.holdIt({
      queueName: RETRY_QUEUE,
      message: { n: 7 },
      options: { attempts: 3, backoff: { type: 'fixed', delay: 100 } },
    })

    await waitFor(() => retryProcessor.attempts.includes(2), 15000)

    expect(retryProcessor.attempts).toEqual([0, 1, 2])
  }, 20000)

  it('shuts down gracefully without throwing', async () => {
    await expect(app.close()).resolves.not.toThrow()
    appClosed = true
  }, 15000)
})
