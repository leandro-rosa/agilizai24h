# Agente de Inteligência de Perdas — Fase 1 (Design)

> Escopo: só a Fase 1 (motor + interface, sem estado). Fases 2 (governança/decisão/resultado) e 3 (chat) são referenciadas onde a Fase 1 precisa deixar contrato pronto para elas, mas não são desenhadas aqui.

## 1. Objetivo

A aba Perdas (`frontend/apps/admin/src/app/(app)/supply/page.tsx`, componente `LossTab`) já responde "quanto perdemos, por loja, por motivo, por SKU". Esta mudança acrescenta uma camada que responde **"por que estamos perdendo, o que merece atenção, e o que eu devo fazer"** — sem refazer nem duplicar nada que já existe (KPIs, gráfico de evolução, donut por motivo, ranking de produtos, matriz Produto×Loja, breakdown de abastecido×vendido×perdido).

A análise tradicional continua sendo a fonte dos números. O agente só interpreta esses números.

## 2. Restrições obrigatórias (não-negociáveis)

1. **Nenhuma lógica depende de estoque.** Não existe estoque confiável no sistema. Proibido: estoque atual/estimado, dias de cobertura, excesso de estoque, ruptura por saldo, disponibilidade presumida, transferência por saldo, sell-through que dependa de estoque, saldo de fechamento tratado como estoque atual, e a fórmula `estoque = abastecido − vendido − perdido`. Se uma conclusão exigiria estoque, o motor declara `dado_indisponivel`, nunca estima.
2. **"Outro motivo" nunca vira roubo.** Fica com o rótulo exato do backend ("Outro motivo") em toda a interface e nunca recebe a árvore de decisão de roubo/validade/danificado. Entra na análise financeira e de recorrência como categoria própria.
3. **Nenhuma ação automática.** O motor produz diagnóstico e recomendação; nenhuma reposição é suspensa, nenhum SKU é retirado, nada é escrito em `supply-service` ou qualquer sistema operacional.
4. **Zero endpoint novo, zero mudança de schema.** Fase 1 consome só o que já é consultável hoje (`finance`, `sales`, `supply`, `products`). Nenhuma tabela nova, nenhuma migration.
5. **Sem persistência.** Todo o cálculo é refeito a cada carregamento da tela. Nada de "última análise" salva (isso é Fase 2 — ver §20).
6. **Motor antes de texto.** A saída estruturada (fatos, métricas, sinais, regras acionadas, diagnóstico, recomendação, prioridade, confiança, limitações) existe independente de qualquer texto em linguagem natural. Um texto explicativo pode ser gerado a partir dessa estrutura (template determinístico nesta fase — ver §15.4), nunca o contrário.
7. **Nunca fabricar certeza.** Toda causa não-observada (por que houve dano, por que houve roubo) aparece como hipótese a investigar, nunca como fato afirmado.

## 3. Onde vive

```
frontend/apps/admin/src/lib/loss-intelligence/
  types.ts              contratos de entrada/saída (§6, §13)
  parameters.ts          LossIntelligenceParameters — thresholds provisórios (§14)
  parameter-docs.ts       documentação de cada threshold (§14)
  metrics.ts              cálculo dos fatos/métricas observadas (§7)
  temporal.ts             janela, período fechado vs em andamento, borda (§8)
  test-product-proxy.ts   heurística de produto novo (§9, dado a ausência de flag real)
  diagnosis/
    validity.ts           árvore de validade (§10.1)
    theft.ts               árvore de roubo (§10.2)
    damage.ts               árvore de danificado (§10.3)
    other-reason.ts          "Outro motivo": só métricas, nunca árvore (§10.4)
  consolidate.ts          Produto×Loja×Motivo → Produto×Loja (§11)
  network-comparison.ts   mesmo SKU entre lojas (§12)
  unnecessary-supply.ts   detector transversal (§9 do pedido / aqui §10.5)
  priority.ts             cálculo de prioridade (§16 aqui, chamado de risco-ordering)
  confidence.ts           cálculo de confiança (§17)
  explain.ts              texto determinístico a partir da saída estruturada (§15.4)
  engine.ts               orquestra tudo, função pública `analyzeLossIntelligence(input)`
  *.spec.ts               um arquivo de teste por módulo acima (§18)
```

Módulo puro: sem React, sem `fetch`, sem Redux — mesmo padrão de `loss-insights.ts` e do motor de `commercial-intelligence`. Recebe dados já buscados pelo componente que o chama.

**UI**, dentro de `loss-tab.tsx` (nova seção, não nova tela):
```
frontend/apps/admin/src/components/supply/loss-intelligence/
  agent-summary-panel.tsx      bloco "✦ Agente de Perdas" no topo (§15.1)
  decisions-table.tsx          tabela "Produtos que exigem decisão" (§15.2)
  decision-drawer.tsx          drill-down Produto×Loja (§15.3)
  rules-fired-detail.tsx       "ver detalhes técnicos" dentro do drawer
```

## 4. Reaproveitamento de UI

`StatusBadge`, `ConfidenceBadge`, `ProvenanceBadge` (`frontend/apps/admin/src/components/{status-badge,confidence-badge,provenance-badge}.tsx`) são importados como estão — mesmo vocabulário visual da Inteligência Comercial.

A ficha de parâmetros (`business-rules-sheet.tsx`) e a página de calibração (`commercial-intelligence/calibration/page.tsx`) hoje são **hard-coded em `CommercialParameters`**. Para o pedido de reaproveitar a infraestrutura sem acoplar o motor de perdas a `CommercialParameters` (§26 do pedido), esta mudança generaliza os dois:

- `BusinessRulesSheet` passa a receber `{ title, parameters, docs }` como props em vez de importar `CommercialParameters` direto.
- A página de calibração vira uma composição parametrizada por namespace; `/commercial-intelligence/calibration` continua existindo como está (passa `commercial.*`), e uma nova `/supply/loss-intelligence/calibration` (ou seção equivalente dentro de `/supply`) passa `loss.*`.

Isso é um refactor pequeno e mecânico (extrair props, não mudar comportamento) — listado como Task 0 do plano de implementação, antes de qualquer código novo do motor de perdas.

## 5. Fontes de dado (nada novo, tudo já existe)

| Dado | Fonte | Campo real |
|---|---|---|
| Perda (quantidade e valor), por motivo e por SKU, por loja-período | `finance-service` via `Reconciliation.loss_by_reason_sku` (`frontend/apps/admin/src/lib/api/finance.ts:29-34`) | `{reason, sku, quantity, value_cents}` |
| Abastecido (quantidade), por SKU, por loja-período | `supply-service` via `SupplyPeriod` (`.../lib/api/supply.ts`) | `quantity_restocked` |
| Vendido (quantidade, receita), por SKU, por loja-período | `sales-service` via `SalesRecord` (`.../lib/api/sales.ts:10-15`) | `quantity_sold`, `revenue_cents` |
| Custo datado (para margem) | `products-service` via `GET /costs` | custo vigente na data do período |
| Loja carrega o SKU em quais outras lojas (para comparação de rede) | fan-out já existente de `sales`/`supply`/`finance` por loja | — |

**Por que a perda vem de `finance`, não recalculada aqui**: `finance-service` é a fonte de verdade para perda real por loja/mês (regra do `CLAUDE.md` raiz — nenhum outro serviço re-deriva isso). O motor de Loss Intelligence lê `loss_by_reason_sku`, nunca soma remoções cruas ele mesmo.

**Multi-mês**: `GET /finance/:storeId` já retorna a série completa sem filtro de período — não precisa fan-out mês a mês para perdas. `sales`/`supply` continuam precisando do fan-out cliente já existente (`useGetNetworkSalesRangeQuery`/`useGetNetworkSupplyRangeQuery`).

## 6. Contrato de entrada

```ts
interface LossIntelligenceInput {
  /** Uma linha por loja×período×SKU já presente nos dados buscados — motor não busca nada. */
  reconciliations: Reconciliation[];      // finance — fonte da perda
  salesByStorePeriodSku: SalesRecord[];    // sales
  supplyByStorePeriodSku: {                // supply
    store_id: number; period: string; sku: string; quantity_restocked: number;
  }[];
  costsBySkuAsOf: (sku: string, asOfPeriod: string) => number | null; // products — custo datado, null = desconhecido
  stores: Store[];                          // para nome/id de loja na comparação de rede
  today: string;                             // YYYY-MM-DD — para decidir período "em andamento" (§8)
  parameters: LossIntelligenceParameters;   // §14
}
```

O motor nunca faz uma chamada de rede. Quem monta este objeto é `loss-tab.tsx`, a partir dos mesmos hooks RTK Query que já usa hoje (`useGetNetworkReconciliationRangeQuery`, `useGetNetworkSalesRangeQuery`, `useGetNetworkSupplyRangeQuery`) mais um novo (pequeno, já existente na API) `useGetCostsQuery`/equivalente para custo datado.

## 7. Métricas observadas (fatos e derivados — nenhuma usa estoque)

Calculadas por (loja, SKU) sobre uma janela de períodos fechados (§8):

| Métrica | Fórmula | Numerador | Denominador | Tipo |
|---|---|---|---|---|
| `qtyRestocked` | Σ `quantity_restocked` na janela | — | — | FATO |
| `qtySold` | Σ `quantity_sold` na janela | — | — | FATO |
| `revenueCents` | Σ `revenue_cents` na janela | — | — | FATO |
| `qtyLost[reason]` | Σ `quantity` de `loss_by_reason_sku` onde `reason` bate, na janela | — | — | FATO |
| `valueLostCents[reason]` | Σ `value_cents` de `loss_by_reason_sku`, na janela | — | — | FATO (já valorado por `finance`) |
| `grossMarginCents` | `revenueCents − Σ(quantity_sold × custo_datado)` | receita | — | MÉTRICA DERIVADA |
| `saleToSupplyRatio` | `qtySold / qtyRestocked` | vendido | abastecido | MÉTRICA DERIVADA — **nunca chamada de "sell-through"** (§14 do pedido: esse nome pressupõe disponibilidade/estoque, que não temos) |
| `lossToSupplyRatio[reason]` | `qtyLost[reason] / qtyRestocked` | perdido | abastecido | MÉTRICA DERIVADA |
| `lossToRevenueRatio[reason]` | `valueLostCents[reason] / revenueCents` | perda R$ | receita | MÉTRICA DERIVADA — indefinida se `revenueCents = 0` |
| `lossToMarginRatio[reason]` | `valueLostCents[reason] / grossMarginCents` | perda R$ | margem bruta | MÉTRICA DERIVADA — indefinida se `grossMarginCents ≤ 0`; é o teste de viabilidade econômica do roubo (§10.2) |
| `netMarginAfterLossCents` | `grossMarginCents − Σ valueLostCents[reason]` | — | — | MÉTRICA DERIVADA, **só para exibição** ("se essa perda não existisse, a margem seria X") — nunca reentra como denominador de outra métrica, para não haver dupla dedução |
| `monthsWithRestock` | contagem de períodos na janela com `quantity_restocked > 0` | — | — | FATO — chamado exatamente assim, nunca "frequência de visitas" |
| `monthsWithSales` | contagem de períodos na janela com `quantity_sold > 0` | — | — | FATO |
| `monthsAnalyzed` | nº de períodos fechados na janela | — | — | FATO |
| `firstSeenPeriod` | menor período, em todo o histórico disponível (não só a janela), com abastecimento OU venda deste SKU nesta loja | — | — | FATO |
| `monthsSinceFirstSeen` | `monthsAnalyzed` desde `firstSeenPeriod` até o fim da janela | — | — | FATO — usado no proxy de produto novo (§9) |

`grossMarginCents` fica `null` (não `0`) quando `costsBySkuAsOf` não resolve o custo para nenhuma venda do período — o motor declara `margem_desconhecida`, nunca assume custo zero.

## 8. Janela e tratamento temporal (obrigatório — §15 do pedido)

**Período fechado vs em andamento**: um período é "fechado" se seu mês já terminou antes de `today`; o mês corrente é "em andamento". Mesmo conceito já usado na validação da fonte Drive (`DRIVE_COVERAGE_MIN_STORE`, "mês em andamento: a janela vai até hoje").

**Regra da borda**: um abastecimento ocorrido no **último período fechado** da janela só entra no cálculo de `saleToSupplyRatio`/sinais de "abasteceu e não vendeu" se houver **pelo menos um período fechado seguinte** dentro da janela em que a venda poderia ter acontecido. Concretamente:

- `qualifyingRestockPeriods` = períodos fechados da janela, **exceto o mais recente**, a não ser que esse já seja o único período com abastecimento em todo o histórico (SKU claramente novo, tratado por §9).
- O período em andamento nunca entra como evidência de "abasteceu sem vender" — aparece na saída como `contexto_periodo_atual`, informativo, nunca decisivo.
- Se a janela tem só 1 período fechado qualificável, a confiança nunca passa de "Média" (ver §17) — evidência de um período só é fraca.

Isso evita o caso citado no pedido: abastecer no dia 28 e classificar como "sem venda" antes mesmo do mês seguinte fechar.

**Janela padrão**: `parameters.window.primaryWindowMonths` (provisório: 3 meses fechados) é a janela que decide a recomendação. `parameters.window.recurrenceLookbackMonths` (provisório: 6 meses fechados) é usada só para o sinal de recorrência (§10.1 caso E, §16) — olha mais para trás sem mudar a recomendação-base.

## 9. Produto novo / "em teste" (gap real, sem flag no sistema)

**Fato confirmado no código**: não existe nenhum campo "em teste"/`is_test` em `products-service` nem em nenhum outro serviço (checado em `backend/apps/products-service/prisma/schema.prisma` e `src/`). A Fase 1 não pode inventar esse campo.

**Proxy usado, honestamente rotulado como proxy**: `monthsSinceFirstSeen` (§7) substitui a flag ausente. Se `monthsSinceFirstSeen < parameters.testProduct.minClosedMonths` (provisório: 2) **ou** `qtyRestocked` acumulado desde `firstSeenPeriod` `< parameters.testProduct.minUnits` (provisório: 15), o SKU×Loja entra em **modo protegido**:

- Confiança nunca passa de "Baixa", a não ser que a evidência seja tão grande que nem 2 meses de histórico deixem dúvida (ex.: 50 unidades abastecidas, zero vendidas, 20 perdidas — caso extremo, ver §19 casos extremos).
- As árvores de decisão (§10) ainda rodam, mas o resultado nunca ultrapassa 🟡/🟠 nesta condição — nunca 🔴/⚫ enquanto "novo" — a não ser pela mesma exceção de evidência esmagadora acima.
- A saída inclui explicitamente `produto_provavelmente_novo: true` e a limitação correspondente em `limitacoes_dos_dados`.

Isso fica documentado como **gap conhecido** no §21: se `products-service` ganhar uma flag real de "em teste" no futuro, ela substitui este proxy sem mudar o resto do motor (só a condição de entrada do modo protegido muda).

## 10. Árvores de decisão por motivo

Cada árvore roda **independente por Produto×Loja×Motivo** (não mistura roubo com validade). A entrada de cada árvore é o subconjunto de métricas do §7 filtrado pelo `reason` correspondente.

### 10.1 Validade (`reason = "expired"`)

Sinais de entrada: `qtySold`, `qtyLost["expired"]`, `qtyRestocked`, `saleToSupplyRatio`, `lossToSupplyRatio["expired"]`, `monthsWithRestock`, recorrência (períodos consecutivos, dentro do `recurrenceLookbackMonths`, com `qtyLost["expired"] > 0`).

| Caso | Condição (provisória, nomes em `parameters.validity.*`) | Regra acionada | Ação |
|---|---|---|---|
| A | `qtySold == 0` E `qtyLost["expired"] > 0` E `monthsWithRestock ≥ minRepeatedSupplyMonths` (2) | `ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS` | 🔴 Suspender novos abastecimentos |
| B | `qtySold > 0` E `saleToSupplyRatio < lowSaleRatio` (0.5) E perda recorrente (≥2 dos últimos `recurrenceLookbackMonths`) | `LOW_SALE_RATIO_RECURRING_EXPIRY` | 🟡 Reduzir abastecimento |
| C | `saleToSupplyRatio ≥ lowSaleRatio` E perda pontual (só 1 período com `qtyLost["expired"]>0` no lookback) | `HEALTHY_SALE_RATIO_ISOLATED_EXPIRY` | 🟢 Manter + monitorar |
| D | Caso A ou B nesta loja, **mas** `networkComparison.affectedShare ≤ localOutlierMaxShare` (0.3) — ver §12 | `LOCAL_OUTLIER_VS_HEALTHY_NETWORK` | 🔴 Avaliar retirada da loja (em vez de só suspender — evidência de rede já descarta problema do produto) |
| E | Caso A ou B em `≥ networkWideMinShare` (0.7) das lojas onde o SKU é abastecido, com `≥ minStoresForNetworkVerdict` (5) lojas comparáveis | `NETWORK_WIDE_LOW_PERFORMANCE_EXPIRY` | ⚫ Avaliar retirada da rede |
| — | Nenhum caso acima se aplica com confiança suficiente | `INSUFFICIENT_EVIDENCE` | ⚪ Dados insuficientes |

Casos D/E dependem da comparação de rede (§12) ter rodado primeiro — a árvore de validade consulta o resultado dela, não a recalcula. D e E **não são ramos independentes de A/B/C**: são um refinamento — primeiro decide-se A, B ou C pela evidência local, depois, se a loja caiu em A ou B, a comparação de rede pode *escalar* essa ação (D → retirada da loja, E → retirada da rede). Entre `localOutlierMaxShare` (0.3) e `networkWideMinShare` (0.7) nenhuma escalada acontece — a ação fica a de A/B mesmo, sem upgrade nem downgrade.

### 10.2 Roubo (`reason = "other_reason"`, quando o contexto é de roubo suspeito — ver nota)

**Nota de nomenclatura**: como `other_reason` é o único bucket disponível e nunca deve ser chamado de roubo por inferência (restrição §2), esta árvore roda sobre `other_reason` mas a interface **nunca afirma "roubo"** — mostra "Outro motivo" com a mesma lógica de viabilidade econômica descrita aqui, e a documentação do parâmetro deixa claro que "roubo" é a hipótese de negócio por trás do nome da árvore, não um fato extraído do dado. (Isso resolve a tensão entre a pergunta 1 respondida — "roubo está classificado como outro motivo, manter assim" — e o pedido de uma árvore de roubo: a lógica de roubo existe, rotulada honestamente como análise de "Outro motivo".)

Sinais: `qtySold`, `valueLostCents["other_reason"]`, `grossMarginCents`, `lossToMarginRatio["other_reason"]`, recorrência.

| Caso | Condição | Regra | Ação |
|---|---|---|---|
| Saudável com perda | `qtySold > minHealthyUnits` (provisório: definido por categoria seria melhor, mas Fase 1 usa um valor de rede: 20) E `grossMarginCents > 0` E `lossToMarginRatio["other_reason"] < viabilityMaxRatio` (0.3) | `HEALTHY_PRODUCT_WITH_LOSS` | 🟠 Investigar controle/exposição (nunca 🔴) |
| Inviável economicamente | `lossToMarginRatio["other_reason"] ≥ viabilityMaxRatio` (0.3) — a perda consome 30%+ da margem gerada — E recorrente (≥2 períodos) | `LOSS_EXCEEDS_VIABILITY_THRESHOLD` | 🔴 Avaliar retirada da loja |
| Margem desconhecida | `grossMarginCents == null` | `MARGIN_UNKNOWN` | ⚪ Dados insuficientes (nunca assume margem) |
| Baixo volume, perda baixa | nenhum dos acima e `valueLostCents["other_reason"]` abaixo de `negligibleValueCents` (provisório) | `NEGLIGIBLE_OTHER_REASON_LOSS` | 🟢 Manter |

Explícito na saída: **hipótese, nunca causa afirmada** — o diagnóstico textual nunca diz "está sendo roubado por exposição ruim"; diz "perda concentrada em Outro motivo, sem evidência de causa específica no dado disponível".

### 10.3 Danificado (`reason = "damaged_product"`)

Sinais: `qtyLost["damaged_product"]` por loja, e a mesma métrica para o mesmo SKU em todas as lojas que o carregam (rede) — necessário para a concentração.

`concentrationShare = qtyLost["damaged_product"]` nesta loja `/ Σ qtyLost["damaged_product"]` do mesmo SKU em toda a rede, na mesma janela.

| Caso | Condição | Regra | Ação |
|---|---|---|---|
| Concentrado numa loja | `concentrationShare ≥ localConcentrationMin` (0.7) E `≥ minStoresCarryingForConcentration` (3) lojas carregam o SKU (senão "concentração" não significa nada) | `DAMAGE_CONCENTRATED_LOCAL` | 🟠 Investigar operação local — hipóteses (manuseio/armazenamento/exposição), nunca afirmadas |
| Espalhado na rede | `concentrationShare < localConcentrationMin` em toda loja relevante E `qtyLost["damaged_product"]` recorrente em `≥ minStoresForSystemic` (4) lojas | `DAMAGE_SYSTEMIC_NETWORK` | 🟠 Investigar problema sistêmico — hipóteses (embalagem/transporte/produto), nunca afirmadas |
| Poucas lojas carregam o SKU | `< minStoresCarryingForConcentration` | `INSUFFICIENT_STORES_FOR_DAMAGE_PATTERN` | ⚪ Dados insuficientes para concluir concentração — mostra só os fatos locais |

### 10.4 Outro motivo — quando NÃO está no papel de "roubo suspeito"

Fora do uso descrito em §10.2 (que é a única árvore que consome `other_reason` como sinal de decisão), toda ocorrência de `other_reason` aparece nas métricas gerais (KPI de perda por motivo, recorrência) exatamente como está — sem árvore própria adicional, sem reclassificação. Isto evita rodar a "árvore de roubo" duas vezes com nomes diferentes.

### 10.5 Detector transversal — abastecimento sem sentido

Roda **depois** das três árvores acima, sobre o mesmo Produto×Loja consolidado (§11), nunca por motivo isolado — porque o padrão que ele procura frequentemente cruza motivos (abasteceu, perdeu por validade, abasteceu de novo).

Sinais compostos (cada um citando os fatos usados, nunca "estoque"):

| Padrão | Condição | Regra |
|---|---|---|
| Zero venda + abastecimento recorrente | `qtySold == 0` E `monthsWithRestock ≥ 2` (dentro de `qualifyingRestockPeriods`) | `ZERO_SALES_RECURRING_SUPPLY` |
| Zero/baixíssima venda + perda de validade | `saleToSupplyRatio < verylowSaleRatio` (0.15) E `qtyLost["expired"] > 0` | `LOW_SALES_EXPIRY_WASTE` |
| Perda de validade + reposição depois | existe período com `qtyLost["expired"]>0` seguido de outro período (dentro da janela) com `quantity_restocked>0` para o mesmo SKU×loja | `RESTOCK_AFTER_EXPIRY_LOSS` |
| Abastecido muito acima do vendido + perda recorrente | `saleToSupplyRatio < lowSaleRatio` (0.5) E perda recorrente (≥2 períodos, qualquer motivo) | `OVERSUPPLY_WITH_RECURRING_LOSS` |

Cada padrão detectado vira um `sinal_detectado` com prioridade elevada (§16) — não substitui a árvore por motivo, **soma-se** a ela como evidência extra no diagnóstico consolidado. O caso do pedido (Paçoquita, 18 abastecidos / 0 vendidos / 5 perdidos por validade / 3 meses com abastecimento) aciona tanto `ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS` (§10.1 caso A) quanto `ZERO_SALES_RECURRING_SUPPLY` e `LOW_SALES_EXPIRY_WASTE` aqui — os três nomeados juntos em `regras_acionadas`.

Sujeito ao modo protegido de produto novo (§9): um SKU com `monthsSinceFirstSeen < 2` nunca aciona este detector com prioridade Crítica, só Média no máximo, até completar o mínimo de meses.

## 11. Consolidação Produto × Loja

Cada árvore (§10.1-10.3) produz um diagnóstico **por motivo**. A tela mostra uma linha por Produto×Loja (não por motivo) — por isso existe uma regra explícita de consolidação, que **não é "pega o mais severo"**:

1. Calcula-se o diagnóstico de cada motivo presente (só motivos com `qtyLost[reason] > 0` no período geram diagnóstico).
2. **Motivo principal** = o motivo com maior `valueLostCents[reason]` no período — critério financeiro, não de severidade da ação.
3. **Ação principal** = a ação do diagnóstico do motivo principal.
4. **Ações secundárias** = ações dos demais motivos com diagnóstico, listadas, nunca escondidas — se validade diz "suspender" e danificado (motivo secundário, menor valor) diz "investigar", a tela mostra os dois, com o principal em destaque.
5. **Exceção de segurança**: se qualquer motivo (principal ou secundário) chega em 🔴/⚫ por evidência de rede (casos D/E de §10.1, ou o caso de inviabilidade de §10.2), essa ação **nunca é rebaixada** pela consolidação — ela sempre aparece pelo menos como ação secundária visível, mesmo que não seja a principal. Isto é o que evita "conflito escondido": a consolidação organiza por relevância financeira, mas nunca apaga um sinal grave.
6. Se dois motivos empatam em valor perdido, desempata por `qtyLost[reason]` (unidades), depois por ordem alfabética do `reason` (determinístico, nunca aleatório).

Exemplo do próprio pedido: Paçoquita×ADM tem só validade com perda (`qtyLost["damaged_product"]=0`) → motivo principal = validade, ação = suspender, sem ação secundária. Se também tivesse dano recorrente, apareceria: "Recomendação principal: suspender (validade) · Ação secundária: investigar dano recorrente (danificado)" — exatamente como o pedido pede em §4.

## 12. Comparação com a rede

Para cada (SKU, motivo) com diagnóstico em pelo menos uma loja, calcula-se sobre **todas as lojas onde o SKU foi abastecido ou vendido** na mesma janela:

- `storesCarryingSku` = nº de lojas com `qtyRestocked>0 OU qtySold>0` para o SKU na janela.
- `storesWithSameSignal` = nº dessas lojas cujo diagnóstico daquele motivo caiu no mesmo "lado ruim" (casos A/B de validade, caso de inviabilidade de roubo, concentração local de dano — cada árvore define o que conta como "sinal ruim" dela).
- `affectedShare = storesWithSameSignal / storesCarryingSku`, só calculado quando `storesCarryingSku ≥ minStoresForNetworkVerdict` (5); abaixo disso, a comparação de rede fica `dado_insuficiente` e as árvores não usam os casos D/E.

A saída de cada linha inclui `comparacao_rede: { storesCarryingSku, storesWithSameSignal, affectedShare, storesHealthy: [...nomes] }` — a base do texto "o SKU tem desempenho saudável em N outras lojas" pedido em §11/§24.

## 13. Contrato de saída

Uma linha por Produto×Loja (consolidada), cada uma carregando os diagnósticos por motivo dentro dela:

```ts
interface LossIntelligenceRecommendation {
  sku: string;
  storeId: number;
  janelaAnalisada: { primaryMonths: string[]; recurrenceLookbackMonths: string[] };

  metricasObservadas: LossMetrics;               // §7, por motivo quando aplicável

  diagnosticosPorMotivo: {
    reason: "expired" | "damaged_product" | "other_reason";
    metrics: PerReasonMetrics;
    sinaisDetectados: string[];                   // ex.: ["ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS"]
    regrasAcionadas: string[];                     // mesmo conjunto, nome estável para UI técnica
    acao: LossAction;
    hipoteses: string[];                            // só quando a árvore gera hipótese não-afirmada (roubo/dano)
  }[];

  motivoPrincipal: "expired" | "damaged_product" | "other_reason";
  motivosSecundarios: string[];

  recomendacaoPrincipal: LossAction;
  acoesSecundarias: LossAction[];

  sinaisTransversais: string[];                    // §10.5, ex.: ["RESTOCK_AFTER_EXPIRY_LOSS"]

  prioridade: "critica" | "alta" | "media" | "baixa";
  confianca: "alta" | "media" | "baixa" | "insuficiente";

  comparacaoRede: NetworkComparisonResult | "dado_insuficiente";

  limitacoesDosDados: string[];                    // ex.: ["margem_desconhecida", "produto_provavelmente_novo"]

  produtoProvavelmenteNovo: boolean;

  versaoMotor: string;                              // ex.: "loss-intelligence/0.1.0-provisional"
  versaoParametros: string;                          // hash ou versão de LossIntelligenceParameters
}

type LossAction =
  | "manter"
  | "manter_monitorar"
  | "reduzir_abastecimento"
  | "investigar"
  | "suspender_abastecimento"
  | "avaliar_retirada_loja"
  | "avaliar_retirada_rede"
  | "dados_insuficientes";
```

Este contrato já é o que a Fase 2 vai persistir (ligado a `add-commercial-intelligence-governance`) — nenhum campo aqui existe só para a Fase 1 e precisa ser reinventado depois.

## 14. Parâmetros (`LossIntelligenceParameters`, namespace `loss.*`)

Arquivo próprio, `NEXT_PUBLIC_LI_<PATH>` como prefixo de env (paralelo a `NEXT_PUBLIC_CI_*`, nunca reaproveitando `CommercialParameters`). Cada campo documentado em `parameter-docs.ts` com: nome, namespace, finalidade, fórmula, numerador, denominador, unidade, janela, valor provisório, motivo do default, decisão que controla, efeito de aumentar, efeito de diminuir, comportamento quando o dado está ausente — seguindo exatamente `PARAMETER_DOCS` de `commercial-intelligence` como modelo de formato.

| Parâmetro | Provisório | Numerador/Denominador | Controla | Efeito ↑ | Efeito ↓ | Se dado ausente |
|---|---|---|---|---|---|---|
| `window.primaryWindowMonths` | 3 | meses fechados | janela principal de evidência | menos ruído, reação mais lenta | mais reativo, mais ruído | usa quantos meses fechados existirem, se menos que 3 |
| `window.recurrenceLookbackMonths` | 6 | meses fechados | detecção de recorrência (§16) | detecta padrões mais longos | perde recorrência de médio prazo | idem |
| `validity.minRepeatedSupplyMonths` | 2 | meses com abastecimento | caso A dispara | exige mais repetição p/ suspender | suspende mais cedo | — |
| `validity.lowSaleRatio` | 0.5 | vendido/abastecido | separa caso B de caso C | mais produtos viram "reduzir" | menos produtos viram "reduzir" | indefinido se `qtyRestocked=0` |
| `validity.localOutlierMaxShare` | 0.3 | lojas com mesmo sinal / lojas comparáveis | caso D (retirada da loja) | mais difícil chegar em D | mais fácil chegar em D | usa `dado_insuficiente` de §12 |
| `validity.networkWideMinShare` | 0.7 | idem | caso E (retirada da rede) | mais difícil chegar em E | mais fácil chegar em E | idem |
| `network.minStoresForNetworkVerdict` | 5 | nº de lojas | habilita §12 | exige mais lojas para comparar | compara com poucas lojas (menos confiável) | abaixo disso, `dado_insuficiente` |
| `theft.minHealthyUnits` | 20 | unidades vendidas na janela | "saudável" em §10.2 | mais exigente p/ considerar saudável | menos exigente | — |
| `theft.viabilityMaxRatio` | 0.3 | perda R$ / margem bruta R$ | corte de inviabilidade econômica | mais perda tolerada antes de sugerir retirada | menos perda tolerada | `dados_insuficientes` se margem desconhecida |
| `theft.negligibleValueCents` | 5000 (R$50) por janela | valor perdido R$ na janela | corte "manter" sem investigar | mais casos viram "investigar" | mais casos viram "manter" | — |
| `damage.localConcentrationMin` | 0.7 | perda nesta loja / perda do SKU na rede | concentração local | mais exigente p/ afirmar "local" | mais fácil afirmar "local" | — |
| `damage.minStoresCarryingForConcentration` | 3 | nº de lojas | habilita o cálculo de concentração | — | — | abaixo disso, `dados_insuficientes` |
| `damage.minStoresForSystemic` | 4 | nº de lojas afetadas | caso sistêmico | mais exigente | menos exigente | — |
| `unnecessarySupply.verylowSaleRatio` | 0.15 | vendido/abastecido | padrão "baixíssima venda" | — | — | — |
| `testProduct.minClosedMonths` | 2 | meses fechados desde primeira aparição | modo protegido liga/desliga | protege por mais tempo | protege por menos tempo | — |
| `testProduct.minUnits` | 15 | unidades abastecidas desde primeira aparição | idem | idem | idem | — |
| `priority.criticalValueCents` | 30000 (R$300) na janela principal | valor perdido R$ do motivo principal | corte Crítica vs Alta (§16) | menos casos viram Crítica | mais casos viram Crítica | não bloqueia — falta de custo datado só afeta `grossMarginCents`, não este corte (é valor de perda, já valorado por `finance`) |
| `confidence.minMonthsForHigh` | 3 | meses fechados qualificáveis | corte Alta vs Média (§17) | mais exigente para "Alta" | menos exigente | — |

Todos com `isProvisional: true` — mesma bandeira de `commercial-intelligence`, mesma tela "Regras de negócio" (agora genérica, §4) avisando que são padrões de julgamento, não medidos.

## 15. Interface

### 15.1 Painel do Agente (topo da seção, dentro de `loss-tab.tsx`)

```
✦ Agente de Perdas
N decisões recomendadas

🔴 X suspender abastecimento
🟡 X reduzir abastecimento
🟠 X investigar
⚫ X avaliar retirada da rede
🔴 X avaliar retirada da loja

Impacto potencial estimado: R$ X–Y/mês em perdas potencialmente evitáveis
(nunca "economia garantida" — mesmo texto de resguardo do "Estimativa de impacto" da Inteligência Comercial)

[Ver todas as recomendações]
```

Contagens vêm de `recomendacaoPrincipal` de cada linha (não conta ações secundárias, para não inflar o total). O intervalo de impacto usa os mesmos três cenários (conservador/esperado/otimista) já com precedente em `commercial-intelligence` — aplicados sobre a soma de `valueLostCents` das linhas com ação diferente de "manter"/"dados insuficientes".

### 15.2 Tabela "Produtos que exigem decisão"

Colunas: Produto, Loja, Vendas, Abastecido, Perda, Motivo principal, Diagnóstico (texto curto), Ação, Prioridade, Confiança.

Filtros: motivo (Todos/Validade/Roubo/Danificado/Outro — "Roubo" aqui filtra por `diagnosticosPorMotivo` cujo `reason="other_reason"` E que passou pela árvore de §10.2, não por todo `other_reason`), ação (Todas/Manter/Monitorar/Reduzir/Investigar/Suspender/Retirar), prioridade, confiança, loja, categoria (via `products-service`).

Nunca repete gráfico/ranking/KPI já existente na aba — é só a tabela de decisão.

### 15.3 Drill-down (drawer lateral)

Ao clicar numa linha: cabeçalho (Produto — Loja, badge de ação, prioridade, confiança) → Evidências (métricas da janela principal) → Histórico (uma linha por período dentro do lookback de recorrência) → Comparação com a rede (texto + números de §12) → Diagnóstico (motivo principal + secundários, com hipóteses claramente marcadas como hipótese) → Recomendação → "Ver regras acionadas" (expande a lista técnica de `regrasAcionadas`) → Limitações (`limitacoesDosDados`, sempre visível quando não-vazio, nunca escondida atrás de um clique extra).

### 15.4 Texto explicativo (determinístico, Fase 1)

Nesta fase, "explicação em linguagem natural" é um **template** que substitui variáveis da saída estruturada — não um LLM. Um template por combinação de regra-acionada-principal, ex.:

```
"{qtyRestocked} abastecidos, {qtySold} vendidos, {qtyLost} perdidos por {motivoLabel}
em {monthsWithRestock} meses com abastecimento nos últimos {primaryWindowMonths} meses.
{networkComparisonSentence}. {recommendationSentence}"
```

Isso cumpre o §21 do pedido ("motor primeiro, texto depois") sem esperar por uma integração de LLM — a Fase 3 (chat) é quem eventualmente troca o template por geração real, consultando os mesmos campos estruturados, nunca inventando um número que não esteja em `metricasObservadas`.

## 16. Cálculo de prioridade

Não é um score único — é atribuição por regra, auditável (lista de gatilhos, cada um citado em `sinaisDetectados`):

- **Crítica**: `recomendacaoPrincipal ∈ {suspender_abastecimento, avaliar_retirada_rede}` E `confianca ≥ media` E (`sinaisTransversais` não-vazio OU `valueLostCents` do motivo principal acima de `priority.criticalValueCents` (provisório)).
- **Alta**: `recomendacaoPrincipal ∈ {suspender_abastecimento, avaliar_retirada_loja, avaliar_retirada_rede, reduzir_abastecimento}` sem atender Crítica.
- **Média**: `recomendacaoPrincipal ∈ {investigar, manter_monitorar}`.
- **Baixa**: `recomendacaoPrincipal ∈ {manter}`.
- `dados_insuficientes` nunca recebe prioridade — fica fora do ranking, listada à parte ("N casos sem evidência suficiente ainda").

Isso já cobre os fatores pedidos em §19 (impacto financeiro e unidades entram via o corte `criticalValueCents`; recorrência e continuidade de abastecimento entram via os `sinaisTransversais` que só disparam com recorrência real; extensão do problema entra via `avaliar_retirada_rede` só existir com evidência de rede) sem um score opaco.

## 17. Cálculo de confiança

Por regra, não por fórmula contínua:

- **Insuficiente**: `monthsAnalyzed < 1` período qualificável, ou `produtoProvavelmenteNovo` sem evidência esmagadora (§9), ou margem desconhecida quando a árvore depende dela (roubo).
- **Baixa**: exatamente 1 período qualificável, ou `produtoProvavelmenteNovo=true` com evidência forte (exceção de §9), ou `comparacaoRede="dado_insuficiente"` quando a árvore usaria rede (casos D/E de validade).
- **Média**: ≥2 períodos qualificáveis, sem contradição (ver abaixo), rede insuficiente mas a árvore não depende dela neste caso.
- **Alta**: ≥`confidence.minMonthsForHigh` (provisório: 3) períodos qualificáveis, sem contradição, E (comparação de rede disponível OU não necessária para o caso).

**Dados contraditórios** (rebaixa um nível, nunca sobe): ex. `qtySold=0` num período e `qtySold>0` no seguinte sem explicação de sazonalidade capturável — Fase 1 não tenta explicar, só rebaixa a confiança e registra `padrao_instavel` em `limitacoesDosDados`.

## 18. Testes obrigatórios

Um `.spec.ts` por módulo do §3, cobrindo pelo menos:

- `metrics.ts`: cada fórmula do §7, incluindo os casos `null`/indefinido (margem desconhecida, denominador zero).
- `temporal.ts`: borda de janela (restock no último período fechado não conta), mês em andamento nunca decide, janela com só 1 período qualificável.
- `test-product-proxy.ts`: SKU novo entra em modo protegido; SKU novo com evidência esmagadora escapa do teto de prioridade mas não do de confiança "Baixa" salvo o caso extremo citado.
- `diagnosis/validity.ts`: um teste por caso A-E do §10.1, incluindo o exemplo literal do pedido (Paçoquita: 18/0/5/3 meses → suspender, confiança alta) e o "caso diferente" do pedido original (50/42/4 → reduzir, não retirar).
- `diagnosis/theft.ts`: produto saudável com perda (nunca retirar automaticamente — teste que EXPLICITAMENTE falha se a ação for `avaliar_retirada_loja` quando `lossToMarginRatio < viabilityMaxRatio`), produto inviável (retirada só aqui), margem desconhecida → dados insuficientes.
- `diagnosis/damage.ts`: concentração local (90%/1 loja → investigar local), espalhado (sistêmico), poucas lojas carregando o SKU → dados insuficientes.
- `unnecessary-supply.ts`: cada um dos 4 padrões do §10.5 isolado, e o caso combinado (Paçoquita aciona 3 regras ao mesmo tempo).
- `consolidate.ts`: motivo principal por valor (não por severidade), ação secundária nunca escondida, exceção de segurança (🔴 secundário nunca rebaixado), empate desempatado deterministicamente.
- `network-comparison.ts`: `affectedShare` correto, corte de `minStoresForNetworkVerdict`, caso D e caso E do pedido (Paçoquita saudável em 9 lojas vs SKU ruim em 14 de 17).
- `priority.ts`, `confidence.ts`: cada tier, e o caso explícito do pedido "prioridade alta + confiança baixa é válido" (não são a mesma dimensão).
- `engine.ts`: teste de integração ponta a ponta com um `LossIntelligenceInput` sintético cobrindo os 3 motivos numa mesma loja×SKU, verificando o objeto de saída completo.

Fixtures sintéticas — nunca dado real do banco de dev nos testes (regra de isolamento do projeto).

## 19. Casos extremos

- SKU sem nenhuma venda nem perda no período, só abastecimento — sem diagnóstico de motivo (não há `reason` com `qtyLost>0`), mas ainda pode acionar `ZERO_SALES_RECURRING_SUPPLY` (§10.5) sozinho.
- Loja nova (poucos meses de operação) — mesma proteção de "produto novo" se aplica quando `firstSeenPeriod` da LOJA (não só do produto) é recente; usar o mínimo de `monthsSinceFirstSeen` entre produto e loja.
- SKU descontinuado no meio da janela (abastecido nos 2 primeiros meses, não no 3º) — `monthsWithRestock` conta certo, mas o período sem abastecimento não deve gerar falso "zero abastecimento contínuo"; a árvore só olha períodos em que houve pelo menos abastecimento OU venda.
- Custo datado ausente para parte das vendas do período (produto sem custo cadastrado naquele mês) — `grossMarginCents=null`, árvore de roubo cai em `dados_insuficientes`, nunca assume custo zero nem ignora as vendas sem custo.
- Mesmo SKU com motivo principal diferente em meses diferentes dentro do lookback (ex.: validade em junho, dano em agosto) — cada mês entra na recorrência do seu próprio motivo; não soma perdas de motivos diferentes para "inflar" recorrência de um só.
- Todas as lojas da rede compartilham o mesmo problema (nenhuma "saudável" para comparar) — caso E deve disparar mesmo sem lojas saudáveis de referência, já que o critério é `affectedShare`, não a existência de contraste.

## 20. O que fica para a Fase 2 (não construir agora)

- Persistência de qualquer snapshot — inclusive o necessário para "novidades desde a última análise" (movido do pedido original, confirmado pelo usuário).
- Botões Aceitar/Ignorar/Monitorar funcionais (podem aparecer desabilitados/"em breve" na UI da Fase 1, mas sem gravar nada).
- Acompanhamento de resultado.
- Métricas de performance da própria inteligência (aceitas/rejeitadas/precisão).
- `intelligence-service` (governança) — este design já deixa o contrato de saída (§13) pronto para ser o payload que a Fase 2 grava lá, mas não cria o serviço.

## 21. Limitações conhecidas desta fase (declaradas na própria UI, não escondidas)

- Sem estoque confiável — nenhuma conclusão sobre "produto parado" é feita; o motor só fala de abastecido/vendido/perdido, nunca de saldo.
- Sem data de visita de abastecimento — "meses com abastecimento" é o proxy mais fino disponível, não é frequência real de visitas.
- Sem flag real de "produto em teste" — proxy por tempo desde primeira aparição, documentado como aproximação.
- `other_reason` nunca é afirmado como roubo — é tratado com a lógica de viabilidade econômica que faz sentido para roubo, mas o rótulo na tela é sempre "Outro motivo".
- Comparação de rede exige um mínimo de lojas comparáveis (5) — SKUs de nicho (poucas lojas) não geram veredito de rede.

## 22. Critérios de aceite da Fase 1

1. A aba Perdas mostra o painel do Agente, a tabela de decisões e o drill-down, sem remover nem duplicar nenhum widget existente.
2. Nenhuma chamada de rede nova além das já usadas por `loss-tab.tsx` mais custo datado de `products-service`.
3. Nenhuma menção a estoque, saldo, disponibilidade ou dias de cobertura em qualquer texto gerado pelo motor — checável por teste (busca por essas palavras na saída de `explain.ts` sobre as fixtures de teste, falha se aparecerem fora de `limitacoesDosDados` declarando a ausência).
4. Os dois exemplos literais do pedido do usuário (Paçoquita 18/0/5 → suspender; 50/42/4 → reduzir; Produto ADM 84 vendidos/11 roubados com margem positiva → investigar, nunca retirar; dano 86% concentrado numa loja → investigar local) produzem exatamente a ação esperada nos testes do motor.
5. Toda ação 🔴/⚫ tem pelo menos um `sinalDetectado`/`regraAcionada` nomeado na saída — nunca aparece sem explicação auditável.
6. `pnpm --filter @agiliz/admin typecheck lint` e a suíte de testes do motor passam limpos.
7. Revisão manual no browser (mock ou dados reais já importados) confirmando que os textos de diagnóstico soam como o exemplo do §36 do pedido, sem eu precisar caçar a informação manualmente.
