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

Pronto: bootstrap, env, health, clientes de leitura, Docker, `agiliz-cli`,
modelo de dados, parâmetros, o **motor** e as **runs** (fila + persistência +
leitura), o **backtest** (fila + persistência + relatório legível) e a **atualização mensal**
(histórico preservado, frescor declarado). Sem rota no gateway e sem tela.

## Runs (`/runs`) — rotas internas

- `POST /runs {rangeFrom, rangeTo, asOf?}` só **registra** a run (versão do motor + versão
  dos parâmetros) e enfileira **um job por loja** (`intelligence.engine-store`); o
  trabalho pesado nunca roda na requisição. `GET /runs/:id` mostra status, a versão de
  parâmetros usada **com seus valores**, o resultado por loja e o resumo de cobertura;
  `GET /runs/:id/results?storeId=&sku=&coverage=` lê os resultados.
- **Loja que não pôde ser lida** fica `skipped` com o motivo e **não** vira "zero
  recomendações" nem derruba as outras. Loja sintética (nome com `[teste]`,
  `sintético`…) é `excluded` e listada; SKU sintético é pulado.
- **`dataThrough` sai dos dados**, não de uma data declarada: o último mês terminado antes
  de `asOf` em que suprimento **e** venda existem para a fração de lojas configurada
  (`refresh.availableStoreShare`, 90%). Nunca um mês que a run não leu. É nulo até acabar.
- **Idempotência**: job reentregue substitui as linhas da loja (não duplica); a run é
  finalizada **uma vez só** (claim atômico `running → finalizing`); run finalizada não é
  reprocessada; run nunca é alterada por outra depois de concluída.
- A **evidência de rede** (retirada em mais da metade das lojas expostas; escopo do dano)
  precisa de todas as lojas, então é aplicada na finalização, não por loja.
- **Limites desta fase**: "SKU rejeitado na importação" e "baseline em conflito" ainda não
  chegam como entrada (nenhuma fonte somente-leitura os expõe por loja), então esses dois
  conflitos não disparam; o motor já os trata quando vierem.
- `asOf` padrão é agora; sem importar setembro, uma run "ao vivo" tem toda contagem
  antiga (`last_count_too_old`) — rode com `asOf` do fim do último mês importado.

## Atualização mensal (`src/modules/refresh/`) — rotas internas

- **Mês disponível** = terminou antes do instante de referência **e** suprimento **e** venda
  importados para pelo menos `refresh.availableStoreShare` (90%) das lojas **ativas** (com visita
  nos 3 meses anteriores, sem as sintéticas). `dataThrough` = o último disponível; mês terminado
  e não disponível = `pendingImport` (com as contagens). A regra é uma só (`availability.ts`) e a
  `dataThroughOf` das runs a reutiliza. A sonda lê os serviços de origem do mês mais novo para
  trás e para no primeiro disponível; resposta lembrada por 60 s.
- **Gatilho**: fila `period.data-updated.intelligence` (assinante novo em
  `@app/period-events-contracts`; supply e sales publicam nela sem mudar). O worker do evento é
  barato: só agenda **uma** checagem por janela de 60 s (`REFRESH_DEBOUNCE_SECONDS`) com `jobId`
  da janela, então centenas de eventos de uma importação viram um job; evento que chega durante a
  checagem cai na janela seguinte. A checagem pergunta se `dataThrough` passou do conjunto atual e,
  se sim, abre **um** conjunto. Manual: `POST /refresh {month?, force?}` (mês precisa ter
  terminado; `force` só para mês que já tem conjunto concluído).
- **Conjunto** (`refresh_set`): uma run do motor sobre o histórico (de `INTELLIGENCE_HISTORY_START`,
  padrão 2026-01) até o mês + o backtest (cobertura e sensibilidade vêm dele) via `BACKTEST_PORT`,
  nessa ordem. `asOf` = primeiro instante depois do mês (a data é do dado, não do relógio). Um
  poll (`intelligence.refresh-advance`, 15 s) inicia o backtest quando a run termina e promove o
  conjunto quando o backtest termina. Falha da run, do backtest, mês não lido ou 6 h sem
  terminar = conjunto `failed` com o motivo; **o conjunto atual não muda**.
- **Histórico só-append**: conjunto concluído nunca é alterado nem apagado; carrega período
  (`dataThrough`, o que a run realmente leu), versão do motor, versão dos parâmetros e
  `computedAt`. O "atual" é a única linha mutável (`refresh_pointer`), move só quando o conjunto
  inteiro termina e nunca para um `dataThrough` mais antigo. Um conjunto por mês (running/concluído),
  garantido por lock consultivo do Postgres.
- **Leituras**: `GET /refresh/status` (atual, em andamento, última falha, `freshness`),
  `GET /refresh/sets`, `GET /history/:storeId/:sku` (o resultado do par em cada conjunto concluído,
  em ordem; `result: null` se o par não existe naquele conjunto).
- **Frescor** em toda run/resultado/status: `dataThrough`, `computedAt`, `outOfDate` + `monthsLagged`
  quando já existe mês disponível posterior, `pendingImport`; `GET /runs/:id` e `/runs/:id/results`
  trazem o bloco. Fonte ilegível = `status: unknown` (nunca "em dia"); nada computado =
  `not_computed`. Nunca se afirma cobrir mês não coberto.
- **Conjunto com loja ignorada** é promovido, mas `currentStoresSkipped` em `/refresh/status`
  mostra quantas; decisão a confirmar com o dono (bloquear impediria atualizar com uma loja fora do ar).
- `BACKTEST_PORT` hoje é um placeholder que falha alto (`NotYetAvailableBacktest`): sem o módulo
  de backtest todo conjunto vira `failed`, nunca "concluído sem backtest".

## Backtest (`/backtests`) — rotas internas (`src/modules/backtest/`)

Repete o motor sobre a história para o dono LER antes de qualquer tela. **Não decide nada**:
sem aprovado/reprovado, sem limiar congelado, sem parâmetro alterado.

- `POST /backtests {rangeFrom, rangeTo, dataThrough?, asOf?, parameterVersionId?}` só registra
  (`backtest_run`, status em `report.status`) e enfileira **um job** (`intelligence.backtest`);
  `GET /backtests`, `GET /backtests/:id` (JSON), `GET /backtests/:id/summary` (texto),
  `GET /backtests/:id/results?storeId=&sku=&origin=&action=&coherence=`. `BacktestService`
  implementa `BACKTEST_PORT` (`start` volta na hora; `status` só diz `completed` quando
  resultados + relatório foram gravados **na mesma transação**).
- **Origens**: todo início de mês com ≥ 8 semanas de história (desde a 1ª visita) até
  `dataThrough` (jan–ago → abr..ago). Cada loja é lida **uma vez** (`RunInputBuilder`) e cada
  origem é um **corte** (`HistoryView`): só entra o que terminou ANTES da origem; teste com
  espião (`latestDateRead`) e de invariância (adulterar o futuro não muda o resultado).
  `asOf` do motor = origem. Evidência de rede não é reexecutada (cada par é julgado sozinho).
- **Por par com dados suficientes** (fora de `insufficient_history`): baseline vigente na
  origem (histórico do baseline; sem histórico → baseline de registro **marcado**
  `ofRecordQuantityOfTheTimeUnknown`; hoje é TODO o período, o histórico só começa em set/2026),
  quantidade/`H`/ação/Mix e, depois: vendido, perda por motivo, rupturas (intervalos
  censurados), ciclos, resultado econômico (margem − custo da perda, cada perda uma vez, custo
  = versão única atual). A perda mensal é espalhada nos ciclos pelas remoções registradas nas
  visitas (estimativa; dito no resultado).
- **Erro de previsão = UMA métrica** (WAPE): previsto (taxa mediana × dias dos intervalos não
  censurados) contra observado entre visitas; censurados contados à parte e fora do erro.
- **Coerência** (`coherence.ts`, D13): "coerente" = só "os dados seguintes são compatíveis sob
  os critérios mostrados", sempre `label: 'estimate'`, com critérios ao lado; critérios em
  conflito ou menos ciclos que o mínimo → `inconclusive`. Redução mostra SEPARADOS perdas,
  vendas, ciclos acima da quantidade sugerida, perda potencialmente evitável (teto =
  baseline − sugerida) e venda em risco. "Em risco" só pesa se ≥ `backtest.salesAtRiskShare`
  das vendas (desvio conservador de D13: sem perda e com pouco acima → inconclusivo, não
  incoerente). Teste varre todo texto/chave: nada diz correto/provado/aprovado/veredito.
- **Cobertura** (5 categorias exclusivas, soma = total; `buildCoverageReport` recusa par
  repetido) e **sensibilidade das regras de contagem** (contagens 1/2/3/5 × mínimo 1/2/3 × idade
  30/45/60/90 × tolerância 5%/2, 10%/3, 15%/5; 108 combinações válidas, as inválidas
  `minCounts > windowCounts` são listadas, não sumidas; as configuradas marcadas
  `configured`, adicionadas se fora da grade). Reusa `classifyTolerance`/`coverageCategory` do
  motor; **não escolhe nem recomenda** (nenhuma chave "recommended/best/chosen").
- Todo agregado traz `covers {origins, pairs, cycles}`. A limitação do baseline de época vem em
  destaque. O JSON não tem veredito nem limiar.
- **Idempotência**: o job só roda com status `running`; reentrega depois de concluído é
  ignorada; escrita sob `pg_advisory_xact_lock`; falha só vira `failed` na ÚLTIMA tentativa.
- Medido nos dados reais jan–ago (21 lojas): ~7,5 s, ~4,8 mil resultados (~10 MB), relatório ~100 KB.

## O motor (`src/modules/engine/`, funções puras)

`runPair(input)` devolve, para um Produto × Loja, tudo do desenho: ciclos,
demanda, padrão, presença, Mix, Quantidade, Operação, economia, saldo estimado
com tolerância, conflitos, cobertura, três confianças e a explicação
(fatos, evidências a favor/contra, limitações). **Não lê banco, relógio nem
rede**: a data de referência é entrada, e há teste que varre os imports e falha
se o motor passar a poder agir. Mesmo input + `ENGINE_VERSION` + parâmetros =
mesmo resultado. Nenhum campo diz "quanto levar" (isso é a Fase 4).

- **Intervalos antes de ciclos**: entre duas aparições consecutivas do SKU,
  consumo = `saldo_final(k) − saldo_anterior(k+1)`. Saldo zero antes da visita =
  **censurado** (consumo é piso, nunca demanda); saldo que sobe sem evento =
  **rise** (conflito, nunca consumo negativo); prateleira vazia o tempo todo não
  diz nada. Intervalo menor que 1 dia funde com o vizinho.
- **Demanda**: só intervalos não censurados, pesados por dias e por recência
  (meia-vida 56 d), p25/p50/p80. Ruptura frequente só levanta o p80 pelo piso.
  Nunca média simples de venda mensal.
- **Quantidade** = comparação do baseline com a banda `[ceil(p50·(H+L)), ceil(p80·(H+L)+z·σ·√(H+L))]`,
  sempre dita para um `H`. Nunca arredonda para múltiplo de caixa. Perda sozinha
  não reduz; ausência de ruptura não afirma falta. Excesso **e** ruptura juntos
  = "sem evidência", não escolhe lado.
- **Mix**: retirada só é *avaliada*, nunca automática, e só com exposição
  suficiente + baixa demanda recorrente + (contribuição baixa/negativa **ou**
  validade recorrente). Da REDE exige mais da metade das lojas expostas.
  "Nunca testado" não é baixa aderência; produto novo é `test`.
- **Janela de perdas/validade** = últimos 3 meses **em que o SKU esteve presente**
  (abastecido, vendido ou removido), não 3 meses de calendário.
- **Saldo**: estimativa (nunca "estoque"); tolerância = o MAIOR entre 10% do saldo
  e 3 unidades; gate liberado só `within_tolerance` + sem conflito + já teve
  estoque. Aberto ou fechado, o saldo continua visível, com o rótulo
  "saldo estimado — baixa confiabilidade" quando fechado.
- **Cobertura**: cada par cai em UMA categoria (histórico insuficiente →
  dados conflitantes → confiável / não confiável / sem contagem suficiente).

### Achados ao rodar nos exemplos reais (ver `engine.examples.spec.ts`)

Com os parâmetros provisórios, 9 dos 12 exemplos do desenho se comportam como
previsto. Diferenças reais, para o backtest e o dono avaliarem — não escondidas:
- **`H` é endógeno**: Trident Morango × ADM reduz só 21→19 (o plano estimava 7 a
  10) porque o `H` do próprio SKU (~49 dias) alarga a banda. Remédio provável:
  `H` da loja em vez do do SKU. Não mudado sem o backtest medir.
- **Mentos Rainbow × ADM**: o plano sugeria "testar aumento" pela alta de jul/ago;
  o motor mantém (baseline dentro da banda, sem ruptura, só 2 meses de alta).
- Os exemplos 11 e 12 (ideal ≠ levar; zero no próximo abastecimento) só se
  completam na Fase 4; aqui o motor só garante que não existe campo "levar".

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
