## 1. Service skeleton

- [x] 1.1 Scaffold `backend/apps/stores-service` (`@agiliz/stores-service`) in the workspace, cloning the structure established by `iam-service`
- [x] 1.2 Add `build`, `dev`, `lint`, `typecheck`, `test` scripts and the shared `eslint.backend.mjs` flavour
- [x] 1.3 Add typed env config validated at boot; no ad-hoc `process.env` reads in business logic
- [x] 1.4 Wire liveness/readiness via `@app/health`
- [x] 1.5 Add structured logging with the inbound correlation/request ID on every line
- [x] 1.6 Do not register `HoldItModule` — nothing here is asynchronous; omit `WITH_KAFKA_BROKERS` from `.env.example` and say why

## 2. Database

- [x] 2.1 Add this service's own Postgres, on `agiliz_network` (database-per-service)
- [x] 2.2 Prisma schema for stores: internal id, name, address, city, type, status, external code, audit timestamps
- [x] 2.3 Unique constraint on external code, allowing it to be absent (a store may exist before its code is known) — `external_code` é unique e nullable, e `status` é indexado para o filtro padrão da listagem
- [x] 2.4 Index the external-code lookup path — ingestion resolves it per uploaded file
- [x] 2.5 Initial Prisma migration, owned solely by this service
- [x] 2.6 Repositories built on `@app/prisma-db-client`'s `PrismaRepository<T, Model>`

## 3. Domain behaviour

- [x] 3.1 Implement create and update, treating the internal identifier as immutable
- [x] 3.2 Reject duplicate external codes with a conflict error — check explicitly rather than relying on a caught Prisma error code, which `PrismaRepository` discards
- [x] 3.3 Implement external-code resolution that reports "no match" rather than falling back to name matching or returning an arbitrary store — reporta 404 nomeando o código; nunca cai para match por nome nem devolve loja arbitrária
- [x] 3.4 Implement status transitions (active / maintenance / inactive)
- [x] 3.5 Refuse permanent deletion, directing callers to deactivate
- [x] 3.6 Implement listing with status, type and city filters, defaulting to active only
- [x] 3.7 Apply a deterministic sort so repeated identical listing requests return a stable order

## 4. HTTP surface

- [x] 4.1 Endpoints for list, get-by-id, resolve-by-external-code, create and update, with typed DTOs and validation
- [x] 4.2 Generate the OpenAPI/Swagger document
- [x] 4.3 Return field names matching the glossary in `openspec/project.md` (Store, not Loja) so the panel's existing types line up — nomes de campo seguem o glossário (Store), alinhados aos tipos que o painel já usa

## 5. Tests

- [x] 5.1 Unit tests for filtering and sort determinism
- [x] 5.2 Integration tests against a real Postgres covering every scenario in the `stores` spec
- [x] 5.3 Explicit tests for: duplicate external code rejected, unknown code reported rather than guessed, deletion refused, inactive store still resolvable by id — cobertos por 17 testes de integração contra Postgres real

## 6. Docker and CLI

- [x] 6.1 Multi-stage Dockerfile with a repo-root build context
- [x] 6.2 Start via `node -r ./register-paths.js` so `@app/*` resolves at runtime; verify the built image starts and serves — imagem `stores-prod` sobe healthy como usuário não-root e serve por nome na `agiliz_network`
- [x] 6.3 `docker-compose.yml` on the external `agiliz_network`, healthcheck targeting `127.0.0.1`
- [x] 6.4 Register `stores` in `cli/agiliz-cli` after `infra`, updating `--help` and completion candidates

## 7. Documentation

- [x] 7.1 Write `backend/apps/stores-service/CLAUDE.md` in the house style
- [x] 7.2 List the service in `backend/CLAUDE.md` and `cli/CLAUDE.md`

## 8. Verification

- [x] 8.1 `pnpm turbo run lint typecheck build test` green across the workspace
- [x] 8.2 `agiliz-cli up -i infra -i stores` brings the service up healthy
- [x] 8.3 Create a store, resolve it by external code, deactivate it, and confirm it still resolves by id — criada loja, resolvida por código externo, desativada e ainda resolvível por id e por código
- [x] 8.4 `openspec validate add-stores-service --strict` passes
