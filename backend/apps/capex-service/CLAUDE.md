# backend/apps/capex-service

Investimento por loja, aporte de investidor e payback. Ver
[../../CLAUDE.md](../../CLAUDE.md) para as convenções do workspace backend.

**Consumidores**: `gateway-service` (rotas `/capex`).
**Depende de**: `@app/health`, `@app/prisma-db-client`. `store_id` e
`supplier_id` são `Int` cru. Sem fila.

Origem na planilha: abas `INVESTIMENTO` (25 categorias × 21 lojas),
`Investimentos`, `Investimento Amil` e `Investidor`.

## A fronteira com `stores-service`

Atributo físico da loja — **data de inauguração, headcount, voltagem** — não
mora aqui, mesmo aparecendo na aba `INVESTIMENTO`. É do `stores-service`.
Este serviço só guarda dinheiro. Duplicar esses campos criaria duas
respostas para "quando a loja abriu".

## Payback é MÉTRICA DERIVADA, não fato

`payback_months = total_invested_cents / monthly_profit_cents`, e
`monthly_profit_cents` é hoje **PREMISSA**: vem digitado no painel, não lido
de `finance-service`. A UI precisa rotular assim — regra da raiz do repo.

`null` significa **indefinido**, não "já se pagou": nenhum número de meses
paga um investimento com lucro zero ou negativo, e devolver `0` afirmaria o
contrário. Em `GET /capex/investments/payback` o `null` ordena **por
último**, porque é o caso que precisa de atenção; ordená-lo como zero o
colocaria em primeiro, no lugar da loja que realmente se paga mais rápido.

## Decisões que não são óbvias no código

- **`itemCostCents` usa o parcelado quando houve parcelamento.** A planilha
  guarda "Valor a vista" e "Vl parcelado total" separados, e a diferença é o
  custo do crédito — somar o à vista subestima o investimento (o refrigerador
  real: R$ 2.590 à vista, R$ 2.890 em 10x).
- **`total_invested_cents` é materializado e recalculado a cada escrita de
  item.** Materializado porque a tela de payback lista 24 lojas de uma vez;
  recalculado sempre porque um total materializado que não se atualiza é
  mentira silenciosa.
- **Mover um item entre lojas recalcula as duas**, senão a loja antiga segue
  contando o que não tem mais.
- **`store_investment_id` é nulo para investimento não atribuível a loja**
  (carro, ferramenta), com `onDelete: SetNull` — apagar o registro da loja não
  deve apagar a compra.

## Rotas

| Rota | Nota |
|---|---|
| `GET /capex/investments` | |
| `GET /capex/investments/payback` | Ordenado; indefinido por último |
| `GET /capex/investments/:storeId` | Com os itens |
| `PUT /capex/investments` | Faturamento e lucro de referência (premissa) |
| `POST /capex/investments/:storeId/recompute` | |
| `GET/POST /capex/items`, `PATCH`/`DELETE /:id` | |
| `GET /capex/investors`, `GET /:id`, `POST`, `PATCH /:id` | |
| `GET /capex/investors/summary` | Comprometido vs. aportado |
| `POST /capex/investors/:id/contributions`, `DELETE /:contributionId` | |

## Gaps conhecidos

- **`monthly_profit_cents` não vem de lugar nenhum automaticamente.** Enquanto
  for digitado, todo payback deste serviço é estimativa. Ligar em
  `finance-service`/`accounting-service` é o que o tornaria fato — e é o maior
  gap aqui.
- **Sem ingestão.** A aba `INVESTIMENTO` não é lida; o dado entra pelo painel.
- **`recompute` re-soma todos os itens da loja a cada escrita.** O(n) por
  item, com n na casa das dezenas — irrelevante hoje, revisitar se um item
  virar milhares.
- **Nada valida `store_id` contra o `stores-service`.** Database-per-service
  não permite FK; a validação certa é uma tela que só oferece lojas reais.
- **A migration inicial foi gerada com `prisma migrate diff`** — o banco deste
  serviço ainda não subiu. Aplicar com `pnpm prisma:deploy` na primeira subida.
