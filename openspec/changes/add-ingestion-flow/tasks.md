## 1. Worker service skeleton

- [x] 1.1 Scaffold `backend/apps/ingestion-worker-service` (`@agiliz/ingestion-worker-service`) with no HTTP surface beyond health
- [x] 1.2 Add `build`, `dev`, `lint`, `typecheck`, `test` scripts and the shared `eslint.backend.mjs` flavour
- [x] 1.3 Typed env config validated at boot; liveness/readiness via `@app/health`; structured logging carrying the correlation ID from each job payload
- [x] 1.4 Register `HoldItModule.register([...])` for the three queues plus `registerWorker({ processors })`, and set `WITH_KAFKA_BROKERS=false` in env, docker-compose and test setup
- [x] 1.5 Its own Postgres for ingestion records (identifier, file type, store, period, status, counts, errors) — the worker owns ingestion state, no other service does

## 2. Upload endpoints on the gateway

- [x] 2.1 Add upload routes for the three file types, each requiring a named upload permission from the shared contracts
- [x] 2.2 Enforce a configured maximum file size and an allowed-format check at the edge, rejecting before anything is stored or queued
- [x] 2.3 Reject Excel lock files (`~$*.xlsx`) by filename (design "Risks")
- [x] 2.4 Require store and period as request parameters rather than inferring them from the file (design D6)
- [x] 2.5 Store the raw file via `@app/aws`'s `S3Service` before enqueueing anything (design D2)
- [x] 2.6 Create the ingestion record, enqueue the parse job carrying the object reference and correlation ID, and return the ingestion identifier without parsing
- [x] 2.7 Add ingestion status and recent-ingestions routes behind a named permission
- [ ] 2.8 Register `HoldItModule` in `gateway-service` for the first time, with `WITH_KAFKA_BROKERS=false`. **NÃO FEITO, POR DECISÃO**: o gateway não enfileira nada — ele grava o arquivo no S3 e chama `ingestion-worker-service` por HTTP, que é quem cria o registro e enfileira. Assim o estado da ingestão mora num serviço só, e o gateway continua sem lógica de domínio. Se essa decisão for aceita, a tarefa deixa de existir; se não, é o gateway que passa a registrar HoldItModule

## 3. Parsing

- [x] 3.1 Validate the declared file type against the workbook's header row before chunking, so a structural mismatch fails once rather than per row (design "Risks") — cabeçalhos lidos e conferidos antes do chunking, com os nomes esperados no erro
- [x] 3.2 Implement a `HoldItWorkerHost` per file type, each with its own queue name and payload contract (design D1)
- [x] 3.3 Parse workbooks with `@app/sheeter`'s `smartChunk`, reading from the stored object
- [ ] 3.4 Resolve the store via `stores-service`'s external code, failing the whole ingestion when it cannot be resolved. **NÃO IMPLEMENTADO**: a loja vem do request (design D6), então nada no fluxo resolve código externo hoje. `UpstreamClient.resolveStoreByExternalCode` existe e está testável, mas não é chamado. Falta decidir se o parser deve **conferir** o código do arquivo contra a loja informada — que é o que pegaria um upload feito na loja errada
- [x] 3.5 Resolve product names via `products-service`, reporting unresolved rows rather than discarding them
- [x] 3.6 Handle the restocking workbook's one-sheet-per-visit structure, aggregating visits into the period being ingested — o `smartChunk` percorre todas as abas e marca `worksheetName`, e o staging acumula as linhas de todas elas no mesmo período. Não há teste com workbook multi-aba real

## 4. Removal reason parsing

- [x] 4.1 Parse the free-text removal field into per-reason quantities, producing one quantity per named reason (design D3)
- [x] 4.2 Produce two quantities from a mixed field such as `-6 Devolução, -3 Outro motivo` — never one combined quantity — verificado por teste: `-6 Devolução, -3 Outro motivo` produz 6+3, e nunca um 9
- [x] 4.3 Normalise reason text (case, accents, punctuation, whitespace) before matching, mirroring how product names are normalised
- [x] 4.4 Verify parsed per-reason quantities sum to the row's reported total, failing the row on mismatch rather than adjusting it — só aqui pode ser conferido: `supply-service` nunca recebe um total
- [x] 4.5 Reject and report rows whose reason text is unrecognised, naming store, period, SKU and the original text — never guess a reason
- [x] 4.6 Treat an empty removal field as no removals, while still processing the row's restock quantity

## 5. Writing to domain services

- [x] 5.1 Accumulate a period's parsed rows and hand each sink one replacement batch, rather than letting each `smartChunk` batch replace the period and clobber the previous one (design D5, "Risks" — the subtlest failure mode here) — **é a razão do staging**; teste dedicado prova que 3 chunks geram 1 handover com todas as linhas, e que só um chunk se vê como último
- [x] 5.2 Publish normalised sales rows to `sales-service`'s queue
- [x] 5.3 Publish normalised restock and per-reason removal rows to `supply-service`'s queue
- [x] 5.4 Write parsed cost rows to `products-service` as dated cost versions effective from the uploaded period (design D7)
- [x] 5.5 Import every queue payload shape from the shared contracts location — never restate them
- [ ] 5.6 Bound retries and let exhausted jobs surface through `@app/hold-it`'s failed-job visibility. **NÃO CONFIGURADO**: o `hold-it` traz `attempts: 0` como default, ou seja, job não é retentado. Falha aparece no log via `HoldItWorkerHost.onFailed`, mas não foi decidido nem configurado quantas tentativas cada fila merece

## 6. Status and error reporting

- [x] 6.1 Track ingestion status through accepted, processing, completed, partially completed and failed
- [x] 6.2 Record per-row rejections with enough detail for an operator to fix the file: row reference and reason
- [x] 6.3 Record accepted and rejected row counts, and make full success distinguishable from partial success (design D4) — `partially_completed` vs `completed`, com contagem de aceitas/rejeitadas
- [x] 6.4 Attach a human-readable error to every failure state
- [x] 6.5 Make the ingestion record traceable to the stored file and its upload time

## 7. Tests

- [x] 7.1 **Mixed-reason parsing fixture**: `-6 Devolução, -3 Outro motivo` produces 6 return and 3 other reason, never a 9 (the defining case, specified here as parsing and in `supply-service` as classification — both need their own test)
- [x] 7.2 Single-reason, non-loss-only, and empty-removal-field fixtures
- [x] 7.3 Unrecognised reason text is rejected and reported, not guessed
- [x] 7.4 Per-reason quantities not summing to the row total fail the row
- [ ] 7.5 Unresolvable product name is reported, not dropped. **NÃO TESTADO**: implementado no `StagedRowsWorker`, sem teste que o cubra
- [ ] 7.6 Unknown store code fails the whole ingestion with no partial writes. **NÃO SE APLICA AINDA** — depende de 3.4
- [x] 7.7 **Multi-batch test**: a file larger than one `smartChunk` batch produces one complete period, not a period containing only the final batch (design "Risks"). Coberto pelo teste de acumulação, que exercita N chunks diretamente em vez de gerar um arquivo grande
- [ ] 7.8 Re-uploading the same file leaves figures unchanged; a corrected file supersedes the previous import. **NÃO TESTADO AQUI**: a idempotência é propriedade dos sinks e está testada em `sales` e `supply`; falta o teste que prova que dois uploads do mesmo arquivo chegam lá como dois batches equivalentes
- [x] 7.9 Partial success is reported as partial, and full success as full
- [ ] 7.10 Worker integration tests against a real Redis, following `@app/hold-it`'s own integration-spec pattern. **NÃO ESCRITO**: a suíte de integração deste serviço exercita a acumulação de chunks direto contra o Postgres, com o broker stubado. O caminho de fila de verdade não é coberto aqui
- [ ] 7.11 **End-to-end test**: upload → parse → records visible in `sales-service` and `supply-service`, with status reporting completion. **NÃO EXECUTADO**: falta o e2e com arquivo real (upload → S3 → parse → sinks). As peças estão cobertas isoladamente — parser 23 testes, acumulação de chunks 7, e o caminho de fila de cada sink na própria suíte —, mas a costura completa nunca rodou

## 8. Docker and CLI

- [x] 8.1 Multi-stage Dockerfile with a repo-root build context; start via `node -r ./register-paths.js`
- [x] 8.2 `docker-compose.yml` on `agiliz_network`, no published host port
- [x] 8.3 Register `ingestion` in `cli/agiliz-cli`, ordered after the sinks it writes to; update `--help` and completion candidates

## 9. Documentation

- [x] 9.1 Write `backend/apps/ingestion-worker-service/CLAUDE.md`: the three queues, the reason-parsing rule, and that it owns text interpretation while `supply-service` owns classification
- [x] 9.2 Update `gateway-service`'s `CLAUDE.md` for the upload and status routes and its first use of `@app/hold-it`
- [x] 9.3 List the service in `backend/CLAUDE.md` and `cli/CLAUDE.md`

## 10. Verification

- [x] 10.1 `pnpm turbo run lint typecheck build test` green across the workspace
- [ ] 10.2 `agiliz-cli up` brings up the full stack healthy. **NÃO EXECUTADO**: nem a imagem deste serviço foi construída, nem a stack completa subiu. O typecheck/lint/build passam, mas nada deste serviço rodou em container
- [ ] 10.3 Upload a real restocking workbook containing a mixed-reason removal and confirm the resulting per-reason quantities match a hand-check of the file. **NÃO EXECUTADO** — depende do e2e acima
- [ ] 10.4 Re-upload the same file and confirm figures do not double. **NÃO EXECUTADO** — depende do e2e acima
- [x] 10.5 `openspec validate add-ingestion-flow --strict` passes
