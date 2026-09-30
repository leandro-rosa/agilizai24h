# Inteligência Comercial v2: Mix × Quantidade × Saldo × Próximo abastecimento

> **Status em 30/09/2026 (fim do dia): Fase 0 pronta; o resto aguarda sua aprovação.** Nada das Fases 1 a 5 foi implementado. Este documento é o desenho que o briefing pediu antes de qualquer implementação.

## Onde estamos

**Feito (Fase 0, parte de dados):** as visitas de abastecimento agora são guardadas (`supply_visit` / `supply_visit_line`) com saldo anterior, contagem, abastecido, remoções, ajuste e saldo final por visita, e jan–ago foi reimportado. A aba **Qualidade do saldo** (Inteligência Comercial) mede se o saldo do sistema é confiável. Conferido contra as planilhas originais: 97 de 99 combinações loja × mês batem exatamente.

**O que a medição mostrou (FATO, jan–ago, 21 lojas):**

| Medida | Resultado |
|---|---|
| Linhas de visita / linhas contadas | 88.199 / 25.538 (29%). Contagem só existe a partir de março; cobertura de 20% a 63% por mês |
| Contagem igual ao saldo do sistema | **97,0%** (giro alto 95,5%, médio 96,8%, baixo 97,3%) |
| Diferença nas 3% restantes | 372 linhas de ±1, 109 de ±2, 197 de 3 a 5, 58 de 6 a 10, 19 acima de 10 (máx. 36). Piora com saldo alto: 93,3% iguais entre 16 e 40 unidades |
| Consumo entre visitas × venda, por loja-mês | mediana **0,985**, 90% das lojas-mês entre 0,94 e 1,04 (79 loja-meses) |
| Consumo × venda por loja × SKU × mês | só 43% exatamente iguais, mas 97% dentro de ±2 un.; giro alto diverge mais (p99 ≈ 10 un.) |
| Saldo que subiu entre visitas sem evento | 108 pares (425 un.) |
| Lacunas | sem venda importada: SP03 (mar–jun), SP03 Copa (jul), Taipas ADM (maio); `Capacidade` 0 em todas as linhas; 112 operações do centro de distribuição sem loja (mai, jun, ago) |

**Leitura honesta:** consumo e venda vêm do mesmo PDV, então a concordância valida o alinhamento dos dados, não o estoque físico. A medida do erro físico exige contagem cega (adiada). A tolerância continua **indefinida**: a decisão é sua, com estes números na mão (decisão 5 abaixo).

**Achado de processo:** a importação tinha um defeito antigo que gravava meses incompletos (corrigido e reimportado). Por isso os totais mensais de fev–jul do painel de Abastecimento subiram e agora batem com as planilhas.

**Ainda falta da Fase 0:** `par_level_history` (histórico do "qtd itens por loja"), importar sua planilha de precificação (Medida, preço), importar setembro (chega em 01/10) e limpar as linhas sintéticas do `minimum_level`.

---

Escrito para: Leandro (operação/dono do produto), para aprovar o desenho antes de qualquer código.

Rótulos usados: **FATO** (medido nos dados), **DERIVADO** (calculado de fatos), **PREMISSA** (vem de você ou é parâmetro), **ESTIMATIVA** (modelo), **HIPÓTESE** (ainda não provado). Nenhum limiar abaixo é final. Todos são parâmetros provisórios, a calibrar por backtest.

## 0. Resumo em 10 linhas

1. **A conclusão mais importante da auditoria:** os planilhões brutos de abastecimento trazem, **por visita**, `Qtd. Anterior`, `Qtd. final`, `Qtd. confirmada` (contagem), data/hora, usuário e tipo de operação (Abastecimento, Inventário, Combinado). O banco **descarta tudo isso** e guarda só o total mensal. Com as visitas dá para reconstruir ciclos e uma âncora de saldo. Só com o banco atual, não.
2. **Validação feita agora (FATO):** o consumo entre visitas (`Qtd. final` da visita n menos `Qtd. Anterior` da visita n+1) bate com as vendas mensais. Trident Menta × Ascenty ADM: consumo 45, 21, 30, 41, 33 contra vendido 47, 19, 33, 40, 35 (mar a jul). Pacoquita e Coca lata seguem o mesmo padrão. O dado suporta ciclos, mas a **HIPÓTESE** de que `Qtd. Anterior` seja saldo do PDV decrementado por vendas ainda precisa de validação formal na Fase 0.
3. **O saldo hoje calculado pelo inventory-service não serve.** Ele dá negativo em 3.787 de 18.152 linhas e difere do saldo registrado em 8.738 de 17.382 linhas (cerca de 50%). O motor novo não o usa.
4. **Quantidade ideal depende do intervalo entre reposições (H).** Trident Menta com par 21 e consumo de 1,1/dia cobre cerca de 19 dias, e a operação repõe a cada 2 a 3 semanas. Julgar "21 é muito?" contra vendas mensais, sem H, leva a conclusões erradas. H vira parâmetro explícito.
5. A sua planilha com `qtd itens por loja`, `Medida` e `Preço Simulado` **não está no repo nem no banco**. Preciso dela (ver seção de decisões).
6. Três dimensões de saída (Mix, Quantidade, Operação) mais Saldo e Próximo abastecimento, sempre separados. Motor determinístico no **backend**, versionado e auditável. A IA generativa só redige a explicação.
7. A unidade é **Produto × Loja**, com comparação com a rede só como evidência.
8. Reaproveito o que presta: Inteligência de Perdas como insumo, `computeTrend`, padrões de UI. Descarto o "Aproveitamento" como indicador principal e a sugestão atual, que é demanda mensal sem saldo nem ciclo.
9. Dados que faltam hoje: frequência/próxima visita planejada, Medida por SKU (232 de 233 produtos sem embalagem), shelf-life (0 de 233), preço de tabela, vendas com hora.
10. Fases: 0 dados e validação, 1 motor com backtest, 2 tela Por Loja, 3 Por Produto e Matriz, 4 Próximo abastecimento, 5 registro de decisões.

---

## A. Mapa dos dados

| Dado | Onde está | Granularidade | Confiabilidade |
|---|---|---|---|
| Vendas agregadas | `sales-service.sales_record` | loja × SKU × mês (9.550 linhas, jan a ago/2026, 24 lojas, 226 SKUs) | Boa. Só `Resultado = OK`. Sem custo nem hora. |
| Vendas por transação | `sales_transaction` | 6.746 linhas, **só ago/2026**, `occurred_at` nulo | Inutilizável para ciclos. Não somar com `sales_record` (dupla contagem). |
| Abastecimento mensal | `supply-service.restock_record` | loja × SKU × mês (12.248 linhas; 3.647 com quantidade 0) | Boa para total mensal. Sem data, usuário nem saldo. |
| Remoções por motivo | `removal_record` | loja × SKU × mês × motivo | Boa. Perda = expired + damaged + other_reason; return/transfer/internal_use **não** são perda. |
| Ajustes | `adjustment_record` | mensal, assinado (`Diferença`) | Mistura transferência, erro e troca no autoatendimento. |
| Saldo registrado | `recorded_closing_balance` | mensal (17.382 linhas) = `Qtd. final` da **última visita do mês** | Boa como fotografia, mas mensal. |
| Saldo derivado | `inventory-service.stock_snapshot.closing_stock` | mensal, acumulado | **Ruim** (negativos, não parte de saldo inicial real). |
| Par | `inventory-service.minimum_level.par_level` | loja × SKU, valor único, **sem histórico** | 2.794 linhas; 7 são sintéticas (`SKU-*`, lojas ≥ 500). Precisa confirmar se é o seu "qtd itens por loja". |
| Embalagem | `Product.package_type / units_per_package / fractionable` | SKU (rede toda) | **Vazio** em 232 de 233 produtos. |
| Custo | `CostVersion` | SKU, datado, por rede | 233 linhas (1 por produto). Na prática só o custo atual. |
| Preço de tabela | `PriceVersion` | SKU | **1 linha**. Usar preço realizado (receita ÷ quantidade do `sales_record`). |
| Visitas (por operação) | **só nas planilhas brutas** em `var/exemplos-de-planilhas/…/Abastecimentos*.xlsx` | 764 operações, 90.016 linhas de produto (jan a jul) | Identidade `final = anterior + abastecida + remoções + diferença` vale em 100% das 89.252 linhas ingeridas. |
| Colunas por visita | idem | `Iniciado em`, `Finalizado em`, `Operação anterior finalizada em`, `Usuário`, `Tipo de operação`, `Capacidade`, `Qtd. Anterior`, `Qtd. confirmada`, `A abastecer`, `Qtd. abastecida`, `Remoções`, `Diferença`, `Qtd. final` | Fonte dos ciclos e das âncoras. |
| Frequência de visitas | derivável | mediana de 4 a 8 dias entre datas de visita (mediana da rede: 6 dias) | Não existe frequência *planejada* nem próxima data. |

**Bloqueadores de integridade:**
- 285 rejeições `unknown_sku` (códigos como 9991, 5004, 5014) e 260 abas não parseadas. Esse dado foi descartado na ingestão.
- 125 operações de Inventário sem nome de loja.
- Lojas 22, 23 e 24 têm venda mas nenhum abastecimento registrado.
- Lojas com meses de venda ausentes (ex.: Plena Saude – ADM Taipas em maio: venda zero com abastecimento de 40 unidades no Prestígio).
- O banco só vai até **2026-08**. Hoje é 30/09, então qualquer saldo ancorado em agosto já teria 30+ dias.

## B. Modelo Produto × Loja (contrato de dados)

Chave: `(store_id, sku)`. Tudo abaixo é produzido por uma função pura, versionada, que guarda `versao_motor` e `versao_parametros` com cada resultado.

```
ProdutoLoja {
  identidade:   { store, sku, nome, categoria, medida{tipo,unidades,fracionável} | "ausente" }
  baseline:     { qtdAtual (par), origem, desde, preferenciaEmbalagemFechada? }     // PREMISSA
  exposicao:    { primeiraApariçãoNaLoja, ultimoAbastecimento, ultimaVenda,
                  ciclosObservados, ciclosComEstoque, intervaloReposicaoH }
  ciclos[]:     { ini, fim, dias, estoqueInicial, abastecido, removidoPorMotivo,
                  consumo, consumoPorDia, ruptura(bool, consumo é piso) }
  demanda:      { taxaDia (robusta, ponderada por recência), p25/p75, cv, tendência, n }
  perdas:       { qtd/custo por motivo, recorrência, concentração, relação com vendas }
  economia:     { receita, cmv, margem, margem%, custoPerdas, contribuiçãoPósPerda }
  saldo:        { estimado, âncora{data,tipo,valor}, diasDesdeÂncora, confiabilidade, motivos }
  rede:         { mediana da taxa do SKU, nº lojas expostas, % lojas com boa aderência }
  decisao:      { mix, quantidade{acao, de, para, delta}, operacao[], proximoAbastecimento }
  confianca:    { recomendacao{nivel, porquê}, saldo{nivel, porquê}, prioridade{R$, nivel} }
  explicacao:   { fatos[], evidênciasParaManter[], evidênciasParaAlterar[], limitações[] }
}
```

**Parâmetros por loja × SKU (novos, versionados, só-append):**
`baseline_qty`, `prefer_closed_pack` (booleano, não entra na matemática, só como alerta/opção na lista), `planned_refill_interval_days` (opcional, sobrescreve H inferido). Hoje `par_level` é sobrescrito sem histórico. Proponho tabela `par_level_history` (append-only), com fonte (arquivo ou usuário) e data.

## C. Modelo de saldo (saldo estimado, nunca "estoque real")

**Ponto inicial = âncora**, em ordem de preferência:
1. `Qtd. confirmada` de operação Inventário ou Combinado (contagem física).
2. `Qtd. final` da última visita (pós-contagem/abastecimento).

**Eventos** (a partir das visitas, não do mês):
- aumentam: `Qtd. abastecida`, `Diferença > 0`;
- diminuem: `Remoções` (todos os motivos, inclusive devolução/transferência/uso interno), `Diferença < 0`;
- consumo: não é evento. Vem de `final(n) − anterior(n+1)`, ou seja, vendas mais perda não registrada.

**Fórmula do saldo atual (ESTIMATIVA):**
`saldo_est(t) = max(0, final_última_visita − taxaDia × (t − data_última_visita))`

A taxa vem dos ciclos recentes (mesma robusta do motor de demanda). Se a última visita mostrou `anterior = 0`, o consumo do ciclo é **piso** (venda censurada) e isso entra na confiabilidade.

**Reconciliação (gate da Fase 0):** para cada loja × SKU × mês, comparar Σ consumo entre visitas com `sales_record.quantity_sold`. A divergência esperada é perda não registrada mais borda de mês. Só habilitamos o saldo onde a divergência ficar dentro de um limite combinado com você.

**Confiabilidade do saldo** (categoria derivada de fatos, sem score inventado):
- idade da âncora em dias (e quantas visitas de contagem ocorreram);
- tipo da âncora (contagem vs só abastecimento);
- estabilidade da taxa (CV dos ciclos);
- ruptura recente (consumo censurado);
- `Diferença` ≠ 0 recorrente;
- meses de venda faltantes.
`alta` = âncora recente, taxa estável, sem `Diferença`. `baixa` = âncora antiga ou taxa instável. `indisponível` = sem âncora (ex.: lojas 22 a 24). Mostra sempre a razão ("última conferência há 45 dias").

**Limitações explícitas:** vendas só existem mensais, então não dá para subtrair "vendas depois da última visita" com exatidão. Usamos taxa × dias. Não há rastreio de origem de transferência. Devolução de venda não existe.

## D. Motor de Mix

Entradas: exposição, demanda, perdas, economia, rede.

| Estado | Condição (provisória) |
|---|---|
| DADOS INSUFICIENTES | menos de N ciclos com estoque, ou meses faltantes que impedem ler o ciclo |
| TESTAR | SKU novo na loja (primeira aparição < X ciclos): não penaliza. É uma **aproximação**, pois não existe flag de teste. |
| MANTER | demanda consistente, contribuição pós-perda não negativa |
| AVALIAR RETIRADA (loja) | exposição ≥ N ciclos **e** demanda recorrentemente baixa **e** contribuição pós-perda baixa/negativa **ou** perdas recorrentes. Nunca automática. |
| AVALIAR RETIRADA (rede) | só se o mesmo padrão aparece na **maioria** das lojas onde o SKU foi efetivamente exposto (evidência muito mais forte). |

**Estados de presença** (nunca confundir):
- VENDE / BOA ADERÊNCIA;
- BAIXA ADERÊNCIA (exposto ≥ N ciclos, demanda baixa recorrente);
- ABASTECIDO SEM VENDA (abastecido e consumo ≈ 0, inclusive devolvido);
- SEM ABASTECIMENTO RECENTE (último reabastecimento > k × H atrás, com histórico bom);
- NUNCA TESTADO (nenhuma visita com estoque > 0 nem abastecimento naquela loja);
- DADOS INSUFICIENTES.

NUNCA TESTADO não é "não vende". Diferença real: Guaraná 2L × Ascenty ADM tem linha na planilha, zero estoque e zero venda nos 8 meses ("linha sem estoque"). Já Guaraná 2L × Plena Saude – ADM nem tem linha.

## E. Motor de Quantidade ideal

Nada de média simples. Pipeline:

1. **Ciclos** por Produto × Loja (abastecimento → consumo → próximo abastecimento), a partir das visitas.
2. **Taxa diária robusta** `d̂`: quantil ponderado por recência (últimos ciclos pesam mais), com correção de censura: ciclo com `anterior = 0` vale como piso, nunca como demanda real.
3. **Padrão temporal** (evidência, não decisão): estável, crescente, decrescente, volátil, novo, insuficiente. Exemplos do seu briefing: `20→19→21→18→20→21` estável; `20→17→14→10→7→4` decrescente; `3→18→4→16→5→20` volátil.
4. **Horizonte H:** dias entre reposições *do produto* (mediana histórica dos reabastecimentos com quantidade > 0), ou `planned_refill_interval_days` se informado. A quantidade ideal é **sempre dita para um H** ("ideal 21 para repor a cada ~19 dias").
5. **Banda de quantidade**:
   `Q_baixa = d̂_p50 × (H + L)` e `Q_alta = d̂_p80 × (H + L) + SS`
   `L` = defasagem (parâmetro), `SS` = folga em função da volatilidade.
6. **Ajustes:** perdas por validade reduzem `Q_alta` quando a demanda é baixa ou decrescente. Shelf-life (quando existir) limita a cobertura. Capacidade da mola (coluna `Capacidade` nas planilhas) limita o teto e gera alerta "limitado por capacidade, considerar reposição mais frequente".
7. **Decisão:**
   - `par ∈ [Q_baixa, Q_alta]` → MANTER X;
   - `par > Q_alta` (sem ruptura recente) → REDUZIR X→Y (Y = `Q_alta` arredondada para frente; **sem** forçar múltiplo de caixa);
   - ruptura frequente (`anterior = 0` em ≥ p% dos ciclos de reposição) **e** `par < Q_baixa` → AUMENTAR/TESTAR X→Y. Só sugere aumento com evidência de ruptura **ou** demanda crescente com baixa perda e boa margem;
   - sem evidência → "SEM EVIDÊNCIA PARA ALTERAR".
8. Perda alta não reduz sozinha: só entra via seção G (validade + demanda baixa).

Saída: `Atual 21 · Ideal 12 · Δ −9 · "Requer fracionamento da caixa de 21"` (quando `units_per_package` existir). Nunca arredonda para múltiplo.

## F. Motor de Próximo abastecimento

Separado, nunca confundido com a quantidade ideal.

`necessidade = max(0, d̂ × (H_próx + L) + SS − saldo_est)`, limitada pela capacidade da mola.

- `H_próx`: intervalo até o próximo **reabastecimento** da loja. Usa `planned_refill_interval_days` quando informado, senão a mediana histórica por loja. Não inventa data de visita.
- **Zero** quando: Mix = AVALIAR RETIRADA, `saldo_est ≥ Q_alta`, ou SKU suspenso.
- Saída: `levar N` mais opção humana `levar caixa fechada` (se `prefer_closed_pack`), sem alterar N.
- Reduz a confiança quando o saldo tem confiabilidade baixa e mostra a faixa (`N_baixo … N_alto`).
- Observação: no histórico real, a operação já **completa até o par** (ex.: 13/03: anterior 8 + abastecido 13 = 21; 19/03: 10 + 11 = 21). A fórmula nova generaliza isso com a demanda até o próximo ciclo e com o saldo estimado.

## G. Motor de alertas operacionais (Operação)

Fatos, sem causa inferida. Reaproveita a Inteligência de Perdas como entrada, sem reconstruí-la.

| Alerta | Gatilho |
|---|---|
| ATENÇÃO À VALIDADE | `expired` recorrente; mais grave com demanda baixa/decrescente. Shelf-life vazio em 233/233: por enquanto só pela evidência de perda. |
| INVESTIGAR AVARIA | `damaged_product`, com escopo local/múltiplas lojas/rede (já calculado pela Inteligência de Perdas). Não assume problema de demanda. |
| INVESTIGAR PERDAS | `other_reason` concentrada ou alta em relação às vendas. Mantém a classificação. **Nunca** rotula como roubo. |
| REVISAR SALDO | confiabilidade baixa, `anterior` muito diferente do esperado, `Diferença` ≠ 0 recorrente |
| REQUER FRACIONAMENTO | quantidade sugerida ou a levar não é múltiplo de `units_per_package` (desligado enquanto Medida estiver vazia, com aviso "Medida ausente") |
| LIMITADO POR CAPACIDADE | `Q_alta` > `Capacidade` |
| DADOS INCOMPLETOS | mês de venda faltante, loja sem abastecimento, SKU rejeitado na ingestão |

## H. Confiança (três coisas diferentes)

- **Confiança da recomendação:** nº de ciclos observados e exposição, consistência da identidade das visitas, recência, concordância com a rede, presença de meses faltantes. Níveis com tetos que só baixam (padrão já usado no repo). Sempre com a lista de motivos.
- **Confiabilidade do saldo:** seção C.
- **Prioridade:** em R$ (estoque excedente a custo, custo das perdas recorrentes, margem em risco). Independe das duas confianças.

Os três aparecem separados na tela. Exemplo válido: "reduzir 21→12, confiança alta · saldo estimado 8, confiabilidade média · prioridade média".

## I. Wireframes

**1. Por Loja**
```
[Loja ▾ Ascenty ADM]  [Período]  [Busca produto]        Âncora mais recente: 29/08  ·  Dados até 2026-08
O que a inteligência encontrou?
[6 revisar permanência] [9 quantidade acima da demanda] [4 testar aumento]
[7 perdas a investigar] [3 bom histórico sem abastecimento] [5 saldo abaixo do necessário]   ← clicáveis, filtram a tabela
Produto | Atual | Ideal | Saldo est. | Levar | Vendido | Perdido | Resultado | Diagnóstico | Mix | Quantidade | Operação
Trident Menta | 21 | 21 | ~8 (média) | 13 | 33 | 3 | R$… | saudável | Manter | Manter 21 | Investigar perdas
```
**2. Por Produto**
```
[Busca: GUARANÁ 2 LITROS]   Lojas com histórico 22 · boa aderência 4 · baixa aderência 14 · abastecida sem venda 2 · nunca testado 1
Filtros: Todas | Boa aderência | Baixa | Com perdas | Sem abastecimento recente | Nunca testado | Revisar
Loja | Atual | Ideal | Saldo est. | Levar | Abastecido | Vendido | Perdido | Resultado | Diagnóstico | Recomendação
```
**3. Matriz Produto × Loja**
```
Produto        ADM  HTL01  HTL05  SUM01
Guaraná 2L      ⚪    🟡     🟢     🟡        🟢 boa · 🟡 observação · 🔴 baixa/revisar · ⚪ nunca testado
```
A cor sai do diagnóstico Produto × Loja (estados da seção D), não de um único limiar. Clicar abre o mesmo drawer.

**4. Drawer Produto × Loja**
```
MANTER PRODUTO  ·  QUANTIDADE IDEAL 21 (p/ H≈19d)  ·  LEVAR 13
Por quê? (2 a 3 frases factuais, geradas dos fatos do motor)
Atual 21 · Sugerida 21 · Medida caixa/21 · Saldo ~8 (âncora 12/03, confiabilidade média) · Próximo: 13
Ciclos (gráfico: estoque inicial, consumo, ruptura) · Abastecimentos · Vendas · Perdas por motivo · Margem
Tendência · Comparação com outras lojas · Evidências p/ manter · Evidências p/ alterar · Limitações
Confiança da recomendação | Confiabilidade do saldo | Prioridade
```
**5. Próximo abastecimento** (só depois da Fase 4)
```
Loja ▾  →  lista por produto: Levar N (faixa a–b) · opção caixa fechada · saldo e sua confiabilidade · motivo de zero
Agrupada: Levar / Não levar / Sem dados / Testes.  Edição manual fica registrada como decisão (Fase 5).
```

## J. Exemplos reais (Jan a Ago/2026, dados do banco e das planilhas brutas)

Interpretações são ilustrativas com parâmetros provisórios. Fatos vêm dos dados.

1. **Produto saudável: Trident Menta × Ascenty ADM.** Vendido 25, 47, 19, 33, 40, 35 (fev a jul); consumo entre visitas 34, 45, 21, 30, 41, 33; perda só `other_reason` 21 un de 290 abastecidas (7%). Reposição a cada 2 a 3 semanas, par 21. Uma ruptura em 25/06 (`anterior = 0`). → **Mix manter · Quantidade manter 21 · Operação: acompanhar Outro motivo.** Uma ruptura em ~8 reposições é evidência fraca para aumentar.
2. **Quantidade excessiva: Trident Morango × ADM.** Vende ~4 a 11/mês (consumo ≈ 0,3/dia). Saldo registrado subiu 9→19→30 (jun→ago), com 21+21 abastecidos em jul/ago contra 13 vendidos. Shelf-life não cadastrado. → **Mix manter · Quantidade reduzir (ESTIMATIVA de uns 7 a 10 para H≈3 semanas, hoje 21 cobre ~70 dias).**
3. **Oportunidade de aumento: Mentos Stick Rainbow × ADM.** 12, 14, 13, 14, 18, 11, **32, 37** (dobrou em jul/ago), perda 3, saldo 17 a 23 (sem ruptura). → **"Evidência de demanda crescente: testar quantidade maior"**, nunca "está faltando". Só 2 meses de alta, confiança média/baixa.
4. **Baixa aderência: Salgadinho Cheetos (1008) × ADM.** Vendido 1, 2, 1, 2, 1, 0; abastecido 4, 4, 3, 4 (15 abastecidos, 7 vendidos), 9 perdidos por validade; parou de ser abastecido em jun. Também Coca 2L × ADM: abastecido 4 em abr, devolvido 4, zero venda. → **Mix avaliar retirada da loja** (exposição longa, demanda baixa, validade recorrente). Retirada da rede exigiria o mesmo padrão na maioria das lojas.
5. **Validade recorrente com demanda em queda: Coca Zero lata (1071) × Ascenty JDI01.** Vendido 13, 14, 15, **4, 2, 5, 0**; abastecido 34, 6, 12, 38, 12, 32, 6; validade 3, 1, **19** (mai a jul). → **Mix manter (já vendeu bem) · Quantidade reduzir · Operação: atenção à validade.** Diferente do exemplo 4: aqui o produto funcionou e a quantidade ficou acima da demanda.
6. **Boa venda + Outro motivo: Coca lata (1070) × ADM.** 256 vendidas em jan a ago; `other_reason` 74 (mais 1 avariada); abastecido 334. Custo R$ 3,40 e preço R$ 6,90 da planilha PREÇOS (**PREMISSA**; o motor usa receita realizada). Margem bruta ≈ R$ 896, perda ≈ R$ 255, contribuição pós-perda ≈ R$ 641, sem descontar duas vezes (unidade perdida não é unidade vendida). → **Mix manter · Quantidade manter · Operação: investigar perdas.** O sistema **não** diz causa.
7. **Nunca testado: Guaraná 2L (1072).** Plena Saude – ADM não tem nem linha. Ascenty ADM tem linha, zero estoque e zero venda em 8 meses ("linha sem estoque"). Rede: só Ascenty VIN02 vende bem (~11/mês), Franco da Rocha ~5, HTL05 ~4 e SP02 ~3; o resto fica entre 0 e 3/mês. **FATO:** baixa aderência na maioria das lojas com estoque. Isto **não** é "vai bem em 10 e mal em 1".
8. **Bom histórico sem abastecimento recente: Chocolate Suflair 50g (1013).** Em ADM, SP04, VIN02, Taipas, Franco da Rocha, HTL05 e SP02 o abastecimento vai a 0 em jun/jul, o saldo registrado chega a 0 e a venda cai a ~0 (ADM: 31, 27, 25, 28, 22, 2, 0, 1). Padrão **simultâneo na rede**: provável problema de suprimento/descontinuação, não de demanda. → **Mix manter; oportunidade de retomada; não penalizar.**
9. **Saldo confiável: Trident Menta × ADM em jun/jul.** Visitas com contagem a cada 3 a 4 dias; `anterior` 15→14→11 (consumo ≈ 1/dia estável). Estimativa a 2 dias da âncora teria erro de ~1 a 2 un. → confiabilidade **alta**.
10. **Saldo pouco confiável: Pacoquita × ADM e lojas 22 a 24.** O `closing_stock` do inventory-service dá −10 a −28 enquanto o registrado vai de 0 a 18 (não usar). Lojas 22, 23, 24 têm venda e nenhuma visita registrada, então saldo **indisponível**.
11. **Ideal ≠ levar: Trident Menta × ADM.** Par 21. Em 05/03 o saldo era 4 e se levou 18 (final 21). Em 13/03 o saldo era 8 e se levou 13 (final 21). Ideal 21, necessidade 13 a 18, e a operação já completa até o par. A fórmula nova acrescenta demanda até o próximo ciclo.
12. **Zero no próximo abastecimento: Trident Morango × ADM.** Saldo registrado 30 (ago) com consumo de ~1,5 a 2/semana. Levar **0** (saldo ≥ `Q_alta`). Também para Mix = AVALIAR RETIRADA (ex.: exemplo 4).

## K. Limitações (o sistema NÃO pode concluir…)

- **Que o saldo é estoque real.** Não há contagem contínua; só âncoras por visita. Fica "saldo estimado" com confiabilidade.
- **Vendas por ciclo exatas.** Vendas são mensais (transações só de ago, sem hora). O consumo por ciclo vem das contagens (piso quando há ruptura).
- **Que falta produto**, sem ruptura observada (`anterior = 0`) ou demanda crescente com baixa perda.
- **Validade por prazo**, enquanto `shelf_life_days` estiver vazio (0 de 233).
- **Fracionamento e caixa fechada**, enquanto Medida estiver vazia (232 de 233) e sem `prefer_closed_pack`.
- **Quando é a próxima visita**, sem frequência planejada; só a mediana histórica (4 a 8 dias entre visitas, e H de reposição por produto derivado).
- **Quem é "loja semelhante"** (oportunidade para lojas sem o SKU): sem atributos de loja (`headcount`, `opened_on` etc. vazios). Fica para depois, como a arquitetura prevê.
- **Margem histórica real**, pois só há o custo atual por produto (1 versão por SKU).
- **Histórico da sua parametrização**, pois `par_level` não guarda versões.
- **Setembro**: sem importação de setembro, toda âncora tem 30+ dias.
- **Mudança de causa da perda** (roubo, erro de operação…): o sistema só mostra o motivo registrado.
- **Transferências**: não sabemos a origem nem o destino.

## L. Plano de implementação (fases; nada começa sem sua aprovação)

Seguindo a convenção do repo: abrir uma mudança OpenSpec que **substitui o escopo** do `add-commercial-intelligence-governance` (que hoje cobre regras do motor antigo e está em 0 de 37 tarefas). Regras e parâmetros vivem no **backend**, nunca no navegador, conforme sua orientação registrada.

- **Fase 0, fundação de dados e gate.**
  - Persistir visitas: `supply_visit` e `supply_visit_line` a partir do mesmo arquivo que já é parseado, preservando `Qtd. Anterior`, `Qtd. confirmada`, horários, usuário e tipo (backfill jan a ago).
  - Tabela `par_level_history` e import da sua planilha de precificação (qtd itens por loja, Medida, Preço Simulado).
  - Importar setembro e limpar linhas sintéticas do `minimum_level`.
  - **Gate:** reconciliar consumo entre visitas × `sales_record` por loja × SKU × mês. Se não fechar, o saldo fica como "indisponível" e a Fase 4 é reavaliada.
- **Fase 1, motor e backtest (sem UI).** Biblioteca pura com os contratos da seção B; serviço no backend que guarda `versao_motor/parametros` por resultado. Backtest de repetição jan a jun → jul/ago: erro da taxa prevista, ruptura e validade após cada recomendação. Os limiares só congelam depois disso.
- **Fase 2, Por Loja + drawer.** Mix, Quantidade, Operação, saldo e confiabilidades. Cards clicáveis. A tela atual de Abastecimento/Mix continua até haver paridade.
- **Fase 3, Por Produto e Matriz.**
- **Fase 4, Próximo abastecimento** (somente se o gate da Fase 0 passar) e lista de ida.
- **Fase 5, registro de decisões** (recomendação, decisão humana, quantidades, usuário, justificativa) e acompanhamento antes × depois.
- **Futuro (só arquitetura preservada):** oportunidade de teste em lojas sem o SKU, e otimização de distribuição de caixa/fardo entre lojas.

**Mantém:** Inteligência de Perdas, `computeTrend` (só como estimador de demanda), `buildStoreSkuSeries` com sinalização de mês faltante, padrões de UI (`Sheet` como drawer, `StatusBadge`, `RequestState`, filtros da tabela de decisões de perdas).
**Altera:** sugestão de reabastecimento (vira Quantidade + Próximo abastecimento), confiança (separa as três), janelas (unificar; corrigir a diferença entre data UTC e mês local), remover a segunda execução duplicada da Inteligência de Perdas.
**Descarta:** "Aproveitamento" como indicador principal, o saldo derivado do inventory-service, os 95 parâmetros do motor antigo (continuam congelados).

## Decisões que preciso de você antes de começar

Respondidas nesta sessão: a planilha de precificação está no Drive (`preços/precificação(1).xlsx`); `Qtd. confirmada` é a contagem feita **antes** do abastecimento (você aceitou a leitura dos dados); 14 produtos descontinuados ficam fora.

1. **`qtd itens por loja` varia por loja ou é o mesmo para todas as lojas do SKU?** Na planilha há um valor por SKU; o `par_level` do banco é por loja × SKU. O que vale como baseline?
2. **Medida (caixa/fardo/unidade) por SKU:** posso importar da sua planilha como dado do produto (hoje 232 de 233 estão sem embalagem)? A preferência "caixa fechada nesta loja" vira um campo opcional por loja × SKU, sem efeito na matemática.
3. **Backend:** novo `intelligence-service` (recomendado) ou um módulo dentro de `supply-service`?
4. **Frequência de visita:** existe uma frequência ou data de próxima visita planejada em algum lugar? Se não, uso a mediana histórica por loja (4 a 8 dias) e deixo `planned_refill_interval_days` como parâmetro opcional seu.
5. **Tolerância (gate do saldo):** com os números da tabela acima, qual divergência você aceita para liberar "saldo estimado" e "quanto levar"? Sugestão para conversar, não para fixar: decidir por faixa de giro e de saldo, já que saldo alto diverge mais. Até lá o saldo fica como "indisponível" nas telas.
6. **Ordem das fases:** confirmar 1 (motor + backtest, sem tela) → 2 (Por Loja + drawer) → 3 (Por Produto + Matriz) → 4 (Próximo abastecimento, só se o gate passar) → 5 (registro de decisões).

## Adendo de 30/09/2026: resultado da auditoria de contagens (Fase 0, sem tolerância definida)

Substitui onde conflitar com o texto acima.
- **`Capacidade` está vazia em 89.252 de 89.252 linhas.** Não há teto de mola. Remover "limitado por capacidade" dos motores E, F e G até existir esse dado.
- **`Qtd. confirmada` é a contagem feita ANTES do abastecimento** (igual a `Qtd. Anterior` em 98% das linhas de Combinado com abastecimento; só 1 de 4.313 igual a anterior + abastecida). A quantidade pós-abastecimento é `Qtd. final`. `Diferença` = confirmada − anterior. Confirmar com o Leandro, que descreveu de outra forma.
- **Âncora de saldo:** só linhas com `Qtd. confirmada` são contagem física. O resto do `Qtd. final` é saldo do sistema.
- **Tolerância:** não definida. Decidir depois, em conjunto, a partir das distribuições por giro.
- **Planilha de preços** localizada no Drive (`preços/precificação(1).xlsx`): `qtd itens por loja` é o ideal por SKU; `par_level` do banco é o parametrizado por loja.

## Verificação (quando for implementar)

- Fase 0: testes com fixtures das planilhas reais (sem escrever dado sintético no banco); reconciliação consumo × vendas em jan a ago, com relatório por loja.
- Fase 1: testes unitários dos motores com os 12 exemplos acima como casos reais, mais backtest.
- Fases 2 a 4: `pnpm turbo run lint typecheck`, specs de componentes, conferência visual no admin com dados reais.
