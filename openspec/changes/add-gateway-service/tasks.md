## 1. Service skeleton

- [ ] 1.1 Scaffold `backend/apps/gateway-service` (`@agiliz/gateway-service`) in the workspace
- [ ] 1.2 Add `build`, `dev`, `lint`, `typecheck`, `test` scripts and the shared `eslint.backend.mjs` flavour
- [ ] 1.3 Typed env config validated at boot, including the base URL of every downstream service
- [ ] 1.4 Liveness/readiness via `@app/health`, and confirm the health route is reachable without a session
- [ ] 1.5 No database and no Prisma — state the exception to database-per-service in this service's `CLAUDE.md` (design D2)
- [ ] 1.6 Do not register `HoldItModule` yet; `add-ingestion-flow` adds it when upload endpoints arrive

## 2. Downstream clients

- [ ] 2.1 Build typed clients for `iam-service`, `stores-service` and `products-service` on `@app/http-client` — never raw axios or fetch
- [ ] 2.2 Configure per-call timeouts and bounded retries, so one slow dependency cannot exhaust the gateway
- [ ] 2.3 Map downstream transport failures to a distinct internal error type, separate from downstream 4xx responses

## 3. Authentication

- [ ] 3.1 Implement session resolution by introspecting against `iam-service` on every protected request, with no caching (design D3)
- [ ] 3.2 Reject missing, unknown and expired sessions as unauthenticated (401) without calling any domain service
- [ ] 3.3 Return 503 when `iam-service` is unreachable, and ensure the caller's session is neither treated as invalid nor cleared (design D5)
- [ ] 3.4 Fail closed: no request reaches a domain service when the session could not be validated for any reason (design D6)
- [ ] 3.5 Mark login and health routes as public

## 4. Browser session handling

- [ ] 4.1 Implement login: forward credentials to `iam-service`, set an HTTP-only, same-site, secure session cookie
- [ ] 4.2 Keep the raw session token out of the login response body — return identity and permissions only
- [ ] 4.3 Implement logout: revoke at `iam-service`, then clear the cookie
- [ ] 4.4 Read the session from the cookie on subsequent requests, requiring no cooperation from the frontend

## 5. Authorization

- [ ] 5.1 Import the named permission constants from the shared contracts location rather than restating string literals (design D7)
- [ ] 5.2 Declare the required permission per route, and enforce it against the caller's effective permissions
- [ ] 5.3 Return 403 (distinct from 401) when authenticated but not permitted, without calling the domain service
- [ ] 5.4 Confirm a revoked permission takes effect on the next request, with no re-login

## 6. Routing and aggregation

- [ ] 6.1 Implement explicit routes for the stores and products surfaces the panel needs — no transparent `/{service}/**` proxying (design D1)
- [ ] 6.2 Report upstream failures as upstream failures, never as auth or permission errors
- [ ] 6.3 For any route combining several services, make partial failure explicit rather than returning the subset as if complete (design D8)
- [ ] 6.4 Keep business logic out — routing, auth and aggregation only; note the rule in this service's `CLAUDE.md`

## 7. Observability

- [ ] 7.1 Reuse an inbound correlation identifier when present, generate one otherwise
- [ ] 7.2 Propagate it on every downstream call and include it on every log line
- [ ] 7.3 Structured logging that never records session tokens, cookies or credentials

## 8. API contract

- [ ] 8.1 Generate the OpenAPI document covering every exposed route, its required permission, and its error responses
- [ ] 8.2 Confirm the documented response shapes are what `add-web-real-data` can code the panel's RTK Query slices against

## 9. Tests

- [ ] 9.1 Unit tests for the permission check and for the error mapping (401 / 403 / 503 / upstream failure)
- [ ] 9.2 Integration tests covering every scenario in the `api-gateway` spec, with `iam-service` running
- [ ] 9.3 **Outage test**: make `iam-service` unreachable, assert 503 rather than 401, and assert sessions still work after it recovers (design "Risks")
- [ ] 9.4 Test that no domain service is called when a request is unauthenticated or forbidden
- [ ] 9.5 Test that the session cookie is HTTP-only and that the raw token never appears in a response body

## 10. Docker, topology and CLI

- [ ] 10.1 Multi-stage Dockerfile with a repo-root build context; start via `node -r ./register-paths.js`
- [ ] 10.2 `docker-compose.yml` on `agiliz_network`, publishing a host port, with a `127.0.0.1` healthcheck
- [ ] 10.3 **Remove the published host ports** from `stores-service` and `products-service` in the same change, so there is no window where domain services are both public and unprotected (design "Migration Plan")
- [ ] 10.4 Register `gateway` in `cli/agiliz-cli`, ordered after `iam`, `stores` and `products`; update `--help` and completion candidates

## 11. Documentation

- [ ] 11.1 Write `backend/apps/gateway-service/CLAUDE.md`: routes, downstream dependencies, the no-database exception, and the no-business-logic rule
- [ ] 11.2 List the service in `backend/CLAUDE.md` and `cli/CLAUDE.md`
- [ ] 11.3 Record in `openspec/project.md` that domain services are internal-only from this change onward

## 12. Verification

- [ ] 12.1 `pnpm turbo run lint typecheck build test` green across the workspace
- [ ] 12.2 `agiliz-cli up` brings up infra, iam, stores, products and gateway healthy in order
- [ ] 12.3 Log in through the gateway, read stores, log out, and confirm the next request is rejected
- [ ] 12.4 Confirm from outside `agiliz_network` that no domain service is reachable directly
- [ ] 12.5 `openspec validate add-gateway-service --strict` passes
