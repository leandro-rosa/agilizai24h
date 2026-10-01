# backend/apps/intelligence-service

Motor de decisão Produto × Loja da Inteligência Comercial v2: para cada par,
Mix (manter, testar, avaliar retirada, dados insuficientes), Quantidade,
Operação, saldo estimado com sua confiabilidade e as três confianças — tudo
determinístico, versionado e reproduzível. Ver
[../../CLAUDE.md](../../CLAUDE.md) para as convenções do workspace backend e
[docs/commercial-intelligence-v2-design.md](../../../docs/commercial-intelligence-v2-design.md)
para o desenho aprovado. Mudança em andamento:
`openspec/changes/add-intelligence-engine-phase1` (esta fase: motor +
backtest, **sem tela, sem rota no gateway e sem "quanto levar"**).

**Lê** (nunca escreve): `supply-service` (visitas e linhas, remoções por
motivo), `sales-service` (venda mensal), `products-service` (custo, embalagem).
**Escreve**: só o próprio banco (porta de host 5446).
Sem superfície pública: nenhuma rota no gateway ainda.

## Estado do scaffold

Pronto: bootstrap Fastify, validação de env, health, `DbClientModule`,
clientes HTTP somente-leitura (`src/modules/sources/`), Docker/compose,
registro no `agiliz-cli`. **Ainda não existe** modelo de dados, motor, fila,
parâmetros nem backtest — vêm nos grupos 3 a 10 da mudança.

## Decisões que valem desde já

- **Os clientes de fonte não expõem escrita** (há teste que trava isso): este
  serviço recomenda, nunca age.
- **404 é resposta, não falha**: mês nunca importado devolve `null`; qualquer
  outra falha lança e nunca vira "sem dado" (nem zero).
- `WITH_KAFKA_BROKERS` é exigido na validação de env (gotcha do `@app/hold-it`);
  `REDIS_QUEUE_*` já são validados, mas o `HoldItModule` só entra com o grupo de
  runs.
- Nada sintético em banco real; testes de integração rodam num Postgres
  descartável.

## Testes

`pnpm test` (unitários, rodar com `--maxWorkers=2`) e `pnpm test:integration`
(Postgres descartável; nunca o banco de quem opera).
