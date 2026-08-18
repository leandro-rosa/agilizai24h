# common/nest-libs/period-events-contracts

Contrato do evento "o período de uma loja mudou". Publicado por
`supply-service`; consumido por `finance-service` e `inventory-service`.

Escopo por **família de evento**, não por par de serviços: isso se espalha para
dois consumidores hoje e pode alcançar mais, então um pacote pareado (o
precedente `quote-search-match`) não generalizaria.

## Public API

- `PERIOD_EVENT_QUEUES.PERIOD_DATA_UPDATED`
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
