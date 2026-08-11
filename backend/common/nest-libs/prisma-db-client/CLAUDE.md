# common/nest-libs/prisma-db-client

Schema-agnostic base repository and search-criteria types for Prisma —
this lib has no knowledge of any app's actual models. Each app owns its own
Prisma schema, generated client, and concrete repositories; this lib only
supplies the generic plumbing they're built on. No app exists under
`backend/apps` yet to show a concrete example — see the `PrismaRepository`
usage pattern below.

## Public API

- `PrismaRepository<T, Model>` — abstract base class. Subclass with
  `super(prisma, prisma.<model>, '<EntityName>')` to get `findAll`, `count`,
  `findUnique`, `create`, `createMany`, `update`, `updateMany`,
  `updateByCriteria`, `createUpdate`, `delete`, `deleteMany`, `findFirst`,
  `groupBy` — each wrapped in `withErrorHandling`, which logs and rethrows
  a generic `Error` (the original Prisma error is logged but not preserved
  on the thrown error itself, so callers can't inspect e.g. Prisma error
  codes from what they catch).
- `SearchCriteriaInterface<T>` — `where`/`orderBy`/`take`/`skip`/`include`/
  `select`/`distinct`/`cursor`, all typed as `any`-permissive (not a strict
  mirror of Prisma's generated types) so it stays usable across different
  apps' schemas.
- Repository methods return audit fields unchanged.

## Known gaps

- `model`/`entityName`/`prisma` are all typed `any`/`unknown` by design (see
  the class-level comment) — this lib trades static type safety at the
  data-access layer for schema independence. Consumers get type safety back
  through their own repository subclass's generic parameters, not through
  this base class's own method signatures.
