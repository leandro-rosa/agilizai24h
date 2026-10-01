# common/nest-libs/period-events-contracts

Contrato do evento "o período de uma loja mudou". Publicado por
`supply-service` e `sales-service`; consumido por `inventory-service` (que encadeia
para `finance-service`) e `intelligence-service` (gatilho da atualização mensal).

Escopo por **família de evento**, não por par de serviços: isso se espalha para
dois consumidores hoje e pode alcançar mais, então um pacote pareado (o
precedente `quote-search-match`) não generalizaria.

## Public API

- `PERIOD_EVENT_QUEUES` (uma fila por assinante: `.inventory`, `.intelligence`) e
  `PERIOD_DATA_UPDATED_SUBSCRIBERS` (os publicadores iteram essa lista: assinante
  novo = fila nova aqui, sem tocar supply/sales).
- `PeriodDataUpdatedEvent` — `schemaVersion`, `storeId`, `period`, `source`,
  `correlationId`, `changedAt`.

## O evento carrega identificadores, nunca cifras

É isso que impede `supply` de saber como a reconciliação funciona. Se o evento
levasse totais de perda ou valores, mudar a fórmula da reconciliação exigiria
mudar o publicador, e os dois ficariam acoplados pelo barramento — exatamente o
acoplamento que o evento existe para evitar. Também elimina bug de payload
obsoleto: o consumidor lê o estado atual quando processa, em vez de confiar num
retrato tirado na publicação.

Entrega é **ao menos uma vez**, então recomputação no consumidor precisa ser
idempotente — requisito declarado na spec de cada consumidor, não presumido aqui.
