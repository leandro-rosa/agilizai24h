# common/nest-libs/ingestion-contracts

Contrato sem lógica entre `ingestion-worker-service` (produtor) e os serviços
que persistem o que ele parseia: `sales`, `supply`, `products`.

## Public API

- `INGESTION_QUEUES` — uma fila **por tipo de arquivo/sink**, não uma
  genérica: os relatórios não compartilham schema, então um payload em união
  seria re-checado por todo consumidor e um arquivo de vendas malformado
  retentaria na mesma fila de uma planilha de custo. `SALES_TRANSACTIONS` é
  fila própria, separada de `SALES_ROWS` (mesmo arquivo de origem, sink
  diferente — ver abaixo).
- `IngestionEnvelope<T>` — `schemaVersion`, `ingestionId` (proveniência),
  `correlationId`, `storeId`, `period` (`YYYY-MM`), `rows`.
- `SalesRow`, `SupplyRestockRow`, `SupplyRemovalRow`, `CostRow`.
- `SalesTransactionRow`/`SalesTransactionsJob` (`add-sales-transaction-detail`)
  — um registro por TRANSAÇÃO, não por SKU somado como `SalesRow`. Só o
  formato de vendas por rede/por transação (Cliente, Resultado etc.) produz
  isso; o formato antigo por SKU nunca gera `SalesTransactionRow`. `result`
  vem verbatim do `Resultado` do arquivo — não só `'OK'`: uma transação
  recusada/cancelada também é publicada aqui (nunca no agregado de
  `SalesRow`), porque é o único jeito de calcular taxa de aprovação depois.
  Todo campo além de `sku`/`quantity`/`amountPaidCents`/`result` é opcional —
  o arquivo real (`ingestion-worker-service/test/fixtures/real-network-sales.xlsx`)
  tem ~26 colunas e só uma parte é lida (ver design de
  `add-sales-transaction-detail`); `CMV`/`Margem`/`Margem(%)`/`Líquido` nunca
  são lidos de propósito — `finance-service` é a única fonte de CMV do
  projeto.
- `isValidPeriod` / `PERIOD_PATTERN`.

## Convenção de nomes

Campos de envelope de fila são **camelCase**; campos persistidos e de HTTP são
**snake_case**. A tradução acontece no produtor, de propósito — nenhuma
convenção vaza para o território da outra.

## Nota sobre remoções

`SupplyRemovalRow` chega **já dividida por motivo**. `supply-service` nunca
interpreta o texto livre de "Remoções": o formato do texto é do PDV e pode
mudar; a classificação de perda é do negócio e é estável. Separar os dois
significa que um novo formato de export muda o parser, não o serviço que é dono
da regra de perda.

## Consumers

- `ingestion-worker-service` (produz).
- `sales-service` (consome `SALES_ROWS` e, desde `add-sales-transaction-detail`,
  `SALES_TRANSACTIONS` — dois consumidores/tabelas separados no mesmo
  serviço), `supply-service`, `products-service` (consomem os demais).
