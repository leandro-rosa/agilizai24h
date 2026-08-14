# Queues

Always go through `@app/hold-it` for background work — never add `bullmq`
or `@nestjs/bullmq` as a direct dependency of an app. The lib exists
precisely so every service configures Redis, retries, and observability
the same way; bypassing it re-opens all of that as a per-app decision.

## Registering queues and workers

The app (or module) that owns a queue registers it:

```ts
HoldItModule.register([WIDGET_SYNC_QUEUE, WIDGET_EXPORT_QUEUE]),
```

The module that processes jobs registers its worker classes separately:

```ts
HoldItModule.registerWorker({ processors: [WidgetSyncWorker, WidgetExportWorker] }),
```

`.register()` and `.registerWorker()` are independent — a queue must be
registered somewhere before a worker for it can start receiving jobs, but
the two calls don't need to be in the same module.

Workers extend `HoldItWorkerHost<T>` and are decorated with
`@HoldItProcessor`:

```ts
@HoldItProcessor(WIDGET_SYNC_QUEUE, { concurrency: 5 })
export class WidgetSyncWorker extends HoldItWorkerHost<WidgetJobEnvelope<WidgetSyncPayload>> {
  async process(job: Job<WidgetJobEnvelope<WidgetSyncPayload>>): Promise<void> {
    const envelope = job.data;
    if (envelope.schemaVersion !== 1) throw new Error(`Unsupported schemaVersion ${envelope.schemaVersion}`);
    // ...
  }
}
```

## Producing jobs

Use `HoldItBullMQBroker.holdIt` for a single job, `.holdItALot` for a
batch:

```ts
@Injectable()
export class WidgetSyncProducer {
  constructor(private readonly broker: HoldItBullMQBroker) {}

  async enqueue(widgetId: number, payload: WidgetSyncPayload) {
    const message = createWidgetJobEnvelope(widgetId, payload);
    await this.broker.holdIt({
      queueName: WIDGET_SYNC_QUEUE,
      message,
      options: {
        jobId: `${widgetId}.widget-sync`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    });
  }
}
```

Give every job a deterministic `jobId` derived from the entity it acts on
(and the step, if a job can be re-enqueued for the same entity multiple
times). BullMQ treats a duplicate `jobId` as a no-op, which makes retried
or duplicate enqueues safe by default instead of something you have to
guard against by hand.

## Versioned envelopes

Wrap every job payload in an envelope with a schema version, so the queue
can evolve without breaking jobs already in flight:

```ts
export const WIDGET_SYNC_QUEUE = 'widget.sync';

export interface WidgetJobEnvelope<T> {
  schemaVersion: 1;
  widgetId: number;
  emittedAt: string;
  payload: T;
}

export function createWidgetJobEnvelope<T>(widgetId: number, payload: T): WidgetJobEnvelope<T> {
  return { schemaVersion: 1, widgetId, emittedAt: new Date().toISOString(), payload };
}
```

Workers check `schemaVersion` before touching `payload` — a worker that
assumes the current shape will misbehave the moment an older in-flight job
from before a deploy lands in its queue.

## Failure handling and idempotency

- If a worker's job depends on a degraded external system, prefer marking
  the entity as failed over letting the whole job throw — a thrown error
  retries the same job, which doesn't help if the dependency is down for
  longer than the retry window, and it hides the failure from anything
  polling the entity's own status.
- Guard state-changing updates with a conditional `updateMany` that
  re-checks the expected status in its `where` clause, so a retried or
  duplicate worker run can't apply the same result twice:

  ```ts
  await this.prisma.widget.updateMany({
    where: { id: widgetId, sync_status: 'pending' },
    data: { sync_status: 'synced' },
  });
  ```

## Cross-service queues

If two independently-deployed apps need to share a queue (one produces,
the other consumes, or vice versa), don't let either app's internal types
be the contract. Extract a small package with no logic — just the queue
name constants and the envelope/payload types both sides import — so a
change to one side's internal types can't silently break the other's
deserialization. Only do this when the queue genuinely crosses a service
boundary; a queue used entirely within one app doesn't need this.

## Known gotcha: `WITH_KAFKA_BROKERS`

`HoldItModule` defaults `WITH_KAFKA_BROKERS` to `true` if the env var isn't
set, which crashes dependency injection — the Kafka broker path needs a
provider (`HoldItElasticsearchService`) that's never bound unless
Elasticsearch is also wired up. Until this is fixed upstream in the lib,
every consumer must explicitly set:

```
WITH_KAFKA_BROKERS=false
```

in the app's environment (and in every test's setup that boots
`HoldItModule`). This is easy to forget and the failure mode is a DI crash
with a stack trace that doesn't obviously point at this env var — check it
first if a service using `@app/hold-it` won't boot.

## Review checklist

- [ ] No direct `bullmq`/`@nestjs/bullmq` dependency — everything goes through `@app/hold-it`.
- [ ] Every job payload is wrapped in a versioned envelope; workers check `schemaVersion`.
- [ ] Producers use deterministic `jobId`s for anything that shouldn't double-enqueue.
- [ ] Workers use conditional updates (status re-checked in `where`) instead of unconditional writes.
- [ ] `WITH_KAFKA_BROKERS=false` is set wherever `HoldItModule` is registered, unless Kafka is actually wanted.
- [ ] Cross-service queue contracts live in a dedicated no-logic package, only when two separately-deployed apps actually share the queue.
