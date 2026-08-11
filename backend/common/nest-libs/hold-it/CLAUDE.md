# common/nest-libs/hold-it

Message-broker abstraction (`HoldItBrokerInterface`: `holdIt`, `holdItALot`,
`shutdown`) with two implementations — BullMQ (fully working) and Kafka
(has a known startup-breaking gap, see below). Also owns the BullMQ worker
abstraction (`@HoldItProcessor` + `HoldItWorkerHost`, added Fase 3) that
queue consumers are meant to be built on. No app exists under
`backend/apps` in this repo yet to exercise either path.

## Public API

- `HoldItModule.register(queueNames?: string[], config?)` — global module; sets up
  the shared Redis connection, registers queues via `@nestjs/bullmq`,
  provides `HoldItBullMQBroker` (always) and, when `WITH_KAFKA_BROKERS`
  is `true` (default), `HoldItKafkaBroker`/`KafkaDlqService` (see the
  Kafka gap below). Wires BullMQ OTel telemetry and mounts
  `BullMQController` at `/holdit/bullmq` (queue-count monitor +
  reprocess-failed endpoint) unless `config.exposeController` is false.
  `config.withKafkaBrokers` can explicitly override the legacy
  `WITH_KAFKA_BROKERS` environment default for isolated consumers.
- `HoldItQueueBoardService.setupBoard(options?)` — builds the Bull Board
  Fastify plugin with an explicit base path and read-only/retry policy.
  Intended to be hosted by a dedicated small app (e.g. a `bull-board`
  service) — no such app exists under `backend/apps` in this repo yet.
- `HoldItModule.registerWorker({ processors })` — registers
  `@HoldItProcessor`-decorated workers; must run alongside a
  `.register([...])` that already registered the same queue names.
- `@HoldItProcessor(queueName, options?)` — marks a class as a BullMQ
  worker for an already-registered queue.
- `HoldItWorkerHost<T>` — abstract worker base class; implement
  `process(job: Job<T>)`. Failed-job logging (`HOLD_IT_JOB_FAILED`) is
  inherited for free.
- `@CurrentJob()` / `@JobInit()` — decorator pair for accessing the
  current BullMQ job inside a handler.
- `@KafkaTopics({ topic, concurrency?, schemaRegistry? })` — metadata
  decorator for Kafka consumers (Kafka path only).

## Intended usage pattern

Producers call `HoldItBullMQBroker.holdIt({ queueName, message, options })`
directly (not through a custom wrapper); workers subclass `HoldItWorkerHost`
and are registered via `HoldItModule.registerWorker()`. Any consuming app
should set `WITH_KAFKA_BROKERS=false` explicitly (env / docker-compose /
test setup) rather than relying on the default — see why below. No app in
this repo does this yet (`backend/apps` is empty today).

## Known gap: Kafka path is broken when enabled

`WITH_KAFKA_BROKERS` defaults to `true` when unset
(`hold-it.module.ts`: `process.env.WITH_KAFKA_BROKERS ? ... === 'true' : true`).
When true, `getProviderMap()` adds `HoldItKafkaBroker` and `KafkaDlqService`
as providers — but `HoldItKafkaBroker`'s constructor also injects
`HoldItElasticsearchService` (`services/elasticsearch/index.ts`), which
`getProviderMap()` never provides. NestJS's DI container fails to resolve
it at boot, crashing app startup. Any consuming app must explicitly set
`WITH_KAFKA_BROKERS=false` (docker-compose, env file, test setup) rather
than relying on the default — omitting that override anywhere Kafka
brokers would otherwise load breaks startup.

`HoldItElasticsearchService` provisions and writes to the Kafka DLQ
"necropolis": an Elasticsearch index family (with a 90-day ILM
rollover/delete policy) that dead Kafka messages get written to after
exhausting retries. `ElasticsearchController`
(`controllers/elasticsearch.ts`, `POST /holdit/elasticsearch/kafka-necropolis-provision`)
provisions that ILM policy/template/index — but it's not registered in
`HoldItModule`'s `controllers` array either, so today it's unreachable even
if the DI gap above were fixed.

Fixing this (provide `HoldItElasticsearchService`, decide whether
`ElasticsearchController` should be mounted) is not done here — no
consuming app uses Kafka today, so it's been worked around (via the
required env override above) rather than fixed.

## Testing

Integration-tested against real Redis (no mocks):
`services/brokers/bull-mq/worker/index.integration-spec.ts` covers
`HoldItModule.registerWorker()` end-to-end (basic processing, concurrency,
retry/backoff). No integration test exists for the Kafka path — it would
need a real Kafka broker, and given the DI gap above, couldn't pass with
`WITH_KAFKA_BROKERS=true` today anyway.
