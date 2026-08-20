# backend/apps/accounting-service

Plano de contas, lançamentos, DRE e fluxo de caixa. Ver
[../../CLAUDE.md](../../CLAUDE.md) para as convenções do workspace backend.

**Consumidores**: `gateway-service` (rotas `/accounting`).
**Depende de**: `@app/health`, `@app/prisma-db-client`. Sem fila.

Origem na planilha: abas `DRE` (165 linhas) e `Fluxo de caixa`.

## A fronteira com `finance-service`

Este serviço **não recalcula CMV, sobra nem perda**. Esses números são do
`finance-service`, que é a fonte de verdade por loja/mês — regra da raiz do
repo, sem exceção. Eles chegam aqui como `LedgerEntry` com
`origin = "finance"`.

O campo `origin` (`manual` · `treasury` · `sales` · `finance` · `billing`) é
o que permite dizer se uma linha do DRE é **FATO** (veio de um serviço) ou
**PREMISSA** (alguém digitou no painel). Sem ele o DRE mistura os dois e a
skill `autonomous-retail-cfo` não tem como rotular o que apresenta.

## Decisões que não são óbvias no código

- **`store_id` nulo significa "rede"**, e a mesma tabela guarda os dois
  níveis. A planilha faz assim, e separar em duas tabelas obrigaria a somar
  as duas para chegar ao mesmo lugar.
- **Índice único PARCIAL para a linha da rede.** Em Postgres `NULL <> NULL`,
  então `@@unique([account_id, period, store_id])` **não** impede duplicar o
  consolidado. O `CREATE UNIQUE INDEX ... WHERE store_id IS NULL` da migration
  inicial é o que protege de verdade — Prisma não expressa índice parcial no
  schema. Mesmo caso em `pnl_snapshot`.
  Como consequência, `putEntry` e `computeSnapshot` fazem find-then-write numa
  transação em vez de `upsert`: `upsert` não endereça chave composta com
  coluna nula.
- **`computePnl` recebe toda despesa POSITIVA** e faz a subtração. Passar
  despesa já negativa dobra o sinal — a classe de erro que a planilha comete
  ao arrastar fórmula.
- **`break_even_cents = -1` quer dizer "indefinido"**, não "já está no
  equilíbrio". Sem receita, ou com margem de contribuição não-positiva,
  nenhum volume de venda cobre o fixo; devolver `0` ali afirmaria o contrário
  da verdade. A tela mostra "—".
- **Conta-mãe só soma as filhas quando não tem valor próprio.** A planilha
  tem linhas de total lançadas à mão, e sobrescrevê-las com uma soma parcial
  mudaria número conferido.
- **`PnlSnapshot` materializa os totais** porque a tela mostra série de 12
  meses, e porque um mês `closed` não pode mudar de valor quando alguém
  corrige um lançamento antigo.
- **`closing_balance_cents` do fluxo é sempre derivado**, nunca aceito do
  chamador.

## Rotas

| Rota | Nota |
|---|---|
| `GET /accounting/accounts` | `?statement=pnl\|cashflow` |
| `POST /accounting/accounts`, `PATCH /:id` | |
| `GET /accounting/entries` | `period` ou `from`/`to`, `store_id`, `statement` |
| `PUT /accounting/entries` | Idempotente por (conta, período, loja) |
| `DELETE /accounting/entries/:id` | |
| `GET /accounting/pnl/:period` | A árvore montada, com totais |
| `GET /accounting/pnl/series` | Série de snapshots |
| `POST /accounting/pnl/:period/compute` | `?close=true` congela |
| `GET /accounting/cash-flow`, `PUT /accounting/cash-flow` | |

## Seed do plano de contas

A migration `20260820130300_seed_chart_of_accounts` traz as 56 linhas
derivadas da planilha. É **estrutura** do negócio, não dado da empresa —
mesmo critério do seed de permissões do `iam-service`. Nenhum valor
financeiro é semeado.

`Deslocamento` (4.2.03) é conta-mãe de Gasolina e Pedágio, espelhando a
planilha: sem esse vínculo as três somariam lado a lado e a despesa variável
sairia dobrada.

## Gaps conhecidos

- **Sem ingestão e sem puxada automática.** Nenhum `LedgerEntry` é criado a
  partir de `finance-service`, `sales-service` ou `treasury-service` ainda —
  o dado entra pelo painel. É o recorte desta fase, e é o maior gap do
  serviço: hoje o `origin` depende de quem digita informar a verdade.
- **`pnl()` não valida que a soma das lojas bate com o consolidado.** Uma
  linha `per_store` lançada só na rede, ou só por loja, passa sem alerta.
- **Sem DRE por loja materializado em lote.** `computeSnapshot` é um mês/uma
  loja por chamada; fechar 24 lojas são 24 chamadas.
- **A migration inicial foi gerada com `prisma migrate diff`** — o banco deste
  serviço ainda não subiu. Aplicar com `pnpm prisma:deploy` na primeira subida.
