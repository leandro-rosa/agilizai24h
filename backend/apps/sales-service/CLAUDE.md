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
| fila `ingestion.sales-rows` | Lote de um período inteiro, de `@app/ingestion-contracts` |
| `GET /health`, `GET /docs` | Health e OpenAPI |

## Decisões que não são óbvias no código

- **O grão é (loja, período, SKU)**, não por transação. É o que o PDV realmente
  exporta; modelar um grão que o dado não sustenta seria inventá-lo. (O mock do
  painel tem forma transacional — é placeholder, não especificação.)
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

## Gaps conhecidos

- Sem autorização própria — enforcement é do gateway.
- Sem rota para reprocessar um período à mão; corrige-se reenviando o arquivo.
- `BullMQController` do `hold-it` fica exposto em `/holdit/bullmq` (default da
  lib). Como o serviço é interno à rede, não é alcançável de fora, mas vale
  desabilitar (`exposeController: false`) se algum dia for exposto.
