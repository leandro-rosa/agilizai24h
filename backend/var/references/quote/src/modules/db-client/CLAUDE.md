# apps/quote/src/modules/db-client

Owns everything database-specific for `quote`: the Postgres/Prisma schema,
migrations, and one thin repository per table. `common/nest-libs/prisma-db-client`
only supplies the generic, schema-agnostic base repository and search-criteria
types — it has no knowledge of `Quote`/`QuoteItem`; that knowledge lives
entirely here.

## Schema conventions

Prisma model names are PascalCase application type names. Every model uses
`@@map` to a singular snake_case Postgres table (`Quote` → `quote`,
`QuoteItem` → `quote_item`, `ColumnMappingTemplate` →
`column_mapping_template`, `QuoteExport` → `quote_export`, and
`QuoteActivityEvent` → `quote_activity_event`). Declare fields directly in
snake_case rather than presenting camelCase Prisma fields through `@map`.

Every primary key is an `Int` with `@id @default(autoincrement())`. Every
relational foreign key is also an `Int`, named `<relation>_id`, and references
that generated integer key.

Application entity interfaces remain owned and exported by this module. Keep
them compile-time checked for structural compatibility with generated Prisma
model types so schema drift fails typecheck; do not re-export generated Prisma
types as application entities or public contracts.

## Tables

- **`Quote`** — one quotation, from either a spreadsheet upload or a
  partner-API intake (`source` discriminator — see the parent
  `backend/apps/quote/CLAUDE.md`'s resolved decisions for why these share
  one table family instead of two).
- **`QuoteItem`** — one line item within a quote: the original uploaded/
  submitted data, the matched catalog candidate(s), and the reviewer's
  decision.
- **`ColumnMappingTemplate`** — a reusable spreadsheet column-mapping
  configuration, so a buyer doesn't have to re-map an identically shaped
  file every time.
- **`QuoteExport`** — a generated export artifact (see the `quotes` module
  for the export job) and its status.
- **`QuoteActivityEvent`** — the audit trail: one row per notable action
  taken on a quote (created, item decided, exported, ...), consumed by the
  activity API.

## Repository pattern

Each repository (`QuoteRepository`, `QuoteItemRepository`,
`ColumnMappingTemplateRepository`, `QuoteExportRepository`,
`QuoteActivityEventRepository`) is a one-line subclass of the shared
`PrismaRepository<T>` base class, binding it to one Prisma model. No
business logic lives here — validation, defaults, and orchestration belong
to the `quotes` module's services; this module is persistence-only.

`DbClientModule` is `@Global()` (all five repositories plus
`PrismaClientService` are injectable anywhere in the app without a direct
import) and also provides the Postgres health-check binding
(`POSTGRES_HEALTH_CLIENT`) that `common/nest-libs/health` consumes.

## Local migration baseline

Migration history is additive. Keep the existing `init` migration immutable and
add a new migration for every schema change. Verify additive migrations both
against the current local database and an empty database before deployment.
`prisma migrate reset` destroys local data; never run it against shared or
production databases, and never rewrite migration history after deployment.
