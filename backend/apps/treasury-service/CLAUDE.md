# backend/apps/treasury-service

Movimento de caixa: extrato bancário, fatura de cartão, o DE-PARA de
favorecido e as taxas de adquirente. Ver [../../CLAUDE.md](../../CLAUDE.md)
para as convenções do workspace backend.

**Consumidores**: `gateway-service` (rotas `/treasury`).
**Depende de**: `@app/health`, `@app/prisma-db-client`, `@app/hold-it`
(consumidor — `TREASURY_QUEUES.RAW_ROWS`, `@app/treasury-ingestion-contracts`).
`supplier_id` referencia `suppliers-service` como `Int` cru —
database-per-service, sem FK cruzando serviço.

Origem na planilha: abas `extrato bancário`, `cartão de crédito`, `DE-PARA`,
`Página64`, `taxas pagseguro` e as linhas "Vendas recebidas ..." do
`Fluxo de caixa`.

## Decisões que não são óbvias no código

- **`amount_cents` é sempre positivo; o sinal mora em `direction`.** Um campo
  que pode ser negativo convida a somar entrada com saída por engano — foi
  assim que a planilha errou o fluxo de caixa de março.
- **`counterparty_raw` é preservado depois de resolvido.** É o que permite
  reconferir uma classificação suspeita; sobrescrever com o nome bonito
  destrói a evidência.
- **`kind` (`revenue`｜`expense`｜`movement`｜`pending`) é o eixo real de "isto
  conta como resultado", independente de `nature`.** Só `kind: expense`
  carrega `nature` — `movement` (transferência entre contas próprias,
  pagamento de fatura, CDB, empréstimo, retirada de sócio) e `pending` nunca
  entram em receita/despesa, não importa o valor. Ver
  `add-treasury-classification-model`.
- **`nature` é o eixo que liga tesouraria a DRE** (`cogs` · `operating` ·
  `administrative` · `investment`), vindo da coluna "Natureza" da aba
  `Página64`, e só se aplica quando `kind: expense`. `entry_type` e
  `category` são texto livre porque a operação inventa categoria nova toda
  semana (`category` agora tem uma lista semi-curada via seed +
  `GET /treasury/categories`); `nature` é fechado porque o DRE depende dela.
- **`CounterpartyMapping.match_type` (`exact`｜`contains`) resolve dois
  mecanismos com uma tabela só.** `exact` (default, comportamento de
  sempre) bate quando o favorecido normalizado é IGUAL a `match_text`;
  `contains` bate quando ele CONTÉM `match_text` — é como as regras de
  combustível/alimentação/estacionamento (`POSTO`, `KFC`, `PARKING`, ...) e
  as contas próprias (mesmo CNPJ, razão social diferente por banco) são
  expressas, sem inventar uma segunda tabela de regra. Entre `contains`
  concorrentes, o `match_text` mais longo vence
  (`longestContainsMatch`) — palavra-chave mais específica bate antes da
  genérica.
- **`applyMappings` só toca `kind: pending`.** Era `supplier_id: null`, mas
  isso também é verdade pra todo `movement` já classificado corretamente
  (nunca tem fornecedor) — reaplicar em cima dele reprocessaria à toa, ou
  desfaria uma correção manual que trocasse o `kind` sem mexer no
  fornecedor. `kind: pending` é o único estado que genuinamente significa
  "ninguém classificou ainda".
- **Neutralização (`neutralized_with_id`, self-FK) exclui um par dos totais
  sem apagar nenhum dos dois lados.** Pix recusado + estornado, ou devolução
  cancelando uma saída recente ao mesmo fornecedor — sempre dentro do mesmo
  período (nunca olha mês anterior). `neutralizationCandidates` só sugere; só
  `neutralize` (chamada explícita, dois ids) vincula — nunca automático. FK
  com `ON DELETE SET NULL`: apagar um lado nunca deixa o outro apontando
  para um id morto.
- **Consolidação por fornecedor (`transactionsBySupplier`) soma
  `kind: expense` através de toda `account_id` do período** — nunca uma
  linha por conta. Um fornecedor pago pelo PagBank e pelo C6 no mesmo mês
  aparece uma vez só.
- **`AcquirerFee` é datado**, como `CostVersion` no `products-service`:
  recalcular julho com a taxa de dezembro apaga o rastro da margem real.
  `effectiveFee()` sempre pede a data — não existe "taxa atual".
- **`upsertSettlement` nunca sobrescreve `fee_cents` informado.** O extrato do
  adquirente é mais autoritativo que a tabela de taxa.
- **Lançamento PODE ser excluído**, diferente de loja e fornecedor. Ele é um
  fato de extrato; um fato lançado errado precisa sair, não virar "inativo"
  somando no DRE para sempre.
- **`BankTransaction.pending_import_id`/`mapping_rule_id` (FK nulável,
  `ON DELETE SET NULL`, mesmo padrão de `neutralized_with_id`) dão o vínculo
  lançamento↔extrato↔de-para** que faltava até `add-treasury-transaction-
  traceability`: `pending_import_id` aponta pro `PendingImport` de origem
  (sempre setado em `confirm`, nunca em lançamento manual), `mapping_rule_id`
  aponta pra `CounterpartyMapping` que classificou a linha em `classifyRow`
  (nulo quando um `structuralHint` decidiu em vez de uma regra, ou quando a
  linha nunca foi resolvida). Mesmo padrão em `PendingTransaction`, antes de
  virar `BankTransaction`. Limite documentado: `mapping_rule_id` registra o
  que classificou NO CONFIRM — se o lançamento for editado manualmente
  depois, o campo não acompanha a mudança (mesma filosofia de
  `counterparty_raw` nunca ser reescrito).
- **`feeCents` arredonda uma vez só, no fim.** Arredondar por parcela e somar
  diverge do total do extrato em alguns centavos por mês, e centavo que não
  bate vira hora de conciliação.
- **A ingestão de extrato/fatura (`add-treasury-statement-ingestion`) chega
  por fila, não por HTTP.** `ingestion-worker-service` parseia cada um dos 6
  arquivos mensais (6 PDF via `pdf-parse`, 1 xlsx o Bradesco) e publica em
  `TREASURY_QUEUES.RAW_ROWS` — uma fila só, porque as 7 fontes convergem no
  mesmo sink aqui, diferente de sales/supply/cost que divergem em três. Este
  serviço é só CONSUMIDOR (primeira vez que registra `HoldItModule`):
  `RawRowsWorker` recebe o lote inteiro de um arquivo num job só (nunca
  chunka por linha — um extrato mensal é centenas de linha, não milhares, e
  não tem o risco de "chunk pisa no anterior" que a ingestão de
  sales/supply tem) e chama `PendingImportService.createOrReplace`.
- **`PendingImport`/`PendingTransaction`/`PendingRejection` são a conferência
  ("staged → confirmed | rejected"), fora de `BankTransaction` de propósito.**
  Nada em staging conta em total nenhum — é exatamente o "conferir antes de
  confirmar" que a área financeira pediu, e o auto-finalize que
  `add-ingestion-flow` usa para sales/supply/cost não serve aqui. Cada linha
  chega já classificada (roda `TreasuryService.resolveMany` na chegada,
  gravando em `suggested_kind`/`suggested_category`/`suggested_nature`/
  `suggested_supplier_id`) — mas só vira `BankTransaction` de verdade em
  `POST /treasury/imports/:id/confirm`, um batch só (mesmo motivo do D5 de
  `add-ingestion-flow`: confirmação parcial não pode deixar parte das linhas
  contando e parte não).
- **Um `structuralHint` no payload da fila pula a resolução por de-para.**
  Existe para os casos em que o FORMATO do arquivo já responde a
  classificação, não o favorecido — uma linha "Inclusão de Pagamento" da
  fatura C6, ou um SISPAG do Itaú sem nome nenhum (`kind: pending` forçado,
  nunca adivinha um fornecedor). `ingestion-worker-service` decide isso, não
  este serviço — a interpretação do formato é do parser, a classificação de
  negócio é daqui, mesma separação que `add-ingestion-flow` já usa para
  motivo de remoção vs. formato do PDV.
- **Reenviar uma fonte enquanto ainda `staged` SUBSTITUI** (apaga e recria —
  mais simples que atualizar em lugar, o cascade cuida dos filhos).
  **Reenviar depois de `confirmed` cria um import NOVO**, com cada linha
  comparada contra `BankTransaction` já confirmada (mesma data+valor+
  favorecido normalizado) e marcada em `likely_duplicate_of_id` quando bate
  — nunca sobrescreve nem duplica silenciosamente o que já foi confirmado.
- **`confirm` não exige nenhuma linha resolvida.** Uma `PendingTransaction`
  ainda `suggested_kind: pending` vira `BankTransaction` com `kind: pending`
  do mesmo jeito — pendente já é um estado de primeira classe
  (`add-treasury-classification-model`), a tela de revisão é quem incentiva
  resolver antes, não este serviço.
- **As regras de classificação confirmadas viajam como seed-via-migration**
  (`prisma/migrations/20260825172504_seed_treasury_classification_rules`),
  mesmo padrão do plano de contas do `accounting-service` e das permissões
  do `iam-service` — é estrutura do negócio, não dado de um mês, e por isso
  não é um `prisma/seed.ts` separado. `ON CONFLICT ("match_text") DO
  NOTHING` porque a tabela é editável pela tela desde antes desta migration
  existir. Contas próprias, fatura/CDB/empréstimo/sócio, financeiro/tributos
  e ~30 fornecedores confirmados; os casos que NÃO viraram regra (favorecido
  em branco do PagBank, a devolução de Pix "Edson Rafael") estão documentados
  como comentário na própria migration.
- **As 6 `BankAccount` do Anexo A também são seed-via-migration**
  (`prisma/migrations/20260826020000_seed_bank_accounts`), mesmo raciocínio:
  "contas próprias... mudam raramente... sem necessidade de tela de
  auto-cadastro nesta fase" (confirmado com a área financeira). Descoberto
  como gap bloqueante ao construir a tela de upload de `add-treasury-review-
  ui` — sem conta nenhuma cadastrada, o seletor de conta por fonte não teria
  o que listar. PagBank, C6 (duas: conta corrente e cartão — únicas com duas
  contas), Nubank, Bradesco, Itaú; `last_digits` fica nulo até alguém digitar
  o final real pela tela existente de contas.

## Rotas

| Rota | Nota |
|---|---|
| `GET/POST /treasury/accounts`, `PATCH /treasury/accounts/:id` | Conta corrente e cartão |
| `GET /treasury/categories` | Categorias em uso (seed + o que uma regra já introduziu) |
| `GET /treasury/transactions` | Filtros: `period`, `from`/`to` (mês), `occurred_from`/`occurred_to` (dia, sobre `occurred_on` — independente de `period`/`from`/`to`), `account_id`, `nature`, `kind`, `direction`, `store_id`, `supplier_id`, `unresolved` |
| `GET /treasury/transactions/summary` | Totais por natureza e categoria (só `kind: expense`) + `movement_cents`, `pending_count`/`pending_cents`, `unresolved_count`. Compartilha `ListTransactionsDto`/`transactionWhere` com `listTransactions` — aceita os mesmos filtros, inclusive `occurred_from`/`occurred_to`, mesmo que o painel hoje só os use na tabela |
| `GET /treasury/transactions/by-supplier` | Despesa por fornecedor, consolidada entre contas |
| `GET /treasury/transactions/neutralization-candidates` | Sugestão de par a neutralizar — nunca vincula sozinho |
| `POST /treasury/transactions/neutralize` | `{ a_id, b_id }` → vincula o par, mesmo período |
| `POST /treasury/transactions/:id/unneutralize` | Desfaz o vínculo dos dois lados |
| `POST/PATCH/DELETE /treasury/transactions[/:id]` | `kind` obrigatório; `nature` só quando `kind: expense` |
| `PATCH /treasury/transactions/bulk` | `{ ids, nature?, category? }` — seleção múltipla da tela de Lançamentos; `nature` só grava nas linhas selecionadas com `kind: expense`, ignora as demais sem erro (não é `updateMany`: precisa do `kind` por linha, então é `$transaction` de updates individuais) |
| `GET/POST /treasury/mappings`, `PATCH`/`DELETE /:id` | O DE-PARA — agora com `kind`/`match_type` |
| `POST /treasury/mappings/apply/:period` | → `{ examined, classified }` |
| `GET/POST /treasury/fees` | Taxa por adquirente/método, com vigência |
| `GET/POST /treasury/settlements` | Recebido por meio de pagamento |
| `GET /treasury/imports` | Lista imports por `status`/`period` |
| `GET /treasury/imports/:id` | Detalhe, com `transactions` e `rejections` |
| `PATCH /treasury/imports/:id/transactions/:txId` | Corrige a classificação sugerida antes de confirmar |
| `PATCH /treasury/imports/:id/transactions/:txId/proof` | Anexa comprovante + favorecido digitado (caminho SISPAG do Itaú) |
| `POST /treasury/imports/:id/confirm` | Vira `BankTransaction` em lote — funciona com linha ainda pendente |
| `POST /treasury/imports/:id/reject` | Descarta as `PendingTransaction`, mantém o registro e o arquivo cru |

`summary` existe para a tela de fluxo de caixa não puxar milhares de linhas
só para somar no cliente — e para `unresolved_count` ficar visível: lançamento
sem fornecedor resolvido é trabalho pendente, não detalhe. Não existe rota
`POST /treasury/imports` — nada cria um import por HTTP; `RawRowsWorker`
(fila) é o único produtor.

## Estado dos dados reais (2026-08-26)

Os 11 arquivos reais que a Bárbara forneceu (jan-ago/2026, 7 fontes) já
foram parseados e estão em `PendingImport`/`PendingTransaction` — 32
imports, 12.818 linhas. Todos os 32 já foram **confirmados** (decisão do
usuário, não deste backfill): `bank_transaction` tem as 12.818 linhas reais,
todas com `pending_import_id` setado e 389 com `mapping_rule_id` (o resto
caiu em classificação por `structuralHint` do formato do arquivo, ou segue
`kind: pending` — ver gap do Anexo A abaixo). Duas fontes tiveram
`period` derivado por linha (extrato bate `occurredOn` real, mês a mês);
as duas faturas (`c6_invoice`, `pagseguro_invoice`) usam o período
declarado do arquivo inteiro, nunca a data de cada linha — motivo abaixo.

Dois arquivos reais eram cópia (nomeados "jan a junho" mas, pelo próprio
cabeçalho do PDF, já cobrindo até 31/07/2026): `"C6 jan a junho.pdf"`
sobrepõe `"extrato c6 julho.pdf"` (mesmo total exato de julho — usado só o
primeiro) e `"Pagbank jan a junho.pdf"` sobrepõe `"Pagbank julho.pdf"`
(emitido 4 dias depois, 11 linhas a mais de liquidação tardia — o mais
recente venceu para 2026-07, o mais antigo perdeu só esse mês). Vale
reconferir a cada novo lote de arquivo real: o nome do arquivo já mostrou
duas vezes que fica desatualizado antes do conteúdo.

## Gaps conhecidos

- **Os parsers de `ingestion-worker-service` já foram validados contra
  arquivo real** (2026-08-26, um mês por fonte — ver
  `add-treasury-statement-ingestion/design.md` D9-D11 pro levantamento
  completo). O layout que era suposição virou medição, incluindo a 7ª fonte
  (fatura PagSeguro) descoberta só ao medir os arquivos reais. Bradesco é
  `.xlsx`, não CSV como assumido originalmente. Ao processar múltiplos
  meses reais de uma vez (backfill acima), dois achados novos: o Itaú tinha
  uma linha fantasma — `SALDO ANTERIOR` (saldo de abertura reportado,
  mesmo rótulo do Bradesco) não estava na lista de linha-de-saldo excluída,
  então virava uma transação de R$0,00 num dia sem lançamento real
  (corrigido, `BALANCE_LINE_PATTERNS`); e a data de cada linha de FATURA
  (C6, PagSeguro) é a data de compra/ciclo, não "a quem esse valor
  pertence" — uma fatura "junho" pode não ter nenhuma linha datada em
  junho (o ciclo de fechamento cai em maio). Período de fatura é sempre o
  declarado no upload, nunca inferido da data da linha.
- **As ~30 regras de de-para (Anexo A) foram escritas contra o texto que a
  área financeira DESCREVEU, não contra o texto que o parser EXTRAI de
  verdade — os dois podem divergir.** Achado ao validar C6: "Débito de
  Cartão" real inclui cidade/estado colados no nome do estabelecimento
  ("ASSAI ATACADISTA LJ49 SAO PAULO BRA", não só "ASSAI ATACADISTA LJ49"),
  o que quebra um `match_type: exact`. Efeito esperado: um pico de
  `kind: pending` no primeiro upload real de cada fonte, mesmo com o parser
  100% correto — é gap de DADO de classificação, não de parsing. Regra
  `contains` (`POSTO`, `KFC`, ...) não sofre disso; regra `exact` de nome
  de fornecedor pode precisar de ajuste pontual pela tela de-para assim
  que aparecer o primeiro caso real.
- **`applyMappings` faz um UPDATE por lançamento**, não um `updateMany` por
  regra. Fica O(n) em ida ao banco. Aceitável no volume atual (centenas por
  mês); se virar milhares, agrupar por regra.
- **`normalizeCounterparty` duplica `normalizeAlias` do
  `suppliers-service`.** Os dois precisam concordar, e hoje isso é garantido
  por teste em cada lado, não por código compartilhado. Extrair para um
  pacote de contrato quando um terceiro serviço precisar do mesmo dobramento.
- **"Dedução de receita" (ex.: repasse de 5% à Plena Saúde) não tem `kind`
  próprio.** Seedado como `expense`/`operating` por ser o mais perto do
  real hoje — um `kind: revenue_deduction` é um gap conhecido, não
  implementado nesta fase (ver comentário na migration de seed).
- **Regras que dependem do VALOR do lançamento não são expressas pelo
  de-para** (ex.: Amlabs Ventures — R$652,20 é sempre ativação de loja nova,
  o restante é mensalidade). Seedado com a categoria mais comum
  (mensalidade); o caso do valor específico precisa de correção manual por
  lançamento.
