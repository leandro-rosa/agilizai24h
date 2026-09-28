# Adenda operacional — Abastecimento Inteligente & Mix das Lojas

Data: 2026-09-24. Revisão pedida pelo operador logo após o merge de
`add-commercial-intelligence-restock-mix` (`docs/superpowers/specs/
2026-09-23-commercial-intelligence-restock-mix-design.md`): a estrutura
atual "melhorou, mas ainda não representa suficientemente a forma como
[o operador] toma decisão operacional". Este documento é **auditoria +
proposta**, sem código — nada aqui foi implementado.

Raciocínio-alvo da tela, nas palavras do operador: **o que estava
parametrizado → quanto foi abastecido → quanto vendeu → quanto foi
perdido → o que a IA recomenda colocar agora.**

## 1. Auditoria

### 1.1 "Parametrizado" (quantidade planejada por Produto × Loja)

**Não existe hoje em nenhum lugar do Agiliz.** Auditei três frentes:

- **Importação do abastecimento** (`ingestion-worker-service`,
  `row-mapping.ts`'s `COLUMN_ALIASES`, medido contra 89.252 linhas reais /
  7 meses): as únicas colunas que o parser lê da planilha são `Qtd.
  Anterior`, `Qtd. abastecida`, `Remoções`, `Diferença`, `Qtd. final` —
  todas quantidades **realizadas** numa visita específica. Nenhuma coluna
  parecida com "Qtd. Desejada" ou "Mínimo Crítico" do TouchPay existe no
  export que o Agiliz ingere.
- **`supply-service`**: schema 100% de quantidades realizadas
  (`RestockRecord.quantity_restocked`, `RemovalRecord.quantity_removed`,
  `AdjustmentRecord.quantity`, `RecordedClosingBalance.quantity` — este
  último já documentado no próprio schema como "cross-check, nunca uma
  segunda fonte de verdade"). Nenhum campo de meta/mínimo/planejado.
- **`inventory-service.MinimumLevel`** — **este é o achado mais
  importante**: existe uma tabela real, já no formato certo (Produto ×
  Loja, `@@unique([store_id, sku])`), com endpoint funcionando (`PUT
  /inventory/:storeId/:sku/minimum`). Mas: (a) semanticamente é um **piso
  de alerta de estoque baixo** ("o nível em que o SKU é reportado como
  baixo"), não uma quantidade desejada/planejada; (b) **está vazia em
  produção** — sem seed, sem nenhum outro código que escreva nela, o único
  uso encontrado é em teste de integração; (c) é um valor mutável único
  (upsert), sem histórico — mesmo se fosse populada, não teríamos "o que
  estava parametrizado em março" retroativamente, só o valor atual.
- **`products-service`**: confirmado 100% rede (sem dimensão de loja) —
  não é onde parametrização por loja poderia viver.

Conclusão: o dado que o operador já mantém no TouchPay **nunca chegou ao
Agiliz**. Não há nada para comparar a sugestão da IA hoje — teríamos que
começar a capturar esse valor agora (ver §5, Decisão 1).

### 1.2 Embalagem / caixa / fardo / fracionamento

**Não existe em nenhum lugar do Agiliz** — nem em `products-service`
(schema/DTO sem nenhum campo do tipo), nem na importação (nenhuma coluna
de embalagem em nenhuma planilha lida), nem em `suppliers-service` (só
dados de identidade/contato do fornecedor, zero dado por SKU). Esse gap
já tinha sido identificado quando a tela atual foi construída — a decisão
nº7 do design original diz: "sem dado de tamanho de embalagem/caixa, a
sugestão sempre sai em unidades soltas, nunca '1 caixa'" — e foi lançada
assim mesmo, deliberadamente. O "múltiplo operacional da loja" que o
operador descreve como conceito à parte (distinto de unidades-por-caixa)
também não tem nenhuma representação hoje.

Um dado relevante para o desenho abaixo **já existe**, embora o operador
não tenha perguntado por ele diretamente: `Product.shelf_life_days`
(validade em dias) está no cadastro de produtos — pode alimentar risco de
perecibilidade no arredondamento (§3.2) mesmo sem dado de embalagem.

### 1.3 Granularidade e histórico (confirmação)

Confirmado direto no schema/rotas, não só na documentação: abastecido/
vendido/perdido são **mensais** em toda a extensão do pipeline
(`period` é sempre `YYYY-MM`, sem coluna diária/semanal em nenhum lugar;
o front busca uma requisição por mês porque não existe rota mais fina).
**Sem limite de retenção** — quantos meses estiverem importados via
Drive/manual ficam disponíveis indefinidamente; a janela de "3 meses de
decisão + 6 de lookback" que o motor usa hoje é escolha de negócio do
motor (mesma do Loss Intelligence), não um limite do backend.

Um dado é capturado no meio do pipeline (`IngestionOperation.finished_at`,
a data da visita de abastecimento) mas é descartado antes de chegar ao
`supply-service` — gap já documentado em
`ingestion-worker-service/CLAUDE.md` ("Perda por dia de visita de
abastecimento"), não contradiz a conclusão acima, só confirma que não dá
para ter granularidade melhor que mensal sem mudança de schema a montante.

## 2. O que a auditoria muda no desenho

- **Parametrização e Variação vs. parametrizado**: não têm dado real hoje.
  A proposta abaixo já inclui as colunas, mas com um estado explícito de
  "sem parametrização registrada" até a Decisão 1 (§5) ser resolvida e
  implementada — nunca um valor fabricado ou um zero escondido.
- **Embalagem / múltiplo operacional**: mesma lógica — a proposta modela
  os campos, mas o arredondamento por caixa só liga quando (e onde) o
  cadastro tiver o dado. Sem isso, sugestão continua em unidades soltas,
  exatamente como hoje.
- **Abastecido × Vendido × Perdido, aproveitamento, motivo de perda,
  janela explícita**: tudo isso já é 100% computável com dado existente —
  proposta abaixo é viável sem nenhuma captura nova.
- **Risco de perecibilidade no arredondamento**: viável agora via
  `shelf_life_days`, sem depender de embalagem.

## 3. Proposta — Abastecimento Inteligente

### 3.1 Tabela revisada

```
Produto | Categoria | Parametrizado atual | Abastecido | Vendido | Perdido (motivo) |
Aproveitamento | Tendência | Sugestão IA | Δ vs. parametrizado | Quantidade final | Confiança
```

- **Parametrizado atual**: valor da Decisão 1 (§5) se existir para aquele
  Produto×Loja; senão "—" com tooltip "sem parametrização registrada".
- **Abastecido / Vendido / Perdido**: soma dos últimos 3 meses fechados
  (mesma janela que o motor já usa) — a tela ganha um rótulo explícito
  acima da tabela: **"Base da recomendação: últimos 3 meses fechados
  (jun–ago/2026)"**, nunca um número sem contexto de janela.
- **Perdido (motivo)**: célula compacta — "4 un. · Validade", "7 un. ·
  Avaria", ou "12 un. · 2 motivos" quando há mais de um, com o detalhe
  completo por motivo só no drawer (§3.3). Fonte: `loss_by_reason_sku` da
  reconciliação, já usado pelo Loss Intelligence — **não duplica o motor
  de perdas**, só re-exibe o que ele já calculou.
- **Aproveitamento**: `vendido ÷ abastecido` na mesma janela, só quando
  `abastecido > 0` (senão "—", nunca 0% ou infinito). Rótulo deixa claro
  que é indicador histórico de giro, **nunca** usado para inferir estoque
  atual — mesma garantia estrutural que já existe no motor hoje.
- **Tendência**: passa a ser evidência de apoio (mostrada, mas não mais o
  "Sinal" de destaque da versão atual) — Crescendo/Caindo/Volátil/Estável,
  mesmo cálculo de hoje.
- **Sugestão IA**: mantém a faixa já implementada na revisão anterior
  ("30 (25–35)"), mas agora rotulada explicitamente como *sugestão
  operacional* — separada da *necessidade estimada* internamente (mesmo
  cálculo, dois nomes, ver §3.2).
- **Δ vs. parametrizado**: "9 ↓15", "18 ↑6", "12 = manter" — só quando
  Parametrizado atual existir; senão a célula fica vazia junto com aquela.
- **Quantidade final**: já existe, editável, inalterada.
- **Confiança**: já existe, inalterada.

12 colunas é uma tabela larga — a alternativa de dividir em duas linhas
por produto (dados operacionais numa linha, decisão da IA na outra) fica
para avaliação visual quando isso for implementado; não é uma decisão de
dado, é de layout.

### 3.2 Motor de quantidade — ajustes

- **Separar conceitualmente** `necessidadeEstimada` (a faixa que o motor
  já calcula, ex. 13–16) de `sugestaoOperacional` (o número final
  arredondado). Hoje os dois são a mesma coisa; a mudança é só nomear e
  expor os dois campos separadamente no tipo de retorno do motor.
- **Arredondamento não sempre para cima**: incorporar ao arredondamento
  (quando a faixa não cai exatamente num múltiplo operacional — que só
  existirá quando a Decisão 2 §5 for resolvida):
  - `shelf_life_days` baixo (produto perecível) → tende a arredondar para
    baixo ou para o mais próximo, nunca para cima por padrão;
  - `aproveitamento` histórico baixo naquele Produto×Loja → mesmo viés,
    resistir a sobra recorrente;
  - `confianca` baixa → arredondar para baixo (princípio já usado em
    outras partes do motor: nunca criar falsa confiança).
  Sem dado de embalagem, isso já pode valer para decidir entre os dois
  extremos da faixa hoje calculada — não depende só da Decisão 2.
- **Δ vs. parametrizado**: campo novo no retorno do motor, calculado só
  quando existir uma Parametrização atual para aquele Produto×Loja
  (Decisão 1).

### 3.3 Drawer revisado

```
Parametrização atual (ou "não registrada")
Histórico por período: Período | Parametrizado (quando disponível) | Abastecido | Vendido | Perdido | Motivo | Margem
Tendência
Inteligência de Perdas (já existe)
Comparação com outras lojas (já existe)
Embalagem / múltiplo operacional (ou "não cadastrado")
Necessidade estimada (a faixa)
Sugestão operacional (o número final)
Por que aumentar/manter/reduzir/não abastecer (já existe como "motivo")
Confiança e limitações (já existe)
```

Tudo que já existe na versão atual do drawer é preservado; as três seções
novas (Parametrização, Embalagem, a divisão Necessidade×Sugestão) entram
com estado explícito de "não disponível" enquanto as Decisões 1/2 (§5) não
forem resolvidas e implementadas.

## 4. Proposta — Mix das Lojas

Mesma reorientação: sair do centro em Crescendo/Caindo/Volátil e passar a
sustentar a decisão nos números operacionais, com tendência como evidência
de apoio, não manchete.

```
Produto | Categoria | Parametrizado | Abastecido | Vendido | Perdido | Margem |
Desempenho na rede | Recomendação | Confiança
```

- **Parametrizado / Abastecido / Vendido / Perdido / Margem**: mesma
  fonte e mesma ressalva de "não registrado" que o Abastecimento (§3.1) —
  Margem já é calculada hoje (`computeMarginPct`), só precisa aparecer na
  tabela em vez de só no drawer.
- **Desempenho na rede**: hoje é `affinity` (um número opaco tipo 0.22x);
  passa a aparecer com rótulo explícito — "0.22x a participação média da
  rede" — em vez de escondido atrás da palavra "Volátil"/"Crescendo".
  Cálculo (`computeNetworkAffinity`) não muda, só a apresentação.
- **Recomendação**: mesma classificação de hoje (manter/explorar/reduzir/
  suspender/avaliar retirada/dados insuficientes).
- **Tendência**: sai da tabela principal, mas continua disponível como
  evidência no drawer, junto com o motivo textual que já existe
  ("Tendência de queda nas vendas.", etc.) — nada é perdido, só reordenado.

Nenhuma mudança de motor aqui além da reordenação de apresentação — o
cálculo de `computeMixRecommendations`/`computeMixOpportunities` continua
o mesmo até a Decisão 1 (parametrização) e Decisão 2 (embalagem, que não
se aplica ao Mix) serem resolvidas.

## 5. Decisões do operador — atualizado 2026-09-24 (arquivo real encontrado)

**Decisão 1 — Parametrização atual: dado real encontrado, muda o plano.**
O operador apontou a pasta real: Drive `agiliz.ai > planogramas`. Não é
um export manual avulso — são **20 arquivos "Relatório_estoque
(N).xlsx"**, um por loja, subidos hoje (2026-09-24). Auditei o conteúdo
real de todos os 20 (mesma disciplina de "nunca desenhar parser sem ver o
arquivo de verdade" já usada no resto do projeto):

- **Colunas, idênticas nos 20 arquivos**: Seleção, ID produto, Código
  Produto, Descrição Produto, Categoria produto, Preço, Código de
  barras, Capacidade mola, **Mínimo crítico**, **Nível de par**,
  **Quant. atual**, Tipo do Produto.
- **`Código Produto` bate exatamente com `Product.sku` do Agiliz** —
  conferido contra o banco real (`1093`→Tonica, `5002`→Bala Skittles
  Original 38g etc., todos batendo). Chave de join direta, sem ambiguidade.
- **`Mínimo crítico`** é exatamente o conceito que `inventory-service.
  MinimumLevel` já modela (Produto × Loja, piso de alerta) — populável
  direto.
- **`Nível de par`** ("par level") é o termo de varejo/vending para
  "quantidade-alvo a manter" — **é isto, não `Mínimo crítico`, que
  corresponde ao que o operador chamou de parametrização/"Qtd.
  Desejada"**. Não existe campo equivalente hoje em nenhum serviço —
  precisa de campo novo.
- **`Quant. atual`** é uma leitura observada de estoque no momento do
  relatório — **não inferida**. Isso é potencialmente importante: a
  premissa "NÃO TEMOS ESTOQUE ATUAL CONFIÁVEL" que fundamenta a engine
  inteira foi definida pelo próprio operador; este relatório parece
  contradizer isso, mas não decido essa mudança sozinho — ver pergunta
  em aberto abaixo.
- **`Categoria produto`** é a taxonomia fina do lado do
  TouchPay/vending (ex. "Balas", "snacks proteicos"), diferente do enum
  de 4 categorias do Agiliz (`meal`/`snack`/`beverage`/`essential`) — não
  dá pra mapear 1:1 sem perda; tratar como metadado informativo, não
  substituir `Product.category`.
- **`Capacidade mola`** está zerada/vazia nas 183 linhas × 20 arquivos —
  campo não populado por esse sistema para essas máquinas, não serve
  para o modelo de embalagem (Decisão 2, §5 abaixo — continua sem dado
  de embalagem real, essa coluna não resolve isso).
- **Nenhum identificador de loja dentro do arquivo** — nem no nome
  (`Relatório_estoque (1)` a `(20)`, só sequencial), nem em metadados do
  Drive (description/properties, checados e vazios), nem em propriedades
  do workbook Excel (checadas e vazias), nem em nenhuma coluna/célula do
  conteúdo. **Isto é o bloqueio real para ingestão automática** — ver
  pergunta em aberto abaixo.

**Perguntas em aberto (substituem a Decisão 1 original):**

1. **Identificação da loja por arquivo**: como cada `Relatório_estoque
   (N).xlsx` deveria ser associado à loja certa? Opções possíveis: (a)
   renomear os arquivos no Drive incluindo o nome/código da loja antes do
   upload (mesmo padrão que outras fontes de ingestão já exigem); (b) o
   operador informa manualmente o mapeamento desta vez (arquivo → loja)
   e eu decido, a partir disso, como validar automaticamente da próxima
   vez; (c) outra fonte de verdade já existe para casar arquivo→loja que
   eu não tenha encontrado.
2. **Confiabilidade de `Quant. atual`**: essa coluna deveria ser tratada
   como estoque atual confiável? Se sim, isso muda uma premissa central
   de toda a feature (§0 do design original — "NÃO TEMOS ESTOQUE ATUAL
   CONFIÁVEL"), o que teria implicações grandes (o motor poderia parar
   de só sugerir quantidade e passar a considerar estoque real). Se não
   (ex. é uma leitura que a máquina reporta mas você não confia
   plenamente, ou é só o que sobrou de uma contagem manual esporádica),
   guardamos o valor só como referência no drawer, sem deixar a engine
   depender dele.
3. **Recorrência**: esse relatório vai ser gerado com alguma regularidade
   (ex. toda vez que houver troca de planograma), ou foi um upload único
   para eu auditar a estrutura? Se for recorrente, o caminho certo é
   estender o pipeline de ingestão de Drive já existente
   (`add-drive-ingestion-source`) com uma fonte nova ("planogramas"),
   igual já existe para vendas/abastecimento — muito melhor que um
   upload manual avulso.

**Respostas do operador (2026-09-24):**

1. **Identificação da loja — CONFIRMADA E TESTADA.** Os 20 arquivos foram
   renomeados (`Relatório_estoque <Loja> - <Cidade>.xlsx`, espaçamento
   inconsistente entre eles). Rodei o casamento real contra os 24
   `Store.name` do banco (algoritmo: maior `Store.name` que aparece como
   substring do nome do arquivo — resolve corretamente o caso ambíguo
   "Plena Saude - ADM Taipas" vs. "Plena Saude - ADM" ao preferir o mais
   longo/específico). **19 de 20 casaram sem ambiguidade.** Um arquivo
   ficou sem match automático: `Relatório_estoque HTL05 -
   Hortolândia.xlsx` — faltou o prefixo "Ascenty - " (deveria ser
   "Ascenty - HTL05"). **Decisão do operador: tratar como exceção
   conhecida no código** (mapear esse nome de arquivo específico direto
   para `store_id` da "Ascenty - HTL05"), sem depender de renomear o
   Drive — a tela de confirmação de import (mesmo padrão já usado em
   vendas/abastecimento: nada entra sem o operador revisar e confirmar)
   mostra a loja resolvida antes da confirmação de qualquer forma, então
   o risco fica coberto mesmo sem essa correção manual. As 4 lojas sem arquivo neste
   lote — `Ascenty - SP03 2`, `Ascenty - SP03 Copa`, `Ascenty - SP03 DH4`,
   `Plena Saude - ADM` — simplesmente não têm relatório aqui, o que é
   esperado (provavelmente máquinas secundárias no mesmo local da loja
   base, sem planograma próprio). **Convenção validada**: nome do
   arquivo contendo o `Store.name` exato como substring funciona bem o
   suficiente para casamento automático — usar esse algoritmo
   (maior-substring, não primeiro-match) no importador real.
2. **Confiabilidade de `Quant. atual`**: confirmada como confiável. Mas
   **decisão separada e explícita**: por enquanto vira só **referência
   exibida** (tabela/drawer) — a fórmula do motor de sugestão **continua
   sem consumir estoque atual**, mesmo comportamento já lançado e
   validado ao vivo. Reformular a fórmula para `reposição = nível de par
   − quant. atual` (ajustada por tendência/perda/confiança) é uma
   mudança de arquitetura real do motor, propositalmente **fora desta
   revisão** — fica para uma próxima revisão dedicada, com o mesmo
   cuidado (auditoria → proposta → aprovação → implementação) que esta e
   a original tiveram.
3. **Recorrência**: upload pontual por enquanto, não uma rotina. Import
   tratado como pontual — **sem** estender o pipeline de Drive ingestion
   com uma fonte nova agora (ver §6 para o que isso simplifica no
   escopo de implementação).

**Caminho aprovado:**
- `Nível de par` → vira a "Parametrização atual" da tela (campo novo,
  Produto × Loja).
- `Mínimo crítico` → popula `inventory-service.MinimumLevel` (campo já
  existe, só falta escrever nele).
- `Quant. atual` → guardado e mostrado como referência no drawer;
  **nunca** alimenta o cálculo de `Sugestão IA`/`Δ vs. parametrizado`.
- Os três cabem na mesma tabela/tela (mesma chave Produto × Loja) — ver
  recomendação de reaproveitar `MinimumLevel` para carregar os três
  campos, §6.

**Decisão 2 — Embalagem / fracionamento: RESOLVIDA.** Modelar agora:
campos de unidades-por-embalagem, tipo e fracionável no cadastro de
produto (`products-service`, rede — não varia por loja); múltiplo
operacional por Loja×SKU (varia por loja, mesma dimensão de
`MinimumLevel`) — ver recomendação de reaproveitar `MinimumLevel` em vez
de criar um serviço/tabela novo, §6. Sugestão continua em unidades soltas
para qualquer SKU/loja sem esse dado ainda cadastrado — nunca trava o
resto da tela. Precisa de uma tela/fluxo para o operador popular aos
poucos (mesmo padrão de "sem dado = sem bloqueio, mostra o que dá pra
mostrar" já usado em todo o resto do produto).

## 6. Escopo de implementação implicado pelas Decisões 1 e 2

Maior que uma revisão só de frontend — as duas decisões abrem trabalho
real de backend em dois serviços, além do motor/tela:

- **`inventory-service`**: nenhuma mudança de schema (`MinimumLevel` já
  existe certo) — só a tela nova no admin que chama o `PUT` já existente.
- **`products-service`**: migration nova adicionando
  `units_per_package`/`package_type`/`fractionable` (nomes provisórios) ao
  `Product`; endpoint de escrita (hoje o cadastro de produto provavelmente
  já tem CRUD — confirmar antes de assumir que precisa de rota nova).
- **"Múltiplo operacional" (Loja × SKU) — recomendação**: em vez de criar
  tabela/serviço novo, adicionar um campo a mais em `MinimumLevel`
  (`inventory-service`), que já é Produto × Loja e já vai ganhar a tela de
  edição pela Decisão 1 — os dois conceitos (parametrização e múltiplo
  operacional) cabem na mesma tela/tabela, mesma chave, sem duplicar
  dimensão.
- **Importação do snapshot do TouchPay**: mecanismo a definir quando o
  arquivo real for fornecido pelo operador — provavelmente upload em
  massa (CSV/planilha) em vez de digitação linha a linha, dado que cobre
  todo o catálogo × todas as lojas. Fica como item explícito do plano de
  implementação, não decidido aqui por falta do arquivo real para
  desenhar o parser contra ele (mesmo princípio já usado no resto do
  projeto: nunca desenhar um parser sem ver o arquivo de verdade).
- **`gateway-service`**: rotas novas ou ajustadas conforme o que sair dos
  itens acima.
- **`frontend/apps/admin`**: telas novas (definir parametrização,
  cadastrar embalagem/múltiplo) + a revisão de tabela/drawer/motor já
  descrita em §3-4.

## 7. Fora de escopo desta revisão

- Persistência de "Quantidade final" (IA sugeriu vs. operador escolheu vs.
  enviado) — já era um gap conhecido antes desta revisão, continua fora.
  Diretamente relevante para poder um dia medir "aproveitamento da
  sugestão da IA" e não só "aproveitamento histórico geral" — vale
  revisitar junto quando a Decisão 1 avançar.
- Granularidade diária de abastecido/vendido/perdido — exigiria mudança
  de schema a montante (`ingestion-worker-service`), gap antigo, não
  reaberto aqui.
- Performance O(N²) do motor de Mix — gap já documentado
  separadamente em `frontend/apps/admin/CLAUDE.md`, não reaberto aqui.
