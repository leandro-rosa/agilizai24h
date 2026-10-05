# DRE — preenchimento automático ao fechar o mês

Status: aprovado pelo operador em 2026-10-05, aguardando plano de implementação.

## Contexto

O DRE (`/finance/pnl`, `accounting-service`) lê só `LedgerEntry`, uma tabela
100% alimentada por digitação manual (`PUT /accounting/entries`) — gap já
documentado no `CLAUDE.md` do serviço ("Sem ingestão e sem puxada
automática... o dado entra pelo painel"). Os lançamentos de jan-ago/2026
foram uma carga única feita via script/API em 2026-09-18 (migração da
planilha antiga, confirmado pelos `updated_at` idênticos no banco), não um
processo recorrente. Setembro ficou vazio porque ninguém relançou.

O operador pediu: ao clicar "Fechar o mês", a tela deve puxar sozinha os
dados que o sistema já tem (treasury classificado, vendas, CMV/perda), e
continuar permitindo lançamento manual para o que não tem fonte confiável
(ele deu como exemplo Luz e Pedágio — investigação mostrou que essas duas
JÁ têm categoria real no treasury; o exemplo motivou a regra, mas não são
os únicos casos que efetivamente precisam ficar manuais — ver mapeamento
abaixo).

**Decisões já tomadas com o operador** (não reabrir sem motivo novo):
- Uma conta editada manualmente nunca é sobrescrita por uma busca automática
  futura — fica "travada" no valor digitado até uma ação explícita futura
  limpar/recalcular aquela conta especificamente (não construída nesta
  fase; não pedida).
- Clicar "Fechar o mês" na visão de REDE busca dado automático e fecha o
  snapshot de TODAS as lojas ativas de uma vez, não só o de rede — fecha
  também o gap já documentado "fechar 24 lojas são 24 chamadas".
- "Taxas da maquininha" (3.2.04) fica manual nesta fase — o cálculo certo
  cruzaria receita por método de pagamento (sales-service) × taxa vigente
  do adquirente (`GET /treasury/fees`), passada própria, não pedida agora.
- "Repasse de vendas" (4.2.01) não precisa de nada novo — já é 100%
  resolvido pela fórmula existente (5% da receita própria da loja, só
  lojas Plena Saúde; confirmado com o operador que não há repasse de
  nenhum outro cliente).

## Fora de escopo (explícito)

- Qualquer mudança na lógica de rateio já existente
  (`allocateNetworkCostsToStore` — visita/receita/divisão-igual). O
  preenchimento automático alimenta só o valor de ENTRADA (nível de rede ou
  por loja) que essa lógica já consome; a fórmula de distribuição continua
  intocada.
- Taxas da maquininha por loja (cálculo via taxa de adquirente datada).
- Fila/processamento assíncrono — a sincronização é parte da mesma request
  síncrona de "Fechar o mês", como `pnlByStore` já faz hoje (loop de N
  lojas numa chamada só).
- Reabrir/recalcular retroativamente meses já fechados (jan-ago) — o botão
  "Reapurar e fechar" já existe para isso e continua sendo uma decisão
  explícita do operador, não automática.
- Qualquer mudança em `treasury-service`, `sales-service` ou
  `finance-service` — este desenho só LÊ dos três, nenhuma rota nova neles.

## Mapeamento das 27 contas do DRE (`statement = 'pnl'`)

Investigação contra dado real (treasury: 38 categorias distintas
classificadas; `GET /sales/:storeId/totals`; `GET
/finance/:storeId/:period`):

**Puxada automática por categoria do treasury, nível de rede
(`store_id: null`)** — soma de `bank_transaction` do período por categoria,
igual ao que `/treasury` já calcula, só que lido por `accounting-service`:

| Conta | Categoria treasury |
|---|---|
| 3.1.03 Mensalidades | "Receita - Mensalidade" |
| 3.2.01 Impostos sobre a venda | "Impostos sobre a venda" |
| 4.1.02 Compra de produtos — coffee break | "Coffee break" |
| 4.1.03 Compra de produtos — frutas | "Frutas" |
| 4.2.04 Gasolina | "Combustível" |
| 4.2.05 Pedágio | "Pedágio" |
| 4.2.08 Alimentação | "Alimentação" |
| 4.3.01 Mensalidade touchpay | "Sistema Touchpay" |
| 4.3.02 Contador | "Contador" |
| 4.3.03 Pró-labore | "Pró-labore" |
| 4.3.04 Luz | "Luz" |
| 4.4.01 Juros de empréstimo | "Juros - Limite Garantido" |

4.2.03 Deslocamento (mãe de Gasolina/Pedágio/Alimentação) **nunca** recebe
valor direto — só as filhas, para não quebrar o roll-up que já soma mãe =
soma das filhas quando a mãe está em zero (`accounting.service.ts`'s
`rollUp`).

**Puxada automática por loja** (loop pelas lojas `status: 'active'` de
`stores-service`):

| Conta | Fonte |
|---|---|
| 3.1.01 Vendas lojas | `GET /sales/:storeId/totals?period=`.`revenue_cents` |
| 4.1.01 Compra de produtos — abastecimento | `GET /finance/:storeId/:period`.`cogs_cents` |
| 4.2.02 Perdas e roubos | `GET /finance/:storeId/:period`.`loss_value_cents` |

**Já resolvido, sem escrever `LedgerEntry` nenhum** — a sincronização nunca
toca esta conta, em nenhum nível:

| Conta | Por quê |
|---|---|
| 4.2.01 Repasse de vendas | Fórmula própria já existente (`PLENA_SAUDE_FLAT_RATE_CODES`) calcula direto de `storeRevenue`, sem precisar de nenhum `LedgerEntry` de entrada |

**Fica manual** (sem categoria de treasury equivalente encontrada, nem
fonte em outro serviço):

| Conta | Observação |
|---|---|
| 3.1.04 Coffee break (receita) | Nenhuma fonte rastreia isso hoje |
| 3.1.05 Frutas (receita) | idem |
| 3.2.02 Taxas voucher | Nenhuma categoria treasury isolada encontrada |
| 3.2.03 Descontos | idem |
| 3.2.04 Taxas da maquininha | Fora de escopo — ver acima |
| 4.2.06 Degustações | Nenhuma categoria treasury isolada encontrada |
| 4.2.07 Marketing | idem |
| 4.3.05 ERP Conta Azul | idem |

## Modelo de dados

Dois campos novos em `Account` (`accounting-service`, migration):

```prisma
auto_source       String?  // "treasury_category" | "sales_revenue" | "finance_cogs" | "finance_loss"
treasury_category String?  // só quando auto_source = "treasury_category"
```

Mapeamento como DADO, não código: a migration semeia os dois campos para as
15 contas da tabela acima (12 de rede + 3 por loja); as 8 contas manuais e
a 1 já-resolvida ficam com `auto_source: null`. Adicionar uma fonte nova
depois (ex.: se Marketing ganhar categoria própria) é um
`PATCH /accounting/accounts/:id`, sem deploy de código.

`LedgerEntry.origin` já existe e já tem os valores certos
(`manual | treasury | sales | finance | billing` — confirmado em
`ORIGIN_LABELS` do frontend, já esperando por isto). Nenhum campo novo
precisa nele.

## Fluxo da sincronização

Novo `UpstreamClient` em `accounting-service`, mesmo padrão exato que
`finance-service` já usa para falar com outros serviços
(`@app/http-client`, uma `<SERVICO>_SERVICE_URL` por env var, 404 tratado
como "sem dado para o período", nunca como erro de transporte):

- `activeStores()` → `GET /stores` (filtra `status: active`) — primeira
  vez que `accounting-service` chama `stores-service`. Só decide EM QUAIS
  lojas tentar buscar dado; não substitui nem altera o `activeStoreCount`
  que `allocateNetworkCostsToStore` já deriva de `LedgerEntry` com receita
  real lançada (base do rateio por divisão igual) — os dois contam "loja
  ativa" por critérios diferentes, de propósito, e continuam assim.
- `salesRevenueFor(storeId, period)` → `GET /sales/:storeId/totals`.
- `financeFor(storeId, period)` → `GET /finance/:storeId/:period`.
- `treasuryCategoryTotals(period)` → `GET /treasury/transactions?period=`,
  somado por `(kind, category)` **em `accounting-service`**, mesmo volume
  pequeno (centenas/poucos milhares de linhas por mês) que o resto do
  painel já soma no cliente sem endpoint de agregação dedicado.

`AccountingService.syncFromUpstreams(period, storeIds)`:

1. Busca os `LedgerEntry` já existentes do período (rede + todas as
   lojas), indexados por `(account_id, store_id)`, para saber quais já são
   `origin: 'manual'`.
2. Para cada conta com `auto_source: 'treasury_category'`: se a entrada de
   rede existente for `manual`, pula; senão `putEntry` com o total da
   categoria e `origin: 'treasury'`.
3. Para cada loja ativa: busca vendas e financeiro da loja; para cada
   conta `sales_revenue`/`finance_cogs`/`finance_loss` cuja entrada
   daquela loja não seja `manual`, `putEntry` com `origin: 'sales'` ou
   `'finance'`.
4. Uma falha de TRANSPORTE (não um 404) numa loja não aborta as demais —
   acumula a lista de lojas com erro e segue; "sem dado" (404) nunca grava
   nada (nunca fabrica zero) e nunca remove uma entrada manual existente.

`POST /accounting/pnl/:period/compute` (endpoint existente, mesma rota):
quando chamado **sem** `storeId` (visão de rede), passa a: rodar
`syncFromUpstreams` (rede + loop de todas as lojas ativas), então chamar
`computeSnapshot` para a rede **e** para cada loja (`close` segue o mesmo
parâmetro recebido). Chamado **com** `storeId` (fechar uma loja específica
pela própria tela dela) continua escopado só àquela loja, sem tocar rede
nem outras lojas — mesmo comportamento de hoje, só que agora também
sincroniza antes de fechar.

Resposta do endpoint ganha `{ synced: { stores_ok: number[], stores_failed:
number[] } }` — o frontend mostra um toast nomeando quem falhou, mesmo
espírito de `StorePnlSummary`/`finance-service`: incompletude nomeada,
nunca escondida.

## Lançamento manual (peça nova de UI)

Hoje não existe NENHUMA tela que chame `PUT /accounting/entries` — a rota
existe na API, nada no frontend a usa (os lançamentos de jan-ago foram uma
carga só, fora da UI). Ícone de edição em cada linha de conta do DRE
(`AccountRow`, `/finance/pnl`), abrindo um `ResourceFormDialog` com um único
campo (valor em R$); submit chama `PUT /accounting/entries` com
`{ account_id, period, store_id, amount_cents, origin: 'manual' }`.
`toCents`/`fromCents` (já existem no `resource-form-dialog.tsx`) convertem.

Sem UI nova para "mostrar a origem" — o badge que já existe por linha
(`ORIGIN_LABELS`: Manual/Tesouraria/Vendas/Financeiro) passa a refletir
automaticamente a origem real assim que a sincronização gravar.

## Tratamento de erro e estados vazios

- Loja sem venda/finance ingerido no período (404 de ambos os serviços):
  conta daquela loja fica como já estava (sem valor novo, sem zero
  fabricado) — mesma filosofia "nunca mostrar zero fabricado" do resto do
  painel.
- Treasury sem nenhuma transação da categoria no período: mesma regra —
  não escreve 0, deixa como já estava (uma categoria genuinamente zerada
  nesse mês fica indistinguível de "sem dado" nesta primeira versão; gap
  aceito, não escondido).
- Falha de transporte real (timeout, 5xx) numa loja: não aborta as demais;
  reportada nominalmente no toast de resultado.
- Botão "Fechar o mês"/"Reapurar e fechar" muda o texto de carregamento
  para refletir que agora busca dado antes de apurar (ex.: "Buscando dados
  e apurando...").

## Testes

- Unitário: `syncFromUpstreams` com cada combinação (conta manual existente
  → pula; conta sem entrada → grava; 404 de upstream → não grava nada;
  falha de transporte numa loja → outras lojas continuam).
- Unitário: migration/seed dos 2 campos novos em `Account` — conferir as 15
  contas mapeadas contra a tabela acima, e as 9 (8 manuais + 1 já
  resolvida) com `auto_source: null`.
- Integração: `POST /accounting/pnl/:period/compute` sem `storeId` fecha
  rede + todas as lojas ativas numa chamada (contra os 4 serviços reais
  stubados, mesmo padrão de `finance-service`'s `upstream.client`).
