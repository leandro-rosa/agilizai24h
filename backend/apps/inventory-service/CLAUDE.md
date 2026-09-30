# backend/apps/inventory-service

Estoque em **unidades** por loja e SKU, derivado dos movimentos que a
plataforma já registra. Ver [../../CLAUDE.md](../../CLAUDE.md) para as
convenções do workspace backend.

**Lê**: `sales-service` e `supply-service` (quantidades, ajuste e o
fechamento registrado).
**Consome**: `period.data-updated.inventory`, publicado por `supply-service`
e `sales-service`.
**Publica**: `inventory.period-derived.finance`, só depois que o rebuild
comita — `finance-service` valora a sobra a partir do que este serviço
deriva, então não pode rodar em paralelo com quem produz esse dado (medido
ao vivo: rodando em paralelo, a sobra saiu errada e o mês ainda se disse
completo). Um evento por período reconstruído, não só o que mudou —
fechamento se propaga, então corrigir março teria que revalorar abril também.
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
| `GET /inventory/audit/balance?from=&to=` | Auditoria de qualidade do saldo (contagem × sistema, consumo × venda) — só distribuições |

## A auditoria de saldo (`add-stock-quality-phase0`)

`GET /inventory/audit/balance?from=YYYY-MM&to=YYYY-MM` mede **quanto o saldo
pode ser confiado**, por dois ângulos independentes, e só descreve — não julga:

1. **Contagem × sistema**: cada linha de visita com `Qtd. confirmada` (a
   contagem feita ANTES do abastecimento) é comparada com `Qtd. Anterior` (o
   saldo que o sistema tinha). Linha sem contagem é excluída e contada como
   cobertura — **nunca** vira "igual ao sistema". Fatiado por faixa de giro e de
   saldo, cada fatia com sua contagem de linhas.
2. **Consumo entre visitas × vendas registradas**: por loja×SKU,
   `saldo_final(k) − saldo_anterior(k+1)` entre aparições consecutivas do SKU,
   rateado pelos dias de cada mês, e comparado com a venda do mês — só para
   meses **inteiramente cobertos** pela cadeia. Saldo que SOBE sem evento é
   contado à parte (nunca consumo negativo) e tira da comparação os meses que
   toca. Loja-mês com consumo e **sem venda importada** é listado como lacuna e
   fica fora das distribuições.

**Calculada na leitura, nada guardado**: os números mudam quando chega
relatório novo e uma cópia guardada viraria mais um saldo divergente. **Não
define tolerância** e **nada depende dela** — nenhuma recomendação, saldo
estimado ou sugestão de abastecimento lê daqui; o serviço (`BalanceAuditService`)
só injeta o cliente de leitura e a config (há teste que trava isso, e outro que
varre a resposta atrás de chave tipo `verdict`/`tolerance`/`pass`).

- **Faixas são apresentação, vêm do backend e voltam na resposta**
  (`presentation`, `provisional: true`): giro = média mensal de venda da
  loja×SKU nos meses com venda importada (alto ≥ 20, médio 5–20, baixo < 5,
  `no_sales`, e `unknown` quando a loja não tem mês importado — dizer "não vende"
  quando a venda só não foi carregada seria falso); saldo 0, 1–5, 6–15, 16–40,
  41+. Env opcionais `AUDIT_TURNOVER_HIGH_MIN`, `AUDIT_TURNOVER_MEDIUM_MIN`,
  `AUDIT_BALANCE_UPPER_BOUNDS`; valor inválido cai no padrão.
- **Loja cuja leitura falha sai inteira** e aparece em `gaps.unavailable_stores`
  — nunca entra como zero. Um 404 de venda é resposta ("mês não importado"), não falha.
- **Não dá para concluir verdade física por aqui**: consumo e venda vêm do mesmo
  PDV, então a concordância valida o alinhamento dos dados, não o estoque real.
  A medida do erro físico exige contagem cega (adiada).
- A rota mora num controller próprio registrado **antes** do `InventoryController`,
  senão `/inventory/:storeId/:sku` engole `/inventory/audit/balance`.
- Operações sem `Cliente` (CD) não vêm daqui: estão em
  `ingestion-worker-service` `GET /ingestions/gaps`, e o painel combina as duas.
- `Capacidade` chega vazia/0 em todas as linhas reais; a auditoria diz
  "capacidade não disponível" em vez de tratar como 0.

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

## O ajuste de inventário e o fechamento registrado

`supply-service` reporta um quarto movimento — o ajuste, assinado — e
opcionalmente o fechamento que os próprios operadores registraram para o
período. Este serviço:

- **Soma o ajuste ao saldo derivado** exatamente como abastecimento e
  remoção: `fechamento = abertura + abastecido − vendido − removido + ajuste`.
  Nunca netado com nenhum dos outros três — `finance-service` valora o
  ajuste como cifra própria (design D6 de `align-ingestion-with-real-reports`).
- **Guarda o fechamento registrado, mas não compara contra o derivado.**
  Existiu uma versão anterior que comparava (`disputed`, por SKU e
  `has_disputes` na listagem) — **revertida** depois de testar contra dado
  real (design D5 de `align-ingestion-with-real-reports`). `Qtd. final` é uma
  leitura no momento de uma visita de abastecimento específica, não o
  fechamento do mês — a JDI01 teve 5 visitas em março, a última terminando
  dia 26, e nada no relatório de venda carrega data por linha (confirmado em
  106 arquivos reais) para separar o que foi vendido antes ou depois dela.
  Comparando contra o total do mês, 51 de ~70 SKUs de uma única loja-mês real
  vieram como "disputados" sem nenhum erro de dado por trás. A identidade de
  saldo por LINHA (checada na ingestão, contra os próprios números daquela
  linha) é diferente disso e continua valendo — ver
  [ingestion-worker-service/CLAUDE.md](../ingestion-worker-service/CLAUDE.md).

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

- Unitários (`pnpm test`): derivação pura, saldo de abertura, a janela de
  períodos, o ajuste e a conferência de fechamento (`derive-stock.spec.ts`).
- Integração (`pnpm test:integration`): precisa do Postgres deste serviço.
  Fontes de movimento são stubadas de propósito — o que está sob teste é a
  derivação e o read model, não HTTP.

## Desvio: sem `PrismaRepository`

Diferente dos outros serviços, este não estende a base de `@app/prisma-db-client`.
A leitura central é um `DISTINCT ON (sku)` cru — pegar o snapshot mais recente
até um período, por SKU — que a base genérica não expressa, e o rebuild é uma
substituição em transação, não CRUD por linha. Um repositório aqui seria uma
camada contornada justamente nos dois caminhos que importam.

## `central-stock` — o único dado não derivado deste serviço

`CentralStockLot` (aba `Estoque Central` da planilha) é o estoque do CD, e é
tabela própria em vez de mais colunas em `StockSnapshot` por dois motivos:
é **lançado à mão** (não derivado de venda × abastecimento) e tem
**validade**, que o sistema hoje perde inteira.

Guardado **por lote, não por SKU**: duas entregas do mesmo produto vencem em
datas diferentes, e um saldo único por SKU não consegue dizer quanto vence
quando.

`GET /inventory/central?expiring_within_days=30` inclui o já vencido de
propósito — quem pergunta o que vence em 30 dias precisa ver primeiro o que
já venceu e continua na prateleira. A ordenação põe vencimento mais próximo
primeiro e lote sem validade por último.

`GET /inventory/central/summary` traz `valued_amount_cents` junto de
`valued_lot_count`: a cifra só conta lote com custo informado, e o contador
existe para ela nunca passar por completa quando não é.

## Gaps conhecidos

- Sem autorização própria — enforcement é do gateway.
- Sem suíte automatizada do caminho de fila; o consumo do evento é coberto pelo
  teste unitário do worker e pela verificação em runtime.
- Uma loja com muitos meses faz uma chamada por período no rebuild. Aceitável
  no volume atual; se deixar de ser, a saída é `sales`/`supply` exporem
  "períodos com dado" em vez de o rebuild caminhar mês a mês.
