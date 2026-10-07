# backend/apps/suppliers-service

Cadastro de fornecedores e — o ponto real deste serviço — as **grafias** sob
as quais cada um aparece nas origens. Ver [../../CLAUDE.md](../../CLAUDE.md)
para as convenções do workspace backend.

**Consumidores**: `gateway-service` (rotas `/suppliers`). `treasury-service`
e `capex-service` guardam `supplier_id` como `Int` cru — database-per-service,
sem FK cruzando serviço.

**Depende de**: `@app/health`, `@app/prisma-db-client`. Sem fila, então sem
`@app/hold-it` e sem a armadilha do `WITH_KAFKA_BROKERS`.

## Por que existe uma tabela de alias

O mesmo fornecedor aparece com grafia diferente em cada origem: o extrato
bancário traz `ASSAÍ ATACADISTA LJ49`, a fatura do cartão traz
`ASSAI ATACADISTA LJ 49`, o cadastro de produto traz `Assaí`. Sem
`supplier_alias`, cada mês de conciliação inventaria um fornecedor novo e
nenhuma soma por fornecedor faria sentido.

`normalized_alias` é `UNIQUE` de propósito: um alias que resolvesse para dois
fornecedores atribuiria a compra ao errado, em silêncio. `addAlias` recusa
com 409 em vez de aceitar a ambiguidade.

`normalizeAlias()` (`constants/supplier-vocabulary.ts`) dobra caixa, acento e
pontuação, mas **preserva o sufixo de filial** (`LJ49` ≠ `LJ144`): duas
filiais podem ser fornecedores distintos para negociação, e essa é decisão de
quem cadastra, não da normalização.

## Rotas

| Rota | Nota |
|---|---|
| `GET /suppliers` | Sem filtro de status explícito, só devolve ativos |
| `GET /suppliers/:id` | Inclui os aliases |
| `POST /suppliers` | O nome vira o primeiro alias, senão o cadastro não resolve contra o extrato que o motivou |
| `PATCH /suppliers/:id` | |
| `POST /suppliers/resolve` | Lote de grafias → `{ matched, unmatched }` |
| `POST /suppliers/:id/aliases` | 409 se a grafia já resolve para outro |
| `DELETE /suppliers/:id/aliases/:aliasId` | 204 |
| `DELETE /suppliers/:id` | **405 sempre** — inativar em vez de excluir |

`POST /resolve` devolve os dois lados. O `unmatched` é a fila de trabalho de
quem concilia: engolir isso silenciosamente esconderia compra não
classificada, que é exatamente o erro que a planilha comete hoje.

## Vocabulário

`category`: `frozen` · `beverages` · `grocery` · `wholesale` · `equipment` ·
`services` · `system`. `status`: `active` · `inactive`. Ambos em
`constants/supplier-vocabulary.ts`, não como enum do Prisma — acrescentar um
valor não deve exigir migration.

## Gaps conhecidos

- **Sem ingestão.** O dado entra pelo painel; nada lê planilha ainda. É o
  recorte deliberado desta fase.
- **`resolve` não sugere aproximação.** Grafia não cadastrada volta em
  `unmatched`, sem "você quis dizer". Casamento por distância de edição foi
  considerado e deixado de fora: um palpite errado aqui atribui dinheiro ao
  fornecedor errado, e o custo de cadastrar o alias à mão é baixo.

## Compras e acerto semanal (`src/modules/purchasing/`, `add-purchases-and-settlement`)

`Purchase` (fornecedor, data, `origin manual|nfe`, nº da nota opcional — único por fornecedor, NULL não colide) → `PurchaseItem` (SKU, unidades, custo pago em centavos, **condição `paid | bonus | on_sale`**, status de pagamento) e `Settlement` (acerto semanal por fornecedor: `proposal → confirmed → paid`, evidência em JSON). Rotas: `/purchases` (list/create/`:id`/`summary?month=`/`items/:id` PATCH/`import/preview`) e `/settlements` (`propose`, `:id/confirm`, `:id/pay`, `open-total`).

- **Acerto** (`utils/settlement.ts`, puro e testado): devido = unidades vendidas × custo; vendidas vêm de `sales-service /sales/network/sold-by-sku` (recibos com data); **vencidos e devolvidos são informados pelo operador** (o abastecimento só os tem por mês); aloca a venda do SKU à entrega mais antiga; saldo corrido entre semanas (só o que ainda está em aberto pode ser devido). Semana sem recibo datado é `partial`, deve zero e **só confirma com `accept_partial`**. Semana confirmada/paga é final; proposta é recalculável e **não conta como devido**. O sistema só registra pago, nunca paga.
- **Condição** do item muda até um acerto confirmado contá-lo. Status de pagamento só vale para `paid`.
- **NF-e**: `ingestion-worker` lê o XML (`POST /purchase-invoices/parse`, sem estado); `import/preview` casa o fornecedor pelo CNPJ exato, senão pelo **nome do emitente cadastrado como alias** (o de-para que o operador faz no próprio diálogo de importação) e, por fim, pela **raiz do CNPJ** (filiais da mesma empresa) quando só um fornecedor a tem — `matched_by` diz qual; casa as linhas por EAN, depois código = SKU (nunca por parecença). **A prévia devolve quantidade e preço como vieram na nota** (muitas vezes o preço é do fardo/caixa) e só *sugere* a embalagem (`units_per_package` do cadastro, senão lida da descrição: "6P", "12UN"); quem converte em unidades e custo de uma unidade é o operador, linha a linha, no diálogo. O que não casa fica de fora com o motivo. Nada grava antes do `POST /purchases`.
- Teste de SQL real: `test/purchasing.integration-spec.ts` roda **só** contra banco descartável (`PURCHASING_IT_THROWAWAY_DB=true`); nunca contra o banco real (a base de histórico de compras se moveria).
- Gaps: sem devolução física modelada; custo pago não altera `CostVersion` do products-service.


## O original da compra em embalagem e a data de emissão (`add-product-cost-price-versioning`)

`PurchaseItem` guarda, além das unidades e do custo **por unidade**, o **original como veio na nota**: `pack_quantity` (embalagens),
`pack_unit_price_cents` (preço de UMA embalagem), `units_per_pack` e `purchase_unit` ("UN", "CX", "FD"). Os três números andam juntos e
**têm de bater** com o que a compra registra (`utils/packaging.ts`): unidades = embalagens × unidades por embalagem, e custo unitário =
preço da embalagem ÷ unidades por embalagem, arredondado ao centavo (1 centavo de folga). Uma compra que discorda do próprio original é
**recusada**, senão a trilha de auditoria mentiria. Ex.: 10 caixas de R$ 63,00 com 21 unidades = 210 un. a R$ 3,00. No banco, um `CHECK`
recusa o original pela metade — escrito com `IS NOT NULL` explícito de propósito (um `CHECK` cuja expressão dá `NULL` **passa** em SQL).
`Purchase.invoice_issued_on` guarda a emissão (`dhEmi`), à parte de `ordered_on` (pedido) e `received_on` (recebimento, a data que vale
para a compra e para o custo). Compra anterior fica com tudo nulo: **"original não registrado"**, nunca um valor inventado.
`GET /purchases?sku=` lista as compras que têm o produto, mostrando só os itens dele (a aba Compras do produto).

## Custo da NF para o produto (outbox, `add-product-cost-price-versioning`)

Receber uma compra **grava o custo da NF no produto**, mas nunca dentro do recebimento. A mesma transação que recebe marca cada item em
`purchase_item.cost_sync = pending` (bonificação = `skipped_bonus`: **brinde nunca cria custo**); o `CostSyncService` (laço a cada
`COST_SYNC_INTERVAL_MS`, padrão 30 s, 0 desliga; mais um envio imediato após o recebimento) chama `POST /products/:sku/costs` do
products-service com `source: invoice`, vigência = `received_on`, fornecedor, compra, item, nº da nota, quantidade/total e o original da
embalagem. Estados: `pending → synced | unchanged | failed`. `unchanged` = o custo em vigor já era igual (nenhuma versão criada). Chave
idempotente `purchase-item:<id>:<dia>:<custo>`: reenviar não duplica, e corrigir o custo de um item recebido cria a versão corrigida (a antiga
fica; append-only). Editar um pedido recebido (itens alterados/novos, ou `received_on` movido) reenfileira o que mudou.
Falha fica no item (`cost_sync_error`, tentativas) e é reenviada com recuo (1, 2, 4… até 30 min, 8 tentativas) ou à mão por
`POST /purchases/:id/cost-sync`. Cada item do `PurchaseView` traz `cost_sync` {state, attempts, synced_at, error, version_id,
previous_cost_cents, variation_bps, alerts}. Avisos: `large_variation` (variação ≥ `COST_VARIATION_ALERT_BPS`, padrão 1000 = 10%, PROVISÓRIO),
`closed_month` (o mês da vigência está fechado no accounting, via `ACCOUNTING_SERVICE_URL`; o CMV desse mês **não** é recalculado sozinho) e
`closed_month_unknown` (accounting sem URL/fora do ar: nunca vira "aberto"). Compras anteriores ficam com `cost_sync` NULL: nada é enviado
retroativamente sem decisão. Sem BullMQ de propósito (este serviço não tem fila; o outbox vive no banco que já guarda o fato).

## Linhas pendentes de cadastro (`add-product-cost-price-versioning`, 1c.4–1c.5)

`POST /purchases` aceita `pending_lines`: linhas da nota cujo produto ainda não existe ("Deixar para depois"). Ficam em `purchase_pending_line`
**inteiras** (descrição, EAN, código do fornecedor, quantidade, custo, condição, original da embalagem): nenhum produto, SKU, item ou custo é
criado e nada se perde. A compra aceita `items` vazio se houver linha pendente (precisa de ao menos uma de cada tipo somadas) e traz
`pending_lines` e `awaiting_product_registration` (quantas faltam: "Aguardando cadastro de produto"). `POST /purchases/:id/pending-lines/:lineId/resolve
{sku}` (gateway: usuário da sessão) transforma a linha em item do produto cadastrado, vinculado ou escolhido (SKU tem de existir; resolve uma vez só),
grava o vínculo código-do-fornecedor → SKU e guarda na linha o produto e o item que ela virou. **Compra já recebida**: o item entra no outbox e o custo
sai na hora (vigência = dia do recebimento), é o primeiro custo do produto novo; **compra ainda não recebida**: nenhum custo existe, ele sai no
recebimento. Compra com acerto confirmado não aceita item novo. Um `CHECK` do banco recusa linha resolvida sem produto.

## Pedidos em etapas e e-mail (`add-purchase-orders-and-email`)

`Purchase.status`: `requisition → awaiting_invoice → invoiced → awaiting_receipt → received`, só para frente, definitivo após `received` (`utils/order-flow.ts`, puro). Nota (nº, chave ou `without_invoice`) exigida a partir de `invoiced`. **Só `received` conta**: `summary`, acerto e mês de compra usam `received_on` e `received_quantity ?? quantity`; pedidos abertos aparecem à parte (`open_orders`). Compras antigas migraram como `received`. `PurchaseEvent` guarda o histórico e `PurchaseEmail` cada tentativa de envio. E-mail atrás da porta `MailTransport` (`mail/`, nodemailer SMTP; fake nos testes; Mailpit no dev): envio só com confirmação, falha não muda a etapa, reenvio só com `resend`, anexo só PDF ≤700 KB. Env opcionais `SMTP_HOST/PORT/SECURE/USER/PASS` e `MAIL_FROM` (sem SMTP o painel diz "não configurado"). Real SMTP é decisão do dono.

**Casamento de linha da NF-e** (ordem): código de barras (**ativo ou histórico**, via `POST /eans/resolve` do products-service — a regra mora lá, uma vez) → vínculo `SupplierProductCode` (código do fornecedor → SKU, gravado quando o operador escolhe o produto de uma linha sem casamento, via `supplier_code` do item em `POST /purchases`; nunca inferido) → código igual ao SKU. Cada linha traz `matched_by` (`ean`, `ean_historical` quando o produto não usa mais aquele código de barras, `supplier_code`, `sku`). Uma NF antiga com o EAN antigo e uma nova com o EAN novo alimentam o **mesmo SKU**. EAN que nenhum produto tem → `unresolved_reason: ean_not_identified`; que já foi de mais de um produto → `ean_ambiguous` (com `ean_candidates`). **Nenhum dos dois cria produto**: a linha fica de fora até o operador escolher. Linha sem produto traz `suggestions` (até 3, `utils/product-suggestions.ts`: palavras em comum, medida 473ml/1,5L comparada à parte e sinalizada `measure_differs`; corte `MIN_SUGGESTION_SCORE = 0.4` PROVISÓRIO, o dono não revisou). Sugestão nunca é aplicada sozinha.

**Editar e excluir pedido**: `PATCH /purchases/:id` aceita data, fornecedor (só antes de receber), nota, prazos, observações, `received_on` e a lista COMPLETA de itens (com `id` altera, sem `id` cria, o que faltar é removido; em pedido recebido também `received_quantity`). Item já marcado como pago não muda nem sai; pedido recebido cujos itens um acerto confirmado já contou só aceita observações/prazos. A nota continua obedecendo à etapa. Cada edição entra no histórico (`edited: ...`) com o ator. `DELETE /purchases/:id` apaga pedido, itens, histórico e log de e-mail (CASCADE), recusado se um acerto confirmado contou os itens; loga quem apagou.

**A pagar** (`/payables`, `utils/payables.ts` puro + `PayablesService`): `GET /payables?month=YYYY-MM` devolve `summary` (aberto, vencido, vence em 7 dias, na entrega, pago no mês, previsto = aberto + pago), `series` (6 meses), `upcoming`, `commitments`, `orders` (uma linha por pedido: estado `overdue|upcoming|on_delivery|undated|paid`, forma `on_delivery|boleto|transfer|other`) e `reconciliation` (funil + avisos). Só item `paid` é a pagar. "Na entrega" antes do recebimento usa a entrega prevista como data e vai marcado `estimated` (ESTIMATIVA). `POST /payables/pay` registra a baixa (data não futura, forma, histórico) e `POST /payables/undo` a desfaz; o sistema só registra, nunca paga. Pedido ganhou `payment_method` (boleto | transfer | other) e o item `paid_method`. `GET /purchases/payments/pending` (lista simples antiga) segue existindo, sem uso na tela.

Ao receber, `POST /purchases/:id/transition` aceita `pay_on_receipt: true` (só ao receber e não para boleto com vencimento): os itens `paid` em aberto são baixados no dia do recebimento, com a forma do pedido. Em `/payables`, o estado `due_today` (vence hoje) entra em "hoje e próximos 7 dias".

`GET /payables` também aceita `from` e `to` (dias reais, até 366) no lugar de `month`: "pago no período" e as linhas pagas passam a contar só os pagamentos feitos dentro dele (o valor de uma linha é o pago NAQUELE intervalo). O que está em aberto aparece sempre. `period` volta na resposta.
