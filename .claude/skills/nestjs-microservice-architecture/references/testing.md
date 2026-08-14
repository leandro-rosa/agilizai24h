# Testing

Three tiers, distinguished by filename suffix, each with a different job.

## `*.spec.ts` — unit

Colocated next to the file under test. Dependencies are hand-rolled Jest
mocks passed straight into the constructor — no `Test.createTestingModule`:

```ts
const repository = { findUnique: jest.fn(), update: jest.fn() };
const producer = { enqueue: jest.fn() };
const service = new WidgetService(repository as any, producer as any);
```

Fast, no I/O, no Nest DI overhead. This tier is for orchestration logic
and pure functions — anything where the point is "does this code call the
right thing with the right arguments," not "does the underlying query or
job actually work."

## `*.integration-spec.ts` — integration

Runs against real infrastructure (Postgres, Redis) via an actual
`Test.createTestingModule({...}).compile()`, with explicit cleanup:

```ts
beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), DbClientModule],
  }).compile();
  const app = await moduleRef.init();
  repository = app.get(WidgetRepository);
}, 30000);

afterAll(async () => {
  await prisma.widget.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.$disconnect();
}, 15000);
```

For BullMQ, clean up the queue itself, not just the database:

```ts
afterAll(async () => {
  await queue.obliterate({ force: true });
  await queue.close();
});
```

## `test/*.e2e-spec.ts` — end-to-end

Boots the whole `AppModule` and exercises it through the framework's own
request path:

```ts
const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
await app.init();
await app.getHttpAdapter().getInstance().ready();

const response = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/health' });
```

## Why real infra instead of mocks for integration/e2e

A mocked repository or broker only proves the code calls the right method
with the right shape of arguments — it can't tell you whether the actual
SQL query is correct, whether a unique constraint fires, or whether a
BullMQ job really gets picked up by a worker. Infrastructure behavior gets
tested against the real thing (Postgres, Redis/BullMQ) precisely because
that's the only way to catch the class of bug a mock is structurally
unable to catch. Reserve mocking for the unit tier, where the target is
pure orchestration logic, not I/O.

## Review checklist

- [ ] Unit tests use hand-rolled mocks and skip `TestingModule`, not the other way around.
- [ ] Integration/e2e tests run against real Postgres/Redis, not mocked repositories or brokers.
- [ ] Integration tests clean up what they create, including queues (`obliterate`) if BullMQ was involved.
- [ ] e2e tests live under `test/`, not colocated with source.
