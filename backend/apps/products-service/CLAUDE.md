# backend/apps/products-service

Catálogo de SKUs e a **referência de custo datada** de que toda cifra em
dinheiro da plataforma deriva. Ver [../../CLAUDE.md](../../CLAUDE.md) para as
convenções do workspace backend.

**Consumidores**: `finance-service` e `supply-service` (custo as-of para valorar
um período), `ingestion-worker-service` (resolve nomes e grava custos da
planilha de preços), `gateway-service` (leituras do painel).

## Rotas

| Rota | Uso |
|---|---|
| `GET/POST /products`, `GET/PATCH /products/:id` | Catálogo |
| `POST /products/:sku/costs` | Registra custo com data de vigência |
| `GET /products/:id/costs` | Histórico de custo |
| `GET /costs?sku=&as_of=` | Custo de um SKU **numa data** |
| `POST /costs/bulk` | Custos de um conjunto de SKUs numa data — resultado particionado |
| `POST /names/resolve` | Resolve nomes do PDV para produtos |
| `GET/POST/DELETE /names/overrides` | Tabela curada de overrides |
| `GET /health`, `GET /docs` | Health e OpenAPI |

## As duas regras que produzem dinheiro errado se implementadas "quase certo"

**1. Custo é série datada, e não existe "custo atual".**
Não há coluna `current_cost` em `Product`, nem operação que devolva custo sem
data. Isso é deliberado: um campo mutável é a coisa fácil de ler por acidente,
e lê-lo para um mês histórico reprecifica aquele mês silenciosamente — os
números simplesmente mudam, sem nada indicando. Modelando custo **só** como
série, não existe esse campo para ler errado.
Regra: a versão mais recente com `effective_from <= as_of`. Antes de todas →
reporta ausência, **nunca** cai para a mais antiga.

**2. Busca em lote devolve resultado particionado, não um mapa.**
`{ resolved, unresolved (com motivo), complete }`. Um mapa convidaria
`costs[sku] ?? 0`, e essa única expressão é como um SKU sem preço vira zero
silencioso — o que subestima CMV **e** perda, deixando os números *melhores*,
então ninguém questiona. A forma particionada não tem jeito natural de
expressar "trate ausente como zero" sem escrever algo que parece errado.

O shape do lote vive em `@app/products-contracts` (não é restated aqui), com
`assertCompleteCosts()` — a forma correta de consumir: quem precisa de um total
tem que primeiro estabelecer que nada ficou sem resolver.

## Matching de nomes

Normalização (caixa, acentos, espaços) → override curado, que **vence**. Um
override existe porque um humano olhou um mismatch real e decidiu; então ele
precisa poder **corrigir** um match normalizado errado, não só preencher lacuna.

**Não há matching fuzzy, e não deve haver.** Casar "Guaraná 350ml" com
"Guaraná 600ml" gera um custo plausível, errado e que ninguém percebe — pior
que um SKU não-casado, que é barulhento e é corrigido. Ambiguidade (mais de um
candidato) vira `ambiguous_name`, nunca escolha arbitrária.

## Dinheiro é inteiro em centavos

`cost_cents: Int`. Nunca float: esses valores são somados por milhares de linhas
e multiplicados por quantidades — exatamente o padrão que acumula erro de ponto
flutuante binário. A diferença resultante contra a planilha do operador seria
pequena, real e caríssima de diagnosticar.

## Catálogo estendido e preço de venda

`subcategory`, `ean`, `supplier_id`, `net_weight`, `ncm`, `cest`,
`shelf_life_days` e `status` vieram das abas de produto da planilha. Todos
nullable pelo mesmo motivo de sempre: os 232 produtos existentes não têm
nenhum deles.

`ean` é **unique**: dois produtos com o mesmo código de barras é erro de
cadastro, e o PDV resolve a venda por ele — um EAN duplicado atribuiria a
venda ao produto errado.

`PriceVersion` espelha `CostVersion` deliberadamente, incluindo o contrato
temporal: **não existe "preço atual" sem data**, pelo mesmo motivo de não
existir "custo atual". As duas pontas do cálculo de margem precisam do mesmo
contrato, senão o preço de hoje acaba comparado com o custo de seis meses
atrás.

**Markup e margem não são colunas em lugar nenhum** — são derivados de custo
× preço na mesma data. Persistir os três garante que um dia discordem, e a
planilha já mostra isso: "Markup", "Valor venda s/ tx" e "Venda venda"
convivem e nem sempre fecham.

`POST /prices/bulk` é particionado (`resolved`/`unresolved`/`complete`), não
mapa — mesma decisão do `BulkCostResult`: um mapa convida a tratar preço
ausente como zero, o que aqui **infla** a margem em vez de deixar o buraco
visível.

## Gaps conhecidos

- Sem autorização própria — enforcement é do gateway, que ainda não existe.
- Sem custo por loja: custo é de rede. Mudar isso é mudança de spec.
- Sem preço de venda: a reconciliação usa **custo**; receita vem dos relatórios
  de venda, que já a declaram.
- Correção retroativa de custo é feita gravando uma versão corretiva para a
  mesma data de vigência; não há trilha de auditoria de correções.


## Vínculos de SKU (`SkuLink`) — troca de código de barras

`GET/PUT /sku-links`, `DELETE /sku-links/:id` (gateway: `/sku-links`, `products:read`/`products:write`).
O operador confirma na Visão Geral que um SKU novo é o MESMO produto de um antigo com
outro código (`decision = same`) ou que não é (`different`, só silencia a sugestão do
front). O backend nunca sugere nem vincula sozinho. `utils/sku-link.ts` recusa auto-vínculo,
ciclo e um mesmo código antigo virando dois produtos; os dois SKUs precisam existir no
catálogo. O efeito (somar histórico) é calculado no frontend (`lib/overview/sku-match.ts`);
nenhum dado de vendas/abastecimento é reescrito. Gap: sem tela de revisão/desfazer
(o `DELETE` existe, sem UI).


## Sincronização com a planilha de precificação (`catalogue-sync`)

`POST /catalogue-sync/preview` (só calcula, `products:read`) e `POST /catalogue-sync/apply`
(grava só o que foi marcado, `products:write`), via gateway em `/catalogue-sync/*`. O
navegador lê o xlsx (SheetJS, `lib/catalogue-sync/parse-sheet.ts` no admin) e manda as linhas;
o plano é uma função pura (`utils/catalogue-sync.ts`, com spec) recalculada no `apply` — nunca
se confia no plano vindo do cliente. **Só CRIA produto novo e registra versões datadas de
custo/preço**; nunca reescreve nome, categoria ou EAN de produto existente.

- Categoria segue a convenção real dos 233 produtos: Bebidas/Cafés → `beverage`, Mercearia →
  `essential`, todo o resto (inclusive congelados e marmitas) → `snack`.
- Vigência em dois campos: produtos NOVOS valem desde o início do mês em que começaram a vender
  (a margem desse mês resolve o custo); MUDANÇAS em existentes valem desde hoje (retroativo
  reprecificaria meses fechados). O catálogo carregado em jan/2026 tem custos com vigência 2026-01-01.
- Avisos (não bloqueiam): custo `#ERROR!` (nunca aplicado), custo R$ 0,00 (margem leria 100% —
  ok se foi brinde), SKU repetido, EAN já usado por outro SKU (novo é cadastrado sem EAN), EAN
  arredondado pelo Excel (7.89856E+12), categoria em branco. Bloqueia: produto novo sem nome.
- O catálogo real não tinha NENHUM preço de venda cadastrado: a primeira sincronização propõe
  preencher o preço de todos os existentes.
- Gaps: fornecedor da planilha só é exibido (products-service não fala com suppliers-service;
  `supplier_id` fica nulo até alguém vincular); `ProductView` devolve `supplier_id` e `PATCH /products/:id` aceita `supplierId` (null desvincula), mas ainda não devolve EAN/subcategoria; o arquivo
  é escolhido à mão (sem leitura automática do Drive); depois de cadastrar, as linhas já rejeitadas
  como `unknown_sku` só entram numa NOVA importação de vendas/abastecimento.

`ProductView` agora devolve `ean` (casamento das linhas de NF-e de compra) além de `supplier_id`.
