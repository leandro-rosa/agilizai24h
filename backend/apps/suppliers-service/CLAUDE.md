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


## Pedidos em etapas e e-mail (`add-purchase-orders-and-email`)

`Purchase.status`: `requisition → awaiting_invoice → invoiced → awaiting_receipt → received`, só para frente, definitivo após `received` (`utils/order-flow.ts`, puro). Nota (nº, chave ou `without_invoice`) exigida a partir de `invoiced`. **Só `received` conta**: `summary`, acerto e mês de compra usam `received_on` e `received_quantity ?? quantity`; pedidos abertos aparecem à parte (`open_orders`). Compras antigas migraram como `received`. `PurchaseEvent` guarda o histórico e `PurchaseEmail` cada tentativa de envio. E-mail atrás da porta `MailTransport` (`mail/`, nodemailer SMTP; fake nos testes; Mailpit no dev): envio só com confirmação, falha não muda a etapa, reenvio só com `resend`, anexo só PDF ≤700 KB. Env opcionais `SMTP_HOST/PORT/SECURE/USER/PASS` e `MAIL_FROM` (sem SMTP o painel diz "não configurado"). Real SMTP é decisão do dono.
