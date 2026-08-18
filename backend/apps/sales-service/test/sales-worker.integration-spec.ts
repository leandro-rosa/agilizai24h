import 'reflect-metadata'
import { Test, type TestingModule } from '@nestjs/testing'
import { HoldItBullMQBroker } from '@app/hold-it'
import { INGESTION_QUEUES, type SalesRowsJob } from '@app/ingestion-contracts'
import { Queue } from 'bullmq'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { SalesService } from '../src/modules/sales/services/sales.service'

/**
 * The queue path end to end: a job enqueued on a real Redis, consumed by the
 * real worker, landing in a real Postgres.
 *
 * The unit spec covers how the worker translates a job into a service call;
 * what this adds is that the job actually arrives, that BullMQ's at-least-once
 * delivery does not double figures, and that a malformed job fails rather than
 * writing something partial.
 *
 * Needs the `infra` Redis and this service's Postgres running — see the
 * service's CLAUDE.md.
 */
describe('sales worker integration', () => {
  let app: TestingModule
  let broker: HoldItBullMQBroker
  let sales: SalesService
  let prisma: PrismaClientService
  let queue: Queue

  const storeIds: number[] = []
  let nextStoreId = 700_000
  const newStore = () => {
    const id = nextStoreId++
    storeIds.push(id)
    return id
  }

  const jobFor = (storeId: number, rows: SalesRowsJob['rows'], ingestionId = 'ing-w1'): SalesRowsJob => ({
    schemaVersion: 1,
    ingestionId,
    correlationId: 'corr-worker',
    storeId,
    period: '2026-03',
    rows,
  })

  /** Waits for the worker to have written something, rather than sleeping blindly. */
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

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = await moduleRef.init()
    broker = app.get(HoldItBullMQBroker)
    sales = app.get(SalesService)
    prisma = app.get(PrismaClientService)

    queue = new Queue(INGESTION_QUEUES.SALES_ROWS, {
      connection: {
        host: process.env.REDIS_QUEUE_HOST ?? '127.0.0.1',
        port: Number(process.env.REDIS_QUEUE_PORT ?? 6379),
      },
    })
  }, 60000)

  afterAll(async () => {
    if (prisma) {
      await prisma.salesRecord.deleteMany({ where: { store_id: { in: storeIds } } })
      await prisma.ingestedPeriod.deleteMany({ where: { store_id: { in: storeIds } } })
    }
    // Clean the queue itself, not just the database.
    await queue?.obliterate({ force: true }).catch(() => undefined)
    await queue?.close()
    await app?.close()
  }, 30000)

  it('consumes an enqueued job and persists the rows with their provenance', async () => {
    const store = newStore()

    await broker.holdIt({
      queueName: INGESTION_QUEUES.SALES_ROWS,
      message: jobFor(store, [
        { sku: 'A', quantitySold: 10, revenueCents: 5000 },
        { sku: 'B', quantitySold: 4, revenueCents: 2400 },
      ]),
    })

    const totals = await waitFor(() => sales.totals(store, '2026-03'))

    expect(totals.total_quantity_sold).toBe(14)
    expect(totals.total_revenue_cents).toBe(7400)

    const rows = await sales.findPeriod(store, '2026-03')
    expect(rows.every(row => row.ingestion_id === 'ing-w1')).toBe(true)
  }, 40000)

  it('does not double figures when the same job is delivered twice', async () => {
    // BullMQ is at-least-once, so this is the property that actually matters.
    const store = newStore()
    const message = jobFor(store, [{ sku: 'A', quantitySold: 10, revenueCents: 5000 }])

    await broker.holdIt({ queueName: INGESTION_QUEUES.SALES_ROWS, message })
    await waitFor(() => sales.totals(store, '2026-03'))

    await broker.holdIt({ queueName: INGESTION_QUEUES.SALES_ROWS, message })
    await new Promise(resolve => setTimeout(resolve, 3000))

    const totals = await sales.totals(store, '2026-03')
    expect(totals.total_quantity_sold).toBe(10)
    expect(totals.total_revenue_cents).toBe(5000)
  }, 40000)

  it('replaces the period on a corrected batch, dropping SKUs it no longer contains', async () => {
    const store = newStore()

    await broker.holdIt({
      queueName: INGESTION_QUEUES.SALES_ROWS,
      message: jobFor(store, [
        { sku: 'A', quantitySold: 2, revenueCents: 500 },
        { sku: 'B', quantitySold: 3, revenueCents: 900 },
      ]),
    })
    await waitFor(async () => {
      const rows = await sales.findPeriod(store, '2026-03')
      if (rows.length !== 2) throw new Error('not yet')
      return rows
    })

    await broker.holdIt({
      queueName: INGESTION_QUEUES.SALES_ROWS,
      message: jobFor(store, [{ sku: 'A', quantitySold: 2, revenueCents: 500 }], 'ing-w2'),
    })

    const rows = await waitFor(async () => {
      const current = await sales.findPeriod(store, '2026-03')
      if (current.length !== 1) throw new Error('not yet')
      return current
    })

    expect(rows.map(r => r.sku)).toEqual(['A'])
    expect(rows[0].ingestion_id).toBe('ing-w2')
  }, 40000)

  it('fails a malformed job rather than writing partial data', async () => {
    const store = newStore()

    await broker.holdIt({
      queueName: INGESTION_QUEUES.SALES_ROWS,
      // A period the contract rejects — writing under it would attribute a
      // month's figures to a key nothing can read back.
      message: { ...jobFor(store, [{ sku: 'A', quantitySold: 1, revenueCents: 1 }]), period: '2026-3' },
    })

    await new Promise(resolve => setTimeout(resolve, 3000))

    await expect(sales.totals(store, '2026-03')).rejects.toThrow(/No sales data ingested/)
  }, 40000)
})
