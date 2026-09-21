# backend/apps/sales-service

O que foi **vendido**: quantidade e receita por loja, por período, por SKU.
Uma das três entradas da reconciliação mensal. Ver
[../../CLAUDE.md](../../CLAUDE.md) para as convenções do workspace backend.

**Escrito por**: `ingestion-worker-service`, via fila BullMQ.
**Lido por**: `finance-service` (CMV), `inventory-service` (derivação de
estoque) e o painel através do `gateway-service`.

## Rotas e fila

| Superfície | Uso |
|---|---|
| `GET /sales/:storeId?period=YYYY-MM` | Linhas por SKU |
| `GET /sales/:storeId/totals?period=YYYY-MM` | Totais agregados no banco |
| `GET /sales/:storeId/transactions?period=YYYY-MM` | Detalhe por transação (`add-sales-transaction-detail`) — 404 se não houver |
| fila `ingestion.sales-rows` | Lote de um período inteiro (agregado por SKU), de `@app/ingestion-contracts` |
| fila `ingestion.sales-transactions` | Lote de transações não somadas, mesmo contrato — só existe pra vendas no formato de rede |
| fila `period.data-updated` | **Publica** quando as vendas do período mudam (só o agregado dispara isso — ver abaixo) |
| `GET /health`, `GET /docs` | Health e OpenAPI |

## `SalesTransaction` — detalhe por transação (`add-sales-transaction-detail`)

Desde essa mudança, `SalesRecord` (agregado por SKU) **não é mais o único
modelo**. `SalesTransaction` guarda um registro por transação — data/hora,
método, adquirente, bandeira, desconto, PDV, número comprador, resultado —
só para lojas/períodos ingeridos do formato de vendas por rede (que carrega
`Cliente`/`Resultado` por linha); o formato antigo por SKU nunca produz
linha nenhuma aqui. **Aditivo, nunca substitui o agregado**: os dois têm
service/worker/fila próprios (`SalesTransactionsService`/
`SalesTransactionsWorker`/`ingestion.sales-transactions`), e nada em
`SalesService`/`SalesRowsWorker` mudou.

`result` guarda o `Resultado` do arquivo **verbatim**, inclusive valores
diferentes de `'OK'` — uma transação recusada/cancelada é gravada aqui (nunca
no agregado, que continua só-`OK`), porque é o único jeito de calcular taxa
de aprovação depois. `CMV`/`Margem`/`Margem(%)`/`Líquido` do arquivo nunca
são lidos nem gravados — `finance-service` continua a única fonte de CMV do
projeto (decisão do operador, 2026-09-18).

`findPeriod` usa 404 por contagem de linha zero, sem uma tabela `IngestedPeriod`
equivalente: "nunca ingerido" e "ingerido mas sem coluna de transação" são
tratados como o mesmo resultado de propósito (ver spec de
`sales-transaction-detail`) — diferente de `SalesRecord`, onde os dois
precisam ser distinguíveis porque uma loja pode legitimamente ficar um mês
inteiro sem vender nada.

## Decisões que não são óbvias no código

- **O grão do agregado (`SalesRecord`) é (loja, período, SKU)**, não por
  transação — é o que o PDV do formato antigo exporta; modelar um grão que
  esse dado não sustenta seria inventá-lo. O formato de rede (acima) é
  genuinamente por transação, e é isso que `SalesTransaction` modela — sem
  mudar o grão do agregado, que outros serviços (finance, inventory) já
  dependem.
- **Substituição do período inteiro, em uma transação**, e não upsert linha a
  linha. Um upsert deixa para trás SKUs que o relatório corrigido não contém
  mais, então o período guarda linhas obsoletas e os totais ficam altos demais.
  Substituir torna "um SKU some do arquivo corrigido" verdade por construção. A
  transação evita período meio-substituído, estado em que toda cifra a jusante
  estaria errada sem nada indicando.
- **Idempotência sai de graça disso**: BullMQ entrega **ao menos uma vez**, e um
  job repetido converge em vez de acumular. Verificado reenfileirando o mesmo
  job: totais inalterados.
- **O lote chega como um job por período**, não linha a linha — caso contrário
  cada linha apagaria a anterior. É a falha mais sutil do desenho de ingestão.
- **`IngestedPeriod` existe só para separar "nunca ingerido" de "ingerido e sem
  vendas"**. Sem isso os dois viram conjunto vazio, e ninguém distingue upload
  faltando de mês parado. `GET` de período nunca ingerido dá 404, não zeros.
- **Receita é inteiro em centavos.** Nunca float: são somas de milhares de
  linhas, o padrão que acumula erro de ponto flutuante.
- **`SalesModule` é `@Global()`** porque `HoldItModule.registerWorker` monta os
  workers num módulo dinâmico próprio, que não importa este — sem isso o worker
  não enxergaria `SalesService`.

## Publica `period.data-updated`

Mesmas regras do `supply`: só identificadores, depois do commit, e só quando
algo mudou de fato.

Acrescentado quando a cadeia completa rodou pela primeira vez: só o `supply`
publicava, então ingerir vendas deixava `inventory` e `finance` servindo uma
cifra obsoleta — o estoque continuava marcando 91 unidades depois de 40 terem
sido vendidas, sem nada indicando. O contrato do evento já previa
`source: 'sales'`; isto é a outra metade dele.

## A armadilha do `WITH_KAFKA_BROKERS`

Primeiro serviço do repo a registrar `HoldItModule`, então a armadilha deixou
de ser teórica. Ela é tratada **duas vezes**, de propósito:

1. `HoldItModule.register([...], { withKafkaBrokers: false })` — explícito no
   código, então o serviço não quebra por env var esquecida.
2. `WITH_KAFKA_BROKERS` é **obrigatória** na validação de env — um deploy que
   esqueça falha alto na configuração, em vez de misteriosamente no DI.

Sem nenhum dos dois, o default é `true`, o que puxa `HoldItKafkaBroker` →
`HoldItElasticsearchService`, que ninguém provê, e o NestJS morre no startup.

## Regra: dependências de lib são do app consumidor

As libs `@app/*` são compiladas **dentro** do `dist` do app, então o Node
resolve a partir do `node_modules` do app — que não alcança o da lib. Logo,
**toda dependência de runtime de uma lib precisa também estar declarada no
app**. Este serviço declara as do `hold-it` (`@bull-board/*`, `bullmq-otel`,
`kafkajs`, `avsc`, `@elastic/elasticsearch`) mesmo sem usar Kafka: os imports
de topo são avaliados no carregamento do módulo, independentemente do provider
ficar de fora.

## Testes

- Unitários (`pnpm test`): worker e validação de env.
- Integração (`pnpm test:integration`): precisa do **Redis do `infra`** e do
  Postgres deste serviço. Cobre o contrato de idempotência contra o banco e o
  caminho real da fila — job enfileirado no Redis, consumido pelo worker real,
  aterrissando no Postgres, incluindo que uma entrega repetida não dobra as
  cifras (BullMQ é ao-menos-uma-vez) e que um job malformado falha sem escrever
  nada.

```bash
cli/agiliz-cli up -i infra
docker start agiliz-sales-postgres
DATABASE_URL=... REDIS_QUEUE_HOST=127.0.0.1 REDIS_QUEUE_PORT=6390 \
  WITH_KAFKA_BROKERS=false pnpm test:integration
```

## Gaps conhecidos

- Sem autorização própria — enforcement é do gateway.
- Sem rota para reprocessar um período à mão; corrige-se reenviando o arquivo.
- `BullMQController` do `hold-it` fica exposto em `/holdit/bullmq` (default da
  lib). Como o serviço é interno à rede, não é alcançável de fora, mas vale
  desabilitar (`exposeController: false`) se algum dia for exposto.
