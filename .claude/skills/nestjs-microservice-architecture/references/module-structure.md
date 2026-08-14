# Module structure

## App folder tree

```
backend/apps/<name>/
├── CLAUDE.md
├── Dockerfile
├── docker-compose.yaml
├── tsconfig.app.json
├── test/
│   └── *.e2e-spec.ts
└── src/
    ├── main.ts
    ├── tracing.ts
    ├── app.module.ts
    ├── config/
    │   ├── env.validation.ts
    │   └── env.validation.spec.ts
    └── modules/
        ├── db-client/          (only if the service uses Postgres)
        └── <feature>/
```

## Feature module internal layout

```
<feature>/
├── CLAUDE.md
├── <feature>.module.ts          # controllers + main services + producers
├── <feature>-shared.module.ts   # @Global(), only if the feature has workers
├── controllers/
│   └── <feature>.controller.ts (+ .spec.ts)
├── services/
│   └── <feature>.service.ts (+ .spec.ts)
├── jobs/                        # only if the feature has async work
│   ├── <step>.producer.ts
│   ├── <step>.worker.ts
│   └── <feature>-job-envelope.ts
├── dto/
├── constants/
├── decorators/
└── utils/
```

Keep `utils/` for pure, side-effect-free functions (scoring, normalization,
status transitions) — separating them from services means they can be
unit-tested without mocking any I/O, which is both faster and a better
signal that the logic itself is correct.

## The `@Global()` shared-module rule

`HoldItModule.registerWorker({ processors })` registers workers in a
dynamic module of its own — it does **not** import your feature module. So
if a worker needs to inject a service, that service can't just live in
`<feature>.module.ts`'s providers; the worker's injector won't see it.

The fix is a parallel module, `<feature>-shared.module.ts`, marked
`@Global()`, exporting exactly the providers workers need:

```ts
@Global()
@Module({
  imports: [HttpClientModule],
  providers: [WidgetActivityService, WidgetSyncProducer],
  exports: [WidgetActivityService, WidgetSyncProducer],
})
export class WidgetSharedModule {}
```

Import `WidgetSharedModule` alongside `WidgetModule` in `app.module.ts` (or
wherever the feature module is imported) — it needs to be part of the
module graph for its `@Global()` providers to register, even though
nothing needs to import it directly afterward.

Only split a provider into the shared module if a worker actually injects
it. Everything else stays in the regular feature module — don't make
everything global by default.

## DTO vocabulary validation

For fields with an open, evolving set of valid values (status, category,
etc.), validate at the DTO layer with `@IsIn` against an exported const
array, not with a Prisma enum:

```ts
export const WIDGET_STATUS_VALUES = ['draft', 'active', 'archived'] as const;

export class UpdateWidgetDto {
  @IsIn(WIDGET_STATUS_VALUES)
  status: string;
}
```

A Prisma enum requires a migration every time the vocabulary changes; a
`String` column validated at the DTO layer doesn't. This is a deliberate
trade-off for fields that are expected to grow — not a blanket rule
against using real types where the value set is genuinely fixed.

## Naming boundary: snake_case vs. camelCase

- Persisted fields and HTTP request/response bodies: `snake_case`
  (`created_by`, `match_status`).
- Queue envelope payloads and inter-service contract fields: `camelCase`
  (`schemaVersion`, `widgetId`).

Translate explicitly at the seam (inside the producer, when building the
envelope) rather than letting one convention leak into the other's
territory.

## Optional: entity/Prisma drift check

For services where the generated Prisma type and a hand-written "entity"
interface need to stay in sync (e.g. because the entity is exposed through
a public API and you want a compile-time alarm if a migration changes its
shape), a compile-time equality check catches drift without any runtime
cost:

```ts
type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type _WidgetMatchesPrisma = Expect<Equal<Widget, PrismaWidget>>;
```

This is optional rigor for services that want it, not a mandatory step for
every model.

## Review checklist

- [ ] Feature modules follow `controllers/services/jobs/dto/constants/decorators/utils`, not an ad hoc layout.
- [ ] Any provider injected by a worker is exported from a `@Global()` `<feature>-shared.module.ts`, not just the regular feature module.
- [ ] Open-vocabulary fields are validated via `@IsIn` against an exported const array, not a Prisma enum.
- [ ] Persisted/HTTP fields are snake_case; queue-envelope/inter-service fields are camelCase, translated explicitly at the boundary.
- [ ] Every module and the app root has a short `CLAUDE.md`.
