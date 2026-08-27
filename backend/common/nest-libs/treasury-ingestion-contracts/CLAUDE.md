# common/nest-libs/treasury-ingestion-contracts

Contrato sem lógica entre `ingestion-worker-service` (produtor, 7 parsers) e
`treasury-service` (único consumidor). Ver
[add-treasury-statement-ingestion](../../../openspec/changes/add-treasury-statement-ingestion)
(ou o arquivo, se já arquivada) para o desenho completo.

## Public API

- `TREASURY_QUEUES.RAW_ROWS` — **uma** fila de saída, não uma por fonte:
  diferente de `@app/ingestion-contracts` (sales/supply/cost divergem em três
  sinks), as 7 fontes de tesouraria convergem no mesmo sink aqui, então uma
  fila por fonte só existiria para ser remontada do outro lado.
- `TREASURY_SOURCES` / `TreasurySource` — as 7 fontes mensais
  (`pagbank_statement`, `c6_statement`, `c6_invoice`, `nubank_statement`,
  `bradesco_statement`, `itau_statement`).
- `TREASURY_SOURCE_QUEUES` — a fila de ENTRADA de `ingestion-worker-service`
  por fonte (uma por parser) — nunca consumida fora daquele serviço, mas
  vive aqui porque o nome da fila é, ele mesmo, o contrato entre o
  controller que aceita o upload e o worker que processa.
- `TreasuryRawRow` — uma linha já parseada, ANTES de classificar:
  `occurredOn`, `amountCents` (sempre positivo, sinal em `direction`),
  `direction`, `counterpartyRaw`, `sourceRef`, parcela opcional, e
  `structuralHint` opcional.
- `TreasuryRawRejection` — linha que o parser não conseguiu ler.
- `TreasuryRawRowsJob` — o envelope: `schemaVersion`, `source`, `accountId`,
  `period`, `objectKey`, `rows`, `rejections`. Um job por ARQUIVO, nunca
  chunkado — um extrato mensal é centenas de linha, não milhares, então não
  existe o risco de "chunk pisa no chunk anterior" que a ingestão de
  sales/supply/cost tem.

## `structuralHint` — a peça que não é óbvia

Setado pelo PARSER, nunca por `treasury-service`, quando o FORMATO do
arquivo já responde a classificação — uma linha "Inclusão de Pagamento" da
fatura C6 é sempre `movement`, um SISPAG do Itaú é sempre `pending`,
independente de quem é o favorecido. Quando presente,
`treasury-service` usa o hint em vez de rodar a resolução por de-para
(`CounterpartyMapping`, `add-treasury-classification-model`) para aquela
linha. Mesma separação que `ingestion-worker-service` já usa para
sales/supply: interpretação de FORMATO é do parser (pode mudar se o banco
mudar o extrato), classificação de NEGÓCIO é do consumidor (estável).

## Convenção de nomes

Campos de envelope de fila são **camelCase**; campos persistidos e de HTTP
são **snake_case** — mesma convenção de `@app/ingestion-contracts`. A
tradução acontece no produtor.

## Consumers

- `ingestion-worker-service` (produz — 7 parsers, um `HoldItWorkerHost` por
  fonte).
- `treasury-service` (consome — `RawRowsWorker` → `PendingImportService`).
