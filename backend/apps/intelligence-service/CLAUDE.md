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

**Lê**: `supply-service` (visitas e linhas, remoções por
motivo), `sales-service` (venda mensal), `products-service` (custo, embalagem).
**Escreve**: o próprio banco (porta de host 5446) e, **numa única exceção**, a embalagem (`packageType`) em `products-service`, só quando o dono dispara a importação da planilha de preços com `apply: true`. O motor e os clientes de fonte nunca escrevem em outro serviço (`src/modules/sources/no-writes.spec.ts` falha se qualquer outro arquivo fizer isso).
Sem superfície pública: nenhuma rota no gateway ainda.

## Estado

Pronto: bootstrap Fastify, validação de env, health, `DbClientModule`,
clientes HTTP somente-leitura (`src/modules/sources/`), Docker/compose,
registro no `agiliz-cli`, **modelo de dados** (`prisma/schema.prisma`: versões de
parâmetros, baseline, agenda por loja, flag de caixa fechada, runs,
recomendações, backtest) e **parâmetros** (`src/modules/parameters/`). **Ainda
não existe** motor, fila nem backtest — vêm nos grupos 5 a 10 da mudança.

## Parâmetros (`/parameters`, `/schedules`) — rotas internas, sem gateway

- Tudo que molda uma recomendação mora aqui, **no backend, versionado e só-append**:
  mudar um valor cria uma versão NOVA a partir da atual (`POST /parameters`
  com `values` parcial + `note`), validada como um todo; nenhuma versão é editada
  ou apagada. `GET /parameters/current` devolve cada parâmetro rotulado
  `provisional` ou não; `GET /parameters/versions[/:id]` lê o histórico. A versão 1
  nasce dos defaults na primeira subida.
- **Tolerância** (decisão do dono, 2026-09-30): aceita diferença de até o MAIOR entre
  10% do saldo e 3 unidades. Esses dois valores **não** são provisórios; os demais
  são — em especial a regra de contagens (`windowCounts` 3, `minCounts` 1,
  `maxAgeDays` 45), que fica provisória e **sem combinação escolhida** até o
  relatório de sensibilidade sobre a cobertura real.
- **Validação** recusa valor negativo/não numérico, `minCounts > windowCounts`
  (nenhum saldo seria verificável), faixas de confiança invertidas, "maioria" que
  não é maioria e dia da semana inválido, listando todos os problemas de uma vez.
- **Dias de visita**: padrão segunda, terça, quinta e sexta (ISO 1,2,4,5), com
  override por loja (`PUT /schedules/:storeId`, só-append, a última linha vence).
  Nunca inferidos do histórico.
- **Baseline** (`qtd itens por loja`): UM valor por SKU, vale para todas as lojas,
  histórico só-append; o vigente é a última linha já em vigor (empate na mesma data
  → a mais recente). **Flag "caixa fechada"**: guardada e exibida, nunca lida por
  cálculo nenhum.

## Importação da planilha de preços (`POST /baselines/import`)

- **Ensaio por padrão**: sem `apply: true` nada é gravado; o relatório separa aceitas,
  rejeitadas, **conflitos**, resolvidas, SKUs fora do catálogo e o que mudaria.
  Só se aplica depois de o dono rever esse relatório.
- Lê só `SKU`, `qtd itens por loja` (baseline, **um por SKU, vale para todas as lojas**) e
  `Medida` (`unidade`/`caixa`/`fardo`). SKU `6024.0` e `6024` são o mesmo; linha sem
  SKU (preenchimento de fim de planilha, `#ERROR!`) é contada, não rejeitada.
- **SKU repetido com valores iguais** colapsa (9987). **Com valores diferentes** é
  conflito: **não entra** a menos que `resolutions` diga a escolha do dono entre os
  valores que as linhas realmente têm (6024 → `unidade`, decisão de 2026-10-01).
- Baseline zero, não inteiro, Medida desconhecida e SKU ilegível são **rejeitados com o
  motivo**, nunca chutados. Mesmo produto sob SKUs diferentes (6030/100018…) não é
  duplicata: cada SKU tem o seu baseline.
- **Histórico só-append**: reimportar valor igual não adiciona linha; valor novo adiciona e
  mantém o anterior. A embalagem só é escrita onde difere; falha de um produto é
  relatada e não derruba os outros. SKU fora do catálogo mantém o baseline e não recebe
  embalagem. Unidades por embalagem **não** vêm da planilha e ficam desconhecidas.

## Decisões que valem desde já

- **Os clientes de fonte não expõem escrita** (há teste que trava isso): este
  serviço recomenda, nunca age. A importação de embalagem é a exceção, isolada e disparada pelo dono.
- **404 é resposta, não falha**: mês nunca importado devolve `null`; qualquer
  outra falha lança e nunca vira "sem dado" (nem zero).
- `WITH_KAFKA_BROKERS` é exigido na validação de env (gotcha do `@app/hold-it`);
  `REDIS_QUEUE_*` já são validados, mas o `HoldItModule` só entra com o grupo de
  runs.
- Nada sintético em banco real; testes de integração rodam num Postgres
  descartável.

## Testes

`pnpm exec jest --maxWorkers=2` (unitários) e `pnpm test:integration:db`
(sobe um Postgres **descartável**, migra do zero e remove ao sair). Os specs de
integração esvaziam as tabelas e **se recusam a rodar** contra algo que pareça o
banco real (`test/support/reset-db.ts`); nunca aponte `DATABASE_URL` para o banco
de quem opera.
