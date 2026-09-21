/**
 * The one configuration of the commercial-intelligence engine.
 *
 * Every threshold and assumption that drives a gate, a classification, a
 * confidence level or an impact estimate is a named field here. No engine
 * module keeps a constant of its own: each function takes the parameters as an
 * argument.
 *
 * THREE KINDS OF PARAMETER (see `parameter-docs.ts`, which tags and documents
 * every one): a BUSINESS RULE is a decision of the company (the minimum combo
 * margin); a DATA-QUALITY rule decides whether there is enough data; the
 * ANALYTIC model decides how association, trend, confidence and opportunity are
 * computed. Nothing here is per viewer: a value chosen in one browser would make
 * two people receive different recommendations, so there is no local override.
 * The official home of a business rule is the backend register of
 * `add-commercial-intelligence-governance`; until it exists the value is the
 * deployment default.
 *
 * EVERY DEFAULT BELOW IS PROVISIONAL. They are judgment values written before
 * any real coupon or history was seen: guardrails, calibrated against the real
 * imported months (tasks group 5) before any of them is frozen, and never
 * adjusted to make results appear. `isProvisional` says so, and the page prints
 * it next to each value.
 *
 * Environment: `NEXT_PUBLIC_CI_<PATH>` overrides a default at build time, with
 * the path upper-cased and its dots turned into underscores
 * (`coupon.exclusionCoverage` → `NEXT_PUBLIC_CI_COUPON_EXCLUSION_COVERAGE`).
 * This module never reads `process.env` itself: Next inlines a public variable
 * only where it is written literally, so `env.ts` does the reading and hands the
 * values here.
 */

export interface CommercialParameters {
  /** Coupon coverage gate and the rules for rebuilding a purchase from a coupon (design D2, D17). */
  coupon: {
    /** Below this store coverage the store leaves the basket analyses. */
    exclusionCoverage: number;
    /** Network coverage at or above this, with no store excluded, opens the analyses fully. */
    fullCoverage: number;
    /** Below this share of coupon baskets with two or more distinct products, a coupon is an id per line, not a basket. */
    multiItemShareMin: number;
    /** Eligible baskets the network needs for the analyses to run. */
    eligibleBasketsMinNetwork: number;
    /** Eligible baskets one store needs for its own recommendations. */
    eligibleBasketsMinStore: number;
    /** Lines of one coupon spread over more minutes than this mean the coupon was reused. */
    spanMaxMinutes: number;
    /** Baskets with more distinct products than this are left out of pair counting (and counted). */
    maxSkusForPairs: number;
  };
  /** Product pairs and their classification (D3, D4). */
  association: {
    minSkuBaskets: number;
    minPairBaskets: number;
    /** Standard deviations of the lift's conservative lower bound. */
    z: number;
    liftLowerBoundMin: number;
    strongConversion: number;
    fullPriceShareNatural: number;
    knownPriceShareMin: number;
    anchorOnlyBasketsMin: number;
    promoDiscountStep: number;
    promoDiscountMax: number;
    promoHeadroomConversionMax: number;
    expiredLossShareForPromo: number;
    topNetworkPairs: number;
    deviationMinAnchorBaskets: number;
    deviationConversionRatio: number;
  };
  /** "What is missing from the cart" (D10). */
  cartGap: {
    minAnchorBasketsNetwork: number;
    minAnchorBasketsStore: number;
    referencePercentile: number;
    referenceMinAnchorBaskets: number;
    partnerBaseRateMin: number;
    partnerBaseRateMax: number;
  };
  /** Behavior by time of day (D7). */
  hourly: {
    minBasketsPerDaypart: number;
    concentrationRatio: number;
    concentrationMinBaskets: number;
    attachDiffMin: number;
    attachZMin: number;
    ticketUplift: number;
  };
  /** Product return classes (D6). */
  products: {
    minUnits: number;
    minSellingDays: number;
    availabilitySellingDaysShareMin: number;
    availabilityGapDays: number;
    motorPercentile: number;
    lowReturnContribMax: number;
    lowReturnQtyMax: number;
    volumeQtyMin: number;
    volumeContribMax: number;
    starMin: number;
    potentialQtyMax: number;
    potentialMarginMin: number;
  };
  /** Similar stores and store gaps (D8). */
  peers: {
    count: number;
    minBaskets: number;
    scaleRatioMin: number;
    scaleRatioMax: number;
    minForBenchmark: number;
    ticketGapPct: number;
    gapT: number;
  };
  /** Impact estimate and priority (D10, D17, D21). */
  impact: {
    /** Conservative scenario: the share of an observed gap a light-touch action is assumed to recover. A premise, never a measured result. */
    scenarioConservative: number;
    /** Expected scenario: what priority is decided from. */
    scenarioExpected: number;
    /** Optimistic scenario. */
    scenarioOptimistic: number;
    highShareOfMargin: number;
    mediumShareOfMargin: number;
    minMonthlyCents: number;
    floorMonthlyCents: number;
    /** How many opportunities the main screen shows; the rest is on demand. A business rule. */
    mainScreenItems: number;
    /** Technical cap of the full list, not what the main screen shows. */
    maxItems: number;
    maxPerDetector: number;
    maxPerStore: number;
  };
  /** Combo simulator (D12). */
  simulator: {
    /** The lowest margin a combo may keep, as a share of its price. */
    minMarginPct: number;
    observedPriceWindowDays: number;
    observedPriceMinObservations: number;
    listPriceDivergence: number;
  };
  /** Wording of loss by cause (D11). */
  loss: {
    dominantShare: number;
    sellThroughLow: number;
    sellThroughHigh: number;
  };
  /** Confidence tiers and caps (D9). The point weights are the rubric itself and live in `confidence.ts`. */
  confidence: {
    highMin: number;
    mediumMin: number;
    daysFull: number;
    daysMid: number;
    daysMin: number;
    evidencePairMid: number;
    evidencePairHigh: number;
    evidenceAnchorMid: number;
    evidenceAnchorHigh: number;
    evidenceUnitsMid: number;
    evidenceUnitsHigh: number;
    couponCoverageMid: number;
    costHigh: number;
    costMid: number;
    reconciliationFlaggedStoreShare: number;
    storeMinBaskets: number;
    scopeMinOkLines: number;
  };
  /** Data-quality banner. */
  quality: {
    /** A category with fewer than this share of the sold products is described as thinly used. */
    catalogSparseCategoryShare: number;
    /** Products with no resolved cost weighing this share of the revenue turn the banner item from information into attention. */
    unresolvedCostRevenueShareAttention: number;
    /** Months with detail from which comparison and stability are fully available. */
    historyMonthsFull: number;
    /** Share of lines with a readable timestamp from which behavior by time is fully available. */
    datedLinesFull: number;
    /** Below this share of dated lines behavior by time is insufficient; between it and the full share, it has caveats. */
    datedLinesMin: number;
    /** Share of the revenue that comes from products with the minimum sample, for product return to be fully available. */
    eligibleSkuRevenueFull: number;
    /** Below this share product return is insufficient. */
    eligibleSkuRevenueMin: number;
  };
}

export const DEFAULT_PARAMETERS: CommercialParameters = {
  coupon: {
    exclusionCoverage: 0.8,
    fullCoverage: 0.95,
    multiItemShareMin: 0.05,
    eligibleBasketsMinNetwork: 300,
    eligibleBasketsMinStore: 100,
    spanMaxMinutes: 30,
    maxSkusForPairs: 12,
  },
  association: {
    minSkuBaskets: 20,
    minPairBaskets: 8,
    z: 2.58,
    liftLowerBoundMin: 1.3,
    strongConversion: 0.25,
    fullPriceShareNatural: 0.85,
    knownPriceShareMin: 0.7,
    anchorOnlyBasketsMin: 30,
    promoDiscountStep: 0.05,
    promoDiscountMax: 0.15,
    promoHeadroomConversionMax: 0.5,
    expiredLossShareForPromo: 0.1,
    topNetworkPairs: 100,
    deviationMinAnchorBaskets: 15,
    deviationConversionRatio: 0.5,
  },
  cartGap: {
    minAnchorBasketsNetwork: 100,
    minAnchorBasketsStore: 60,
    referencePercentile: 0.75,
    referenceMinAnchorBaskets: 60,
    partnerBaseRateMin: 0.05,
    partnerBaseRateMax: 0.95,
  },
  hourly: {
    minBasketsPerDaypart: 40,
    concentrationRatio: 1.5,
    concentrationMinBaskets: 25,
    attachDiffMin: 0.1,
    attachZMin: 2,
    ticketUplift: 0.2,
  },
  products: {
    minUnits: 10,
    minSellingDays: 14,
    availabilitySellingDaysShareMin: 0.5,
    availabilityGapDays: 7,
    motorPercentile: 0.8,
    lowReturnContribMax: 0.25,
    lowReturnQtyMax: 0.5,
    volumeQtyMin: 0.6,
    volumeContribMax: 0.4,
    starMin: 0.5,
    potentialQtyMax: 0.4,
    potentialMarginMin: 0.6,
  },
  peers: {
    count: 3,
    minBaskets: 100,
    scaleRatioMin: 0.4,
    scaleRatioMax: 2.5,
    minForBenchmark: 2,
    ticketGapPct: 0.15,
    gapT: 2,
  },
  impact: {
    scenarioConservative: 0.2,
    scenarioExpected: 0.4,
    scenarioOptimistic: 0.6,
    highShareOfMargin: 0.01,
    mediumShareOfMargin: 0.003,
    minMonthlyCents: 3000,
    floorMonthlyCents: 1000,
    mainScreenItems: 5,
    maxItems: 30,
    maxPerDetector: 5,
    maxPerStore: 2,
  },
  simulator: {
    minMarginPct: 0.3,
    observedPriceWindowDays: 7,
    observedPriceMinObservations: 5,
    listPriceDivergence: 0.05,
  },
  loss: {
    dominantShare: 0.5,
    sellThroughLow: 0.6,
    sellThroughHigh: 0.8,
  },
  confidence: {
    highMin: 70,
    mediumMin: 45,
    daysFull: 25,
    daysMid: 14,
    daysMin: 7,
    evidencePairMid: 15,
    evidencePairHigh: 30,
    evidenceAnchorMid: 300,
    evidenceAnchorHigh: 800,
    evidenceUnitsMid: 30,
    evidenceUnitsHigh: 100,
    couponCoverageMid: 0.9,
    costHigh: 0.95,
    costMid: 0.8,
    reconciliationFlaggedStoreShare: 0.2,
    storeMinBaskets: 100,
    scopeMinOkLines: 200,
  },
  quality: {
    catalogSparseCategoryShare: 0.05,
    unresolvedCostRevenueShareAttention: 0.05,
    historyMonthsFull: 3,
    datedLinesFull: 0.95,
    datedLinesMin: 0.8,
    eligibleSkuRevenueFull: 0.8,
    eligibleSkuRevenueMin: 0.5,
  },
};

type NumericPaths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends number ? `${P}${K}` : T[K] extends object ? NumericPaths<T[K], `${P}${K}.`> : never;
}[keyof T & string];

/** Every numeric parameter, as a dotted path. Adding a parameter without documenting it fails the typecheck. */
export type ParameterPath = NumericPaths<CommercialParameters>;

export type ParameterUnit = "share" | "ratio" | "count" | "days" | "minutes" | "cents" | "number";

export interface ParameterDoc {
  label: string;
  unit: ParameterUnit;
  min: number;
  max: number;
  integer: boolean;
  /** What the value decides, in one sentence. */
  controls: string;
}

const doc = (label: string, unit: ParameterUnit, min: number, max: number, controls: string): ParameterDoc => ({
  label,
  unit,
  min,
  max,
  integer: unit === "count" || unit === "days" || unit === "minutes" || unit === "cents",
  controls,
});

export const PARAMETER_DOCS: Record<ParameterPath, ParameterDoc> = {
  "coupon.exclusionCoverage": doc("Cobertura mínima de cupom por loja", "share", 0, 1, "Abaixo disso a loja sai das análises de cesta e é listada como excluída."),
  "coupon.fullCoverage": doc("Cobertura de cupom que libera tudo", "share", 0, 1, "Com a rede a partir daqui e nenhuma loja excluída, as análises rodam sem teto de confiança."),
  "coupon.multiItemShareMin": doc("Compras com 2+ produtos (mínimo)", "share", 0, 1, "Abaixo disso o cupom parece um id por linha, não uma cesta, e as análises de cesta ficam bloqueadas."),
  "coupon.eligibleBasketsMinNetwork": doc("Cestas elegíveis mínimas (rede)", "count", 1, 1_000_000, "Menos cestas que isso bloqueia as análises de cesta da rede."),
  "coupon.eligibleBasketsMinStore": doc("Cestas elegíveis mínimas (loja)", "count", 1, 1_000_000, "Menos cestas que isso e a loja não recebe recomendação de combo."),
  "coupon.spanMaxMinutes": doc("Intervalo máximo de uma cesta", "minutes", 1, 1440, "Linhas do mesmo cupom mais espalhadas que isso indicam cupom reaproveitado; a cesta sai e é contada."),
  "coupon.maxSkusForPairs": doc("Produtos por cesta para contar pares", "count", 2, 200, "Cestas com mais produtos que isso não entram na contagem de pares (são contadas, não escondidas)."),

  "association.minSkuBaskets": doc("Compras mínimas de cada produto do par", "count", 1, 100_000, "Um par só é confiável se cada produto aparece em pelo menos tantas compras."),
  "association.minPairBaskets": doc("Compras conjuntas mínimas do par", "count", 1, 100_000, "Um par só é confiável com pelo menos tantas compras juntas."),
  "association.z": doc("Rigor do limite inferior do lift (desvios-padrão)", "number", 0.5, 6, "Maior valor = mais conservador; barra pares que só parecem fortes por acaso."),
  "association.liftLowerBoundMin": doc("Lift mínimo (limite inferior)", "ratio", 1, 20, "O par precisa passar disso mesmo no cenário conservador para ser listado."),
  "association.strongConversion": doc("Conversão que define associação forte", "share", 0, 1, "A partir daí o par já compra junto: só exposição conjunta, sem desconto."),
  "association.fullPriceShareNatural": doc("Parcela a preço cheio que dispensa desconto", "share", 0, 1, "Compras conjuntas quase todas a preço cheio: desconto só reduziria margem."),
  "association.knownPriceShareMin": doc("Compras com desconto conhecido (mínimo)", "share", 0, 1, "Só se julga a preço cheio quando esta parcela das compras tem o estado de desconto conhecido."),
  "association.anchorOnlyBasketsMin": doc("Compras só com o item âncora (mínimo)", "count", 1, 100_000, "Sem folga de compras que ainda não levam o par, não há o que promover."),
  "association.promoDiscountStep": doc("Passo da grade de desconto", "share", 0.01, 0.5, "Descontos candidatos: do passo até o máximo, de passo em passo."),
  "association.promoDiscountMax": doc("Desconto máximo testado", "share", 0.01, 0.9, "Nenhum desconto acima disso é sugerido."),
  "association.promoHeadroomConversionMax": doc("Conversão extra máxima plausível", "share", 0, 1, "Se o desconto exige mais conversão que isso para se pagar, não é candidato."),
  "association.expiredLossShareForPromo": doc("Perda por validade que justifica promoção", "share", 0, 1, "Perda por validade a partir desta parcela do vendido é motivo de demanda."),
  "association.topNetworkPairs": doc("Pares da rede comparados por loja", "count", 1, 10_000, "Só os melhores pares da rede são checados em cada loja."),
  "association.deviationMinAnchorBaskets": doc("Compras da âncora para apontar desvio de loja", "count", 1, 100_000, "Uma loja só é apontada se tiver compras suficientes do item âncora."),
  "association.deviationConversionRatio": doc("Fração da conversão da rede para apontar desvio", "share", 0, 1, "A loja é apontada quando converte no máximo esta fração do padrão da rede."),

  "cartGap.minAnchorBasketsNetwork": doc("Cestas-âncora mínimas (rede)", "count", 1, 100_000, "Abaixo disso a rede não tem lacuna de carrinho estimável."),
  "cartGap.minAnchorBasketsStore": doc("Cestas-âncora mínimas (loja)", "count", 1, 100_000, "Abaixo disso a loja não tem lacuna de carrinho estimável."),
  "cartGap.referencePercentile": doc("Percentil de referência entre lojas", "share", 0, 1, "A lacuna é medida contra este percentil da taxa das lojas."),
  "cartGap.referenceMinAnchorBaskets": doc("Cestas-âncora para uma loja entrar na referência", "count", 1, 100_000, "Lojas com menos cestas-âncora não formam a referência."),
  "cartGap.partnerBaseRateMin": doc("Taxa-base mínima do item complementar", "share", 0, 1, "Abaixo disso o complementar é raro demais para ter lacuna significativa."),
  "cartGap.partnerBaseRateMax": doc("Taxa-base máxima do item complementar", "share", 0, 1, "Acima disso o complementar já está em quase toda compra."),

  "hourly.minBasketsPerDaypart": doc("Compras mínimas por faixa horária", "count", 1, 100_000, "Faixas com menos compras não geram regra de comportamento."),
  "hourly.concentrationRatio": doc("Concentração de categoria na faixa", "ratio", 1, 20, "Participação da categoria na faixa versus fora dela."),
  "hourly.concentrationMinBaskets": doc("Compras da categoria para apontar concentração", "count", 1, 100_000, "Evita concluir concentração com poucas compras."),
  "hourly.attachDiffMin": doc("Diferença mínima de adesão (p.p.)", "share", 0, 1, "Quanto a adesão da faixa precisa ficar abaixo da de fora."),
  "hourly.attachZMin": doc("Rigor da diferença de adesão (z)", "number", 0.5, 6, "Teste de duas proporções: só diferença que resiste a esse rigor entra."),
  "hourly.ticketUplift": doc("Ticket acima do escopo (informativo)", "share", 0, 5, "Faixa com ticket este tanto acima é destacada, sem recomendação."),

  "products.minUnits": doc("Unidades mínimas para classificar um produto", "count", 1, 100_000, "Abaixo disso o produto fica em 'Dados insuficientes'."),
  "products.minSellingDays": doc("Dias com venda mínimos", "days", 1, 31, "Menos dias com venda e o produto fica 'Em observação' (produto novo julgado por velocidade)."),
  "products.availabilitySellingDaysShareMin": doc("Parcela mínima de dias com venda", "share", 0, 1, "Abaixo disso a disponibilidade é incerta e nenhuma classe adversa é dada."),
  "products.availabilityGapDays": doc("Dias seguidos sem venda que indicam incerteza", "days", 1, 31, "Uma lacuna assim pode ser ruptura; o produto não é penalizado."),
  "products.motorPercentile": doc("Percentil do motor de resultado", "share", 0, 1, "Produtos a partir daqui na contribuição de margem são motores."),
  "products.lowReturnContribMax": doc("Contribuição máxima do baixo retorno", "share", 0, 1, "Percentil de contribuição abaixo do qual o produto é candidato a baixo retorno."),
  "products.lowReturnQtyMax": doc("Volume máximo do baixo retorno", "share", 0, 1, "Junto com a contribuição baixa: pouco volume e pouco resultado."),
  "products.volumeQtyMin": doc("Volume mínimo de 'volume sem retorno'", "share", 0, 1, "Percentil de volume ou receita a partir do qual há volume."),
  "products.volumeContribMax": doc("Contribuição máxima de 'volume sem retorno'", "share", 0, 1, "Volume alto com contribuição abaixo disso não paga o giro."),
  "products.starMin": doc("Percentil mínimo de estrela", "share", 0, 1, "Volume, margem % e contribuição a partir daqui classificam uma estrela."),
  "products.potentialQtyMax": doc("Volume máximo do potencial subexplorado", "share", 0, 1, "Pouco volume com margem alta pode ser pouca exposição."),
  "products.potentialMarginMin": doc("Margem mínima do potencial subexplorado", "share", 0, 1, "Percentil de margem % ou de margem por unidade para o potencial."),

  "peers.count": doc("Lojas parecidas por loja", "count", 1, 20, "Quantas lojas de padrão de demanda parecido formam o benchmark."),
  "peers.minBaskets": doc("Compras mínimas para ser loja parecida", "count", 1, 100_000, "Lojas com menos compras não entram como parecidas."),
  "peers.scaleRatioMin": doc("Razão mínima de porte entre lojas", "ratio", 0.05, 1, "Uma loja parecida não pode ter menos que esta fração das compras."),
  "peers.scaleRatioMax": doc("Razão máxima de porte entre lojas", "ratio", 1, 20, "Nem mais que este múltiplo das compras."),
  "peers.minForBenchmark": doc("Parecidas mínimas para o benchmark", "count", 1, 20, "Com menos que isso a comparação cai para a referência da rede."),
  "peers.ticketGapPct": doc("Diferença de ticket que vira lacuna de loja", "share", 0, 5, "Ticket a partir desta distância das parecidas é uma lacuna candidata."),
  "peers.gapT": doc("Rigor da lacuna de ticket (t de Welch)", "number", 0.5, 6, "Só lacuna que resiste a este rigor estatístico entra."),

  "impact.scenarioConservative": doc("Estimativa de impacto — cenário conservador", "share", 0, 1, "Parte da diferença observada que se assume recuperar no cenário conservador. Premissa de potencial, nunca resultado medido nem garantido."),
  "impact.scenarioExpected": doc("Estimativa de impacto — cenário esperado", "share", 0, 1, "Parte assumida no cenário esperado. É o que decide a prioridade."),
  "impact.scenarioOptimistic": doc("Estimativa de impacto — cenário otimista", "share", 0, 1, "Parte assumida no cenário otimista: o teto plausível de uma ação leve."),
  "impact.highShareOfMargin": doc("Prioridade alta: parcela da margem mensal", "share", 0, 1, "Impacto médio a partir desta parcela da margem mensal do escopo é prioridade alta."),
  "impact.mediumShareOfMargin": doc("Prioridade média: parcela da margem mensal", "share", 0, 1, "Idem, para prioridade média."),
  "impact.minMonthlyCents": doc("Impacto mensal mínimo para prioridade", "cents", 0, 100_000_000, "Abaixo disso o item é prioridade baixa, qualquer que seja a parcela."),
  "impact.floorMonthlyCents": doc("Impacto mensal abaixo do qual o item some", "cents", 0, 100_000_000, "Ganho estimado menor que isso não vale a atenção e não é listado."),
  "impact.mainScreenItems": doc("Oportunidades na tela principal", "count", 1, 20, "Quantas oportunidades a tela principal mostra; as demais ficam sob demanda."),
  "impact.maxItems": doc("Teto técnico da lista completa", "count", 1, 500, "Limite da lista completa de oportunidades; não define quantas aparecem na tela principal."),
  "impact.maxPerDetector": doc("Itens por tipo de detector", "count", 1, 500, "Evita que um tipo domine a lista."),
  "impact.maxPerStore": doc("Itens de desvio por loja", "count", 1, 500, "Teto por loja na visão de rede."),

  "simulator.minMarginPct": doc("Margem mínima do combo", "share", 0, 0.95, "O simulador marca 'abaixo da margem mínima' e calcula o desconto máximo a partir daqui. PREMISSA editável."),
  "simulator.observedPriceWindowDays": doc("Janela do preço observado (dias)", "days", 1, 31, "O preço do simulador é a moda dos últimos dias do período."),
  "simulator.observedPriceMinObservations": doc("Observações mínimas do preço", "count", 1, 10_000, "Com menos que isso na janela, usa o período inteiro."),
  "simulator.listPriceDivergence": doc("Divergência que marca o preço de cadastro", "share", 0, 5, "Preço de cadastro fora desta distância do observado ganha um aviso."),

  "loss.dominantShare": doc("Parcela que torna um motivo dominante", "share", 0, 1, "Um motivo com esta parcela da perda do produto define o texto da causa."),
  "loss.sellThroughLow": doc("Giro baixo (vendido ÷ abastecido)", "share", 0, 1, "Perda por validade com giro abaixo disso aponta excesso de abastecimento."),
  "loss.sellThroughHigh": doc("Giro alto (vendido ÷ abastecido)", "share", 0, 1, "Produto que gira bem e perde: a perda é operacional, não de mix."),

  "confidence.highMin": doc("Pontuação mínima para confiança Alta", "number", 0, 100, "Pontuação (0–100) a partir da qual a confiança é Alta."),
  "confidence.mediumMin": doc("Pontuação mínima para confiança Média", "number", 0, 100, "Idem, para Média; abaixo é Baixa."),
  "confidence.daysFull": doc("Dias com venda: pontuação cheia", "days", 1, 31, "A partir daqui, os 10 pontos de dias com venda."),
  "confidence.daysMid": doc("Dias com venda: pontuação parcial", "days", 1, 31, "A partir daqui, 6 pontos."),
  "confidence.daysMin": doc("Dias com venda mínimos (teto Baixa)", "days", 1, 31, "Com menos dias que isso a confiança é no máximo Baixa."),
  "confidence.evidencePairMid": doc("Evidência de par: patamar médio", "count", 1, 100_000, "Compras conjuntas que rendem 20 dos 30 pontos de evidência."),
  "confidence.evidencePairHigh": doc("Evidência de par: patamar alto", "count", 1, 100_000, "Compras conjuntas que rendem os 30 pontos."),
  "confidence.evidenceAnchorMid": doc("Evidência de âncora: patamar médio", "count", 1, 100_000, "Cestas-âncora que rendem 20 pontos."),
  "confidence.evidenceAnchorHigh": doc("Evidência de âncora: patamar alto", "count", 1, 100_000, "Cestas-âncora que rendem 30 pontos."),
  "confidence.evidenceUnitsMid": doc("Evidência de produto: patamar médio", "count", 1, 100_000, "Unidades que rendem 20 pontos."),
  "confidence.evidenceUnitsHigh": doc("Evidência de produto: patamar alto", "count", 1, 100_000, "Unidades que rendem 30 pontos."),
  "confidence.couponCoverageMid": doc("Cobertura de cupom: patamar médio", "share", 0, 1, "Cobertura a partir daqui rende 10 dos 15 pontos (a cheia usa a cobertura que libera tudo)."),
  "confidence.costHigh": doc("Custo resolvido: patamar alto", "share", 0, 1, "Parcela de produtos com custo a partir da qual rende 7 pontos (100% rende 10)."),
  "confidence.costMid": doc("Custo resolvido: patamar médio", "share", 0, 1, "Idem, 3 pontos; abaixo disso zero e as afirmações de margem são retidas."),
  "confidence.reconciliationFlaggedStoreShare": doc("Reconciliação: parcela de produtos sinalizados na loja", "share", 0, 1, "A partir daqui, mesmo um produto limpo rende menos pontos de reconciliação."),
  "confidence.storeMinBaskets": doc("Compras mínimas da loja (teto Baixa)", "count", 1, 100_000, "Loja com menos compras que isso tem confiança no máximo Baixa."),
  "confidence.scopeMinOkLines": doc("Linhas mínimas do escopo", "count", 1, 1_000_000, "Escopo com menos linhas concluídas que isso é 'Dados insuficientes'."),

  "quality.unresolvedCostRevenueShareAttention": doc("Receita sem custo que pede atenção", "share", 0, 1, "Produtos sem custo resolvido pesando esta parcela da receita passam de informação a atenção no aviso de qualidade."),
  "quality.historyMonthsFull": doc("Meses com detalhe para histórico completo", "count", 1, 24, "Com menos meses que isso a comparação e a estabilidade entre meses ficam com ressalva."),
  "quality.datedLinesFull": doc("Linhas com horário legível (completo)", "share", 0, 1, "A partir daqui o comportamento por horário está disponível sem ressalva."),
  "quality.datedLinesMin": doc("Linhas com horário legível (mínimo)", "share", 0, 1, "Abaixo disso o comportamento por horário é 'Dados insuficientes'."),
  "quality.eligibleSkuRevenueFull": doc("Receita de produtos com amostra mínima (completo)", "share", 0, 1, "A partir daqui o retorno dos produtos está disponível sem ressalva."),
  "quality.eligibleSkuRevenueMin": doc("Receita de produtos com amostra mínima (mínimo)", "share", 0, 1, "Abaixo disso o retorno dos produtos é 'Dados insuficientes'."),
  "quality.catalogSparseCategoryShare": doc("Categoria pouco usada no catálogo", "share", 0, 1, "Categoria com menos que esta parcela dos produtos vendidos é apontada como pouco usada."),
};

export const PARAMETER_PATHS = Object.keys(PARAMETER_DOCS) as ParameterPath[];

export const PARAMETER_GROUP_LABELS: Record<string, string> = {
  coupon: "Cupom e cestas",
  association: "Pares de produtos",
  cartGap: "O que falta no carrinho",
  hourly: "Horário",
  products: "Produtos",
  peers: "Lojas parecidas",
  impact: "Impacto e prioridade",
  simulator: "Simulador de combo",
  loss: "Perdas",
  confidence: "Confiança",
  quality: "Qualidade dos dados",
};

/**
 * Parameters whose calibration against real data was reviewed and approved.
 * Empty until tasks 5.6: nothing is frozen yet, so everything reads "provisório".
 */
export const APPROVED_PARAMETERS: ReadonlySet<ParameterPath> = new Set<ParameterPath>();

export function isProvisional(path: ParameterPath): boolean {
  return !APPROVED_PARAMETERS.has(path);
}

/** `coupon.exclusionCoverage` → `NEXT_PUBLIC_CI_COUPON_EXCLUSION_COVERAGE`. */
export function envNameOf(path: ParameterPath): string {
  const snake = path
    .split(".")
    .map((part) => part.replace(/([a-z0-9])([A-Z])/g, "$1_$2"))
    .join("_");
  return `NEXT_PUBLIC_CI_${snake.toUpperCase()}`;
}

export function getParameter(parameters: CommercialParameters, path: ParameterPath): number {
  let cursor: unknown = parameters;
  for (const key of path.split(".")) cursor = (cursor as Record<string, unknown>)[key];
  return cursor as number;
}

function withParameter(parameters: CommercialParameters, path: ParameterPath, value: number): CommercialParameters {
  const next = structuredClone(parameters);
  const keys = path.split(".");
  let cursor = next as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
  cursor[keys[keys.length - 1]] = value;
  return next;
}

function inBounds(path: ParameterPath, value: number): boolean {
  const { min, max, integer } = PARAMETER_DOCS[path];
  return Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
}

/** Pairs that only make sense in order. A violated pair drops the later value back to its default. */
const ORDERED_PAIRS: { lower: ParameterPath; upper: ParameterPath; text: string }[] = [
  { lower: "coupon.exclusionCoverage", upper: "coupon.fullCoverage", text: "a cobertura que exclui a loja não pode passar da que libera tudo" },
  { lower: "impact.scenarioConservative", upper: "impact.scenarioExpected", text: "o cenário conservador não pode passar do esperado" },
  { lower: "impact.scenarioExpected", upper: "impact.scenarioOptimistic", text: "o cenário esperado não pode passar do otimista" },
  { lower: "quality.datedLinesMin", upper: "quality.datedLinesFull", text: "o mínimo de linhas com horário não pode passar do completo" },
  { lower: "quality.eligibleSkuRevenueMin", upper: "quality.eligibleSkuRevenueFull", text: "o mínimo de receita com amostra não pode passar do completo" },
  { lower: "impact.mediumShareOfMargin", upper: "impact.highShareOfMargin", text: "a parcela da prioridade média não pode passar da alta" },
  { lower: "impact.floorMonthlyCents", upper: "impact.minMonthlyCents", text: "o impacto que faz o item sumir não pode passar do mínimo de prioridade" },
  { lower: "peers.scaleRatioMin", upper: "peers.scaleRatioMax", text: "a razão mínima de porte não pode passar da máxima" },
  { lower: "confidence.mediumMin", upper: "confidence.highMin", text: "a pontuação da confiança Média não pode passar da Alta" },
  { lower: "confidence.daysMin", upper: "confidence.daysMid", text: "os dias mínimos não podem passar dos da pontuação parcial" },
  { lower: "confidence.daysMid", upper: "confidence.daysFull", text: "os dias da pontuação parcial não podem passar dos da cheia" },
  { lower: "confidence.evidencePairMid", upper: "confidence.evidencePairHigh", text: "o patamar médio de evidência de par não pode passar do alto" },
  { lower: "confidence.evidenceAnchorMid", upper: "confidence.evidenceAnchorHigh", text: "o patamar médio de evidência de âncora não pode passar do alto" },
  { lower: "confidence.evidenceUnitsMid", upper: "confidence.evidenceUnitsHigh", text: "o patamar médio de evidência de produto não pode passar do alto" },
  { lower: "confidence.costMid", upper: "confidence.costHigh", text: "o patamar médio de custo resolvido não pode passar do alto" },
  { lower: "cartGap.partnerBaseRateMin", upper: "cartGap.partnerBaseRateMax", text: "a taxa-base mínima do complementar não pode passar da máxima" },
];

/**
 * Returns `parameters` with every violated pair restored to its defaults, and a
 * sentence for each. The restoring is per pair, so one bad value never discards
 * a valid one elsewhere.
 */
function enforceOrder(parameters: CommercialParameters, warnings: string[]): CommercialParameters {
  let result = parameters;
  for (const { lower, upper, text } of ORDERED_PAIRS) {
    if (getParameter(result, lower) <= getParameter(result, upper)) continue;
    warnings.push(`Parâmetros ${lower} e ${upper} voltaram ao padrão: ${text}.`);
    result = withParameter(withParameter(result, lower, getParameter(DEFAULT_PARAMETERS, lower)), upper, getParameter(DEFAULT_PARAMETERS, upper));
  }
  return result;
}

export interface ResolvedParameters {
  parameters: CommercialParameters;
  /** Values that were set but could not be used, each said in a sentence. Never thrown: the page must open. */
  warnings: string[];
}

/**
 * The defaults with the environment applied. A value that is not a number, is
 * out of its bounds or breaks an ordered pair is ignored and reported: a typo
 * in a deployment variable must not take the page down, and must not pass in
 * silence either.
 */
export function parametersFromEnv(env: Record<string, string | undefined>): ResolvedParameters {
  const warnings: string[] = [];
  let parameters = DEFAULT_PARAMETERS;

  for (const path of PARAMETER_PATHS) {
    const name = envNameOf(path);
    const raw = env[name]?.trim();
    if (raw === undefined || raw === "") continue;

    const value = Number(raw);
    if (!inBounds(path, value)) {
      const { min, max } = PARAMETER_DOCS[path];
      warnings.push(`${name}="${raw}" foi ignorado: precisa ser um número entre ${min} e ${max}${PARAMETER_DOCS[path].integer ? ", inteiro" : ""}.`);
      continue;
    }
    parameters = withParameter(parameters, path, value);
  }

  return { parameters: enforceOrder(parameters, warnings), warnings };
}

/** The value as the reader should see it: 80%, 1,5×, 30 min, R$ 30,00. */
export function formatParameterValue(path: ParameterPath, value: number): string {
  const { unit } = PARAMETER_DOCS[path];
  switch (unit) {
    case "share":
      return `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    case "ratio":
      return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`;
    case "days":
      return `${value} ${value === 1 ? "dia" : "dias"}`;
    case "minutes":
      return `${value} min`;
    case "cents":
      return (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    default:
      return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  }
}
