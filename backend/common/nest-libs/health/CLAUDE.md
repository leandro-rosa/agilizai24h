# common/nest-libs/health

Generic health-check module built on `@nestjs/terminus`. Deliberately not
coupled to Prisma or any specific ORM.

## Public API

- `HealthModule` — imports `TerminusModule`, provides `PostgresHealthIndicator`,
  registers `HealthController` at `GET /health`.
- `PostgresHealthIndicator.isHealthy(key)` — runs `SELECT current_database()`
  through whatever client is bound to the `POSTGRES_HEALTH_CLIENT` injection
  token and reports `up`/`down`. If nothing is bound, it reports `down` with
  an explicit message instead of throwing — importing `HealthModule` alone,
  without binding the token, degrades gracefully rather than crashing boot.

## Wiring a Postgres client (consumer's responsibility)

`HealthModule` does not bind `POSTGRES_HEALTH_CLIENT` itself. The consuming
app's own DB module must, e.g. a `DbClientModule` in a Prisma-backed app:

```ts
{ provide: POSTGRES_HEALTH_CLIENT, useExisting: PrismaClientService }
```

Any client exposing `$queryRaw` (the shape `PrismaClientService` already
has) works — this indicator has no Prisma import, so it isn't tied to it.

## Consumers

None yet — no app imports `HealthModule` in this repo (`backend/apps` is
empty today). Wiring it into a new app's `app.module.ts` plus binding the
token as shown above is the whole integration.
