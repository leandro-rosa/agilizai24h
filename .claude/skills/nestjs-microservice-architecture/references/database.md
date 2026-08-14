# Database

Prisma, not TypeORM — using the newer `prisma-client` generator with the
`@prisma/adapter-pg` driver adapter (not the classic generated client).

## Setup

`prisma.config.ts` (new config format, sits next to `schema.prisma`):

```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
```

`schema.prisma` generator block:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

Migrations live under `prisma/migrations/<timestamp>_<name>/migration.sql`.
Treat them as additive-only — never rewrite an existing migration's SQL
once it's merged, even to "clean it up."

## Schema conventions

- Models: PascalCase, `@@map`'d to a singular snake_case table
  (`model Widget { ... } @@map("widget")`).
- Fields: snake_case directly in the schema (no per-field `@map`).
- Primary keys: `id Int @id @default(autoincrement())`.
- Foreign keys: `Int`, named `<relation>_id` (e.g. `widget_group_id`).
- No Prisma enums for status/vocabulary fields — keep them `String` and
  validate at the DTO layer (see
  [module-structure.md](module-structure.md)) so vocabulary changes don't
  need a migration.
- Prefer a discriminator column (`source: 'a' | 'b'`) over two parallel
  model families when the same table shape serves more than one source.
- Denormalized counters (`total_items`, `processed_items`) that services
  or workers maintain directly are fine, and usually preferable to running
  `COUNT(*)` on every poll.

## Client and module wiring

`PrismaClientService` connects/disconnects through Nest's lifecycle hooks
rather than leaving that to the caller:

```ts
@Injectable()
export class PrismaClientService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly prismaPg: PrismaPg) {
    super({ adapter: prismaPg, log: ['warn', 'error'] });
  }
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```

`db-client.module.ts` is `@Global()` — every other module needs a
`PrismaClientService` or a repository, and re-importing it everywhere adds
nothing:

```ts
@Global()
@Module({
  providers: [
    {
      provide: PrismaPg,
      useFactory: async (cs: ConfigService) => new PrismaPg({ connectionString: cs.get('DATABASE_URL') }),
      inject: [ConfigService],
    },
    PrismaClientService,
    WidgetRepository,
    { provide: POSTGRES_HEALTH_CLIENT, useExisting: PrismaClientService },
  ],
  exports: [PrismaClientService, WidgetRepository, POSTGRES_HEALTH_CLIENT],
})
export class DbClientModule {}
```

Binding `POSTGRES_HEALTH_CLIENT` here is what lets `@app/health`'s
Postgres indicator work without that lib knowing anything about Prisma.

## Repositories

One thin class per model, extending `PrismaRepository<T, Model>` from
`@app/prisma-db-client`. Repositories are persistence only — no business
logic, no cross-table orchestration; that belongs in the service layer.

```ts
@Injectable()
export class WidgetRepository extends PrismaRepository<Widget, Widget> {
  constructor(prisma: PrismaClientService) {
    super(prisma, prisma.widget, 'Widget');
  }
}
```

The base class already gives you `findAll`, `count`, `findUnique`,
`create`, `createMany`, `update`, `updateByCriteria`, `createUpdate`
(upsert), `delete`, `deleteMany`, `findFirst`, `groupBy` — add a method to
the subclass only for queries the base class genuinely can't express.

## Concurrency

For updates that must not race (two requests bumping the same revision,
for example), combine a transaction, an advisory lock, and an optimistic
check rather than relying on the transaction alone:

```ts
return this.prisma.$transaction(async (tx) => {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${id})`);
  const result = await tx.widget.updateMany({
    where: { id, revision: expectedRevision },
    data: { revision: expectedRevision + 1, ...changes },
  });
  if (result.count === 0) throw new ConflictException('Widget revision mismatch');
});
```

The advisory lock serializes concurrent writers on the same `id`; the
`updateMany` + row-count check is what actually detects a stale write and
turns it into a `409` instead of a silent overwrite.

## Review checklist

- [ ] Uses Prisma + `@prisma/adapter-pg`, not the classic generated client or a different ORM.
- [ ] `db-client.module.ts` is `@Global()` and binds `POSTGRES_HEALTH_CLIENT`.
- [ ] Each model has a thin repository extending `PrismaRepository<T, Model>` — no business logic inside repositories.
- [ ] No Prisma enums for fields with growing/open vocabularies.
- [ ] Concurrent-write paths use a transaction + advisory lock + optimistic check, not a bare `update`.
- [ ] Migrations are additive-only.
