## 1. Worker service skeleton

- [ ] 1.1 Scaffold `backend/apps/ingestion-worker-service` (`@agiliz/ingestion-worker-service`) with no HTTP surface beyond health
- [ ] 1.2 Add `build`, `dev`, `lint`, `typecheck`, `test` scripts and the shared `eslint.backend.mjs` flavour
- [ ] 1.3 Typed env config validated at boot; liveness/readiness via `@app/health`; structured logging carrying the correlation ID from each job payload
- [ ] 1.4 Register `HoldItModule.register([...])` for the three queues plus `registerWorker({ processors })`, and set `WITH_KAFKA_BROKERS=false` in env, docker-compose and test setup
- [ ] 1.5 Its own Postgres for ingestion records (identifier, file type, store, period, status, counts, errors) — the worker owns ingestion state, no other service does

## 2. Upload endpoints on the gateway

- [ ] 2.1 Add upload routes for the three file types, each requiring a named upload permission from the shared contracts
- [ ] 2.2 Enforce a configured maximum file size and an allowed-format check at the edge, rejecting before anything is stored or queued
- [ ] 2.3 Reject Excel lock files (`~$*.xlsx`) by filename (design "Risks")
- [ ] 2.4 Require store and period as request parameters rather than inferring them from the file (design D6)
- [ ] 2.5 Store the raw file via `@app/aws`'s `S3Service` before enqueueing anything (design D2)
- [ ] 2.6 Create the ingestion record, enqueue the parse job carrying the object reference and correlation ID, and return the ingestion identifier without parsing
- [ ] 2.7 Add ingestion status and recent-ingestions routes behind a named permission
- [ ] 2.8 Register `HoldItModule` in `gateway-service` for the first time, with `WITH_KAFKA_BROKERS=false`

## 3. Parsing

- [ ] 3.1 Validate the declared file type against the workbook's header row before chunking, so a structural mismatch fails once rather than per row (design "Risks")
- [ ] 3.2 Implement a `HoldItWorkerHost` per file type, each with its own queue name and payload contract (design D1)
- [ ] 3.3 Parse workbooks with `@app/sheeter`'s `smartChunk`, reading from the stored object
- [ ] 3.4 Resolve the store via `stores-service`'s external code, failing the whole ingestion when it cannot be resolved
- [ ] 3.5 Resolve product names via `products-service`, reporting unresolved rows rather than discarding them
- [ ] 3.6 Handle the restocking workbook's one-sheet-per-visit structure, aggregating visits into the period being ingested

## 4. Removal reason parsing

- [ ] 4.1 Parse the free-text removal field into per-reason quantities, producing one quantity per named reason (design D3)
- [ ] 4.2 Produce two quantities from a mixed field such as `-6 Devolução, -3 Outro motivo` — never one combined quantity
- [ ] 4.3 Normalise reason text (case, accents, punctuation, whitespace) before matching, mirroring how product names are normalised
- [ ] 4.4 Verify parsed per-reason quantities sum to the row's reported total, failing the row on mismatch rather than adjusting it
- [ ] 4.5 Reject and report rows whose reason text is unrecognised, naming store, period, SKU and the original text — never guess a reason
- [ ] 4.6 Treat an empty removal field as no removals, while still processing the row's restock quantity

## 5. Writing to domain services

- [ ] 5.1 Accumulate a period's parsed rows and hand each sink one replacement batch, rather than letting each `smartChunk` batch replace the period and clobber the previous one (design D5, "Risks" — the subtlest failure mode here)
- [ ] 5.2 Publish normalised sales rows to `sales-service`'s queue
- [ ] 5.3 Publish normalised restock and per-reason removal rows to `supply-service`'s queue
- [ ] 5.4 Write parsed cost rows to `products-service` as dated cost versions effective from the uploaded period (design D7)
- [ ] 5.5 Import every queue payload shape from the shared contracts location — never restate them
- [ ] 5.6 Bound retries and let exhausted jobs surface through `@app/hold-it`'s failed-job visibility

## 6. Status and error reporting

- [ ] 6.1 Track ingestion status through accepted, processing, completed, partially completed and failed
- [ ] 6.2 Record per-row rejections with enough detail for an operator to fix the file: row reference and reason
- [ ] 6.3 Record accepted and rejected row counts, and make full success distinguishable from partial success (design D4)
- [ ] 6.4 Attach a human-readable error to every failure state
- [ ] 6.5 Make the ingestion record traceable to the stored file and its upload time

## 7. Tests

- [ ] 7.1 **Mixed-reason parsing fixture**: `-6 Devolução, -3 Outro motivo` produces 6 return and 3 other reason, never a 9 (the defining case, specified here as parsing and in `supply-service` as classification — both need their own test)
- [ ] 7.2 Single-reason, non-loss-only, and empty-removal-field fixtures
- [ ] 7.3 Unrecognised reason text is rejected and reported, not guessed
- [ ] 7.4 Per-reason quantities not summing to the row total fail the row
- [ ] 7.5 Unresolvable product name is reported, not dropped
- [ ] 7.6 Unknown store code fails the whole ingestion with no partial writes
- [ ] 7.7 **Multi-batch test**: a file larger than one `smartChunk` batch produces one complete period, not a period containing only the final batch (design "Risks")
- [ ] 7.8 Re-uploading the same file leaves figures unchanged; a corrected file supersedes the previous import
- [ ] 7.9 Partial success is reported as partial, and full success as full
- [ ] 7.10 Worker integration tests against a real Redis, following `@app/hold-it`'s own integration-spec pattern
- [ ] 7.11 **End-to-end test**: upload → parse → records visible in `sales-service` and `supply-service`, with status reporting completion

## 8. Docker and CLI

- [ ] 8.1 Multi-stage Dockerfile with a repo-root build context; start via `node -r ./register-paths.js`
- [ ] 8.2 `docker-compose.yml` on `agiliz_network`, no published host port
- [ ] 8.3 Register `ingestion` in `cli/agiliz-cli`, ordered after the sinks it writes to; update `--help` and completion candidates

## 9. Documentation

- [ ] 9.1 Write `backend/apps/ingestion-worker-service/CLAUDE.md`: the three queues, the reason-parsing rule, and that it owns text interpretation while `supply-service` owns classification
- [ ] 9.2 Update `gateway-service`'s `CLAUDE.md` for the upload and status routes and its first use of `@app/hold-it`
- [ ] 9.3 List the service in `backend/CLAUDE.md` and `cli/CLAUDE.md`

## 10. Verification

- [ ] 10.1 `pnpm turbo run lint typecheck build test` green across the workspace
- [ ] 10.2 `agiliz-cli up` brings up the full stack healthy
- [ ] 10.3 Upload a real restocking workbook containing a mixed-reason removal and confirm the resulting per-reason quantities match a hand-check of the file
- [ ] 10.4 Re-upload the same file and confirm figures do not double
- [ ] 10.5 `openspec validate add-ingestion-flow --strict` passes
