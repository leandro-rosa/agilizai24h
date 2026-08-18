# backend/apps/finance-service

A **reconciliação mensal** — as quatro cifras que o operador calcula hoje à
mão, por loja, todo mês: valor abastecido, CMV, valor da sobra e perda real.
É a mudança pela qual a plataforma existe. Ver
[../../CLAUDE.md](../../CLAUDE.md) para as convenções do workspace backend.

**Lê**: `supply` (abastecimento e remoções classificadas), `sales`
(quantidades), `inventory` (sobra) e `products` (custo as-of).
**Consome**: `inventory.period-derived.finance`, publicado pelo `inventory` —
**não** o `period.data-updated`. A cadeia é
`supply|sales → inventory → finance`, e o porquê está abaixo.
**Exposto pelo**: `gateway-service` sob `finance:read`.

## Rotas

| Rota | Uso |
|---|---|
| `GET /finance/:storeId/:period` | As quatro cifras, com quebras e completude |
| `GET /finance/:storeId` | Série de meses da loja |
| `GET /finance/rollup?period=` | Total da rede no mês |
| `POST /finance/:storeId/:period/recompute` | Backfill e correção de custo |

## As decisões que evitam número errado

- **Espera o `inventory`, não corre em paralelo com ele.** Rodando os dois a
  partir do mesmo evento, o finance lia um fechamento que o inventory ainda não
  tinha escrito: medido ao vivo, sobra saiu 31500 onde 29250 era o certo — e o
  mês ainda se declarou completo. Número errado que se diz confiável é o pior
  resultado possível aqui.
- **Uma fila por assinante.** Fila do BullMQ é ponto-a-ponto: dois workers no
  mesmo nome **competem**. Com uma fila compartilhada, medimos 6 eventos
  dividindo 5/1 entre inventory e finance — a maior parte dos meses
  simplesmente nunca reconciliava, e os que reconciliavam saíam corretos, então
  nada denunciava a falha.
- **Estoque negativo nunca vira mês limpo.** O `inventory` reporta saldo
  negativo em vez de zerar, justamente para o problema ficar visível; o finance
  chegou a valorar −37500 centavos e dizer `complete: true`. Agora o SKU vai
  para `inconsistent_stock` e derruba `complete`. A cifra continua sendo
  calculada — ela é a evidência do tamanho do problema.
- **Uma flag de confiança só.** `complete` responde "dá para agir nisso?";
  `unvalued` e `inconsistent_stock` dizem **por quê**. Duas flags viram a que o
  consumidor esquece de checar.
- **A data de valoração é o último dia do mês**, e vai **gravada no
  resultado**. O `products` se recusa a responder "custo atual" de propósito,
  então alguém tem que escolher — e deixar cada chamador escolher é como duas
  telas passam a discordar. Fim do mês em vez de início porque um custo que
  entra no meio vale para a maior parte do mês. A aproximação é real e fica
  visível em vez de implícita.
- **SKU sem preço nunca vale zero.** Tratar custo faltante como zero subestima
  CMV **e** perda, o que deixa os números *melhores* — então ninguém questiona.
  Ele vai para `unvalued`, com as quantidades, e força `complete: false`.
- **Incompletude propaga para o rollup**, nomeando as lojas: um total que
  contém uma loja sem preço não é cifra para agir em cima.
- **A perda vem classificada do `supply`**, nunca re-derivada aqui. Uma segunda
  cópia da regra divergiria, e a cópia no caminho de relatório é a que as
  pessoas confiariam.
- **Materializado na mudança**, não calculado por request: senão toda carga do
  painel abriria leque para quatro serviços, e — pior — a cifra de um mês
  histórico dependeria do que o `products` respondesse naquele instante.
- **Aritmética inteira em centavos**, do começo ao fim. Essas cifras são
  conferidas à mão contra a planilha do operador; alguns centavos de deriva
  seriam pequenos, reais e dias de trabalho para explicar.
- **Recompute manual existe** porque correção de custo muda as cifras sem
  nenhum dado de supply/sales mudar — e portanto sem evento nenhum.

## Barra de aceite

O design registra, e vale repetir: **passar nos testes não é o critério**. O
critério é uma reconciliação deste serviço bater com a planilha de um mês que
os operadores já fecharam à mão. Isso ainda **não** foi feito — falta o dado
real.

O que foi verificado: um mês inteiro pela cadeia real (upload → parse →
supply/sales → inventory → finance → leitura pelo gateway), com as quatro
cifras conferidas à mão contra planilha construída para o caso, incluindo uma
linha de motivo misto (`-4 Vencido, -6 Devolução` ⇒ 4 de perda, não 10).

## Testes

- Unitários (`pnpm test`): a valoração pura, incluindo SKU sem preço, quebras
  que somam ao total, aritmética exata em 1000 linhas e a data de valoração.
- Integração (`pnpm test:integration`): precisa do Postgres deste serviço.
  Os quatro upstreams são stubados de propósito — os casos interessantes (SKU
  sem preço, custo gravado depois) são difíceis de encenar com quatro serviços
  vivos e triviais aqui.

## Gaps conhecidos

- Sem autorização própria — enforcement é do gateway.
- Correção de custo no `products` não dispara recompute: o `products` não
  publica evento. Fica no recompute manual, como o design previu.
- Sem percentual de perda sobre receita ou sobre abastecido — é cifra derivada
  de apresentação, e ninguém pediu ainda.
- A suíte de worker exige o **container do finance parado** — ele consome a
  mesma fila no mesmo Redis e competiria pelos jobs. O teste falha com uma
  mensagem dizendo isso, em vez de falhar aleatoriamente.
- Um mês pode ficar **transitoriamente errado** enquanto uma ingestão está em
  voo: cada evento recomputa, e só o último tem o dado completo. `computed_at`
  e `inputs_changed_at` deixam isso detectável, mas o painel ainda não usa.
