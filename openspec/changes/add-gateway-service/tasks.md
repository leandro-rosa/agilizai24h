## 1. Service skeleton

- [x] 1.1 Scaffold `backend/apps/gateway-service` (`@agiliz/gateway-service`) in the workspace
- [x] 1.2 Add `build`, `dev`, `lint`, `typecheck`, `test` scripts and the shared `eslint.backend.mjs` flavour
- [x] 1.3 Typed env config validated at boot, including the base URL of every downstream service
- [x] 1.4 Liveness reachable without a session. **DESVIO**: não usa `@app/health`. O controller daquele módulo fixa um indicador Postgres e o terminus reprova o check inteiro quando qualquer indicador está down — então um serviço sem banco nunca reporta healthy por ele (verificado: 503 permanente). O gateway declara a própria liveness em vez de amarrar um cliente Postgres falso só para passar num check que não lhe diz respeito
- [x] 1.5 No database and no Prisma — state the exception to database-per-service in this service's `CLAUDE.md` (design D2)
- [x] 1.6 Do not register `HoldItModule` yet; `add-ingestion-flow` adds it when upload endpoints arrive

## 2. Downstream clients

- [x] 2.1 Build typed clients for `iam-service`, `stores-service` and `products-service` on `@app/http-client` — never raw axios or fetch
- [x] 2.2 Configure per-call timeouts and bounded retries, so one slow dependency cannot exhaust the gateway
- [x] 2.3 Map downstream transport failures to a distinct internal error type, separate from downstream 4xx responses

## 3. Authentication

- [x] 3.1 Implement session resolution by introspecting against `iam-service` on every protected request, with no caching (design D3)
- [x] 3.2 Reject missing, unknown and expired sessions as unauthenticated (401) without calling any domain service
- [x] 3.3 Return 503 when `iam-service` is unreachable, and ensure the caller's session is neither treated as invalid nor cleared (design D5) — verificado derrubando o iam-prod: sessão válida recebeu 503 e voltou a 200 após recuperação, sem novo login
- [x] 3.4 Fail closed: no request reaches a domain service when the session could not be validated for any reason (design D6)
- [x] 3.5 Mark login and health routes as public

## 4. Browser session handling

- [x] 4.1 Implement login: forward credentials to `iam-service`, set an HTTP-only, same-site, secure session cookie
- [x] 4.2 Keep the raw session token out of the login response body — return identity and permissions only
- [x] 4.3 Implement logout: revoke at `iam-service`, then clear the cookie
- [x] 4.4 Read the session from the cookie on subsequent requests, requiring no cooperation from the frontend

## 5. Authorization

- [x] 5.1 Import the named permission constants from the shared contracts location rather than restating string literals (design D7)
- [x] 5.2 Declare the required permission per route, and enforce it against the caller's effective permissions
- [x] 5.3 Return 403 (distinct from 401) when authenticated but not permitted, without calling the domain service — operador sem `stores:write` recebeu 403 em POST /stores e 200 em GET /stores
- [x] 5.4 Confirm a revoked permission takes effect on the next request, with no re-login

## 6. Routing and aggregation

- [x] 6.1 Implement explicit routes for the stores and products surfaces the panel needs — no transparent `/{service}/**` proxying (design D1)
- [x] 6.2 Report upstream failures as upstream failures, never as auth or permission errors
- [x] 6.3 For any route combining several services, make partial failure explicit rather than returning the subset as if complete (design D8) — `/overview` com products fora devolveu `products.available:false` + `complete:false`
- [x] 6.4 Keep business logic out — routing, auth and aggregation only; note the rule in this service's `CLAUDE.md`

## 7. Observability

- [x] 7.1 Reuse an inbound correlation identifier when present, generate one otherwise
- [x] 7.2 Propagate it on every downstream call and include it on every log line
- [x] 7.3 Structured logging that never records session tokens, cookies or credentials

## 8. API contract

- [x] 8.1 Generate the OpenAPI document covering every exposed route, its required permission, and its error responses
- [x] 8.2 Confirm the documented response shapes are what `add-web-real-data` can code the panel's RTK Query slices against

## 9. Tests

- [x] 9.1 Unit tests for the permission check and for the error mapping (401 / 403 / 503 / upstream failure)
- [ ] 9.2 Integration tests covering every scenario in the `api-gateway` spec, with `iam-service` running. **PARCIAL**: os cenários foram exercitados manualmente contra o stack real (401/403/503/502, revogação, falha parcial) e por 20 testes unitários, mas não há suíte `*.integration-spec.ts` automatizada — só o gateway ficou sem ela. Vale acrescentar antes do `add-web-real-data` depender destas rotas
- [x] 9.3 **Outage test**: make `iam-service` unreachable, assert 503 rather than 401, and assert sessions still work after it recovers (design "Risks") — teste de queda executado de verdade contra o container
- [x] 9.4 Test that no domain service is called when a request is unauthenticated or forbidden
- [x] 9.5 Test that the session cookie is HTTP-only and that the raw token never appears in a response body

## 10. Docker, topology and CLI

- [x] 10.1 Multi-stage Dockerfile with a repo-root build context; start via `node -r ./register-paths.js`
- [x] 10.2 `docker-compose.yml` on `agiliz_network`, publishing a host port, with a `127.0.0.1` healthcheck
- [x] 10.3 **Remove the published host ports** from `stores-service` and `products-service` in the same change, so there is no window where domain services are both public and unprotected (design "Migration Plan") — os serviços de domínio usam `expose`, não `ports`; só o gateway publica porta. Ver gap sobre os Postgres no CLAUDE.md do serviço
- [x] 10.4 Register `gateway` in `cli/agiliz-cli`, ordered after `iam`, `stores` and `products`; update `--help` and completion candidates

## 11. Documentation

- [x] 11.1 Write `backend/apps/gateway-service/CLAUDE.md`: routes, downstream dependencies, the no-database exception, and the no-business-logic rule
- [x] 11.2 List the service in `backend/CLAUDE.md` and `cli/CLAUDE.md`
- [x] 11.3 Record in `openspec/project.md` that domain services are internal-only from this change onward

## 12. Verification

- [x] 12.1 `pnpm turbo run lint typecheck build test` green across the workspace
- [x] 12.2 `agiliz-cli up` brings up infra, iam, stores, products and gateway healthy in order
- [x] 12.3 Log in through the gateway, read stores, log out, and confirm the next request is rejected
- [x] 12.4 Confirm from outside `agiliz_network` that no domain service is reachable directly — `curl` direto a stores de fora da rede recusou conexão
- [x] 12.5 `openspec validate add-gateway-service --strict` passes
