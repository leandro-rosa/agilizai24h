## 1. Service skeleton

- [x] 1.1 Scaffold `backend/apps/iam-service` as a NestJS app in the pnpm workspace (`@agiliz/iam-service`), with `tsconfig.app.json` extending `backend/tsconfig.json`
- [x] 1.2 Add `build`, `dev`, `lint`, `typecheck`, `test` scripts so the app participates in the Turborepo pipeline; import the shared `eslint.backend.mjs` flavour
- [x] 1.3 Add typed env config validated at boot, failing fast on missing or invalid values — no ad-hoc `process.env` reads in business logic
- [x] 1.4 Wire liveness/readiness endpoints via `@app/health` rather than a hand-rolled controller
- [x] 1.5 Add structured logging with a correlation/request ID read from an inbound header and included on every log line
- [x] 1.6 Confirm `pnpm turbo run typecheck lint build` passes with the new app in the graph

## 2. Database

- [x] 2.1 Add a Postgres service for IAM (its own database — see design D2 and the database-per-service rule), on `agiliz_network`
- [x] 2.2 Add the Prisma schema: users, credentials, roles, permissions, role-permission and user-role joins, sessions, and failed-attempt tracking
- [x] 2.3 Add a unique constraint on user email, plus an index on the session token lookup path (introspection is a per-request read)
- [x] 2.4 Create the initial Prisma migration; confirm the migration history is owned solely by this service
- [x] 2.5 Implement repositories on `@app/prisma-db-client`'s `PrismaRepository<T, Model>` base
- [x] 2.6 Seed the `administrator` and `operator` roles and the named permission set (design D4) via migration, since these are structural rather than secret — the seed SQL is generated from `@app/iam-contracts` so the two cannot drift

## 3. Credentials and accounts

- [x] 3.1 Implement Argon2id hashing with tuned parameters sourced from validated env config (design D3)
- [x] 3.2 Implement account creation, rejecting duplicate emails with a conflict error — check for the existing email explicitly, because `PrismaRepository` discards Prisma error codes (design "Risks")
- [x] 3.3 Guarantee no endpoint ever returns a password or hash, and no log or error message ever contains a plaintext password
- [x] 3.4 Implement account deactivation, cascading to revoke that account's sessions

## 4. Sessions

- [x] 4.1 Implement session creation with a cryptographically random, high-entropy opaque token carrying no embedded user data
- [x] 4.2 Store only a hash of the session token, so a database read cannot be replayed as a valid session
- [x] 4.3 Implement expiry, and treat expired sessions as invalid while reporting "expired" distinctly from "unknown"
- [x] 4.4 Implement logout with immediate revocation — no grace period
- [x] 4.5 Implement introspection returning identity, roles and effective permissions, and confirm it does not extend the session's expiry

## 5. Authorization and throttling

- [x] 5.1 Implement effective-permission resolution as the de-duplicated union of the user's roles' permissions
- [x] 5.2 Confirm a role change is reflected on the next introspection without requiring re-login
- [x] 5.3 Implement per-account failed-attempt throttling with a cooling-off period that clears on its own (design D6)
- [x] 5.4 Make failure responses generic and comparable in timing between unknown-email and wrong-password, so accounts cannot be enumerated

## 6. HTTP surface

- [x] 6.1 Implement login, logout, introspect, and account management endpoints with typed DTOs and validation
- [x] 6.2 Generate the OpenAPI/Swagger document for the service — a deliberate deviation from the `nestjs-microservice-architecture` skill's baseline, which omits Swagger; the repo's engineering standards require it per HTTP service
- [x] 6.3 Define the permission-name constants in the shared contracts location so the gateway imports them rather than duplicating string literals — new `@app/iam-contracts` package

## 7. Bootstrap

- [x] 7.1 Implement an idempotent bootstrap command creating the first administrator from supplied input, never a default password (design D5)
- [x] 7.2 Make it a no-op that reports "already bootstrapped" when any account exists
- [x] 7.3 Document the procedure in the service's `CLAUDE.md`

## 8. Tests

- [x] 8.1 Unit tests for permission union, throttle counting/expiry, and token generation — 18 unit tests passing
- [x] 8.2 Integration tests against a real Postgres (Testcontainers or docker-compose) covering every scenario in the `iam` spec — 16 integration tests passing
- [x] 8.3 Explicit tests for the security-sensitive scenarios: password never persisted or returned in plaintext, opaque token, immediate revocation on logout, session revocation on deactivation, and no account enumeration
- [x] 8.4 Confirm the whole spec's scenarios map to tests, with none left unasserted

## 9. Docker and CLI

- [x] 9.1 Multi-stage Dockerfile with a repo-root build context, matching the pattern established for the frontends
- [ ] 9.2 Start the compiled app through `node -r ./register-paths.js` so `@app/*` resolves at runtime, and verify the built image actually starts (design "Risks"). **PARTIAL**: the compiled app was verified running natively via `register-paths.js` — which is what the design flagged as the real risk, and it surfaced two genuine bugs (see the change's notes). The *image* build is NOT verified: it was interrupted by a machine crash and left unbuilt to spare memory on this host. Build and run `iam-prod` before considering this change done
- [x] 9.3 Add `docker-compose.yml` joining the external `agiliz_network`, with a healthcheck targeting `127.0.0.1` explicitly
- [x] 9.4 Register `iam` in `cli/agiliz-cli` (`VALID_PROJECTS`, `PROJECT_DIRECTORIES`, `PROJECT_FILES`, dev/prod service maps, ordered after `infra`), and update the `--help` PROJECTS block and completion candidates
- [x] 9.5 Add the service's `.env.example`, deliberately omitting `WITH_KAFKA_BROKERS` and documenting why (design D7)

## 10. Documentation

- [x] 10.1 Write `backend/apps/iam-service/CLAUDE.md` in the house style — public API/routes, dependencies on other libs, known gaps — short, no restating the parent
- [x] 10.2 List the service in `backend/CLAUDE.md`, which currently records `apps/` as empty
- [x] 10.3 Update `cli/CLAUDE.md`'s project table and ordering note

## 11. Verification

- [x] 11.1 `pnpm turbo run lint typecheck build test` green across the workspace
- [ ] 11.2 `agiliz-cli up -i infra -i iam` brings the service up healthy, and it serves introspection end to end. **BLOCKED**: deferred with 9.2 — needs the container image, held back for memory on this host
- [x] 11.3 Bootstrap an empty database, log in, introspect, log out, and confirm the token is rejected immediately afterwards — verified against the real Postgres, including bootstrap idempotency on a second run
- [x] 11.4 `openspec validate add-iam-service --strict` passes
