# Config and bootstrap

## HTTP framework

Fastify via `@nestjs/platform-fastify`, not Express:

```ts
const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
if (needsFileUpload) {
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
}
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
await app.listen(port, '0.0.0.0');
```

Only register the multipart plugin if the service actually handles file
uploads — it's not part of the baseline bootstrap.

## Tracing as a separate entrypoint

OpenTelemetry instrumentation patches modules (`http`, `pg`, `ioredis`,
Fastify) at `require()` time. If `tracing.ts` is imported from inside
`main.ts`, those modules are already loaded by the time tracing sets up,
so the patching arrives too late. Instead, `tracing.ts` is its own file,
loaded with `node -r` *before* `main.js` runs (see
[docker.md](docker.md) for where this goes in the `CMD`):

```
node -r ./dist/apps/<name>/src/tracing.js dist/apps/<name>/src/main.js
```

`tracing.ts` itself just builds and starts an OpenTelemetry `NodeSDK` with
auto-instrumentation and an OTLP exporter — it has no NestJS imports and
isn't part of the module graph.

## Environment validation

`ConfigModule.forRoot` with a `validate` function, not a Joi schema:

```ts
// app.module.ts
ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
```

```ts
// config/env.validation.ts
class EnvironmentVariables {
  @IsString() @IsNotEmpty() DATABASE_URL: string;
  @IsString() @IsNotEmpty() REDIS_QUEUE_HOST: string;
  @IsInt() @Min(1) REDIS_QUEUE_PORT: number;
  @IsOptional() @IsInt() @Min(1) PORT?: number;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) throw new Error(`Invalid environment configuration:\n${errors.toString()}`);
  return validated;
}
```

This throws at boot on any invalid or missing variable — fail fast, rather
than discovering a missing env var when the first request that needs it
comes in. Only declare fields for env vars the app actually reads today;
extend the class incrementally as new modules get wired in, instead of
pre-declaring vars nothing consumes yet.

## What this pattern deliberately doesn't have (yet)

- **No Swagger/OpenAPI.** API contracts are documented in each module's
  `CLAUDE.md` instead. Add `@nestjs/swagger` if a consumer genuinely needs
  a machine-readable spec — it's not part of the baseline.
- **No global exception filters, interceptors, or guards.** Throw standard
  Nest HTTP exceptions (`NotFoundException`, `ConflictException`, etc.)
  directly from services and let Nest's default filter handle
  serialization. Add a filter/interceptor when a real cross-cutting need
  shows up, not preemptively.

## Health checks

Mount `@app/health`'s `HealthModule` in `app.module.ts` for a `GET
/health` endpoint. It's ORM-agnostic — it only needs something with a
`$queryRaw`-shaped method bound to its `POSTGRES_HEALTH_CLIENT` injection
token, which `db-client.module.ts` provides (see
[database.md](database.md)). If the service has no database, the
indicator degrades to `status: 'down'` with a message instead of crashing
— it doesn't need every service to have Postgres to be useful.

## Review checklist

- [ ] Uses `@nestjs/platform-fastify`, not Express.
- [ ] `tracing.ts` is a separate file loaded via `node -r`, not imported inside `main.ts`.
- [ ] `env.validation.ts` only declares vars the app actually consumes, and throws on invalid config at boot.
- [ ] `HealthModule` is mounted; if the app has Postgres, its client is bound to `POSTGRES_HEALTH_CLIENT`.
- [ ] No Swagger/global filters/interceptors/guards added without a concrete need driving them.
