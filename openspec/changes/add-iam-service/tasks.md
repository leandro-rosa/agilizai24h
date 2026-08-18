## 1. Service skeleton

- [ ] 1.1 Scaffold `backend/apps/iam-service` as a NestJS app in the pnpm workspace (`@agiliz/iam-service`), with `tsconfig.app.json` extending `backend/tsconfig.json`
- [ ] 1.2 Add `build`, `dev`, `lint`, `typecheck`, `test` scripts so the app participates in the Turborepo pipeline; import the shared `eslint.backend.mjs` flavour
- [ ] 1.3 Add typed env config validated at boot, failing fast on missing or invalid values — no ad-hoc `process.env` reads in business logic
- [ ] 1.4 Wire liveness/readiness endpoints via `@app/health` rather than a hand-rolled controller
- [ ] 1.5 Add structured logging with a correlation/request ID read from an inbound header and included on every log line
- [ ] 1.6 Confirm `pnpm turbo run typecheck lint build` passes with the new app in the graph

## 2. Database

- [ ] 2.1 Add a Postgres service for IAM (its own database — see design D2 and the database-per-service rule), on `agiliz_network`
- [ ] 2.2 Add the Prisma schema: users, credentials, roles, permissions, role-permission and user-role joins, sessions, and failed-attempt tracking
- [ ] 2.3 Add a unique constraint on user email, plus an index on the session token lookup path (introspection is a per-request read)
- [ ] 2.4 Create the initial Prisma migration; confirm the migration history is owned solely by this service
- [ ] 2.5 Implement repositories on `@app/prisma-db-client`'s `PrismaRepository<T, Model>` base
- [ ] 2.6 Seed the `administrator` and `operator` roles and the named permission set (design D4) via migration, since these are structural rather than secret

## 3. Credentials and accounts

- [ ] 3.1 Implement Argon2id hashing with tuned parameters sourced from validated env config (design D3)
- [ ] 3.2 Implement account creation, rejecting duplicate emails with a conflict error — check for the existing email explicitly, because `PrismaRepository` discards Prisma error codes (design "Risks")
- [ ] 3.3 Guarantee no endpoint ever returns a password or hash, and no log or error message ever contains a plaintext password
- [ ] 3.4 Implement account deactivation, cascading to revoke that account's sessions

## 4. Sessions

- [ ] 4.1 Implement session creation with a cryptographically random, high-entropy opaque token carrying no embedded user data
- [ ] 4.2 Store only a hash of the session token, so a database read cannot be replayed as a valid session
- [ ] 4.3 Implement expiry, and treat expired sessions as invalid while reporting "expired" distinctly from "unknown"
- [ ] 4.4 Implement logout with immediate revocation — no grace period
- [ ] 4.5 Implement introspection returning identity, roles and effective permissions, and confirm it does not extend the session's expiry

## 5. Authorization and throttling

- [ ] 5.1 Implement effective-permission resolution as the de-duplicated union of the user's roles' permissions
- [ ] 5.2 Confirm a role change is reflected on the next introspection without requiring re-login
- [ ] 5.3 Implement per-account failed-attempt throttling with a cooling-off period that clears on its own (design D6)
- [ ] 5.4 Make failure responses generic and comparable in timing between unknown-email and wrong-password, so accounts cannot be enumerated

## 6. HTTP surface

- [ ] 6.1 Implement login, logout, introspect, and account management endpoints with typed DTOs and validation
- [ ] 6.2 Generate the OpenAPI/Swagger document for the service
- [ ] 6.3 Define the permission-name constants in the shared contracts location so the gateway imports them rather than duplicating string literals

## 7. Bootstrap

- [ ] 7.1 Implement an idempotent bootstrap command creating the first administrator from supplied input, never a default password (design D5)
- [ ] 7.2 Make it a no-op that reports "already bootstrapped" when any account exists
- [ ] 7.3 Document the procedure in the service's `CLAUDE.md`

## 8. Tests

- [ ] 8.1 Unit tests for permission union, throttle counting/expiry, and token generation
- [ ] 8.2 Integration tests against a real Postgres (Testcontainers or docker-compose) covering every scenario in the `iam` spec
- [ ] 8.3 Explicit tests for the security-sensitive scenarios: password never persisted or returned in plaintext, opaque token, immediate revocation on logout, session revocation on deactivation, and no account enumeration
- [ ] 8.4 Confirm the whole spec's scenarios map to tests, with none left unasserted

## 9. Docker and CLI

- [ ] 9.1 Multi-stage Dockerfile with a repo-root build context, matching the pattern established for the frontends
- [ ] 9.2 Start the compiled app through `node -r ./register-paths.js` so `@app/*` resolves at runtime, and verify the built image actually starts (design "Risks")
- [ ] 9.3 Add `docker-compose.yml` joining the external `agiliz_network`, with a healthcheck targeting `127.0.0.1` explicitly
- [ ] 9.4 Register `iam` in `cli/agiliz-cli` (`VALID_PROJECTS`, `PROJECT_DIRECTORIES`, `PROJECT_FILES`, dev/prod service maps, ordered after `infra`), and update the `--help` PROJECTS block and completion candidates
- [ ] 9.5 Add the service's `.env.example`, deliberately omitting `WITH_KAFKA_BROKERS` and documenting why (design D7)

## 10. Documentation

- [ ] 10.1 Write `backend/apps/iam-service/CLAUDE.md` in the house style — public API/routes, dependencies on other libs, known gaps — short, no restating the parent
- [ ] 10.2 List the service in `backend/CLAUDE.md`, which currently records `apps/` as empty
- [ ] 10.3 Update `cli/CLAUDE.md`'s project table and ordering note

## 11. Verification

- [ ] 11.1 `pnpm turbo run lint typecheck build test` green across the workspace
- [ ] 11.2 `agiliz-cli up -i infra -i iam` brings the service up healthy, and it serves introspection end to end
- [ ] 11.3 Bootstrap an empty database, log in, introspect, log out, and confirm the token is rejected immediately afterwards
- [ ] 11.4 `openspec validate add-iam-service --strict` passes
