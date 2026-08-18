## 1. Gateway

- [x] 1.1 Add a stub upstream HTTP server the suite controls, so IAM and domain responses (valid, invalid, slow, unreachable) can be driven deterministically without containers — stub HTTP real em socket real, então o request atravessa de verdade `@app/http-client`, o guard, o filtro e o Fastify
- [x] 1.2 Boot the real Nest application with supertest, so the global guard, the exception filter and cookie handling are exercised together rather than as units
- [x] 1.3 Assert 401 for missing and for invalid sessions, and that no upstream call is made in either case
- [x] 1.4 Assert 403, distinct from 401, when authenticated but lacking the route's permission
- [x] 1.5 Assert 503 — not 401 — when the identity service is unreachable, and that the session still works once it recovers — coberto por três casos: upstream com erro, upstream lento demais, e recuperação com a mesma sessão
- [x] 1.6 Assert 502 when a domain service is unreachable, and that a domain 404 is forwarded as 404 rather than as a gateway error
- [x] 1.7 Assert the session cookie is HTTP-only and that the raw token never appears in a response body
- [x] 1.8 Assert `/health` and `/docs` answer without a session
- [x] 1.9 Assert an aggregated route reports partial failure explicitly rather than returning the subset

## 2. Sales worker

- [x] 2.1 Boot the app against real Redis and Postgres, enqueue through the real broker, and wait for the worker to finish
- [x] 2.2 Assert the rows land with their provenance
- [x] 2.3 Assert a re-delivered identical job does not double figures — BullMQ is at-least-once, so this is the property that matters — job reentregue deixou os totais em 10/5000
- [x] 2.4 Assert a corrected batch replaces the period and drops SKUs it no longer contains
- [x] 2.5 Assert a malformed job fails rather than writing partial data
- [x] 2.6 Clean up the queue as well as the database, following `@app/hold-it`'s own integration-spec pattern

## 3. Supply worker

- [x] 3.1 Same queue-path coverage as sales, against real Redis and Postgres
- [x] 3.2 Assert the period-data-updated event is published on a real change
- [x] 3.3 Assert it is suppressed when a re-delivered job changes nothing — verificado contra a fila de eventos real, não com spy: o que se quer evitar é tempestade a jusante, propriedade do que chega no Redis
- [x] 3.4 Assert the event carries identifiers only — no monetary figures
- [x] 3.5 Assert a job with an unrecognised reason fails and writes nothing

## 4. Running them

- [x] 4.1 Document how to bring up the infrastructure these need, and note that the gateway suite needs none — instruções no `CLAUDE.md` de cada serviço; a do gateway registra que não precisa de infra
- [x] 4.2 Confirm each suite passes, and remove the gap each service's `CLAUDE.md` records
- [x] 4.3 Confirm the unit tiers still pass and the workspace pipeline is green
- [x] 4.4 `openspec validate add-worker-integration-tests --strict` passes
