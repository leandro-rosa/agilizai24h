# backend/apps/ingestion-worker-service

Transforma as três planilhas operacionais em registros normalizados — a
mudança que substitui o processo manual mensal. Ver
[../../CLAUDE.md](../../CLAUDE.md) para as convenções do workspace backend.

**Chamado por**: `gateway-service` (HTTP interno, ao aceitar um upload).
**Lê**: `stores-service` e `products-service`.
**Escreve**: filas de `sales`, `supply`, `products` e (quarta família,
`add-treasury-statement-ingestion`) `treasury`.
Sem superfície pública — não publica porta.

## A quarta família: extrato bancário e fatura de cartão

Diferente das três primeiras (workbook → `sheeter.smartChunk` → staging →
finalize), os 7 parsers de tesouraria não passam por staging nenhum: um
arquivo mensal é centenas de linhas, não milhares, então não existe o risco
de "chunk pisa no chunk anterior" que staging existe pra resolver. Cada
parser lê o arquivo inteiro, produz TODAS as linhas de uma vez, e publica
UM job só em `TREASURY_QUEUES.RAW_ROWS` (`@app/treasury-ingestion-contracts`)
— `treasury-service` é o único consumidor, então (diferente de
sales/supply/cost, que divergem em três filas de saída) as 7 fontes
convergem numa fila de saída só.

```
gateway: recebe até 6 arquivos → S3 (um por vez) → POST /treasury-imports aqui (uma vez por arquivo)
  ↓ uma fila POR FONTE (treasury-ingestion.pagbank-statement, .c6-statement, ...)
<Fonte>Worker: baixa do S3 → extrai texto (pdf-parse) ou lê CSV (Bradesco) → parser da fonte
  ↓ fila treasury.raw-rows (UM job por arquivo, nunca chunkado)
treasury-service: RawRowsWorker classifica e grava em PendingImport/PendingTransaction
```

`POST /treasury-imports` (`TreasuryIngestionController`) não grava nada
localmente — diferente de `POST /ingestions`, que cria um `Ingestion` aqui.
`treasury-service` é dono de todo o estado da importação
(`add-treasury-statement-ingestion` design D4); esta rota só decide qual
fila enfileirar.

**PDF é extração de texto (`pdf-parse`), nunca OCR** — os 6 extratos/fatura
em PDF são gerados pelo banco, têm camada de texto real (confirmado direto:
nenhum é escaneado). `utils/pdf-text.ts` é o wrapper fino; `utils/money.ts`
e `utils/date.ts` são compartilhados por vários parsers (o "-R$" colado ao
sinal, sem espaço, é um bug real do histórico da área financeira — testado
nominalmente por causa disso; `findBareMoneyInText` é a variante sem `R$`
obrigatório, precisa pra Itaú/C6-fatura/Nubank/PagSeguro-fatura, que não
têm `R$` em lançamento nenhum). `utils/normalize.ts` dobra acento pro
casamento de padrão estrutural — um `matchText` escrito com acento
("Cartão") só bate com o texto extraído se os dois passarem pela mesma
normalização; comparar com `.toUpperCase()` sozinho não dobra acento.

**O layout de linha foi medido contra arquivo real** (2026-08-26, Barbara
forneceu os 12 arquivos — ver `add-treasury-statement-ingestion/design.md`
D9-D11 para o levantamento completo, `tasks.md` §10 para o histórico
linha-a-linha por fonte). A suposição original ("data no início, descrição
no meio, `R$` em algum lugar depois") só bateu pra PagBank — as outras 5
fontes precisaram de reescrita real:

- **PagBank**: bate com a suposição original.
- **C6 extrato**: linha tab-separated, data `DD/MM` **sem ano** (ano vem de
  um cabeçalho de seção "Mês AAAA" visto antes) — fora de
  `parseStatementLines` de propósito, tem seu próprio loop.
- **C6 fatura**: data `DD mmm` (abreviação de mês PT, sem barra, sem ano —
  resolvido via `period` do upload + regra de rollover), valor sem `R$`.
- **PagSeguro fatura**: 7ª fonte, descoberta só ao medir os arquivos reais
  — arquivo genuinamente distinto do extrato PagBank, formato invertido
  (descrição, valor nu, **data no fim** da linha).
- **Itaú**: valor sem `R$` (2 ocorrências no documento inteiro, nenhuma em
  lançamento); registro pode se espalhar por até 3 linhas de continuação
  sem data própria (razão social longa empurra CNPJ+valor) — join de
  lookahead até achar valor ou a próxima linha datada.
- **Nubank**: a mais divergente — sem `R$`, sem data por lançamento (só no
  cabeçalho do dia), registro de 3-5 linhas físicas. `nubank.parser.ts` tem
  seu próprio assembler de blocos (estado dia+direção, nunca reseta por
  página — um bloco pode atravessar borda de página de verdade, medido
  direto). Tem um artefato de extração conhecido e documentado no próprio
  arquivo: `pdf-parse` duplica o rabo do último registro visível bem na
  borda de página — nunca perde valor (a soma bate exata contra o total que
  o próprio arquivo declara), só ocasionalmente deixa um fragmento órfão
  como rejeição.
- **Bradesco**: arquivo real é `.xlsx`, nunca foi CSV — reescrito sobre
  `readWorkbookRows` (mesmo leitor que sales/supply/cost já usa), cabeçalho
  localizado por busca de conteúdo (linha 9, não linha 1), duas colunas de
  valor (Crédito/Débito), uma segunda tabela empilhada abaixo de um rodapé
  "Total" (mesmo padrão de "múltiplas tabelas numa aba" que
  `locate-restocking-operations.ts` já resolve pra abastecimento).

Cada fonte corrigida foi validada rodando o parser de verdade contra o
arquivo real correspondente (script ad-hoc, não commitado) — Bradesco,
Nubank e a fatura PagSeguro bateram a soma EXATA contra o total que o
próprio arquivo declara (linha "Total"/resumo).

**`counterpartyRaw` tem o rótulo do tipo de lançamento removido, quando a
fonte souber quais são** (`stripKnownPrefix`, `parsers/statement-line.ts`,
parâmetro `verbPrefixes`). Achado ao rodar o pipeline real de ponta a ponta:
uma linha de extrato começa com o rótulo do BANCO ("Pix enviado AMBEV"), mas
o de-para semeado em `add-treasury-classification-model` guarda o nome NU do
favorecido ("AMBEV", `match_type: exact`) — sem o strip, nenhuma linha
comum batia com regra nenhuma, e tudo além dos `StructuralPattern`s virava
`kind: pending`. PagBank e C6 (com vocabulário de rótulo confirmado contra
arquivo real) têm `VERB_PREFIXES` próprio; Nubank/Itaú resolvem o
equivalente dentro do próprio assembler/join (não usam `stripKnownPrefix`,
que é específico de `parseStatementLines`); Bradesco/PagSeguro fatura não
têm rótulo nenhum colado na descrição (medido — a coluna/campo já é o nome
nu). Casamento por CONTAGEM DE TOKEN contra `normalizeForMatch`, não por
índice de caractere na string normalizada — colapso de espaço/pontuação na
normalização quebraria um slice por índice (bug real, achado e corrigido
contra o texto real do PagBank: um token de pontuação pura, tipo um `-`
sozinho, some da contagem normalizada mas não some do array bruto).

**`pdf-parse@2.4.5`/`pdfjs-dist` fazem `import()` dinâmico ao montar o
"fake worker" do Node — o Jest padrão rejeita isso** com "A dynamic import
callback was invoked without --experimental-vm-modules". Confirmado que é
uma limitação SÓ do Jest: o mesmo código, rodando via `node` puro (o caminho
real de produção/dev, `ts-node-dev` ou `tsc` compilado), extrai o PDF sem
flag nenhuma. Por isso `pnpm test` deste serviço roda com
`NODE_OPTIONS=--experimental-vm-modules` (só o script de teste, não o app).

## O fluxo

Vendas e custo: um arquivo, uma tabela plana, cabeçalho na linha 1 —
inalterado desde sempre.

```
gateway: recebe arquivo → S3 → POST /ingestions aqui
  ↓ fila ingestion.parse-file
ParseFileWorker: baixa do S3 → valida cabeçalhos (linha 1) → sheeter.smartChunk
  ↓ fila ingestion.staged-rows (um job por linha)
StagedRowsWorker: resolve produto → parseia motivos → grava em staged_row
  ↓ (só o chunk que completa o arquivo)
finalize(): UM batch por período para cada sink
```

Abastecimento é outro fluxo, porque o arquivo é outra coisa — ver abaixo.

## O layout real do export de abastecimento

O arquivo é **um workbook por mês cobrindo toda a rede**, uma aba por
operação (`Operação 1`..`Operação N`), e cada aba tem **duas tabelas
empilhadas**:

```
aba "Operação N"
  linha 1  ID PDV | Cliente | Local | ... | Tipo de operação | ...
  linha 2  68     | Ascenty - HTL05 | Hortolândia | ... | Abastecimento | ...
  linha 3  (vazia)
  linha 4  ID produto | Código Produto | Nome produto | ... | Qtd. Anterior |
           Qtd. abastecida | Remoções | Diferença | Qtd. final | ...
  linha 5+ linhas de produto
```

Medido em 7 meses reais (89.252 linhas): a linha 4 é sempre onde a segunda
tabela começa, mas o código **localiza** em vez de assumir — busca a linha
que contém `Cliente` para o bloco de operação, e `Código Produto` para a
tabela de produtos, dentro de uma janela de 10 linhas
(`locate-restocking-operations.ts`). Um workbook cujas abas discordam sobre
onde está a tabela falha o arquivo inteiro — nunca visto acontecer, mas
`smartChunk` só aceita uma posição de cabeçalho por chamada, então discordar
significa não adivinhar qual está certa.

**Três tipos de operação**, reconhecidos explicitamente
(`operation-kinds.ts`): `Abastecimento` (reposição + remoções),
`Inventário` (ajuste + remoções, `Qtd. abastecida` tipicamente ausente),
`Combinado` (os três). Um tipo desconhecido rejeita a operação, nunca
assume reposição.

**A loja vem da aba, não de quem faz upload.** `Cliente` no bloco de operação
é o código externo da loja — um upload de abastecimento cobre a rede inteira,
então pedir "qual loja?" no upload atribuiria todas as outras silenciosamente
à loja errada. Vendas continuam pedindo a loja no upload: o relatório de
venda não carrega identidade de loja em lugar nenhum do arquivo.

## Por que colunas desconhecidas falham o arquivo

O parser antigo **inventou** nomes de coluna antes de qualquer export real
ser lido. O pior caso: o alias de `removals` batia com `Remoções`, que no
export real é o **número** de removidos (sempre ≤0), não o texto do motivo —
que mora em `Detalhes das Remoções` e nunca era lido. Nada falhava: lia a
coluna errada e produzia um valor plausível.

Por isso os nomes de coluna agora são os reais do export, e uma coluna
esperada ausente **falha o arquivo**, nomeando qual — nunca lê um valor
ausente como zero. `row-mapping.ts` mantém uma lista canônica em português
e deriva duas tabelas de busca: uma para texto de cabeçalho lido direto via
ExcelJS (antes do `smartChunk` tocar o arquivo), outra para as chaves já
slugificadas que o `smartChunk` produz — as duas normalizações são
diferentes, e confundi-las foi um segundo bug real (`assertHeadersMatchType`
comparava cabeçalho bruto usando o comparador esperando chave slugificada).

## A identidade de saldo

Toda linha de produto satisfaz
`Qtd. final = Qtd. Anterior + Qtd. abastecida + Remoções + Diferença` — medido
em **100,000%** das 89.252 linhas reais. Uma linha que não bate é rejeitada
(`check-balance-identity.ts`), porque a divergência significa que o parser
leu a linha errado, não que o export está errado.

## Produto: código primeiro, nome como fallback

`Código Produto` (abastecimento), `Código` (vendas) e `sku`
(`products-service`) são o mesmo identificador. Resolvido em lote via
`POST /skus/resolve` (`products-service`) antes de qualquer resolução por
nome. Um código que não resolve **nunca** é re-tentado pelo nome da mesma
linha — um código digitado errado não pode ser mascarado pelo que o nome
por acaso bateria.

## O ajuste de inventário — nem abastecimento, nem remoção

`Diferença` é o valor que faz a aritmética da própria linha fechar. Mistura
transferência deliberada entre lojas, erro de digitação e caixa de
autoatendimento entregando produto trocado — indistinguível a partir do
dado. Guardado como movimento assinado próprio (`movement_kind: 'adjustment'`
em `staged_row`), nunca somado a abastecimento nem a remoção. Ver
[supply-service/CLAUDE.md](../supply-service/CLAUDE.md).

Uma operação tipo `Abastecimento` carregando `Diferença` não-zero nunca foi
observada (0 de 89.252 linhas) e é tratada como dado que o desenho não
reconhece — rejeitada, não acumulada silenciosamente.

## Uma loja, várias operações no mês — soma, nunca sobrescreve

O mesmo par (loja, SKU) aparece em várias operações dentro de um mês real
(a mesma loja é visitada várias vezes). `finalize()` agrupa por loja e
**soma** abastecimento/remoção(por motivo)/ajuste através de todas as
operações antes de publicar — nunca uma entrada por linha. Sem isso, duas
operações da mesma loja e SKU violariam a constrain única
`(store_id, period, sku)` do `supply-service` na segunda escrita. Havia um
bug exatamente assim durante a implementação: pego pelo teste de integração
contra o export real, nunca em typecheck.

## O fechamento registrado (Qtd. final) — atravessa até o inventory

O mesmo par (loja, SKU) pode ter `Qtd. final` de várias operações no mês —
cada uma é uma leitura NAQUELE momento, não o fechamento do mês. `finalize()`
escolhe a leitura da operação com o `Finalizado em` mais recente
(`IngestionOperation.finished_at`), e só essa atravessa para
`supply-service` → `inventory-service`, onde vira a conferência contra o
saldo derivado (design D5).

## Por que existe staging (o risco mais sutil do desenho)

`smartChunk` quebra um arquivo em N jobs de fila — um por linha, no
`@app/hold-it` real (`holdItALot` chama `addBulk` com um job por mensagem,
nunca um job por lote) — e os sinks **substituem o período inteiro**. Se
cada linha entregasse direto ao sink, cada uma apagaria a anterior e só a
última sobreviveria — um período silenciosamente sem a maior parte dos
dados, com status "completed".

Staging existe só para isso: as linhas se acumulam em `staged_row`, e apenas
o chunk que fecha o arquivo entrega tudo de uma vez. O contador
`expected_chunks`/`processed_chunks` é incrementado e lido numa única
instrução, então dois chunks terminando juntos não podem ambos se ver como
"último" (entregaria duas vezes) nem ambos como "não último" (deixaria o
arquivo eternamente inacabado). Há teste para os dois casos.

## Parsing de motivos — a peça com consequência de negócio

`-6 Devolução, -3 Outro motivo` vira duas quantidades: 6 de `return` e 3 de
`other_reason`. O 9 nunca é produzido. Um motivo repetido na mesma célula
soma (`-1 Validade vencida, -3 Validade vencida` ⇒ 4) — o dado real faz isso
o tempo todo. Motivo desconhecido, segmento ilegível, ou split que não bate
com o total reportado (a coluna `Remoções`, em módulo) **rejeitam a linha**,
nunca adivinham.

Interpretação de texto mora aqui, e não no `supply`, de propósito: o formato
é do PDV e pode mudar; a classificação de perda é do negócio e é estável.

## Decisões que não são óbvias no código

- **Período vem do request, nunca inferido do arquivo** (para os três
  tipos): nenhuma planilha tem período legível por máquina, e adivinhar
  atribui silenciosamente dados de março a abril.
- **Loja vem do request só para vendas e custo** — abastecimento vem da
  aba (acima). Uma regra virou duas de propósito.
- **`toCents`/`toQuantity` devolvem `null` para valor ilegível, nunca 0** —
  e mantêm o sinal: `Remoções` e `Diferença` são legitimamente negativos.
  Descascar não-dígitos de "abc" deixa string vazia, e `Number('')` é 0 — um
  valor que o arquivo não soube expressar viraria zero silencioso. Há teste
  de regressão; foi bug real.
- **Custos são gravados com vigência no período do upload**, o que é o que
  faz valer "valorar um mês com o custo daquele mês".

## Testes

- Unitários (`pnpm test`): parser de motivos, mapeamento de linha e coluna
  (bruta e slugificada), datas seriais do Excel.
- Integração (`pnpm test:integration`): precisa do Postgres deste serviço.
  `test/chunk-accumulation.integration-spec.ts` cobre a acumulação de chunks
  contra o Postgres com o broker stubado.
  `test/real-exports.integration-spec.ts` roda o parser real contra as
  fixtures em `test/fixtures/` — cortadas do export real, mais algumas
  sintéticas para casos nunca observados (ver `test/fixtures/README.md`).
  É aqui que os dois bugs acima foram achados: nenhum apareceu em
  typecheck.

## Bugs que só apareceram rodando

- **O alias de motivo batia com a coluna errada.** Ver "Por que colunas
  desconhecidas falham o arquivo" acima — a razão de existir de
  `align-ingestion-with-real-reports`.
- **`assertHeadersMatchType` comparava cabeçalho bruto com o comparador
  errado** (esperava chave já slugificada pelo `smartChunk`, recebia texto
  cru direto do ExcelJS) — toda venda real seria rejeitada por "coluna
  ausente" que na verdade existia.
- **Abastecimento por loja em múltiplas operações não somava** —
  `finalize()` mandava uma entrada por linha para `supply-service`, que
  violaria a constraint única na segunda operação da mesma loja/SKU. Pego
  pelo teste `real-exports.integration-spec.ts`, cenário construído a
  partir do padrão real (mesma loja, várias visitas no mês).
- **`@app/sheeter` quebrava todo serviço que o importasse.** Ele chama
  `XLSX.set_fs(fs)` no topo do módulo, e o pacote `xlsx` do npm (0.18.5) **não
  exporta** `set_fs` — isso só existe nos builds do CDN do SheetJS. Agora a
  chamada é condicional.
- **O MinIO subia sem bucket.** O `docker-compose.infra.yaml` tem um passo
  `minio-provision` que cria o bucket e sai.

## Gaps conhecidos
- **Os 7 parsers de tesouraria já foram validados contra arquivo real**
  (2026-08-26 — ver "A quarta família" acima, `add-treasury-statement-
  ingestion/design.md` D9-D11). O que ainda falta: só `pagbank-sample.pdf`
  virou fixture binária sintética commitada com teste de ponta a ponta
  (`.fixture.spec.ts`); as outras 6 fontes têm cobertura de regressão via
  `.spec.ts` com texto real medido (não fixture binária) — construir uma
  fixture binária por fonte é um follow-up de menor prioridade, não
  bloqueante (a validação interativa contra o arquivo real já provou a
  extração PDF/xlsx em si funciona). **Atualização (backfill de 2026-08-26,
  7-8 meses reais por fonte, não mais 1):** achado um segundo caso real de
  linha-fantasma no Itaú — `SALDO ANTERIOR` (saldo de abertura, mesmo
  rótulo do Bradesco) não estava em `BALANCE_LINE_PATTERNS`, virava
  transação de R$0,00 (corrigido). As duas faturas (C6, PagSeguro) mostraram
  que a data de cada linha é a de compra/ciclo, não a de referência do
  período — uma fatura "junho" pode ter zero linha datada em junho; o
  período de fatura nunca deve ser inferido de `occurredOn`, só do upload.
  Os 5 extratos (não-fatura) continuam com `occurredOn` = data real de
  liquidação, confirmado através de vários meses reais batendo exato contra
  o subtotal que o próprio arquivo imprime (C6: `Entradas:`/`Saídas:` por
  mês, todos os 7 meses testados — ver `treasury-service/CLAUDE.md`).
- **Um "Distribution Center" existe no export desde maio/2026, sem `Cliente`.**
  A partir do backfill real de 7 meses: operações com `Estoque: Distribution
  Center` e `Tipo de operação: Inventário` carregam `Cliente` em branco — não
  existiam em nenhum dos 4 primeiros meses auditados (jan-abr, base da decisão
  D6), passaram a existir em maio (52 abas), junho (33) e julho (40). Como a
  loja vem de `Cliente` (design D2), toda aba assim é rejeitada
  (`unparseable_sheet`) e suas linhas são descartadas silenciosamente pelo
  `staged-rows.worker.ts` (comportamento documentado, pensado para não
  duplicar a rejeição de uma aba já rejeitada — não pensado para este caso).
  Não é um bug de parsing: é um nó novo que o desenho não previu. Decisão
  necessária antes de resolver — o estoque do DC entra em CMV de alguma loja,
  ou é só um pulmão que abastece lojas depois via `Diferença`? — por isso
  ficou como gap, não como código. Não afeta a barra de aceite de
  `align-ingestion-with-real-reports` (março não tem DC).
- Sem cancelamento de ingestão em andamento; corrige-se reenviando o arquivo.
- Sem política de retenção dos arquivos crus no object storage.
- Resolução de código/nome roda por chunk (por linha, na prática, dado como
  `holdItALot` real entrega); um arquivo com muitas linhas faz muitas
  chamadas ao `products`. Aceitável no volume atual.
- Rastrear qual loja originou uma transferência (par de entrada/saída do
  ajuste de inventário) não é feito — o export não nomeia a loja de origem,
  e a tentativa de inferir por proximidade de horário não fecha de forma
  confiável (ver design "Open Questions" de `align-ingestion-with-real-reports`).
- `Total de Perdas` / `Total Perdas Custos (R$)` do cabeçalho da operação —
  a conferência própria do export contra a perda calculada — não é lida.
  Adiado deliberadamente (ver o mesmo design): não é necessário para a
  ingestão estar correta, e ampliaria o escopo da mudança.
