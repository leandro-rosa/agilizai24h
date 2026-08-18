import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { HoldItModule, HoldItBullMQBroker } from '@app/hold-it'
import {
  INVENTORY_PERIOD_DERIVED_SUBSCRIBERS,
  PERIOD_EVENT_QUEUES,
  type InventoryPeriodDerivedEvent,
} from '@app/period-events-contracts'
import { DbClientModule } from '../src/modules/db-client/db-client.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { FinanceModule } from '../src/modules/finance/finance.module'
import { PeriodUpdatedWorker } from '../src/modules/finance/jobs/period-updated.worker'
import { UpstreamClient } from '../src/modules/finance/services/upstream.client'

/**
 * The queue path against a real Redis, following `@app/hold-it`'s own
 * integration-spec pattern.
 *
 * The trigger is inventory-service's derived event, not the raw period event:
 * reconciliation values remaining stock from what inventory writes, so reacting
 * to the same input ran the two concurrently and read a balance that was not
 * there yet.
 *
 * The unit test proves the handler; this proves the wiring — that a published
 * `inventory.period-derived` actually reaches it, with the payload intact. Those are
 * different failures, and the second one is invisible to a unit test.
 *
 * Requires the finance-service container to be DOWN. It consumes the same queue
 * on the same Redis, so leaving it up makes the two compete for every job and
 * the suite fails at random — which is worse than not running. The guard below
 * turns that into one clear message instead. (inventory-service may stay up: it
 * consumes a different queue entirely, which is the point of the last test.)
 */
const waitFor = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 20000): Promise<void> => {
  const start = Date.now()

  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met before timeout')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

describe('inventory.period-derived worker (integration, real Redis)', () => {
  let app: TestingModule
  let broker: HoldItBullMQBroker
  let prisma: PrismaClientService

  const storeIds: number[] = []
  let nextStoreId = 410_000
  const newStore = () => {
    const id = nextStoreId++
    storeIds.push(id)
    return id
  }

  beforeAll(async () => {
    process.env.REDIS_QUEUE_HOST = process.env.REDIS_QUEUE_HOST ?? 'localhost'
    process.env.REDIS_QUEUE_PORT = process.env.REDIS_QUEUE_PORT ?? '6379'
    process.env.WITH_KAFKA_BROKERS = 'false'

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DbClientModule,
        // The real module, so what is exercised is the production wiring —
        // including the @Global() that lets the worker inject FinanceService.
        FinanceModule,
        HoldItModule.register([PERIOD_EVENT_QUEUES.INVENTORY_PERIOD_DERIVED_FINANCE], { withKafkaBrokers: false }),
        HoldItModule.registerWorker({ processors: [PeriodUpdatedWorker] }),
      ],
    })
      // One restocked unit at one centavo: the figures are not what is under
      // test here, arrival is.
      .overrideProvider(UpstreamClient)
      .useValue({
        supplyFor: async () => ({ restocks: [{ sku: 'W', quantity_restocked: 1 }], removals: [] }),
        salesFor: async () => [],
        stockFor: async () => [],
        costsAsOf: async (_skus: string[], asOf: string) => ({
          as_of: asOf,
          resolved: [{ sku: 'W', product_id: 1, cost_cents: 1, effective_from: '2026-01-01' }],
          unresolved: [],
          complete: true,
        }),
      })
      .compile()

    app = await moduleRef.init()
    broker = app.get(HoldItBullMQBroker)
    prisma = app.get(PrismaClientService)

    const queue = await broker.getQueue(PERIOD_EVENT_QUEUES.INVENTORY_PERIOD_DERIVED_FINANCE)
    const workers = await queue.getWorkers()

    if (workers.length > 1) {
      throw new Error(
        `${workers.length} workers are attached to ${PERIOD_EVENT_QUEUES.INVENTORY_PERIOD_DERIVED_FINANCE}. ` +
          'Another consumer — almost certainly the finance-service container — would compete for these jobs. ' +
          'Stop it first: cli/agiliz-cli down -i finance',
      )
    }
  }, 60000)

  afterAll(async () => {
    if (prisma) await prisma.reconciliation.deleteMany({ where: { store_id: { in: storeIds } } })
    await app?.close()
  }, 30000)

  const publish = (event: InventoryPeriodDerivedEvent) =>
    broker.holdIt({ queueName: PERIOD_EVENT_QUEUES.INVENTORY_PERIOD_DERIVED_FINANCE, message: event, options: { attempts: 1 } })

  const stored = (storeId: number, period: string) =>
    prisma.reconciliation.findUnique({ where: { store_id_period: { store_id: storeId, period } } })

  it('reconciles a store-month when the event arrives', async () => {
    const store = newStore()

    await publish({
      schemaVersion: 1,
      storeId: store,
      period: '2026-05',
      changedAt: '2026-05-31T12:00:00.000Z',
    })

    await waitFor(async () => (await stored(store, '2026-05')) !== null)

    expect((await stored(store, '2026-05'))!.restocked_value_cents).toBe(1)
  }, 40000)

  it('records the input change time the event carried', async () => {
    // Without this a figure computed before its inputs last changed is
    // indistinguishable from a current one.
    const store = newStore()

    await publish({
      schemaVersion: 1,
      storeId: store,
      period: '2026-05',
      changedAt: '2026-05-31T12:00:00.000Z',
    })

    await waitFor(async () => (await stored(store, '2026-05')) !== null)

    expect((await stored(store, '2026-05'))!.inputs_changed_at?.toISOString()).toBe('2026-05-31T12:00:00.000Z')
  }, 40000)

  it('is unharmed by a redelivered event', async () => {
    // BullMQ delivers at least once, so this is the normal case, not the edge.
    const store = newStore()
    const event: InventoryPeriodDerivedEvent = {
      schemaVersion: 1,
      storeId: store,
      period: '2026-06',
      changedAt: '2026-06-30T12:00:00.000Z',
    }

    await publish(event)
    await waitFor(async () => (await stored(store, '2026-06')) !== null)

    await publish(event)
    await new Promise(resolve => setTimeout(resolve, 2000))

    expect(await prisma.reconciliation.count({ where: { store_id: store, period: '2026-06' } })).toBe(1)
    expect((await stored(store, '2026-06'))!.restocked_value_cents).toBe(1)
  }, 40000)

  it('has a queue of its own, so inventory-service cannot consume its events', async () => {
    // A single shared queue made the two services COMPETE — measured at
    // five/one across six events — so most months silently never reconciled.
    // Nothing else catches that: the figures that DO get computed are correct.
    expect(PERIOD_EVENT_QUEUES.INVENTORY_PERIOD_DERIVED_FINANCE).not.toBe(
      PERIOD_EVENT_QUEUES.PERIOD_DATA_UPDATED_INVENTORY,
    )
    expect([...INVENTORY_PERIOD_DERIVED_SUBSCRIBERS]).toContain(PERIOD_EVENT_QUEUES.INVENTORY_PERIOD_DERIVED_FINANCE)

    // And only this service's own worker is attached to it.
    const queue = await broker.getQueue(PERIOD_EVENT_QUEUES.INVENTORY_PERIOD_DERIVED_FINANCE)

    expect(await queue.getWorkers()).toHaveLength(1)
  }, 20000)

  it('reconciles any month inventory rebuilt, not only the month that changed', async () => {
    // Closing stock carries forward, so correcting March moves April too.
    // Inventory emits one event per rebuilt month; this is the consumer half of
    // that — without it, later months keep a figure computed from an old
    // balance while still reporting themselves complete.
    const store = newStore()

    await publish({
      schemaVersion: 1,
      storeId: store,
      period: '2026-07',
      changedAt: '2026-03-31T12:00:00.000Z',
    })

    await waitFor(async () => (await stored(store, '2026-07')) !== null)

    // The input-change time is March's, carried through — it says when the data
    // changed, not when inventory happened to finish rebuilding July.
    expect((await stored(store, '2026-07'))!.inputs_changed_at?.toISOString()).toBe('2026-03-31T12:00:00.000Z')
  }, 40000)
})
