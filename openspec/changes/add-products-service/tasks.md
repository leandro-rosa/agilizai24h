## 1. Service skeleton

- [ ] 1.1 Scaffold `backend/apps/products-service` (`@agiliz/products-service`), cloning the structure established by `iam-service`
- [ ] 1.2 Add `build`, `dev`, `lint`, `typecheck`, `test` scripts and the shared `eslint.backend.mjs` flavour
- [ ] 1.3 Typed env config validated at boot; liveness/readiness via `@app/health`; structured logging carrying the inbound correlation ID
- [ ] 1.4 Do not register `HoldItModule` (design D7); omit `WITH_KAFKA_BROKERS` from `.env.example` and say why

## 2. Database

- [ ] 2.1 This service's own Postgres on `agiliz_network`
- [ ] 2.2 Prisma schema: products (id, SKU, name, category), cost versions (product, `effectiveFrom`, cost in integer centavos), and the name-override table
- [ ] 2.3 Unique constraint on SKU; unique constraint on (product, `effectiveFrom`) so re-recording the same date replaces rather than duplicates
- [ ] 2.4 Store money as integer minor units — no floats anywhere in the schema or DTOs (design D6)
- [ ] 2.5 Index the as-of lookup path (product + `effectiveFrom` descending), since it runs per SKU per valuation
- [ ] 2.6 Index the normalised-name column used for matching, and store the normalised form rather than normalising on every read
- [ ] 2.7 Initial Prisma migration, owned solely by this service; repositories on `PrismaRepository<T, Model>`

## 3. Cost versioning

- [ ] 3.1 Implement recording a cost version, preserving all previous versions (never overwrite or delete)
- [ ] 3.2 Implement replace-in-place when a cost is re-recorded for an effective date that already exists
- [ ] 3.3 Implement as-of resolution: latest version with `effectiveFrom <= asOf`
- [ ] 3.4 Report "no cost known" when the as-of date precedes every version — never fall back to the earliest version
- [ ] 3.5 Expose no operation that returns a cost without an explicit date (design D2)

## 4. Name matching

- [ ] 4.1 Implement normalisation: case folding, accent removal, whitespace collapsing
- [ ] 4.2 Implement exact comparison on the normalised form
- [ ] 4.3 Implement the curated override table and give it precedence over a normalised match (design D4)
- [ ] 4.4 Report ambiguity as unmatched when a normalised name matches multiple products and no override applies — never pick one
- [ ] 4.5 Implement no fuzzy or similarity matching of any kind (design D3), and note the prohibition in the service's `CLAUDE.md` so it is not "improved" later
- [ ] 4.6 Expose management of override entries so a mismatch can be fixed without a deploy

## 5. Bulk lookup contract

- [ ] 5.1 Implement bulk cost resolution for a set of SKUs at one date
- [ ] 5.2 Return a partitioned result — resolved costs separate from unresolved SKUs, each unresolved entry carrying a reason (design D5)
- [ ] 5.3 Ensure a recorded cost of zero is representable and distinguishable from "no cost"
- [ ] 5.4 Define the response shape and the money unit in the shared contracts location, so `finance` and `supply` import it rather than restating it

## 6. HTTP surface

- [ ] 6.1 Endpoints for product CRUD, cost-version recording, as-of and bulk cost lookup, name resolution, and override management, with typed DTOs and validation
- [ ] 6.2 Generate the OpenAPI/Swagger document, stating the money unit explicitly on every monetary field
- [ ] 6.3 Use the glossary terms from `openspec/project.md` (Cost, SKU, Product)

## 7. Tests

- [ ] 7.1 Unit tests for normalisation (case, accents, whitespace) and for override precedence
- [ ] 7.2 Unit tests for as-of selection at, before, and after each effective boundary
- [ ] 7.3 **Historical stability regression test**: value a period, record a later higher cost, re-value the same period, assert the result is unchanged (design "Risks" — this is the test that catches a wrong as-of implementation)
- [ ] 7.4 Tests for ambiguous match reported as unmatched, unknown name reported with the original string, and zero-cost distinguished from no-cost
- [ ] 7.5 Test that a bulk lookup with some unpriceable SKUs cannot be mistaken for a complete result
- [ ] 7.6 Integration tests against a real Postgres covering every scenario in the `products` spec

## 8. Docker and CLI

- [ ] 8.1 Multi-stage Dockerfile with a repo-root build context; start via `node -r ./register-paths.js`
- [ ] 8.2 `docker-compose.yml` on `agiliz_network` with a `127.0.0.1` healthcheck
- [ ] 8.3 Register `products` in `cli/agiliz-cli` after `infra`, updating `--help` and completion candidates

## 9. Documentation

- [ ] 9.1 Write `backend/apps/products-service/CLAUDE.md`, calling out the dated-cost rule, the no-fuzzy-matching prohibition, and the money unit
- [ ] 9.2 List the service in `backend/CLAUDE.md` and `cli/CLAUDE.md`

## 10. Verification

- [ ] 10.1 `pnpm turbo run lint typecheck build test` green across the workspace
- [ ] 10.2 `agiliz-cli up -i infra -i products` brings the service up healthy
- [ ] 10.3 Record two cost versions for one SKU, resolve as of a date between them, and confirm the earlier cost is returned
- [ ] 10.4 `openspec validate add-products-service --strict` passes
