# Fluxo de caixa (`/finance/cash-flow`) — redesenho

Status: aprovado pelo operador em 2026-09-16, aguardando plano de implementação.

## Contexto

O operador pediu o redesenho de duas telas a partir de um mockup: Lançamentos
(`/treasury`, tela de classificação contábil) e Fluxo de caixa
(`/finance/cash-flow`, tela de decisão sobre caixa). A mudança em Lançamentos
é pontual sobre um fluxo que já existe (remover card duplicado, reduzir
gráfico a 2 barras, adicionar seleção múltipla + edição inline + endpoint de
update em lote) e não precisa de spec — vai direto para implementação normal.

Este documento cobre só o Fluxo de caixa, porque é reconstrução de verdade,
não edição: a rota já existe hoje, mas é outra coisa — um formulário onde
alguém digita 5 números por mês (saldo inicial, recebimentos, OPEX,
empréstimos, CAPEX) e vê um gráfico de linha do saldo acumulado
(`accounting-service`, dado é PREMISSA digitada, nunca extrato real). O
mockup pede um dashboard diário, regime de caixa, alimentado por dado
bancário real — degrau de complexidade diferente, decisões de dado novas.

**Decisões já tomadas com o operador** (não reabrir sem motivo novo):
- Open Finance (Pluggy/Belvo), sync automático do Drive em background e
  captura por voz/foto ficam de fora desta fase — a tela é construída sobre
  o que já existe (extrato importado manualmente, mesma base de
  `treasury-service`). Sem gancho de UI fingindo que essas integrações
  existem.
- Sem conceito de lançamento "Previsto" nesta fase — só Realizado. Sem
  "Lançamento rápido" (nem texto, nem voz/foto). O toggle
  Realizado/Previsto/Ambos do mockup não entra.
- "Conciliado" = já classificado (`kind ≠ pending`), não um motor de
  matching contra uma segunda fonte de verdade — não existe segunda fonte
  sem Open Finance. "Saldo bancário" = soma de tudo que foi importado
  (inclusive pendente); "saldo em sistema" = soma só do já classificado. A
  diferença entre os dois é literalmente o que falta classificar, o mesmo
  número que já aparece como "Pendente" em Lançamentos.
- `/finance/cash-flow` vira o dashboard novo. O formulário de premissa
  mensal atual (`useGetCashFlowQuery`/`usePutCashFlowMutation`,
  `accounting-service`) muda de rota para `/finance/cash-flow/premises` —
  continua existindo porque `capex-service`/`billing-service` ainda
  dependem dele enquanto payback/repasse forem métrica derivada sobre
  premissa (ver CLAUDE.md raiz, seção "Suporte à decisão financeira").

## Fora de escopo (explícito)

- Open Finance / qualquer agregador (Pluggy, Belvo).
- Sincronização automática/background com Google Drive.
- Captura por voz ou foto (STT, OCR/visão computacional).
- Lançamento "Previsto" e o toggle Realizado/Previsto/Ambos.
- "Itens que explicam a diferença" (divergência de timing D+1 etc.) — só
  existe entre DUAS fontes independentes; aqui há uma só.
- Qualquer alteração ao formulário de premissa mensal além de mudar de
  rota.

## Modelo de dados e regra de agregação

Mesma tabela `bank_transaction` de Lançamentos — não é um dado novo, é uma
lente diferente sobre o mesmo dado, lida por `occurred_on` (data real do
lançamento) em vez de `period` (competência). Isso já diverge de Lançamentos
em casos reais: uma parcela de cartão comprada em janeiro pode ter `period`
(competência) em junho — Fluxo de caixa deve mostrar essa parcela em janeiro
(quando o dinheiro de fato saiu/entrou), Lançamentos em junho.

**Por que os números de Entrada/Despesa desta tela vão ser DIFERENTES dos
cards de Lançamentos, por design:**
`GET /treasury/transactions/summary` (o endpoint que Lançamentos usa) já
aceita `occurred_from`/`occurred_to`, mas seu `inflow_cents`/`outflow_cents`
são estritamente `kind: revenue` / `kind: expense` — exclui qualquer
`kind: movement` (transferência entre contas, empréstimo, retirada de
sócio, CDB, pagamento de fatura). Isso é uma lente contábil correta para o
DRE, mas **não fecha com o saldo real do banco**, porque um empréstimo
recebido ou uma retirada de sócio é caixa de verdade entrando/saindo, só
não é resultado. A regra de ouro desta tela ("o saldo final sempre fecha
com o saldo real do banco") obriga uma regra diferente:

- **Saldo (inicial/final)**: soma de TODAS as linhas do período (qualquer
  `kind`/categoria) — é o saldo de caixa de verdade.
- **Entradas/Saídas (cards + gráfico diário), com "Todas as contas"
  selecionado**: soma de tudo EXCETO a categoria `"Movimentação entre
  contas"` (transferência entre as próprias contas Agiliz.AI) — essa
  categoria, e só ela, é excluída porque cada transferência tem uma ponta
  de saída numa conta e uma ponta de entrada em outra (rastreável via
  `neutralized_with_id`, já existente), então soma zero no consolidado. As
  demais categorias hoje classificadas como `movement` (empréstimo, sócio,
  CDB, pagamento de fatura) **entram** em Entradas/Saídas — são caixa real
  saindo da empresa, mesmo não sendo resultado contábil.
- **Entradas/Saídas com UMA conta específica selecionada**: soma de TUDO,
  sem excluir `"Movimentação entre contas"` — do ponto de vista de uma
  conta isolada, uma transferência para outra conta própria é caixa real
  saindo dessa conta (a ponta de entrada está em outra conta, não nesta).
  Excluir aqui quebraria a fórmula "saldo inicial + entradas − saídas =
  saldo final" para visão de conta única.
- Com essas duas regras, a fórmula **sempre fecha exatamente**, em
  qualquer seleção de conta — não é aproximação.
- **Despesa por categoria (donut)**: reaproveita `by_category` do
  `summary()` existente (só `kind: expense`, já correto — categoria de
  transferência/empréstimo não faz sentido num donut de despesa
  classificada), chamado com `occurred_from`/`occurred_to` em vez de
  `period`. Nenhum código novo aqui.
- **Tabela "Movimentações"**: `GET /treasury/transactions` com
  `occurred_from`/`occurred_to` (já suporta, já é usado assim por
  Lançamentos na tabela principal) — sem endpoint novo. Coluna "Tipo"
  deriva de `direction` + `category === "Movimentação entre contas"` →
  "Transferência"; senão Entrada/Saída pelo `direction`. Coluna "Conciliado"
  deriva de `kind`: `pending` → "Pendente"; qualquer outro → "Sim". Coluna
  "Regime" sempre "Realizado" nesta fase (documentado acima).

**Gap conhecido, documentar na tela, não esconder**: "saldo inicial" é
calculado como soma de tudo importado antes da data de início — isto é, a
tela assume saldo zero antes do primeiro lançamento importado de cada
conta. Para contas com lacuna de importação conhecida (Itaú jan-abr/2026,
C6 cartão jan-mai, PagSeguro cartão mar-ago, Bradesco jan-mar/jul-ago — ver
histórico desta sessão), o saldo inicial de qualquer período que dependa
desses meses vai estar incorreto por não contar o saldo real de antes da
lacuna. Não há como resolver sem os extratos que faltam ou uma âncora de
saldo manual — fica registrado como limitação conhecida, não resolvido
nesta fase.

## Backend — um endpoint novo em `treasury-service`

`GET /treasury/transactions/cash-flow` — novo método em `TreasuryService`,
mesmo `ListTransactionsDto`/`transactionWhere` de `listTransactions` como
base de filtro (`occurred_from`, `occurred_to`, `account_id` — período/mês
não se aplica aqui, é sempre range de dia).

Resposta:
```ts
interface CashFlowSummary {
  from: string // occurred_on
  to: string
  account_id: number | null // null = todas as contas
  opening_balance_cents: number // soma de tudo antes de `from`
  inflow_cents: number
  outflow_cents: number
  closing_balance_cents: number // opening + inflow - outflow, sempre bate
  daily: { date: string; inflow_cents: number; outflow_cents: number; balance_cents: number }[]
}
```

Implementação: uma query para `opening_balance_cents` (soma assinada de
tudo com `occurred_on < from`, filtrado por `account_id` quando informado),
uma query agrupada por dia (`GROUP BY occurred_on`, mesmo filtro de
exclusão condicional de `"Movimentação entre contas"` descrito acima) para
preencher `daily[]`, com `balance_cents` sendo a soma corrida a partir de
`opening_balance_cents`. `inflow_cents`/`outflow_cents`/`closing_balance_cents`
do topo são a agregação total do range (soma dos `daily[]`, não uma query
separada).

**Índice novo**: não existe hoje índice em `occurred_on` isolado nem em
`(account_id, occurred_on)` — todos os índices atuais são sobre `period`.
A query de `opening_balance_cents` (`WHERE occurred_on < :from`) e a
agregação diária vão fazer sequential scan sem um. Adicionar
`@@index([account_id, occurred_on])` no `schema.prisma` do
`treasury-service`, migration nova.

Rota registrada no `gateway-service` (`treasury.controller.ts` do domínio),
mesmo padrão das rotas de `treasury` já expostas.

## Frontend

**Rotas:**
- `frontend/apps/admin/src/app/(app)/finance/cash-flow/page.tsx` — dashboard
  novo, consome `GET /treasury/transactions/cash-flow` (via
  `src/lib/api/treasury.ts`, novo `useGetCashFlowSummaryQuery`) +
  `GET /treasury/transactions/summary` (reaproveitado, para `by_category`) +
  `GET /treasury/transactions` (reaproveitado, para a tabela de
  movimentações) + `GET /treasury/accounts` (reaproveitado, para o seletor
  de conta e o card "Contas").
- `frontend/apps/admin/src/app/(app)/finance/cash-flow/premises/page.tsx` —
  o arquivo atual de `cash-flow/page.tsx` movido pra cá sem mudança de
  lógica (só rota), continua em `accounting-service`
  (`useGetCashFlowQuery`/`usePutCashFlowMutation`).
- Sidebar (`app-sidebar.tsx`): "Fluxo de caixa" continua apontando para
  `/finance/cash-flow`; adicionar um link secundário discreto (ex: dentro
  da própria tela nova, não no menu principal) para "Premissas mensais" →
  `/finance/cash-flow/premises`, já que essa tela vira uso raro/interno.

**Composição da tela nova** (mapeado 1:1 ao mockup, menos o que está fora de
escopo):
- Filtros: período (reaproveita `DateRangePicker` já usado em Lançamentos),
  seletor de conta (`Select` sobre `useGetAccountsQuery`, com opção "Todas
  as contas" = `account_id` omitido).
- Fórmula de fechamento em destaque: Saldo inicial · Entradas · Saídas ·
  Saldo final — 1:1 com `CashFlowSummary` do endpoint novo.
- 4 cards de KPI: Entradas, Saídas, Saldo do período (`inflow - outflow`),
  Saldo final — reaproveita o componente `SummaryCard` já extraído em
  `treasury/page.tsx` (ou promovido para um local compartilhado, ver
  "Refatoração" abaixo).
- Gráfico "Fluxo de caixa diário": barras de entrada/saída + linha de saldo
  — `ComposedChart` do `recharts` (já é dependência), sobre `daily[]`.
  Reaproveita `ChartContainer`/`ChartConfig` como os gráficos de Lançamentos.
- "Despesas por categoria": donut — `PieChart` do `recharts` (novo uso
  nesta tela; Lançamentos usa grade de ícones, não donut — o mockup pede
  donut aqui especificamente, mantido).
- Tabela "Movimentações": mesma composição de colunas de
  `TransactionsTable` (Lançamentos) mas com "Tipo"/"Regime"/"Conciliado" em
  vez de "Categoria"/"Tipo"/ações — componente novo e separado
  (`CashFlowMovementsTable`), não reaproveita `TransactionsTable` direto
  porque as colunas divergem o suficiente pra virar uma prop `mode` confusa.
  Linhas "Previsto" atenuadas: não se aplica nesta fase (documentado acima),
  todas as linhas são Realizado.
- "Contas conectadas": lista `useGetAccountsQuery()` de verdade, rotulada
  honestamente — não "Sincronizado há 4 min" (falso, não existe live sync),
  e sim algo como "Extrato importado até {data do lançamento mais recente
  da conta}". Botão "+ Conectar novo banco" **não entra nesta fase** (abriria
  um fluxo Open Finance que não existe) — hoje não existe NENHUMA tela de
  cadastro de conta (as 6 `BankAccount` são seed-via-migration, por decisão
  documentada no CLAUDE.md do `treasury-service`: "sem necessidade de tela
  de auto-cadastro nesta fase"); uma conta nova continua sendo cadastrada do
  jeito que é hoje (migration), não é um gap que este redesenho introduz.
- **Fora da tela nesta fase** (sem gancho fingindo funcionar): bloco
  "Sincronização com o Drive", botões "🎤 Falar um gasto"/"📷 Foto do
  pedido/nota", "Itens que explicam a diferença", toggle
  Realizado/Previsto/Ambos, painel "Insights" (é alerta automático — pode
  virar fase 2 sobre o mesmo dado, mas não tem regra definida ainda, não
  inventar regra só pra preencher o espaço).

**Refatoração pequena, não adicionar complexidade nova**: `SummaryCard`
hoje é uma função não-exportada dentro de `treasury/page.tsx`. Promovê-la
para `src/components/summary-card.tsx` (mesma assinatura, sem mudança de
comportamento) para os dois arquivos consumirem — evita duplicar o
componente, que já tem ícone/trend/tone.

## Verificação

- `pnpm --filter @agiliz/admin typecheck`/`lint` limpos, mesmo padrão da
  sessão.
- Novo teste de integração em `treasury-service` para `cash-flow`: caso com
  transferência entre duas contas no mesmo range (verifica soma zero no
  consolidado e não-zero em conta isolada), caso com `kind: movement`
  não-transferência (empréstimo) entrando em entradas/saídas, caso
  `opening_balance_cents` com lançamento anterior ao range.
- Verificação visual no navegador real (mesmo processo desta sessão:
  usuário de teste separado via `POST /users` do `iam-service`, sem tocar
  em conta real, apagado ao final) — conferir que a fórmula
  "saldo inicial + entradas − saídas = saldo final" bate exatamente para
  "Todas as contas" e para uma conta isolada, com um mês real (ex:
  2026-06, mesmo período usado na investigação de performance).
