# backend/apps/inventory-service

Estoque em **unidades** por loja e SKU, derivado dos movimentos que a
plataforma já registra. Ver [../../CLAUDE.md](../../CLAUDE.md) para as
convenções do workspace backend.

**Lê**: `sales-service` e `supply-service` (quantidades).
**Consome**: `period.data-updated` publicado pelo `supply-service`.
**Lido por**: `finance-service` (quantidades de sobra para valorar) e o painel
pelo `gateway-service`.

Separado do `finance` de propósito: aqui a resposta é em **unidades**, lá é em
**dinheiro**, e são telas diferentes lendo por razões diferentes.

## Rotas

| Rota | Uso |
|---|---|
| `GET /inventory/:storeId?period=` | Saldo por SKU no fim do período |
| `GET /inventory/:storeId/:sku?period=` | Saldo de um SKU |
| `GET /inventory/:storeId/below-minimum` | SKUs no mínimo ou abaixo |
| `GET/PUT .../minimums` | Configura o mínimo por loja+SKU |
| `POST /inventory/:storeId/recompute?from=` | Backfill e correções sem evento |
| `DELETE /inventory/:storeId/:sku` | **405** — estoque é derivado |

## As três regras que a spec exige

1. **Toda remoção reduz o estoque, qualquer que seja o motivo.** Uma devolução
   sai da prateleira igual a um vencido. Deixar a classificação de perda afetar
   a quantidade faria o estoque discordar da realidade em toda remoção não-perda.
2. **Saldo negativo é reportado, nunca zerado.** Negativo significa que o dado
   de movimento está errado — venda ou remoção registrada sem o abastecimento
   correspondente. Zerar esconde justamente a inconsistência que precisa ser
   corrigida, e ainda faz o número parecer plausível. A listagem carrega
   `has_inconsistencies` para o total não passar por limpo.
3. **Fechamento passado não muda quando um período posterior ganha movimento** —
   mesma propriedade que a regra de custo datado protege no `products`.

## Decisões que não são óbvias no código

- **Estoque é derivado, nunca digitado.** `DELETE` responde 405 apontando para
  corrigir os movimentos, o que mantém o read model reproduzível.
- **Read model materializado**, não calculado a cada request: uma leitura
  point-in-time re-somaria todos os movimentos desde a abertura da loja, toda
  vez. Os movimentos nos serviços donos seguem sendo a fonte da verdade.
- **Rebuild é incremental**: apaga do período mudado para frente e semeia o
  saldo com o fechamento imediatamente anterior. Reconstruir a história inteira
  significaria rebuscar todo mês que a loja já teve, a cada ingestão.
- **Mas recomputa tudo dali para frente**, porque fechamento se propaga —
  corrigir março move abril e todos os meses seguintes. Recomputar só o período
  mudado deixaria todo saldo posterior silenciosamente errado.
- **A janela de recompute vai até o mês corrente**, não só até os períodos já
  conhecidos: um mês que foi ingerido mas nunca derivado — porque o evento dele
  se perdeu ou foi suprimido — ficaria invisível para sempre.
- **SKU com saldo mas sem movimento no mês continua na listagem**, carregado
  pelo saldo de abertura; sem isso ele sumiria da tela no mês em que não se
  mexeu.
- **Mínimo só é afirmado para SKU que tem um configurado.** O mock do painel
  usava "15 para bebidas, 8 senão", que nunca foi configuração real — assumir
  um default inventaria um limiar que ninguém definiu.

## Testes

- Unitários (`pnpm test`): derivação pura, saldo de abertura e a janela de
  períodos.
- Integração (`pnpm test:integration`): precisa do Postgres deste serviço.
  Fontes de movimento são stubadas de propósito — o que está sob teste é a
  derivação e o read model, não HTTP.

## Desvio: sem `PrismaRepository`

Diferente dos outros serviços, este não estende a base de `@app/prisma-db-client`.
A leitura central é um `DISTINCT ON (sku)` cru — pegar o snapshot mais recente
até um período, por SKU — que a base genérica não expressa, e o rebuild é uma
substituição em transação, não CRUD por linha. Um repositório aqui seria uma
camada contornada justamente nos dois caminhos que importam.

## Gaps conhecidos

- Sem autorização própria — enforcement é do gateway.
- Sem suíte automatizada do caminho de fila; o consumo do evento é coberto pelo
  teste unitário do worker e pela verificação em runtime.
- Uma loja com muitos meses faz uma chamada por período no rebuild. Aceitável
  no volume atual; se deixar de ser, a saída é `sales`/`supply` exporem
  "períodos com dado" em vez de o rebuild caminhar mês a mês.
