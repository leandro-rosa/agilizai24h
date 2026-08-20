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
- **A migration inicial foi gerada com `prisma migrate diff`**, não com
  `migrate dev` — o banco deste serviço ainda não subiu. Aplicar com
  `pnpm prisma:deploy` na primeira subida.
