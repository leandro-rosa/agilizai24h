# backend/apps/treasury-service

Movimento de caixa: extrato bancário, fatura de cartão, o DE-PARA de
favorecido e as taxas de adquirente. Ver [../../CLAUDE.md](../../CLAUDE.md)
para as convenções do workspace backend.

**Consumidores**: `gateway-service` (rotas `/treasury`).
**Depende de**: `@app/health`, `@app/prisma-db-client`. `supplier_id` referencia
`suppliers-service` como `Int` cru — database-per-service, sem FK cruzando
serviço. Sem fila.

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
- **`nature` é o eixo que liga tesouraria a DRE** (`cogs` · `operating` ·
  `administrative` · `investment`), vindo da coluna "Natureza" da aba
  `Página64`. `entry_type` e `category` são texto livre porque a operação
  inventa categoria nova toda semana; `nature` é fechado porque o DRE
  depende dela.
- **`applyMappings` só toca lançamento sem `supplier_id`.** Reaplicar sobre
  lançamento já conferido à mão desfaria a correção de quem conciliou.
- **`AcquirerFee` é datado**, como `CostVersion` no `products-service`:
  recalcular julho com a taxa de dezembro apaga o rastro da margem real.
  `effectiveFee()` sempre pede a data — não existe "taxa atual".
- **`upsertSettlement` nunca sobrescreve `fee_cents` informado.** O extrato do
  adquirente é mais autoritativo que a tabela de taxa.
- **Lançamento PODE ser excluído**, diferente de loja e fornecedor. Ele é um
  fato de extrato; um fato lançado errado precisa sair, não virar "inativo"
  somando no DRE para sempre.
- **`feeCents` arredonda uma vez só, no fim.** Arredondar por parcela e somar
  diverge do total do extrato em alguns centavos por mês, e centavo que não
  bate vira hora de conciliação.

## Rotas

| Rota | Nota |
|---|---|
| `GET/POST /treasury/accounts`, `PATCH /treasury/accounts/:id` | Conta corrente e cartão |
| `GET /treasury/transactions` | Filtros: `period`, `from`/`to`, `account_id`, `nature`, `direction`, `store_id`, `supplier_id`, `unresolved` |
| `GET /treasury/transactions/summary` | Totais por natureza e categoria + `unresolved_count` |
| `POST/PATCH/DELETE /treasury/transactions[/:id]` | |
| `GET/POST /treasury/mappings`, `PATCH`/`DELETE /:id` | O DE-PARA |
| `POST /treasury/mappings/apply/:period` | → `{ examined, classified }` |
| `GET/POST /treasury/fees` | Taxa por adquirente/método, com vigência |
| `GET/POST /treasury/settlements` | Recebido por meio de pagamento |

`summary` existe para a tela de fluxo de caixa não puxar milhares de linhas
só para somar no cliente — e para `unresolved_count` ficar visível: lançamento
sem fornecedor resolvido é trabalho pendente, não detalhe.

## Gaps conhecidos

- **Sem ingestão.** OFX, CSV do banco e fatura de cartão ainda não são lidos;
  o dado entra pelo painel. Recorte deliberado desta fase.
- **`applyMappings` faz um UPDATE por lançamento**, não um `updateMany` por
  regra. Fica O(n) em ida ao banco. Aceitável no volume atual (centenas por
  mês); se virar milhares, agrupar por regra.
- **`normalizeCounterparty` duplica `normalizeAlias` do
  `suppliers-service`.** Os dois precisam concordar, e hoje isso é garantido
  por teste em cada lado, não por código compartilhado. Extrair para um
  pacote de contrato quando um terceiro serviço precisar do mesmo dobramento.
- **A migration inicial foi gerada com `prisma migrate diff`** — o banco deste
  serviço ainda não subiu. Aplicar com `pnpm prisma:deploy` na primeira subida.
