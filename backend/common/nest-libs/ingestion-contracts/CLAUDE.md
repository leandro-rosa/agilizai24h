# common/nest-libs/ingestion-contracts

Contrato sem lógica entre `ingestion-worker-service` (produtor) e os serviços
que persistem o que ele parseia: `sales`, `supply`, `products`.

## Public API

- `INGESTION_QUEUES` — uma fila **por tipo de arquivo**, não uma genérica: os
  três relatórios não compartilham schema, então um payload em união seria
  re-checado por todo consumidor e um arquivo de vendas malformado retentaria
  na mesma fila de uma planilha de custo.
- `IngestionEnvelope<T>` — `schemaVersion`, `ingestionId` (proveniência),
  `correlationId`, `storeId`, `period` (`YYYY-MM`), `rows`.
- `SalesRow`, `SupplyRestockRow`, `SupplyRemovalRow`, `CostRow`.
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

- `ingestion-worker-service` (produz) — ainda não existe.
- `sales-service`, `supply-service`, `products-service` (consomem).
