import 'reflect-metadata'
import { Test, type TestingModule } from '@nestjs/testing'
import { HoldItBullMQBroker } from '@app/hold-it'
import { INGESTION_QUEUES, type SupplyRowsJob } from '@app/ingestion-contracts'
import { PERIOD_DATA_UPDATED_SUBSCRIBERS, type PeriodDataUpdatedEvent } from '@app/period-events-contracts'
import { Queue } from 'bullmq'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { SupplyService } from '../src/modules/supply/services/supply.service'

/**
 * The queue path end to end, plus the part unique to this service: whether the
 * period-data-updated event is actually published, and actually suppressed.
 *
 * That suppression is asserted against the real event queue rather than a spy,
 * because the thing being guarded against is a downstream recomputation storm —
 * which is a property of what reaches Redis, not of what the code intended.
 *
 * Needs the `infra` Redis and this service's Postgres running.
 */
describe('supply worker integration', () => {
  let app: TestingModule
  let broker: HoldItBullMQBroker
  let supply: SupplyService
  let prisma: PrismaClientService
  let ingestionQueue: Queue
  /** One per subscriber: the event is fanned out, not broadcast. */
  let eventQueues: Queue[]

  const storeIds: number[] = []
  let nextStoreId = 600_000
  const newStore = () => {
    const id = nextStoreId++
    storeIds.push(id)
    return id
  }

  const connection = () => ({
    host: process.env.REDIS_QUEUE_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_QUEUE_PORT ?? 6379),
  })

  const jobFor = (
    storeId: number,
    removals: SupplyRowsJob['removals'],
    ingestionId = 'ing-w1',
  ): SupplyRowsJob =>
    ({
      schemaVersion: 1,
      ingestionId,
      correlationId: 'corr-supply-worker',
      storeId,
      period: '2026-03',
      restocks: [{ sku: 'A', quantityRestocked: 100 }],
      removals,
    }) as SupplyRowsJob

  const waitFor = async <T>(read: () => Promise<T>, timeoutMs = 15000): Promise<T> => {
    const deadline = Date.now() + timeoutMs
    let lastError: unknown

    while (Date.now() < deadline) {
      try {
        return await read()
      } catch (error) {
        lastError = error
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    }

    throw lastError ?? new Error('timed out waiting for the worker')
  }

  /** How many period events are sitting across the subscriber queues right now. */
  const eventCount = async (): Promise<number> => {
    const perQueue = await Promise.all(
      eventQueues.map(async queue => {
        const counts = await queue.getJobCounts()
        return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.completed ?? 0) + (counts.delayed ?? 0)
      }),
    )

    return perQueue.reduce((sum, count) => sum + count, 0)
  }

  const eventJobs = async (): Promise<PeriodDataUpdatedEvent[]> => {
    const perQueue = await Promise.all(
      eventQueues.map(queue => queue.getJobs(['waiting', 'completed', 'active', 'delayed'])),
    )

    return perQueue.flat().map(job => job.data as PeriodDataUpdatedEvent)
  }

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = await moduleRef.init()
    broker = app.get(HoldItBullMQBroker)
    supply = app.get(SupplyService)
    prisma = app.get(PrismaClientService)

    ingestionQueue = new Queue(INGESTION_QUEUES.SUPPLY_ROWS, { connection: connection() })
    eventQueues = PERIOD_DATA_UPDATED_SUBSCRIBERS.map(name => new Queue(name, { connection: connection() }))
    await Promise.all(eventQueues.map(queue => queue.obliterate({ force: true }).catch(() => undefined)))
  }, 60000)

  afterAll(async () => {
    if (prisma) {
      await prisma.restockRecord.deleteMany({ where: { store_id: { in: storeIds } } })
      await prisma.removalRecord.deleteMany({ where: { store_id: { in: storeIds } } })
      await prisma.ingestedPeriod.deleteMany({ where: { store_id: { in: storeIds } } })
    }
    await ingestionQueue?.obliterate({ force: true }).catch(() => undefined)
    await Promise.all((eventQueues ?? []).map(queue => queue.obliterate({ force: true }).catch(() => undefined)))
    await ingestionQueue?.close()
    await Promise.all((eventQueues ?? []).map(queue => queue.close()))
    await app?.close()
  }, 30000)

  it('consumes a job and derives loss from the split, not the line total', async () => {
    // The defining case, arriving the way it really will: through the queue.
    const store = newStore()

    await broker.holdIt({
      queueName: INGESTION_QUEUES.SUPPLY_ROWS,
      message: jobFor(store, [
        { sku: 'A', reason: 'return', quantityRemoved: 6, sourceText: '-6 Devolução, -3 Outro motivo' },
        { sku: 'A', reason: 'other_reason', quantityRemoved: 3, sourceText: '-6 Devolução, -3 Outro motivo' },
      ]),
    })

    const loss = await waitFor(() => supply.findLoss(store, '2026-03'))

    expect(loss.total).toBe(3)
  }, 40000)

  it('publishes a period-data-updated event on a real change', async () => {
    const store = newStore()
    const before = await eventCount()

    await broker.holdIt({
      queueName: INGESTION_QUEUES.SUPPLY_ROWS,
      message: jobFor(store, [{ sku: 'A', reason: 'expired', quantityRemoved: 4 }]),
    })
    await waitFor(() => supply.findLoss(store, '2026-03'))

    const after = await waitFor(async () => {
      const count = await eventCount()
      if (count <= before) throw new Error('event not published yet')
      return count
    })

    expect(after).toBeGreaterThan(before)
  }, 40000)

  it('carries identifiers only — no monetary figures — in the event', async () => {
    const store = newStore()

    await broker.holdIt({
      queueName: INGESTION_QUEUES.SUPPLY_ROWS,
      message: jobFor(store, [{ sku: 'A', reason: 'expired', quantityRemoved: 2 }]),
    })
    await waitFor(() => supply.findLoss(store, '2026-03'))

    const published = await waitFor(async () => {
      const match = (await eventJobs()).find(event => event.storeId === store)
      if (!match) throw new Error('not yet')
      return match
    })

    expect(published).toMatchObject({ schemaVersion: 1, storeId: store, period: '2026-03', source: 'supply' })
    expect(published.correlationId).toBe('corr-supply-worker')
    // If the event carried figures, changing the reconciliation formula would
    // mean changing this service — the coupling the event exists to avoid.
    expect(JSON.stringify(published)).not.toMatch(/cents|total|loss/i)
  }, 40000)

  it('reaches every subscriber, not just whichever consumer grabs it first', async () => {
    // BullMQ queues are point-to-point, so one shared queue made inventory and
    // finance COMPETE — measured at five/one across six events. Most months
    // silently never reconciled, and the ones that did were perfectly correct,
    // so nothing else would have caught it.
    const store = newStore()

    await broker.holdIt({
      queueName: INGESTION_QUEUES.SUPPLY_ROWS,
      message: jobFor(store, [{ sku: 'A', reason: 'expired', quantityRemoved: 1 }]),
    })
    await waitFor(() => supply.findLoss(store, '2026-03'))

    for (const queue of eventQueues) {
      await waitFor(async () => {
        const jobs = await queue.getJobs(['waiting', 'completed', 'active', 'delayed'])
        if (!jobs.some(job => (job.data as PeriodDataUpdatedEvent).storeId === store)) {
          throw new Error(`event never reached ${queue.name}`)
        }
        return true
      })
    }

    expect(eventQueues).toHaveLength(PERIOD_DATA_UPDATED_SUBSCRIBERS.length)
  }, 60000)

  it('suppresses the event when a re-delivered job changes nothing', async () => {
    const store = newStore()
    const message = jobFor(store, [{ sku: 'A', reason: 'expired', quantityRemoved: 4 }])

    await broker.holdIt({ queueName: INGESTION_QUEUES.SUPPLY_ROWS, message })
    await waitFor(() => supply.findLoss(store, '2026-03'))
    await waitFor(async () => {
      if (!(await eventJobs()).some(event => event.storeId === store)) throw new Error('not yet')
      return true
    })

    const afterFirst = await eventCount()

    // Re-uploading an identical file is a normal operator action; publishing
    // again would trigger a downstream recomputation storm for nothing.
    await broker.holdIt({ queueName: INGESTION_QUEUES.SUPPLY_ROWS, message })
    await new Promise(resolve => setTimeout(resolve, 4000))

    expect(await eventCount()).toBe(afterFirst)
  }, 60000)

  it('fails a job with an unrecognised reason and writes nothing', async () => {
    const store = newStore()

    await broker.holdIt({
      queueName: INGESTION_QUEUES.SUPPLY_ROWS,
      message: jobFor(store, [{ sku: 'A', reason: 'roubo', quantityRemoved: 5 }]),
    })

    await new Promise(resolve => setTimeout(resolve, 4000))

    await expect(supply.findPeriod(store, '2026-03')).rejects.toThrow(/No supply data ingested/)
  }, 40000)
})
