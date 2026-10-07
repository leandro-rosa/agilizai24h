# common/nest-libs/products-contracts

Contrato sem lógica entre `backend/apps/products-service` e quem valora um
período em dinheiro (`finance-service`, `supply-service`). Mesmo padrão de
`iam-contracts`: só tipos e constantes.

## Public API

- `Centavos` — todo valor monetário que cruza fronteira de serviço é inteiro em
  unidades menores. Nunca float.
- `BulkCostResult` — `{ as_of, resolved, unresolved, complete }`.
  **Deliberadamente não é um mapa**: um mapa convida `costs[sku] ?? 0`, que é
  como um SKU sem preço vira zero silencioso e subestima CMV e perda.
- `ResolvedCost` — além de `sku`, `product_id`, `cost_cents` e `effective_from`, traz `source` e `invoice_number` **opcionais** (de onde veio a versão de custo em vigor: `invoice`, `manual`, `catalogue_sync`, `legacy_import`…; aditivo, quem não precisa ignora e quem precisa não pode supor que existam).
- `UnresolvedCost` / `UNRESOLVED_COST_REASONS` — o motivo de
  cada SKU não resolvido.
- `assertCompleteCosts(result)` — a forma correta de consumir: quem precisa de
  um total tem que primeiro estabelecer que nada ficou sem resolver.

## Consumers

- `backend/apps/products-service` — produz o shape.
- `finance-service`, `supply-service` — consomem (ainda não existem).
