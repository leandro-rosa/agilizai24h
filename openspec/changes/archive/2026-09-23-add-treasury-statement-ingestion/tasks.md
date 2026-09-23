## 1. `treasury-service` staging model

- [x] 1.1 Add `PendingImport` model: `id`, `account_id`, `period`, `source` (enum: pagbank_statement
      | c6_statement | c6_invoice | nubank_statement | bradesco_statement | itau_statement),
      `status` (staged | confirmed | rejected), `object_key` (raw file in S3), counts
      (`line_count`, `rejected_line_count`), timestamps
- [x] 1.2 Add `PendingTransaction` model: FK to `PendingImport`, raw fields (`occurred_on`,
      `amount_cents`, `direction`, `counterparty_raw`, `source_ref`), suggested classification
      (`suggested_kind`, `suggested_category`, `suggested_nature`, `suggested_supplier_id`),
      `proof_object_key` (nullable), `likely_duplicate_of_id` (nullable, FK to `BankTransaction`)
- [x] 1.3 Add `PendingRejection` model (mirrors `ingestion-worker-service`'s `IngestionRejection`
      shape): FK to `PendingImport`, `row_reference`, `reason`, `detail`
- [x] 1.4 Migration; register `HoldItModule` in `treasury-service` with `WITH_KAFKA_BROKERS=false`
      (env, docker-compose, test setup — standing gotcha)

## 2. `treasury-service` staging endpoints

- [x] 2.1 Internal producer path — resolved to queue-based, not HTTP (design D3, consistent with
      `add-ingestion-flow`'s "no synchronous processing on the HTTP path" rule): `RawRowsWorker`
      consumes `TREASURY_QUEUES.RAW_ROWS` and calls `PendingImportService.createOrReplace`, which
      creates or replaces (design D6) the `PendingImport` for an account+period+source and its
      `PendingTransaction` rows, running each line through the classification engine
      (`add-treasury-classification-model`'s `resolveMany`) before saving. There is deliberately no
      `POST /treasury/imports` HTTP route — see treasury-service CLAUDE.md.
- [x] 2.2 On create, when the account+period+source was already `confirmed`, `createOrReplace`
      creates a *new* `PendingImport` (the `stagedExisting` lookup only matches `status: staged`)
      and `flagLikelyDuplicates` sets `likely_duplicate_of_id` on any line matching an existing
      confirmed transaction by date+amount+normalized counterparty (design D6)
- [x] 2.3 `GET /treasury/imports?period=` — list imports with status and counts
- [x] 2.4 `GET /treasury/imports/:id` — import detail with its pending transactions and rejections
- [x] 2.5 `PATCH /treasury/imports/:id/transactions/:txId` — edit a pending transaction's suggested
      classification before confirming (reviewer correction)
- [x] 2.6 `PATCH /treasury/imports/:id/transactions/:txId/proof` — attach `proof_object_key` +
      set counterparty/payee text (the Itaú SISPAG resolution path)
- [x] 2.7 `POST /treasury/imports/:id/confirm` — converts every non-rejected pending transaction
      into a real `BankTransaction` in one DB transaction, sets import `status: confirmed`
      (design D5); rejects if the import is not `staged`
- [x] 2.8 `POST /treasury/imports/:id/reject` — discards the pending transactions, sets
      `status: rejected`, keeps the raw file and the record for audit

## 3. `ingestion-worker-service` — treasury sink family

- [x] 3.1 Add `TREASURY_QUEUES`/`TREASURY_SOURCE_QUEUES` (one outbound `RAW_ROWS` queue, one
      inbound queue per source, design D3), each a `HoldItWorkerHost`
- [x] 3.2 Gateway → worker: batch-upload endpoint accepts up to six files, stores each raw file via
      `@app/aws` `S3Service` before queueing anything (mirrors `add-ingestion-flow` D2), enqueues
      one parse job per source via `ingestion-worker-service`'s `POST /treasury-imports`
- [x] 3.3 Shared money-parsing utility used by every PDF parser, with the "-R$" concatenated-sign
      case as a named unit test from the start (design D2) — plus a thousands-separator truncation
      bug found by the same suite (`findMoneyInText` "does not truncate the decimal part...")
- [x] 3.4 PagBank parser: line shapes "Pix enviado", "QR Code Pix enviado", "Pagamento de conta",
      "Cartão PagBank" (fatura, → `kind: movement`). Verb-prefix stripping added after live
      verification showed these labels were leaking into `counterpartyRaw` — see note below 3.11.
- [x] 3.5 C6 extrato parser: line shapes "Entrada PIX", "Saída PIX", "Pagamento", "Débito de
      Cartão", "Outros gastos", "Entradas", "Devolução PIX", "PGTO FAT CARTAO C6" (→
      `kind: movement`), "CDB C6 LIM.GARANT." / "EMISSAO DE CDB" / "RESGATE DE CDB" (→
      `kind: movement`), "SEGURO CONTA C6" / "JUROS CHEQUE ESP" / "IOF CHEQUE ESPECIAL" / "SIMPLES
      NACIONAL" / "RECEITA FEDERAL" (→ `kind: expense`, `category: Financeiro/Tributos`). Same
      verb-prefix stripping as 3.4.
- [x] 3.6 C6 fatura (invoice) parser: separates compras (→ `kind: expense`) from "Inclusão de
      Pagamento" / "Pagamento Fatura QR CODE" (→ `kind: movement`); "Refinanciamento Fatura -
      Parcela X/Y" lines → `kind: expense`, `category: Financeiro/Tributos` (juros/IOF embedded,
      not a new compra); cartão adicional lines (e.g. "C6 Business Final XXXX - BARBARA O
      FERNANDES") parsed identically to the cartão principal's lines
- [x] 3.7 Nubank parser: extracts lines as-is (classification, including the "pessoal, not company
      money" exclusions, is `treasury`'s mapping rules — see task 4.2, not parser logic). No verb
      vocabulary given in Anexo A for this bank, so no prefix-stripping added — same "assumed, not
      measured" gap as the rest of this parser (CLAUDE.md).
- [x] 3.8 Itaú parser: extracts "SISPAG PAGAMENTO DE FORNECEDOR" lines with no payee (spec
      requirement — staged pending, never guessed); other line types parsed normally
- [x] 3.9 Bradesco CSV parser: column-mapped (date, description, amount, direction), same
      reject-and-report contract as the PDF parsers for a row that doesn't match the expected shape
- [x] 3.10 Every parser rejects and reports a line it cannot match, naming the source and the raw
      text (spec requirement) — never assigns a default/zero value
- [x] 3.11 On parse completion, hand the source's structured rows to `treasury-service` via
      `@app/hold-it`'s `TREASURY_QUEUES.RAW_ROWS` (design D3).

      **Bug found during live verification, fixed same session**: every parser was passing the
      bank's own transaction-type label ("Pix enviado AMBEV") through as `counterpartyRaw`
      unstripped, but every seeded `exact` mapping rule stores a bare name ("AMBEV") — so no
      ordinary line ever matched a rule, and every line staged as `kind: pending`. Fixed by adding
      `stripKnownPrefix` to `statement-line.ts` (token-count match against `normalizeForMatch`
      output, longest prefix wins) and giving PagBank/C6 their own `verbPrefixes` list from Anexo A
      §3. Verified live end-to-end afterward: uploading the PagBank fixture now classifies all 4
      lines correctly (AMBEV → Estoque/cogs, fatura → movement, AGILIZ.AI LTDA → movement, POSTO →
      Combustível/operating) instead of everything but the two structurally-hinted lines staging as
      pending.

## 4. Seed additions for ingestion-specific patterns

- [x] 4.1 Add the Nubank "not company money" mapping rules (Companhia Brasileira de Distribuição
      Automotiva, iFood Pago, Rosti Serviços Administrativos), `kind: movement`,
      `category: "Pessoal"` — extends `add-treasury-classification-model`'s seed, kept here since
      these only matter once real Nubank lines are being classified
- [x] 4.2 The "AGILIZ.AI LTDA received on C6" case doesn't need its own rule: mapping resolution
      isn't scoped by account, so the existing own-entity `AGILIZ AI LTDA` rule from
      `add-treasury-classification-model` already covers it (documented in the seed migration
      rather than duplicated, since `match_text` is unique)

## 5. Gateway routes

- [x] 5.1 Batch-upload route (`POST /treasury/imports/upload`) behind `TREASURY_WRITE`, accepting
      up to six files with per-file source+account+period metadata
- [x] 5.2 Pass-through routes for the six `treasury-service` staging endpoints (2.3–2.8), read
      routes behind `TREASURY_READ`, mutating routes behind `TREASURY_WRITE`

## 6. Tests

- [~] 6.1 Fixture-based tests per PDF source — only PagBank has an actual PDF-bytes fixture
      committed to the repo (synthetic but mechanically real, see `test/fixtures/treasury/
      README.md`); the other six sources are tested against directly-constructed line arrays with
      real-measured text, not committed fixture files. Real bank exports DO now exist (§10) and
      were used directly for validation — see 10.12/10.13 — just not turned into committed binary
      fixtures; see §10.10 for the reasoning.
- [x] 6.2 The "-R$1.234,56" concatenated-sign fixture parses correctly (regression test named after
      the historical bug) — `money.spec.ts`: "finds a negative amount with the sign concatenated..."
- [x] 6.3 A line matching no known pattern is rejected and reported, not skipped
- [x] 6.4 An Itaú SISPAG line stages as `suggested_kind: pending` with no supplier
- [x] 6.5 Re-upload while staged replaces pending transactions (count matches the new parse, not
      the sum of old + new)
- [x] 6.6 Re-upload after confirmation creates a new import and flags duplicates by
      date+amount+counterparty
- [x] 6.7 Confirm converts every non-rejected pending transaction to a `BankTransaction` in one
      batch; a `reject`ed import leaves no `BankTransaction` rows
- [x] 6.8 Confirm succeeds with unresolved (`suggested_kind: pending`) lines present (same test as
      6.7's batch-conversion case: two unmapped counterparties confirm as `kind: pending`)
- [x] 6.9 C6 invoice: compra vs. pagamento vs. refinanciamento-parcela lines classify as the design
      specifies
- [x] 6.10 End-to-end: closed by §10.13 — real files for 3 sources (not all 7 in one period, but
      3 genuinely distinct file formats: PDF tab-separated, xlsx, inverted-date PDF) uploaded,
      confirmed, and hand-checked exactly against each file's own stated total through the real
      Docker stack

## 7. Docker and CLI

- [x] 7.1 Register the six new queues' env/config in `ingestion-worker-service`'s docker-compose;
      no new host ports
- [x] 7.2 `treasury-service` docker-compose gains Redis dependency (first queue user) — points at
      the shared `agiliz_network` infra Redis, not a new one

## 8. Documentation

- [x] 8.1 Update `backend/apps/ingestion-worker-service/CLAUDE.md`: the fourth sink family, the six
      queues, and that classification stays in `treasury-service` (mirrors the existing D3 note for
      why reason-parsing stays out of `supply-service`)
- [x] 8.2 Update `backend/apps/treasury-service/CLAUDE.md`: the staging model, its state machine,
      and its first use of `@app/hold-it`
- [x] 8.3 Update `backend/apps/gateway-service/CLAUDE.md` with the batch-upload and staging routes

## 9. Verification

- [x] 9.1 `pnpm turbo run lint typecheck build test` green across the workspace (87/87 tasks)
- [x] 9.2 `agiliz-cli up` brings the full stack up healthy with the new queues registered — verified
      via `treasury-dev`/`gateway-dev`/`ingestion-dev` logs (containers rebuilt one at a time due to
      a memory-constrained dev host — parallel rebuilds OOM-killed once)
- [x] 9.3 Closed by §10.13 (real files now exist, provided by Barbara 2026-08-26) — real files for
      3 sources uploaded, confirmed, and hand-checked exactly against each file's own stated total
      through the real HTTP/Docker stack.
- [x] 9.4 `openspec validate add-treasury-statement-ingestion --strict` passes

## 10. Alinhamento com arquivos reais (Barbara forneceu os arquivos em 2026-08-26)

Fecha 6.1/6.10/9.3 acima. Ver design.md D9-D11 para o raciocínio completo por trás de cada item.

- [x] 10.1 `utils/money.ts`: casador de valor BRL sem `R$` obrigatório (Itaú/C6-fatura/Nubank/
      PagSeguro-fatura precisam); endurecer `findMoneyInText` para aceitar `R$-X` (sinal depois do
      `R$`, visto no resumo da fatura PagSeguro)
- [x] 10.2 Tabela de abreviação de mês PT (`abr`, `mai`, ...) — C6-fatura e PagSeguro-fatura
- [x] 10.3 `statement-line.ts`: corrigir `stripKnownPrefix` (desalinhamento raw/normalizado quando
      um token bruto é só pontuação) — regressão via fixture do PagBank, PagBank fixture
      regenerada com o texto real medido ("Pix enviado - X")
- [x] 10.4 C6 extrato: reescrever fora de `parseStatementLines` (linhas tab-separated, ano por
      estado do cabeçalho de seção, excluir `Saldo do dia`) — validado contra os 2 arquivos reais:
      645 linhas/0 rejeições (jan-jun) e 108 linhas/0 rejeições (julho)
- [x] 10.5 C6 fatura: `parseC6Invoice` recebe `period`, resolve ano via rollover, troca pro
      casador de valor sem `R$` — validado contra os 2 arquivos reais: 37 linhas/0 rejeições
      (junho) e 41 linhas/0 rejeições (julho)
- [x] 10.6 Bradesco: worker escreve buffer em arquivo temporário; parser reescrito sobre
      `readWorkbookRows` (localiza cabeçalho por janela de busca, mapeia Crédito/Débito, ignora
      `SALDO ANTERIOR`/`Total`/segunda tabela `Saldos Invest Fácil`) — validado contra o arquivo
      real: 64 linhas/0 rejeições, soma entrada/saída bate exatamente com a linha "Total" do
      próprio arquivo (R$105.249,80 / R$79.344,59)
- [x] 10.7 Itaú: casador sem `R$`; join de lookahead até achar valor ou a próxima linha datada
      (não 1 linha fixa — arquivo real tem registro se espalhando por até 3 linhas de
      continuação); excluir linhas de saldo — validado contra o arquivo real: 276 linhas/0
      rejeições, 47 linhas SISPAG (`kind: pending`), batendo exatamente com a contagem
      independente de ocorrências reais de "SISPAG" no texto bruto
- [x] 10.8 Nubank: assembler de blocos local ao parser (estado dia+direção, sobrevive ao loop de
      páginas) — validado contra o arquivo real (22 páginas): 141 linhas, soma entrada/saída bate
      EXATAMENTE com o total que o próprio arquivo declara (R$358.574,75 / R$358.574,75). 5
      rejeições residuais são um artefato conhecido e documentado no código (duplicação de
      conteúdo do pdf-parse exatamente na borda de página) — nunca perdem dinheiro (a soma já bate
      sem elas), só descartam um fragmento órfão
- [x] 10.9 7ª fonte (fatura PagSeguro) — contrato, migration de seed da `BankAccount`, parser+worker
      novos, `app.module.ts`, frontend (`treasury.ts` + `upload/page.tsx`) — validado contra os 2
      arquivos reais: 25 linhas/0 rejeições (janeiro, soma despesa bate exatamente com o
      "Total despesas / débitos R$ 11.041,53" que o próprio arquivo declara) e 2 linhas/0
      rejeições (fevereiro)
- [~] 10.10 **Escopo ajustado**: só a fixture do PagBank foi regenerada (única que já existia como
      binário sintético end-to-end). Para as outras 6 fontes, a rede de segurança de regressão é
      o `.spec.ts` de cada parser com trechos de texto REAL medidos diretamente do arquivo (não
      inventados) — cobre a lógica de parsing tão bem quanto uma fixture binária cobriria. O que
      uma fixture binária adicionaria (provar que `pdf-parse`/`readWorkbookRows` em si funciona
      contra bytes reais) já foi coberto, de forma mais forte, pela validação interativa direta
      contra os arquivos reais (10.4-10.9) — cada uma batendo total exato onde o arquivo declara
      um. Construir 6 fixtures binárias novas (headless Chrome/ExcelJS) ficou como follow-up de
      menor prioridade, não bloqueante — 10.12/10.13 (upload real via Docker) são a forma mais
      forte de prova disponível e já estão no escopo desta seção.
- [x] 10.11 Atualizado toda menção parada a "as 6 fontes"/"6 parsers" (`treasury-ingestion-
      contracts/src/index.ts` já corrigido na 10.9; CLAUDE.md de ingestion-worker-service/
      treasury-service/treasury-ingestion-contracts, docstring do controller do gateway) — os dois
      gaps "nunca viu arquivo real" foram reescritos por completo (não só o número 6→7), incluindo
      um gap novo documentado: as regras de-para do Anexo A foram escritas contra texto DESCRITO,
      não o texto que o parser EXTRAI de verdade (achado real: "Débito de Cartão" da C6 inclui
      cidade/estado colados no nome do estabelecimento)
- [x] 10.12 Cada parser corrigido validado interativamente contra o arquivo real correspondente em
      `var/` (script ad-hoc, não commitado) — todas as 7 fontes, soma exata contra o total que o
      próprio arquivo declara onde existe um (PagBank, C6 extrato+fatura, Bradesco, Itaú, Nubank,
      PagSeguro fatura)
- [x] 10.13 Upload real de 3 fontes (C6 extrato julho, Bradesco jan-junho, fatura PagSeguro
      fevereiro — cobrindo os 3 formatos de arquivo distintos: PDF tab-separated, xlsx, PDF
      invertido) via `/treasury/imports/upload` contra o stack Docker real, conferência, confirmar,
      bater contra os arquivos reais à mão: C6 R$31.972,17/R$32.463,81, Bradesco
      R$105.249,80/R$79.344,59, PagSeguro R$5.860,46/R$71,69 — todos batendo exato contra o total
      que cada arquivo declara. Achou e corrigiu, ao vivo, um bug real e geral no gateway (ver
      design.md D11, corolário): parte de multipart desconhecida travava o request inteiro para
      sempre por nunca drenar o stream — corrigido com `part.file.resume()`
- [x] 10.14 `pnpm turbo run lint typecheck build test` limpo — 87/87 tasks, rodado com `--force`
      (sem cache) pra confirmar de verdade, não só reaproveitar cache antigo
- [x] 10.15 `openspec validate add-treasury-statement-ingestion --strict` passa
