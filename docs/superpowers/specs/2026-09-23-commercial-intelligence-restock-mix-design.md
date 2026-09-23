# Inteligência Comercial — reinício de fase: Abastecimento Inteligente + Mix das Lojas

## 0. Contexto e motivação

A primeira versão de `/commercial-intelligence` (`add-commercial-intelligence-page`) tentava responder 6
perguntas ao mesmo tempo (qualidade dos dados, combos, receita/ticket/margem, comportamento,
central de oportunidades genérica, calibração) — conceitualmente ampla demais e difícil de usar
(pedido do operador, 2026-09-23). As análises daquela primeira versão continuam em espera desde
`add-commercial-intelligence-page` (aguardando os meses reais do Drive e conferência de qualidade
de `Cupom`/histórico) e **nenhuma regra analítica daquela fase foi congelada** — nada muda aqui
sobre esse status.

Decisão do operador: parar de evoluir aquela UX e recomeçar a experiência da tela em torno de só 2
perguntas operacionais:

> "O que devo levar para esta loja?" → **Abastecimento Inteligente**
> "Estou colocando os produtos certos nesta loja?" → **Mix das Lojas**

Nada do código/motor atual é apagado. Este documento mapeia o que se reaproveita, o que fica de
lado por enquanto, e propõe o desenho técnico das duas abas novas — **para aprovação antes de
qualquer implementação** (pedido explícito do operador: não seguir para `writing-plans` nem
codificar sem aprovar isto primeiro).

## 1. Escopo desta fase

Dentro: as duas abas `[ Abastecimento Inteligente ] [ Mix das Lojas ]`, substituindo as 6 abas
atuais na navegação principal de `/commercial-intelligence` — nenhuma rota nova, mesma filosofia
já usada em `/supply` (sub-abas dentro da página, não item novo na sidebar).

Fora da experiência principal por enquanto (preservado tecnicamente, sem UI):
Combos & Cross-sell, Comportamento, Produtos & retorno, a Central de oportunidades genérica,
Experimentos, os cards de Receita/Ticket/Itens por compra/Margem por compra, a estimativa de
impacto 20/40/60 e o painel de Qualidade dos Dados como elemento de topo. Reintrodução gradual
prevista (Fase 2 Produtos, Fase 3 Combos, Fase 4 Comportamento, Fase 5 Experimentos) — não faz
parte desta proposta.

## 2. Reaproveitamento de código (mapeamento)

Investigação feita por leitura direta de `frontend/apps/admin/src/lib/commercial-intelligence/*`,
`src/components/commercial-intelligence/*.tsx` e as páginas de `src/app/(app)/commercial-intelligence/`.

**Reaproveitável direto** (zero ou quase zero mudança):
- `synthetic.ts` inteiro (guarda de dado sintético, genérico sobre `{name}`).
- `loss-index.ts`'s `buildSupplyIndex`/`sellThrough` — **já existe um índice loja×SKU de
  abastecido e giro (vendido÷abastecido), e hoje não é chamado por nenhuma tela** (grep confirmou
  zero uso em `page.tsx`/componentes). É a base pronta do motor novo. Ressalva pequena:
  `buildSupplyIndex` recebe `SupplyRangeResult[]` (já somado no range pedido) — para a série
  mês-a-mês que o motor de tendência precisa, chama-se uma vez por mês (ou se escreve um irmão
  trivial de granularidade mensal), não é a função pronta para uma série temporal direta.
- `loss-index.ts`'s `skuLossQuality`/`storeFlaggedShare` (sinal "não recomende sobre reconciliação
  inconsistente").
- `dataset.ts`'s `wallClock()`/`priceStateOf()`.
- `kpis.ts`'s `relativeDelta`.
- `types.ts`'s `Provenance`, `Confidence`, `Level`, `Range`, `Scope`.
- Componentes: `ConfidenceBadge`, `ProvenanceBadge`, `KpiCard`, `SuggestionTag`, `HeldTab`,
  `DataQualityBanner` (mecanismo, recebe `QualityItem[]` novo), `no-transaction-detail.tsx`.
- `ParameterCatalog`/`BusinessRulesSheet` — já se descrevem no próprio código como
  *"domain-agnostic — the caller resolves its own parameter type into rows"*
  (`parameter-catalog.tsx:109`, `business-rules-sheet.tsx:23-28`). Servem para os parâmetros novos
  bastando escrever um `parameter-rows.ts` equivalente.
- `logic-version.ts`, `env.ts`, `runtime-parameters.ts` — não o *conteúdo*, mas o **padrão**
  (arquivo-ponte de 3 linhas, override por `NEXT_PUBLIC_*` resolvido uma vez fora do motor puro).

**Reaproveitável com adaptação:**
- `types.ts`'s `Opportunity`/`Origin` já prevê `"similar_store"`/`"mix"` como origem — contrato
  pensado para caber recomendação, mas falta quantidade sugerida/ação/confiança no formato que as
  telas novas precisam.
- `confidence.ts` — a **arquitetura** (gate duro → soma de fatores aplicáveis → score → nível por
  limiar → tetos que só reduzem) é genérica e serve bem para quantidade/mix (evidência = meses com
  venda, estabilidade = variação período a período, reconciliação = mesmo sinal de hoje). O fator
  de cobertura de cupom é 100% específico de cesta e não entra. Implementação: `evidenceGate`/
  `evidenceTiers` leem `CommercialParameters` diretamente — não são chamáveis como estão; escreve-se
  um `computeRestockConfidence`/`computeMixConfidence` irmão seguindo o mesmo desenho, não uma
  adaptação in-place.
- `availability.ts`'s tipo `AnalysisAvailability`/`AvailabilityState` (não o dispatcher, que está
  amarrado às 6 análises antigas) e `quality.ts`'s `QualityItem`/`buildQualityItems` (padrão, não
  corpo) — para os avisos contextuais pequenos ("dados insuficientes para recomendar quantidade").
- `parameters.ts`/`parameter-docs.ts`/`parameter-rows.ts` — a maquinaria (paths tipados, override
  por env, validação de pares ordenados, documentação com fórmula/motivo/efeito de subir e descer)
  é ótima de copiar como padrão; o conteúdo dos 95 parâmetros atuais é 100% do domínio combo/cesta.
- `kpis.ts`'s `computeMarginBreakdown`/`costBySkuFrom` — dão margem sobre uma lista de linhas, mas
  hoje só chamadas em escopo rede/loja inteira, nunca por SKU×loja; adaptação pequena.

**Específico da UX atual (fica de lado, não apagado):**
`parameters.ts`'s grupos `coupon`/`association`/`cartGap`/`hourly`/`products`/`peers`/`impact`/
`simulator`/`loss`/`quality`; `availability.ts`'s dispatcher e as 6 funções por análise;
`quality.ts`'s `assessCouponGate`/`storeCouponInsufficiency`/`couponBiasDiagnostic`; `dataset.ts`'s
`baskets`/`byCoupon`; `combos-tab.tsx`, `overview-tab.tsx`, `quality-tab.tsx` (o corpo, não o
`AnalysisCard` genérico que ele usa).

## 3. Dados disponíveis × ausentes (granularidade real confirmada)

| Dado | Grão real | Fonte |
|---|---|---|
| Vendas por SKU×loja | **Mensal** (`SalesRecord`: `quantity_sold`, `revenue_cents`) — grão confiável em todo o histórico | `useGetNetworkSalesByStoreMonthQuery` |
| Vendas por transação | Por transação, com `occurred_at` real — **só 1 mês por vez, só lojas/meses no formato novo (ago/2026+)** | `useGetNetworkSalesTransactionsQuery` |
| Abastecimento por SKU×loja | **Mensal só** (`RestockRow`: `quantity_restocked`) — sem data de visita, sem estoque resultante | `useGetNetworkSupplyByStoreMonthQuery` |
| Perdas por SKU×loja×motivo | Mensal (`loss_by_reason_sku`: quantidade + valor) | reconciliação, já consumido pelo Loss Intelligence |
| Recomendação de perdas já computada | Por SKU×loja, com ação/prioridade/confiança/escopo | `LossIntelligenceResult.recommendations` |
| Custo do produto | Datado por SKU (`asOf`) | `useGetCostsAsOfQuery` |
| Categoria do produto | **Só 4 valores fechados**: `meal \| snack \| beverage \| essential` — mais grosso que "Bebidas/Balas/Snack" | `Product.category` |
| Estoque atual por loja | **Não existe** | confirmado — nenhum endpoint |
| Lojas parecidas (peer clustering) | **Nunca implementado** — só parametrizado (`peers`), documentado como "grupo 10, em espera" | `parameter-docs.ts:119` |

Consequências diretas para a proposta:
- A coluna "Categoria" da tela vai mostrar Refeição/Snack/Bebida/Essencial — não o granular do
  mockup original do operador (Bebidas/Balas/Snack como categorias distintas não existem hoje).
- "Vendas recentes" e tendência usam a série **mensal** como base confiável em toda a janela;
  `SalesTransaction` (com hora real) só refina o mês corrente quando disponível, não a série.
- Nenhuma fórmula pode subtrair/inferir estoque — confirmado, sem gap a preencher.
- **"Lojas parecidas" é o gap mais sério para o Mix** — ver §8.

## 4. Integração com o Loss Intelligence

O motor de Abastecimento **nunca recalcula** a lógica de perda — consome o resultado já computado
(mesma orquestração hoje em `loss-tab.tsx`: `analyzeLossIntelligence(input)`), indexado por
`` `${storeId}:${sku}` ``. Contrato lido (`frontend/apps/admin/src/lib/loss-intelligence/types.ts`):
`acaoPrioritaria: LossAction`, `prioridade: Priority | null`, `confianca: Confidence`,
`diagnosticosPorMotivo[].escopoProblema`, `limitacoesDosDados: string[]`.

**Decidido (2026-09-23):** o motor de Abastecimento reaproveita a mesma janela de análise do Loss
Intelligence (3 meses de decisão + lookback de 6 meses) — os dois motores nunca mostram números de
períodos diferentes sem avisar, mesmo raciocínio já aplicado ao próprio Loss Intelligence (§23.5 da
adenda desta sessão).

Regra de precedência proposta (§6 detalha os valores, aqui a hierarquia):

1. `suspender_abastecimento` / `avaliar_retirada_loja` / `avaliar_retirada_rede` → **vence tudo**:
   quantidade = 0, ação = "Não abastecer", motivo cita a recomendação ativa de perdas.
2. `reduzir_abastecimento` → ação = "Reduzir", quantidade da fórmula própria cortada por um fator
   (proposta inicial: ×0,5 — **parâmetro a aprovar**).
3. `avaliar_permanencia_loja` / `avaliar_permanencia_rede` / `investigar` → fórmula própria segue
   normal, mas a saída ganha uma limitação explícita ("sob avaliação da Inteligência de Perdas") e
   a confiança nunca sobe além de Média.
4. `manter` / `manter_monitorar` / sem sinal → fórmula própria, sem ajuste.

## 5. Contrato de saída — motor de Abastecimento (proposta)

```ts
export type RestockAction = "aumentar" | "manter" | "reduzir" | "nao_abastecer" | "dados_insuficientes";
export type Trend = "crescendo" | "estavel" | "caindo" | "volatil" | "indeterminada";

export interface RestockRecommendation {
  sku: string;
  storeId: number;
  categoria: Product["category"]; // meal | snack | beverage | essential

  // Evidência observada (fatos, nunca recalculados)
  vendasUltimoMes: number;
  historicoMensal: { period: string; vendido: number; abastecido: number; perdido: number }[];
  ultimoAbastecimento: number | null;
  mesesComVenda: number;
  mesesAnalisados: number;

  // Sinal derivado
  tendencia: Trend;
  faixaEstimada: { min: number; max: number }; // nunca um número só fingindo precisão

  // Loss Intelligence — só leitura, nunca recomputado aqui
  sinalPerdas: { acao: LossAction; prioridade: Priority | null; confianca: Confidence; escopoProblema: EscopoProblema } | null;

  // Saída
  quantidadeSugeridaIA: number;
  quantidadeFinalOperador: number | null; // null = ainda não editado; arquitetura já pronta para registrar override humano (sem persistência nesta fase)
  acao: RestockAction;
  motivo: string; // frase curta determinística, mesmo padrão de explainRecommendation
  confianca: Confidence;
  limitacoes: string[];

  versaoMotor: string;
  versaoParametros: string;
}
```

## 6. Motor de quantidade — fórmula proposta (sem estoque)

Nomeada **quantidade recomendada de abastecimento** (nunca "reposição necessária" — não há estoque
atual para calcular reposição). Janela proposta: mesma do Loss Intelligence (3 meses de decisão +
lookback de 6), para os dois motores nunca mostrarem números de janelas diferentes sem dizer
(mesma lição do §23.5 da adenda de Loss Intelligence) — **decisão a confirmar, ver §11**.

1. **Gate de evidência**: `mesesComVenda < minMonthsWithSales` (parâmetro) → `acao =
   "dados_insuficientes"`, `confianca = "insuficiente"`.
2. **Série robusta e ponderada por recência**: pesos crescentes do mês mais antigo ao mais recente
   (ex.: `[1,1,2,2,3,3]` para 6 meses — parâmetro); `estimativaCentral = média(mediana bruta da
   série, média ponderada por recência)` — combina "pesar mais o histórico recente" com "não deixar
   um pico isolado distorcer" (pedido explícito do operador) sem descartar dado nenhum.
3. **Faixa**: `desvio` = desvio absoluto médio em torno da mediana; `faixaEstimada = [max(0,
   estimativaCentral − desvio), estimativaCentral + desvio]`.
4. **Ajuste de tendência**: compara média dos últimos 2 meses com a dos 2 anteriores
   (`trendUpThreshold`/`trendDownThreshold`, parâmetros) → `crescendo`/`caindo`/`estavel`;
   coeficiente de variação alto → `volatil` (sobrepõe, alarga a faixa, capa a confiança).
5. **Override do Loss Intelligence** (§4) — sempre por último, nunca sobreposto pelos passos 1-4.
6. **Ação operacional** (quando não veio do override): compara `quantidadeSugeridaIA` com
   `ultimoAbastecimento` por limiares (`increaseThreshold`/`decreaseThreshold`, parâmetros) →
   aumentar/manter/reduzir/não abastecer.
7. **Edição humana**: UI permite substituir a sugestão; contrato já reserva
   `quantidadeFinalOperador` (sem persistência ainda — só estado local do componente nesta fase).

Todos os limiares citados (pesos, thresholds de tendência, fator de redução por sinal de perdas,
mínimo de meses com venda) entram como `RestockParameters`, documentados no mesmo padrão de
`PARAMETER_DOCS` (fórmula, motivo do padrão, efeito de subir/descer) — nenhum ajustado sem
aprovação, mesma regra que já vale para o resto do painel.

## 7. Mix das Lojas — SKUs já existentes na loja

```ts
export type MixClassification = "manter" | "explorar" | "reduzir" | "suspender_abastecimento" | "avaliar_retirada" | "testar" | "dados_insuficientes";
```

- Loss Intelligence já decidiu `suspender_abastecimento` → passthrough direto.
- Loss Intelligence já decidiu `avaliar_retirada_loja`/`avaliar_retirada_rede` **ou**
  `avaliar_permanencia_loja`/`avaliar_permanencia_rede` → `avaliar_retirada` (mesma pergunta de
  fundo). **Decidido (2026-09-23)**: mapear os dois para a mesma classificação — o vocabulário do
  Mix fica com as 7 opções originais do operador, sem uma 8ª; o drawer, ao abrir o produto, ainda
  mostra o motivo mais preciso vindo direto do Loss Intelligence.
- Sem sinal estrutural de perdas: classifica por tendência (§6) + affinity vs. rede
  (`productAffinity`, já existe em `sales-insights.ts`, mede participação do SKU na loja ÷
  participação na rede) + margem (custo datado) — crescendo+saudável → `explorar`; estável+saudável
  → `manter`; caindo sem sinal de perdas → `reduzir`; evidência abaixo do mínimo →
  `dados_insuficientes`.

## 8. Mix das Lojas — oportunidades de novo mix (SKUs ausentes)

Este é o ponto com o **gap mais sério**: a spec do operador pede "SKU funciona bem em lojas
comparáveis" como critério — mas lojas parecidas nunca foram implementadas em nenhuma parte do
código (§3).

**Decidido (2026-09-23): v1 sem "lojas parecidas" — comparar com a rede inteira.** Um SKU com bom
desempenho (affinity, margem, baixa perda) em qualquer amostra suficiente de lojas da rede vira
candidato, sem filtrar por semelhança de porte/perfil. `peers` (a similaridade real, nunca
implementada) fica para uma fase futura. Consequência direta na UI: o exemplo do operador ("Monster
sabor X... bom desempenho em lojas comparáveis") fica mais fraco nesta v1 — "bom desempenho na
rede", sem o recorte "comparável" — por isso a confiança dessas oportunidades **fica sempre capada
em Média/Baixa**, e o aviso na tela diz isso explicitamente (`origem: "rede_inteira"` no contrato
abaixo é justamente para nunca deixar essa diferença implícita).

A saída candidata:

```ts
export interface MixOpportunity {
  sku: string;
  storeId: number; // loja candidata a receber o produto
  origem: "rede_inteira" | "lojas_parecidas"; // qual base gerou o candidato
  evidencia: string; // frase curta, ex. "bom desempenho em N lojas comparáveis"
  quantidadeTeste: number; // pequena, nunca pretende ser a demanda real
  confianca: Confidence; // nunca "Alta" nesta fase — é extrapolação, não histórico direto do par
}
```

## 9. Estrutura da tela (ajustada à realidade dos dados)

A estrutura do operador (§ da mensagem original) é adotada quase 1:1, com estes ajustes vindos da
investigação:

- Coluna **Categoria**: 4 valores reais (Refeição/Snack/Bebida/Essencial), não o granular do
  mockup.
- Coluna **Sinal**: combina duas fontes independentes — a seta de tendência (§6, calculada aqui) e
  um selo de override (⚠ vem do Loss Intelligence quando há `sinalPerdas` ativo; 💎 aparece só em
  linhas vindas do motor de oportunidades de mix, nunca nas linhas de SKU já existente na loja).
- **Confiança**: reaproveita o componente `ConfidenceBadge` como está — só a função que calcula o
  nível é nova (`computeRestockConfidence`/`computeMixConfidence`, mesma arquitetura de
  `confidence.ts`, ver §2).
- Drawer: todos os campos pedidos (Por quê, Histórico, Tendência, Inteligência de Perdas,
  Comparação com a rede, Quantidade em faixa, Confiança, Limitações) mapeiam direto para o
  contrato de `RestockRecommendation` (§5) — nenhum campo pedido pelo operador ficou sem fonte de
  dado real.
- **"GERAR LISTA DE ABASTECIMENTO"**: separa Abastecer/Não abastecer/Testes a partir do mesmo
  array de `RestockRecommendation` já calculado — sem chamada nova, é reagrupamento client-side.

## 10. Parâmetros e calibração

Proposta: **uma página de calibração só** (`/commercial-intelligence/calibration`, rota já
existente) com seções por motor (Abastecimento, Mix, e futuramente os motores hoje em espera) —
`ParameterCatalog` já é domain-agnostic (§2), então isso é só alimentar `sections` com um
`RestockParameters`/`MixParameters` novo + `parameter-rows.ts` equivalente, sem tocar nos
componentes. Evita proliferar rotas — **decisão a confirmar, ver §11**.

Sobre onde as regras de negócio (não os parâmetros de qualidade/analíticos) devem morar: o
`CLAUDE.md` do app já documenta que o registro oficial (valor único, permissão, histórico de
alteração) é a change `add-commercial-intelligence-governance` (proposta escrita, aguardando
aprovação, criaria um `intelligence-service` novo) — hoje ainda não existe.

**Decidido (2026-09-23)**: caminho interino via override por env var, mesmo padrão já usado pelo
resto do painel — não bloqueia o início desta fase esperando a aprovação/construção de um serviço
novo. Migrar para o `intelligence-service` fica para quando `add-commercial-intelligence-
governance` for aprovada, para todos os motores de uma vez, não só estes 2.

## 11. Decisões

As 4 decisões arquiteturais foram respondidas pelo operador em 2026-09-23 e já estão incorporadas
nas seções acima:

1. **Lojas parecidas para o Mix** → v1 sem isso, comparação com a rede inteira, confiança sempre
   capada (§8).
2. **Loss Intelligence `avaliar_permanencia_*` → Mix** → mapeado para `avaliar_retirada` (§7).
3. **Janela de análise do motor de Abastecimento** → mesma do Loss Intelligence, 3 meses de
   decisão + lookback de 6 (§4, §6).
4. **Governança dos parâmetros de negócio** → caminho interino via env var (§10).

Três defaults menores, propostos e ainda sem objeção do operador — seguem valendo salvo correção:

5. **Fator de redução quando o Loss Intelligence já sinaliza `reduzir_abastecimento`**: ×0,5 sobre
   a quantidade que a fórmula própria calcularia (§4, §6).
6. **Calibração**: uma página só (`/commercial-intelligence/calibration`) com seções por motor,
   não rotas separadas (§10).
7. **Piso operacional de quantidade**: sem dado de tamanho de embalagem/caixa, a sugestão sempre
   sai em unidades soltas, nunca "1 caixa".

## 12. Fora de escopo nesta fase

Tudo listado em §1 como "fora da experiência principal" continua existindo em código, sem UI.
Nenhuma rota nova. Nenhuma persistência de override humano (`quantidadeFinalOperador`) ainda —
arquitetura pronta para registrar `IA sugeriu / usuário escolheu / quantidade enviada` quando essa
fase for aprovada, mas não implementada agora. Envio automático para TouchPay não faz parte desta
fase — a TouchPay continua sendo a ferramenta operacional da Pick List; o Agiliz é a camada de
inteligência que recomenda os números.
