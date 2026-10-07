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
- Correção retroativa de custo é uma versão corretiva de mesma data de vigência — agora **sem sobrescrever**
  (ver "Versões só crescem" abaixo).


## Versões só crescem, e dizem de onde vieram (`add-product-cost-price-versioning`)

`cost_version` e `price_version` são **append-only**. Gravar uma data que já tem versão **adiciona** outra; nenhuma é sobrescrita nem apagada.
Quem vale numa data (`utils/resolve-version.ts`, a única regra): a **maior data de vigência ≤ data**; entre versões da mesma data, para
**custo** a de origem mais forte (`invoice` > `manual` > o resto) e depois a **última gravada**; para **preço**, a última gravada. Antes da
primeira versão, ausente — nunca cai para a mais nova. O contrato do `bulk` (particionado) não mudou.

- **Origem em toda versão:** `source` (`manual | invoice | pricing_intelligence | catalogue_sync | legacy_import | other`), `actor`, `reason`,
  `source_ref` (chave de idempotência: o mesmo `(source, source_ref)` nasce uma vez, índice parcial no banco) e, no custo de NF,
  `supplier_id`, `purchase_id`, `purchase_item_id`, `invoice_number`, `purchase_quantity`, `purchase_total_cents`, `pack_quantity`,
  `units_per_pack`. `utils/provenance.ts` valida: **manual exige usuário e motivo**; **invoice exige fornecedor, compra, item e chave**;
  dados de compra só com `invoice`; preço nunca é `invoice`; `pricing_intelligence` exige o usuário e o id da decisão. `legacy_import`
  só a migration escreve. Sem `source` o padrão é `other` (não `manual`: a importação de custo do ingestion não é digitação).
- **Sem `source` no banco não há default**: uma versão nova esquecida de rotular é recusada, nunca vira "legado".
- **Backfill:** as versões que já existiam viraram `legacy_import` (255 custos e 23 preços na cópia testada), sem usuário nem fornecedor inventados.
- **Gravar o mesmo valor, data e origem de novo não faz nada** (reaplicar a planilha não duplica); a resposta traz `created` e `in_force`
  (falso quando outra versão da mesma data prevalece, ex.: uma NF sobre um manual).
- **Fim de vigência é derivado** (`utils/describe-versions.ts`): o dia antes da próxima data; versão sobreposta na mesma data aparece
  `superseded` e sem fim. `GET /products/:id/costs|prices` devolvem isso junto da origem. Nada guardado, então nunca discorda da série.
- `/catalogue-sync/apply` só **adiciona** (`catalogue_sync`) e a leitura do "estado atual" usa a mesma regra.
- `product.sale_unit` (padrão `un`); o código interno é o SKU.
- Teste de integração (`test/`) roda contra o banco do ambiente: **só contra um banco descartável**.

### Linha do tempo e margem por período (`TimelineService`)

`GET /products/:id/timeline`: tudo o que mudou em custo e preço, do mais novo ao mais antigo; cada evento traz o valor que substituiu
(derivado da série, nunca guardado), a origem, o usuário, o fornecedor e a nota, e `superseded`. `history_available_from` diz onde o dado
começa — **nada é afirmado antes dele**. `GET /products/:id/price-margins`: a margem do produto `(preço − custo)/preço` **quebrada em toda
mudança de custo ou de preço**; cada intervalo lê as versões em vigor **na sua data**, então um custo novo nunca altera um intervalo
antigo (exemplo do dono nos testes: custo 5,70 → 6,20 em 10/10, preço 11,90 → 12,50 em 16/09 dá 52,1% → 54,4% → 50,4%). Margem vazia
(nunca zero) quando falta custo ou preço. É a margem do PRODUTO, não a econômica do motor de precificação.

## Vários EANs por produto (`ProductEan`)

O **SKU identifica o produto; o EAN identifica a embalagem.** Um produto pode ter vários EANs ao longo do tempo (embalagem nova, outro
fornecedor), e trocar de EAN **não** cria produto: o histórico de custo, preço, compras, vendas e margem continua do SKU. A coluna única
`product.ean` deixou de existir; no lugar, `product_ean` (`status active|inactive`, `is_primary`, `valid_from`/`valid_to`, `source`,
`actor`, `note`).

- **Nada é apagado.** Não há `DELETE`: parar de usar um EAN é **inativá-lo** (grava `valid_to`; ele continua achando o SKU) e pode ser
  reativado no mesmo vínculo. `POST /products/:id/eans` aceita `make_primary` e `retire_current` (novo principal + o antigo inativo com data
  de fim, `valid_from − 1 dia`). `PATCH /products/:id/eans/:eanId` inativa/reativa, troca o principal ou edita a observação.
- **Travas no banco** (índices parciais da migration): um EAN **ativo** pertence a **um** produto; no máximo **um principal** por produto,
  e ele é ativo; `(product_id, ean)` único. O serviço checa antes e devolve 409 **nomeando o produto**; uma corrida cai no mesmo 409.
- **Quem acha o SKU** (`POST /eans/resolve`, particionado como os outros lookups; regra pura em `utils/ean.ts`): EAN ativo → o produto;
  sem ativo, **histórico em exatamente um produto → resolve, marcado `historical`**; histórico em **mais de um → `ean_ambiguous`** (não
  resolve, devolve os candidatos); sem vínculo → **`ean_not_identified`** e **nenhum produto é criado**; formato ruim → `ean_invalid`.
- **Criar produto com um EAN que já pertence (ou pertenceu) a outro produto é recusado** (409): é um vínculo a acrescentar àquele produto.
  A sincronização da planilha também enxerga os EANs históricos e avisa "já pertence (ou já pertenceu) ao SKU X".
- O `ean` do `ProductView` é o **principal** (ou o ativo mais recente); nunca um inativo. Vínculos vindos da carga inicial: `source =
  legacy_import`, **`valid_from` vazio** (nunca registrado, não se inventa data).
- **Dado real (2026-10-07): só 1 dos 255 produtos tinha EAN cadastrado** — a planilha de precificação tem EAN, mas a sincronização nunca
  reescreve produto existente. Enquanto isso não for corrigido, a NF-e casa por EAN em quase nada.

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
  `supplier_id` fica nulo até alguém vincular); `ProductView` devolve `supplier_id` e `PATCH /products/:id` aceita `supplierId` (null desvincula), e hoje devolve também `eans`, `subcategory`, `status`, `sale_unit` e `origin` (o `PATCH` aceita `subcategory`, `status` e `saleUnit`); o arquivo
  é escolhido à mão (sem leitura automática do Drive); depois de cadastrar, as linhas já rejeitadas
  como `unknown_sku` só entram numa NOVA importação de vendas/abastecimento.

`ProductView` devolve `ean` (o principal), `eans` (todos, com status e validade) e `supplier_id`.

`POST /products` aceita `ean` (8–14 dígitos; duplicado → 409) e `supplierId`, para cadastrar produto novo dentro do formulário de compra.


## Origem do cadastro e SKU sugerido (`add-product-cost-price-versioning`, 1c.1–1c.2)

`product.origin`: `manual` | `invoice` (cadastrado a partir de uma linha de NF-e) | `legacy_import` (carga inicial: **origem não registrada**, nunca
chutada; os 255 produtos existentes ficaram assim). Origem `invoice` só vale com a evidência: nº da nota, fornecedor, data da nota e usuário
(`origin_invoice_number/supplier_id/purchase_id/on/actor`); sem ela o `POST /products` recusa e um `CHECK` do banco recusa também (escrito com
`IS NOT NULL` explícito). `POST /products` aceita ainda `subcategory` e `saleUnit`; o EAN da linha entra como EAN **principal ativo**, fonte
`invoice_import`, ator e `valid_from` = data da nota. EAN que já é de outro produto, ou SKU repetido: recusa 409 e nada é criado.
`GET /products/next-sku` devolve `{ suggested, highest, suggestion: true }`: o número depois do maior SKU de seis dígitos (`utils/next-sku.ts`);
**é sugestão, nada é reservado** (SKU repetido é recusado ao criar); sem SKU de seis dígitos, ou após 999999, `suggested` é null. A leitura do
produto traz `origin {type, invoice_number, supplier_id, purchase_id, on, actor}`. O primeiro custo do produto novo **não** é gravado aqui:
nasce da compra, pelo outbox do suppliers-service, na data de recebimento.
