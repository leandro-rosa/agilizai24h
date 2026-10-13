# Fechamentos de fornecedores por consignação — design

Data: 2026-10-13 · Estado: aguardando revisão · Caminho: arquitetural

## 1. Objetivo

Substituir a planilha de fechamento do fornecedor consignado por uma tela que diga exatamente quanto repassar e permita conferir estoque, vencimentos e devoluções, sem inventar lote, validade ou quantidade que o sistema não tem.

Decisões já aprovadas (não reabertas):

- **Estende o Acerto semanal existente** (`/purchases/settlements`, `suppliers-service`), sob "Compras". Não há módulo paralelo.
- **Razão de movimentos consignados, aditivo**, no `suppliers-service`. O estoque derivado (`inventory-service`) e o `CentralStockLot` não são substituídos: só servem de conferência e de sugestão do saldo inicial.
- **Saldo inicial por contagem confirmada pelo operador**, com sugestão do sistema, em data e hora de corte. Não gera dívida.
- **Custo aplicável = custo de repasse acordado vigente na data da venda.** Nesta entrega não existe o modo "custo do lote recebido" (ver §6.3).
- Vendas **nunca viram movimento** do razão: são lidas do `sales-service`.

Fora do escopo: pagamento automático (o sistema só registra), alocação de venda a lote, correção automática de divergência de estoque, qualquer mudança de precificação ou do fluxo de outros fornecedores.

## 2. Duas contas separadas

- **Estoque**: abertura + recebimentos + transferências de entrada − transferências de saída − vendas líquidas − baixas por vencimento − devoluções de vendável − outras perdas ± correções. Serve para conferir.
- **Repasse**: soma de (quantidade líquida vendida × custo de repasse vigente na data da venda). Nunca deriva venda por diferença de estoque. Não usa preço de venda, não desconta imposto, taxa de cartão, margem ou despesa sem regra contratual cadastrada. Vencidos não vendidos não geram pagamento e **não são subtraídos** do total.

Exemplo de referência (teste): abertura 20, recebido 30, 18 vendas, baixa de 2 vencidas → saldo vendável 30; repasse = 18 × custo; as 2 vencidas ficam aguardando devolução; confirmar a entrega delas não altera o saldo vendável.

## 3. Modelo de dados (suppliers-service, tudo aditivo)

| Tabela | Papel |
|---|---|
| `ConsignmentAgreement` | Por fornecedor: `cost_basis` (única opção: `sale_date`, explícito na configuração), periodicidade (7/10/15 dias ou personalizada), data inicial do primeiro fechamento, produtos vinculados. |
| `ConsignmentCost` | Custo de repasse por SKU com vigência (`valid_from`, sem sobreposição). Nunca editado: nova vigência substitui. |
| `OpeningBalance` | A contagem confirmada: `cutoff_at` (timestamptz), por SKU e local, quantidade, lote e validade **nulos quando ausentes**, origem da sugestão (`central_lot`/`derived_store`/`manual`), confirmado por e quando. |
| `ConsignmentMovement` | Append-only. `supplier_id`, `sku`, `location` (depósito ou loja), `lot`/`expires_on` (nulos), `kind`, `quantity` assinada, `occurred_at`, `source_ref` **único**, `reverses_id` opcional. |
| `ExpiryWriteoff` | Baixa por vencimento: quantidade baixada (vendável → aguardando devolução), data, vínculo opcional a `RemovalRecord` do supply-service. Gera o movimento `expiry_writeoff`. |
| `SupplierReturn` | **Uma linha por entrega** ao fornecedor: `writeoff_id`, quantidade, data, comprovante, observação. Soma ≤ quantidade baixada, validada na transação. Não gera movimento de saldo. |
| `SettlementPayment` | Pagamentos de um fechamento: valor, data, forma, observação, `reversed_by` (correção por registro compensatório). |
| `SettlementSaleLine` | Congelada ao confirmar: `sale_key` **único entre fechamentos ativos**, quantidade, custo unitário, vigência do custo, `kind` (`sale`/`adjustment_cancel`/`adjustment_late`/`adjustment_qty`), atribuição de fornecedor e sua base. |
| `SettlementAssignment` | Atribuição manual de uma venda a fornecedor (ator, quando, motivo). |

`Settlement` ganha: `period_start`/`period_end` (timestamptz, intervalo semiaberto `[start, end)`), `sales_imported_until`, `partial_reason`, estados novos, `kind` (`regular`/`legacy`).

`kind` dos movimentos: `opening`, `receipt`, `transfer_in`, `transfer_out`, `expiry_writeoff`, `return_sellable`, `loss`, `correction`. Correção e perda são **compensatórias**: nada é editado nem apagado. Perda não gera cobrança sem regra contratual explícita por fornecedor (inexistente nesta entrega).

## 4. Origem de cada movimento (sem lançar duas vezes)

- **Saldo inicial**: assistente. Depósito: sugere lotes do `CentralStockLot` com `supplier_id` do fornecedor. Lojas: sugere o saldo derivado dos SKUs vinculados, marcado "conferir" (o derivado não conhece fornecedor). O operador ajusta e confirma por produto e local. Lote ausente permanece ausente; lote já existente não é duplicado (`source_ref` do lote). Entra como `opening`, sem dívida.
- **Recebimento**: a confirmação de recebimento do pedido passa a gravar um **evento de recebimento** com quantidade, destino, data e lote/validade quando houver; recebimentos parciais são vários eventos, cada um com id próprio. O `receipt` usa o id do evento como `source_ref`. Pedido, por si só, não altera estoque nem gera valor devido.
- **Transferência**: linha de visita **ingerida de relatório finalizado** (`ended_at`, `restocked > 0`) para SKU consignado. Duas pontas gravadas **na mesma transação**, `source_ref` distintos (`visit-line:<id>:out` e `visit-line:<id>:in`). Origem real respeitada; origem não identificada vira pendência (ver §6.2).
- **Baixa por vencimento**: se já houver `RemovalRecord` `expired` para loja/SKU/mês no supply-service, a tela o mostra como sugestão e vincula; não cria o movimento a partir dele sozinho.
- **Outras devoluções**: devolução de produto ainda vendável é `return_sellable` e **reduz o saldo**. Entrega de produto já baixado é `SupplierReturn` e **não** reduz.
- **Conferência**: razão × estoque derivado × `CentralStockLot`; divergência sinalizada, nunca corrigida sozinha.

## 5. Saldo e conciliação

- `saldo(local, SKU, D) = abertura + movimentos até D − vendas líquidas OK desde o corte até D` (vendas da loja descontam só a loja). Independe de confirmação de fechamento: confirmar não desconta de novo nem faz a venda sumir da consulta.
- Saldo negativo é mostrado, nunca zerado.
- **Saldo físico** (última contagem do operador) exibe data e hora e é comparado **no mesmo instante**: saldo esperado em `t_contagem` (não o atual) × contado. Movimentos posteriores à contagem são mostrados à parte. Contagem antiga nunca é comparada com o saldo atual.
- **Divergência** mostra a causa quando identificável (visita sem transferência, venda sem recibo datado, baixa não registrada, importação ausente). Bloqueia a confirmação **apenas** se comprometer a origem do fornecedor ou o valor devido; nos demais casos permite confirmar com a pendência registrada.

## 6. Cálculo do fechamento

### 6.1 Períodos
Intervalos semiabertos `[início, fim)` sem sobreposição e sem lacuna. O primeiro começa **exatamente** em `cutoff_at`; os seguintes cobrem dias inteiros em America/Sao_Paulo, o fim de um é o início do seguinte. A sugestão vem do último fechamento confirmado; o ajuste manual valida sobreposição e **sinaliza lacuna**. O fechamento mostra "vendas importadas até X".

### 6.2 Identidade e atribuição das vendas
- `sale_key` = loja + SKU + instante + identificador do recibo (`coupon`, senão `internal_code`, senão `acquirer_code`) + ordem determinística dentro do recibo. Linha sem identificador ou sem `occurred_at` = pendência bloqueante (afeta valor).
- Só `result = 'OK'`. Vendas confirmadas que viram não-`OK` num relatório corrigido geram **ajuste negativo** rastreável no próximo fechamento aberto (chave original), sem reabrir o confirmado. Vendas importadas depois com data dentro de período confirmado entram no próximo fechamento como `adjustment_late`. Mudança de quantidade numa chave gera ajuste pela diferença.
- Atribuição: SKU com saldo de **um** fornecedor no local/data → atribuído (FATO derivado). Dois ou mais → **pendência bloqueante** até atribuição manual; o sistema só sugere, rotulado ESTIMATIVA.
- Origem desconhecida de visita e quantidade vencida não confirmada **bloqueiam somente se afetarem a atribuição das vendas ou o valor**; caso contrário ficam como pendência operacional visível e as vendas conferidas podem ser pagas.

### 6.3 Custo
O custo de cada venda é o vigente na **data da venda** (`ConsignmentCost`). A configuração e a spec dizem explicitamente que **não é o custo do lote recebido**; a tela não usa essa expressão. Venda sem custo vigente bloqueia. Custos diferentes no mesmo SKU abrem uma linha por vigência. Alterar o cadastro depois não muda fechamento confirmado.

### 6.4 Dados incompletos
Período com importação parcial só confirma com permissão específica, confirmação clara e **justificativa registrada** (`partial_reason`). Vendas importadas depois entram como ajustes (§6.2).

## 7. Fluxo

Estados: `draft` → `confirmed` → `partially_paid` → `paid`; `cancelled`.

- Confirmar congela evidência, linhas, custos e intervalo; é final.
- **Cancelamento direto é proibido se houver pagamento registrado.** Exige o fluxo explícito de correção/reversão dos pagamentos (registros compensatórios, histórico preservado). As vendas só ficam livres para outro fechamento quando **não houver obrigação financeira ativa** ligada a elas; cancelar libera as `sale_key` e exige motivo.
- Pagamento só é registrado; soma dos pagamentos define `partially_paid`/`paid`.
- Exportação PDF e Excel do demonstrativo, a partir da evidência congelada (confirmado) ou da prévia (rascunho, marcada). O Excel traz as chaves de venda.
- Auditoria (ator e instante) em confirmação, cancelamento, reversão, baixa, entrega, atribuição, saldo inicial e aceite parcial.

## 8. Migração dos acertos antigos

O acerto antigo calcula a semana como segunda a domingo em **UTC** (`T00:00:00Z`), de rede inteira, sem chaves de venda.

- Linhas existentes de `Settlement` migram com `kind = legacy`, **mantendo evidência (JSON), `owed_cents`, estado, pagamento e vínculos aos itens de compra**.
- Cada acerto confirmado/pago grava o intervalo **exatamente como foi calculado** (`[Mon 00:00Z, Mon+7 00:00Z)`) como intervalo já acertado. Fechamentos novos **não podem sobrepor** esses intervalos, e as vendas nesses intervalos nunca entram em fechamento novo. É isso que impede cobrança dupla, sem inventar chaves.
- Um acerto `legacy` cujo intervalo ultrapassa o corte bloqueia a definição do corte até ser resolvido.
- `proposal` antigo vira `draft` e continua recalculável pelo fluxo antigo até ser descartado.

## 9. Interface

Rota "Compras → Fechamentos de fornecedores", reaproveitando componentes e padrão visual do acerto atual. Abas: **Vendas e repasse**, **Vencimentos e devoluções**, **Conciliação do estoque**; assistentes de **saldo inicial** e **configuração do fornecedor**. Origem dos números (FATO, MÉTRICA DERIVADA, PREMISSA, ESTIMATIVA) conforme o CLAUDE.md, concentrada em cabeçalhos, legendas e detalhes; sem repetir em cada célula. Cada total abre as vendas (chaves) que o compõem.

## 10. Testes

Regra pura primeiro (TDD): saldo, repasse, atribuição, ajustes (cancelamento posterior, venda tardia, quantidade), soma de devoluções, períodos sem lacuna/sobreposição, exemplo 20/30/18/2. Integração: idempotência do `source_ref`, transferência atômica nas duas pontas, unicidade de `sale_key`, bloqueio de cancelamento com pagamento, migração dos acertos antigos sem cobrança dupla. Front: abas, bloqueios, exportação. Somente fixtures e fakes; nenhum dado sintético em banco real.

## 11. Riscos e decisões pendentes

1. **Corte padrão.** Combinado "29/09/2026 23:59:59". Como o primeiro período começa **exatamente** no corte e os intervalos são semiabertos, o padrão passa a ser **30/09/2026 00:00:00 America/Sao_Paulo** (equivale ao fim do dia 29, sem lacuna). Confirmar.
2. **Janela UTC do acerto antigo × fuso novo.** Há 3 h de diferença nos limites. Se existir acerto antigo confirmado cujo intervalo toque o corte, ele precisa ser resolvido antes. Verificar nos dados reais antes de implementar.
3. **Visita não tem origem.** `supply_visit` não registra de onde saiu o abastecimento. Hoje a transferência depósito→loja só pode ser presumida ou confirmada pelo operador. Decidir: capturar a origem na ingestão (muda `ingestion-worker-service`/`supply-service`) ou aceitar confirmação manual por visita. Sem isso, a pendência bloqueia sempre que o SKU tiver mais de um fornecedor.
4. **Estabilidade do `sale_key`.** `SalesTransaction` é substituído por período a cada reimportação (ids mudam). A chave depende de identificador de recibo; a ordem dentro do recibo precisa ser determinística. Medir nos dados reais (ago e set/2026) quantas linhas ficam sem identificador antes de fixar a regra.
5. **Vendas anteriores a ago/2026** só têm agregado mensal, sem instante: nunca entram no repasse (pendência).
6. **Rota de vendas por loja** nova no `sales-service` (hoje a soma é de rede) e leitura das chaves; exposição via gateway e novas permissões (aceite parcial, reversão de pagamento, saldo inicial) a definir com o IAM existente.
7. **Comprovantes** (devolução e baixa): reaproveitar o armazenamento de arquivos já usado pelo gateway; tamanho e tipos permitidos a fixar na implementação.
