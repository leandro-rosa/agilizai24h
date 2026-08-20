# backend/apps/billing-service

Receita contratada e faturamento: clientes, unidades, contratos, notas
fiscais e repasse de vendas. Ver [../../CLAUDE.md](../../CLAUDE.md) para as
convenções do workspace backend.

**Consumidores**: `gateway-service` (rotas `/billing`).
**Depende de**: `@app/health`, `@app/prisma-db-client`. `store_id` referencia
`stores-service` como `Int` cru. Sem fila.

Origem na planilha: abas `Clientes` e `Notas fiscais`, as linhas
`Mensalidades` e `Repasse de vendas` do `DRE`, e `Contratos/*.pdf`.

## Decisões que não são óbvias no código

- **"Vencido" não é status persistido.** É derivado de `due_on < hoje` com
  `paid_on` nulo. Como coluna, precisaria de um job diário mudando linha, e o
  número do a-receber passaria a depender de ele ter rodado. A planilha só
  tem `PAGO`/`CANCELADA` e por isso **não enxerga o vencido** — é o buraco
  que `GET /billing/invoices/aging` fecha.
- **`due_on` é materializado, mas sempre derivado.** Gravado para o aging
  filtrar e ordenar no banco em vez de em memória, e recalculado toda vez que
  emissão ou prazo mudam — deixá-lo defasado quebraria o aging em silêncio.
- **Prazo e percentual caem para os do contrato** quando não vêm no corpo. É
  onde estão negociados; redigitar a cada nota é como a planilha diverge do
  contrato.
- **`PATCH /contracts/:id` com `store_ids` substitui a cobertura inteira**,
  não soma. Um contrato que perdeu uma loja precisa deixar de cobri-la, e um
  PATCH que só acrescenta não consegue expressar isso.
- **`ClientSite` existe separado de `Client`** porque cada unidade tem CNPJ
  próprio — a aba `Clientes` lista 20 CNPJs distintos só da Ascenty. É a
  unidade que hospeda a loja, não o cliente.
- **`weighted_daily_traffic`** é a coluna "Total Ponderado - Dia": visitante
  entra com peso menor que funcionário. É o denominador honesto do ticket
  médio, e a planilha já resolve essa ponderação.
- **`daysOverdue` compara só a parte de data.** Comparar com hora faria uma
  nota que vence hoje virar "vencida" às 00:00:01.

## Rotas

| Rota | Nota |
|---|---|
| `GET /billing/clients`, `GET /:id`, `POST`, `PATCH /:id` | `:id` inclui as unidades |
| `POST /billing/clients/:id/sites`, `PATCH /:id/sites/:siteId` | |
| `GET /billing/contracts`, `GET /:id`, `POST`, `PATCH /:id` | `store_ids` substitui a cobertura |
| `GET /billing/invoices` | `client_id`, `period`, `status` |
| `GET /billing/invoices/aging` | `?on=YYYY-MM-DD` para simular outra data |
| `POST /billing/invoices`, `PATCH /:id`, `POST /:id/pay` | |
| `GET/POST /billing/revenue-shares` | |

## Gaps conhecidos

- **Sem ingestão.** O dado entra pelo painel; nada lê a aba `Notas fiscais`
  ainda. Recorte deliberado desta fase.
- **`revenue_share` não busca a receita base sozinho.** `base_revenue_cents`
  vem no corpo; ninguém lê `sales-service` para preenchê-lo. Enquanto for
  assim, o repasse é PREMISSA, não FATO — rotular assim na UI.
- **Nada valida `store_id` contra o `stores-service`.** Um contrato pode
  cobrir uma loja que não existe. Database-per-service não permite FK, e um
  check síncrono na escrita acopla os dois serviços; a validação certa é uma
  tela que só oferece lojas reais.
- **Sem numeração automática de NF.** `number` vem do chamador, porque a
  numeração é do emissor fiscal, não deste serviço.
- **A migration inicial foi gerada com `prisma migrate diff`** — o banco deste
  serviço ainda não subiu. Aplicar com `pnpm prisma:deploy` na primeira subida.
