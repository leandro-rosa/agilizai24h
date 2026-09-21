import type { ParameterPath } from "./parameters";

/**
 * What kind of rule a parameter is (design D16). The interface never mixes them:
 *  - `business`: a decision of the company. One value for the whole operation;
 *    read-only here, and never stored in a viewer's browser.
 *  - `quality`: decides whether there is enough data for an analysis. Shown to
 *    the reader as indicators and blocks; the thresholds live in the advanced area.
 *  - `analytic`: how association, trend, similarity, confidence and opportunity
 *    are computed. Advanced and calibration area only.
 * Every one of them is provisional until calibrated against real months.
 */
export type ParameterKind = "business" | "quality" | "analytic";

export interface ParameterExtra {
  kind: ParameterKind;
  /** How the number is computed, when the parameter is compared with a computed ratio or statistic. */
  formula: string | null;
  /** The reason for the default. All of them are judgment written before real data. */
  why: string;
  /** Where in the product the parameter is read. */
  usedIn: string;
  /** What raising the value does. */
  up: string;
  /** What lowering the value does. */
  down: string;
}

/** Where each group's parameters are read, unless a parameter says otherwise. */
const USED_IN: Record<string, string> = {
  coupon: "Portão de cobertura de cupom (assessCouponGate) e disponibilidade dos combos",
  association: "Pares de produtos e sua classificação (grupo 6, em espera)",
  cartGap: "“O que falta no carrinho” (grupo 6, em espera)",
  hourly: "Comportamento por horário (grupo 9, em espera)",
  products: "Classes de retorno dos produtos (grupo 8, em espera)",
  peers: "Lojas parecidas e lacunas de loja (grupo 10, em espera)",
  impact: "Estimativa de impacto, prioridade e central de oportunidades (grupo 11, em espera)",
  simulator: "Simulador de combo (grupo 7, em espera)",
  loss: "Texto de perda por causa (grupo 8, em espera)",
  confidence: "Confiança das recomendações (computeConfidence)",
  quality: "Disponibilidade das análises e aviso de qualidade (assessAvailability, buildQualityItems)",
};

interface Options {
  formula?: string;
  usedIn?: string;
}

const e = (group: string, kind: ParameterKind, why: string, up: string, down: string, options: Options = {}): ParameterExtra => ({
  kind,
  formula: options.formula ?? null,
  why,
  usedIn: options.usedIn ?? USED_IN[group],
  up,
  down,
});

/** Judgment cut used by the product classes; a class never comes from one of them alone (D6, D20). */
const classCut = (why: string, up: string, down: string): [string, string, string] => [`Corte de julgamento: ${why} A classe exige a combinação dos sinais, nunca só este.`, up, down];

export const PARAMETER_EXTRA: Record<ParameterPath, ParameterExtra> = {
  /* ------------------------------- coupon ------------------------------- */
  "coupon.exclusionCoverage": e("coupon", "quality", "Abaixo de 80%, mais de uma linha em cada cinco fica fora de qualquer cesta e não dá para presumir o sentido do viés.", "Mais lojas excluídas: análise mais limpa, sobre menos lojas.", "Menos lojas excluídas: mais risco de viés por cupom faltando.", { formula: "linhas OK com cupom ÷ todas as linhas OK da loja, no período" }),
  "coupon.fullCoverage": e("coupon", "quality", "A partir de 95% o que fica de fora é pequeno o bastante para a regra de estabilidade absorver.", "A rede abre menos vezes; mais análises ficam com teto de confiança Média.", "A rede abre mesmo com mais lacuna de cupom.", { formula: "Σ linhas OK com cupom ÷ Σ linhas OK, todas as lojas com detalhe (agregada, não média de percentuais)" }),
  "coupon.multiItemShareMin": e("coupon", "quality", "Se quase nenhuma cesta com cupom tem 2+ produtos, o cupom identifica a linha, não a compra.", "Bloqueia mais cedo por cupom que não agrupa.", "Aceita cupons que quase não agrupam; os pares ficam raros e frágeis.", { formula: "cestas com cupom e 2+ produtos distintos ÷ cestas com cupom (lojas elegíveis)" }),
  "coupon.eligibleBasketsMinNetwork": e("coupon", "quality", "Com poucas centenas de cestas o lift é ruído; 300 é um piso de julgamento.", "Bloqueia a rede com mais cestas: mais exigente.", "Libera com amostra menor: mais pares espúrios.", { formula: "Σ cestas com cupom das lojas elegíveis" }),
  "coupon.eligibleBasketsMinStore": e("coupon", "quality", "Uma loja com poucas cestas não sustenta recomendação própria; 100 é um piso de julgamento.", "Menos lojas recebem recomendação própria.", "Mais lojas com amostra frágil recebem recomendação.", { formula: "cestas com cupom da loja" }),
  "coupon.spanMaxMinutes": e("coupon", "analytic", "Uma compra numa máquina leva minutos; horas entre linhas do mesmo cupom indicam cupom reaproveitado.", "Aceita cestas mais espalhadas: risco de juntar compras diferentes.", "Descarta mais cestas como reaproveitadas.", { formula: "horário da última linha − horário da primeira linha do mesmo cupom, em minutos", usedIn: "Construção das cestas (buildDataset)" }),
  "coupon.maxSkusForPairs": e("coupon", "analytic", "Cestas enormes geram muitos pares sem sinal e pesam desproporcionalmente na contagem.", "Mais cestas grandes entram na contagem de pares.", "Mais cestas ficam fora da contagem de pares (são contadas, não escondidas).", { formula: "produtos distintos da cesta", usedIn: "Contagem de pares (grupo 6, em espera)" }),

  /* ----------------------------- association ---------------------------- */
  "association.minSkuBaskets": e("association", "quality", "Sem compras suficientes de cada produto o par não é estável.", "Menos pares passam.", "Mais pares passam, incluindo os raros.", { formula: "cestas que contêm o produto" }),
  "association.minPairBaskets": e("association", "quality", "Poucas compras conjuntas podem ser acaso.", "Menos pares passam.", "Mais pares passam, com risco de acaso.", { formula: "cestas que contêm A e B" }),
  "association.z": e("association", "analytic", "Entre centenas de pares testados prefere-se dizer “não sei” a listar ruído; 2,58 ≈ 99% de confiança.", "Mais conservador: menos pares.", "Menos conservador: passam pares só prováveis.", { formula: "liftLB = lift · exp(−z · √Var), Var(ln lift) ≈ 1/nAB − 1/nA − 1/nB + 1/N + 2(lift−1)/N" }),
  "association.liftLowerBoundMin": e("association", "analytic", "Exige excesso garantido sobre o acaso, não só a estimativa pontual.", "Menos pares confiáveis.", "Mais pares confiáveis, com associação mais fraca.", { formula: "limite inferior do lift ≥ mínimo" }),
  "association.strongConversion": e("association", "analytic", "Quando 1 em 4 compradores da âncora já leva o par, eles já compram juntos: só exposição, sem desconto.", "Menos pares viram “associação forte”; mais viram cross-sell.", "Mais pares viram “associação forte”.", { formula: "cestas com A e B ÷ cestas com A" }),
  "association.fullPriceShareNatural": e("association", "analytic", "Se quase tudo já sai a preço cheio, desconto só reduziria margem sem vender mais.", "Exige mais compras a preço cheio para dispensar desconto.", "Dispensa desconto com menos evidência de preço cheio.", { formula: "cestas conjuntas com as duas linhas a preço cheio ÷ cestas conjuntas com estado de desconto conhecido" }),
  "association.knownPriceShareMin": e("association", "quality", "Sem saber se houve desconto não se julga “a preço cheio”.", "Julga preço cheio em menos casos.", "Julga preço cheio com menos dados sobre desconto.", { formula: "cestas conjuntas com estado de desconto conhecido ÷ cestas conjuntas" }),
  "association.anchorOnlyBasketsMin": e("association", "quality", "Sem folga de compras que ainda não levam o par não há o que promover.", "Menos pares chegam a candidato de ação.", "Mais pares chegam a candidato, com folga pequena.", { formula: "cestas com a âncora e sem o par" }),
  "association.promoDiscountStep": e("association", "analytic", "Grade de descontos candidatos em passos de 5 pontos percentuais.", "Grade mais grossa: menos candidatos.", "Grade mais fina: mais candidatos.", { formula: "descontos testados = passo, 2·passo, … até o desconto máximo" }),
  "association.promoDiscountMax": e("association", "business", "O maior desconto que a empresa aceita testar num combo; 15% é um teto de partida.", "Permite testar descontos maiores, com mais risco de margem.", "Restringe os testes a descontos menores.", { formula: "desconto testado ≤ este valor e margem do combo ≥ margem mínima" }),
  "association.promoHeadroomConversionMax": e("association", "analytic", "Se o desconto exige uma conversão implausível para se pagar, não é candidato.", "Aceita descontos que exigem mais conversão extra.", "Aceita menos descontos.", { formula: "combos extras necessários ÷ cestas só com a âncora" }),
  "association.expiredLossShareForPromo": e("association", "analytic", "Perda por validade relevante é motivo de demanda para promover.", "Exige mais perda por validade para justificar promoção.", "Justifica promoção com menos perda.", { formula: "valor perdido por validade ÷ valor vendido do produto" }),
  "association.topNetworkPairs": e("association", "analytic", "Só os melhores pares da rede são conferidos por loja: limita as comparações múltiplas.", "Mais pares conferidos por loja: mais chance de falso positivo.", "Menos pares conferidos por loja.", { usedIn: "Desvio de loja no padrão da rede (grupo 6, em espera)" }),
  "association.deviationMinAnchorBaskets": e("association", "quality", "Uma loja só é apontada como desvio se tiver compras suficientes do item âncora.", "Menos lojas apontadas.", "Mais lojas apontadas, com amostra menor.", { formula: "cestas da loja com a âncora", usedIn: "Desvio de loja no padrão da rede (grupo 6, em espera)" }),
  "association.deviationConversionRatio": e("association", "analytic", "Uma loja que converte no máximo metade do padrão da rede merece atenção.", "Aponta mais lojas como desvio.", "Aponta menos lojas.", { formula: "conversão da loja ≤ fração × conversão da rede, e limite superior de Wilson abaixo da rede", usedIn: "Desvio de loja no padrão da rede (grupo 6, em espera)" }),

  /* ------------------------------- cartGap ------------------------------ */
  "cartGap.minAnchorBasketsNetwork": e("cartGap", "quality", "Abaixo de 100 cestas com a categoria âncora, a taxa de adesão é instável.", "Menos lacunas estimáveis.", "Mais lacunas, sobre amostra menor.", { formula: "cestas com ao menos um item da categoria âncora" }),
  "cartGap.minAnchorBasketsStore": e("cartGap", "quality", "Uma loja precisa de menos cestas que a rede, mas não de poucas; 60 é um piso de julgamento.", "Menos lojas com lacuna estimável.", "Mais lojas com lacuna, sobre amostra menor.", { formula: "cestas da loja com ao menos um item da categoria âncora" }),
  "cartGap.referencePercentile": e("cartGap", "analytic", "O 75º percentil é uma referência alcançável: nem a melhor loja, nem a média.", "Referência mais alta: lacunas maiores.", "Referência mais baixa: lacunas menores.", { formula: "percentil P das taxas de adesão entre as lojas com amostra" }),
  "cartGap.referenceMinAnchorBaskets": e("cartGap", "quality", "Lojas com poucas cestas âncora não entram na referência.", "Referência sobre menos lojas.", "Referência inclui lojas de amostra pequena.", { formula: "cestas da loja com a categoria âncora" }),
  "cartGap.partnerBaseRateMin": e("cartGap", "analytic", "Um complementar raro demais não tem lacuna significativa.", "Menos categorias complementares avaliadas.", "Mais categorias avaliadas, algumas raras.", { formula: "cestas âncora que contêm o parceiro ÷ cestas âncora" }),
  "cartGap.partnerBaseRateMax": e("cartGap", "analytic", "Um complementar presente em quase toda compra não tem lacuna.", "Avalia complementares mais universais.", "Avalia menos complementares.", { formula: "cestas âncora que contêm o parceiro ÷ cestas âncora" }),

  /* -------------------------------- hourly ------------------------------ */
  "hourly.minBasketsPerDaypart": e("hourly", "quality", "Uma faixa do dia com poucas compras não sustenta regra.", "Menos faixas com análise.", "Mais faixas, com amostra menor.", { formula: "compras da loja ou da rede dentro da faixa" }),
  "hourly.concentrationRatio": e("hourly", "analytic", "1,5× indica uma concentração relevante da categoria na faixa.", "Aponta menos concentrações.", "Aponta mais concentrações, algumas fracas.", { formula: "participação da categoria na faixa ÷ participação fora da faixa" }),
  "hourly.concentrationMinBaskets": e("hourly", "quality", "Evita concluir concentração com poucas compras da categoria.", "Menos concentrações apontadas.", "Mais concentrações, sobre amostra menor.", { formula: "compras com a categoria dentro da faixa" }),
  "hourly.attachDiffMin": e("hourly", "analytic", "10 pontos percentuais é uma diferença de adesão que importa comercialmente.", "Aponta menos lacunas por faixa.", "Aponta mais lacunas, algumas pequenas.", { formula: "adesão fora da faixa − adesão na faixa, em pontos percentuais" }),
  "hourly.attachZMin": e("hourly", "analytic", "|z| ≥ 2 corresponde a cerca de 95% de confiança na diferença.", "Mais exigente: menos diferenças passam.", "Menos exigente: mais ruído passa.", { formula: "z de duas proporções entre a adesão na faixa e fora dela" }),
  "hourly.ticketUplift": e("hourly", "analytic", "Ticket 20% acima do escopo é destaque informativo, sem ação.", "Destaca menos faixas.", "Destaca mais faixas.", { formula: "ticket da faixa ÷ ticket do escopo − 1" }),

  /* ------------------------------- products ----------------------------- */
  "products.minUnits": e("products", "quality", "Menos de 10 unidades não caracteriza o comportamento de um produto.", "Mais produtos ficam em “Dados insuficientes”.", "Classifica produtos com amostra menor.", { formula: "unidades vendidas no escopo" }),
  "products.minSellingDays": e("products", "quality", "Produto novo é julgado pela velocidade de venda, não pelo volume; abaixo disso fica em observação.", "Mais produtos ficam “Em observação”.", "Classifica produtos com pouco histórico.", { formula: "dias do período com ao menos uma venda" }),
  "products.availabilitySellingDaysShareMin": e("products", "quality", "Poucos dias com venda sugerem indisponibilidade, não baixa procura.", "Mais produtos com disponibilidade incerta.", "Menos produtos com disponibilidade incerta.", { formula: "dias com venda ÷ dias do período" }),
  "products.availabilityGapDays": e("products", "quality", "Uma sequência de 7 dias sem venda pode ser ruptura: o produto não é penalizado.", "Exige lacunas maiores para suspeitar de ruptura.", "Suspeita de ruptura com lacunas menores.", { formula: "maior sequência de dias sem venda no período" }),
  "products.motorPercentile": e("products", "analytic", ...classCut("os 20% que mais contribuem em margem (R$).", "Menos produtos viram motor de resultado.", "Mais produtos viram motor de resultado."), { formula: "percentil da contribuição de margem (R$) entre os produtos do escopo" }),
  "products.lowReturnContribMax": e("products", "analytic", ...classCut("contribuição abaixo do 25º percentil.", "Mais produtos candidatos a baixo retorno.", "Menos candidatos a baixo retorno."), { formula: "percentil da contribuição de margem entre os produtos do escopo" }),
  "products.lowReturnQtyMax": e("products", "analytic", ...classCut("volume abaixo da mediana, junto com contribuição baixa.", "Mais candidatos a baixo retorno.", "Menos candidatos a baixo retorno."), { formula: "percentil de unidades vendidas entre os produtos do escopo" }),
  "products.volumeQtyMin": e("products", "analytic", ...classCut("volume ou receita a partir do 60º percentil.", "Menos produtos contam como de alto volume.", "Mais produtos contam como de alto volume."), { formula: "percentil de unidades ou de receita entre os produtos do escopo" }),
  "products.volumeContribMax": e("products", "analytic", ...classCut("contribuição abaixo do 40º percentil apesar do volume.", "Mais produtos viram “volume sem retorno”.", "Menos produtos viram “volume sem retorno”."), { formula: "percentil da contribuição de margem entre os produtos do escopo" }),
  "products.starMin": e("products", "analytic", ...classCut("volume, margem % e contribuição a partir da mediana.", "Menos estrelas.", "Mais estrelas."), { formula: "percentis de unidades, margem % e contribuição entre os produtos do escopo" }),
  "products.potentialQtyMax": e("products", "analytic", ...classCut("pouco volume com margem alta pode ser pouca exposição. É sempre estimativa, com confiança no máximo Baixa.", "Mais candidatos a potencial subexplorado.", "Menos candidatos a potencial subexplorado."), { formula: "percentil de unidades vendidas entre os produtos do escopo" }),
  "products.potentialMarginMin": e("products", "analytic", ...classCut("margem % ou margem por unidade a partir do 60º percentil.", "Menos candidatos a potencial subexplorado.", "Mais candidatos a potencial subexplorado."), { formula: "percentil de margem % ou de margem por unidade entre os produtos do escopo" }),

  /* --------------------------------- peers ------------------------------ */
  "peers.count": e("peers", "analytic", "Três lojas parecidas dão um benchmark sem depender de uma só.", "Benchmark mais estável, menos parecido.", "Benchmark mais parecido, menos estável.", { formula: "as N lojas com maior similaridade (1 − distância de Hellinger) que passam nos filtros de porte" }),
  "peers.minBaskets": e("peers", "quality", "Uma loja com menos de 100 compras não tem padrão de demanda estável para comparar.", "Menos lojas elegíveis a parecidas.", "Mais lojas elegíveis, com padrão instável.", { formula: "compras da loja no período" }),
  "peers.scaleRatioMin": e("peers", "analytic", "Lojas de porte muito diferente não são comparáveis.", "Exige lojas de porte mais próximo.", "Aceita lojas bem menores.", { formula: "compras da candidata ÷ compras da loja" }),
  "peers.scaleRatioMax": e("peers", "analytic", "Lojas de porte muito diferente não são comparáveis.", "Aceita lojas bem maiores.", "Exige lojas de porte mais próximo.", { formula: "compras da candidata ÷ compras da loja" }),
  "peers.minForBenchmark": e("peers", "quality", "Com menos de duas parecidas volta-se à referência da rede, dita como secundária.", "Mais lojas caem na referência da rede.", "Benchmark com uma parecida só.", { formula: "lojas parecidas elegíveis" }),
  "peers.ticketGapPct": e("peers", "analytic", "Uma diferença de 15% no ticket já é relevante para a operação.", "Aponta menos lacunas de ticket.", "Aponta mais lacunas, algumas pequenas.", { formula: "|ticket da loja − ticket das parecidas| ÷ ticket das parecidas" }),
  "peers.gapT": e("peers", "analytic", "|t| ≥ 2 corresponde a cerca de 95% de confiança na diferença de ticket.", "Mais exigente: menos lacunas passam.", "Menos exigente: mais ruído passa.", { formula: "t de Welch entre os tickets da loja e das parecidas" }),

  /* -------------------------------- impact ------------------------------ */
  "impact.scenarioConservative": e("impact", "analytic", "Cenário prudente: recupera só um quinto da diferença observada. É premissa de potencial, não medida.", "Impacto conservador maior; prioridades sobem.", "Impacto conservador menor.", { formula: "impacto conservador (R$/mês) = premissa × diferença observada (R$/mês)" }),
  "impact.scenarioExpected": e("impact", "analytic", "Ponto médio entre os cenários; é o que decide a prioridade. Premissa, não medida.", "Impacto esperado maior; prioridades sobem.", "Impacto esperado menor; prioridades descem.", { formula: "impacto esperado (R$/mês) = premissa × diferença observada (R$/mês)" }),
  "impact.scenarioOptimistic": e("impact", "analytic", "Teto plausível de uma ação leve. Premissa, não medida nem garantida.", "Faixa de potencial mais larga.", "Faixa de potencial mais estreita.", { formula: "impacto otimista (R$/mês) = premissa × diferença observada (R$/mês)" }),
  "impact.highShareOfMargin": e("impact", "analytic", "1% da margem mensal do escopo já muda o resultado de forma perceptível.", "Menos oportunidades de prioridade alta.", "Mais oportunidades de prioridade alta.", { formula: "impacto esperado ÷ margem mensal do escopo ≥ limite" }),
  "impact.mediumShareOfMargin": e("impact", "analytic", "0,3% da margem mensal é o piso de uma oportunidade que merece acompanhamento.", "Menos oportunidades de prioridade média.", "Mais oportunidades de prioridade média.", { formula: "impacto esperado ÷ margem mensal do escopo ≥ limite" }),
  "impact.minMonthlyCents": e("impact", "business", "Abaixo de R$ 30 por mês, uma ação não merece prioridade média nem alta, qualquer que seja a parcela.", "Exige impacto mínimo maior para priorizar.", "Prioriza ações menores.", { formula: "impacto esperado ≥ este valor para prioridade média ou alta" }),
  "impact.floorMonthlyCents": e("impact", "business", "Abaixo de R$ 10 por mês o ganho estimado não vale a atenção e a oportunidade nem é listada.", "Lista menos oportunidades.", "Lista oportunidades menores.", { formula: "impacto esperado < este valor: a oportunidade é descartada" }),
  "impact.mainScreenItems": e("impact", "business", "A tela principal deve responder “onde vale minha atenção agora?”: poucas oportunidades, o resto sob demanda.", "Mais itens na tela principal: mais dispersão de atenção.", "Menos itens: foco no essencial.", { formula: "n primeiras oportunidades pelo ranking (impacto, confiança, esforço e risco)" }),
  "impact.maxItems": e("impact", "analytic", "Teto técnico da lista completa; não define quantas aparecem na tela principal.", "A lista completa cresce.", "A lista completa é cortada mais cedo.", { formula: "n oportunidades da lista completa" }),
  "impact.maxPerDetector": e("impact", "analytic", "Evita que um único tipo de detector domine a lista completa.", "Um tipo pode ocupar mais da lista.", "A lista fica mais variada.", { formula: "oportunidades por tipo de detector" }),
  "impact.maxPerStore": e("impact", "analytic", "Limita quantos desvios de uma mesma loja entram na visão de rede.", "Mais desvios por loja.", "Menos desvios por loja.", { formula: "desvios por loja na visão de rede" }),

  /* ------------------------------- simulator ---------------------------- */
  "simulator.minMarginPct": e("simulator", "business", "30%, abaixo da margem bruta da rede (cerca de 50%): só barra combos que comem a maior parte da margem.", "Permite descontos menores: combos mais protegidos.", "Permite descontos maiores: mais risco de margem.", { formula: "margem do combo com o preço proposto ÷ preço proposto ≥ este valor", usedIn: "Simulador de combo e classificação promocional (grupos 6 e 7, em espera)" }),
  "simulator.observedPriceWindowDays": e("simulator", "analytic", "O preço do simulador é a moda dos últimos dias do período, que reflete o preço praticado hoje.", "Janela mais longa: mais observações, preço menos atual.", "Janela mais curta: preço mais atual, menos observações.", { formula: "moda de valor original ÷ quantidade nos últimos N dias do período" }),
  "simulator.observedPriceMinObservations": e("simulator", "quality", "Com poucas observações na janela a moda não é confiável e usa-se o período inteiro.", "Mais casos usam o período inteiro.", "Aceita a moda com poucas observações.", { formula: "linhas do produto dentro da janela" }),
  "simulator.listPriceDivergence": e("simulator", "analytic", "Um preço de cadastro a mais de 5% do observado merece um aviso ao lado do simulador.", "Avisa menos vezes.", "Avisa mais vezes.", { formula: "|preço de cadastro − preço observado| ÷ preço observado" }),

  /* --------------------------------- loss ------------------------------- */
  "loss.dominantShare": e("loss", "analytic", "Um motivo que responde por metade da perda do produto define o texto da causa.", "Menos textos de causa dominante.", "Mais textos de causa dominante.", { formula: "valor perdido pelo motivo ÷ valor perdido total do produto" }),
  "loss.sellThroughLow": e("loss", "analytic", "Perda por validade com giro abaixo de 60% aponta excesso de abastecimento.", "Mais casos lidos como excesso de abastecimento.", "Menos casos lidos como excesso de abastecimento.", { formula: "unidades vendidas ÷ unidades abastecidas" }),
  "loss.sellThroughHigh": e("loss", "analytic", "Um produto que gira bem e ainda perde tem perda operacional, não problema de mix.", "Menos casos lidos como perda operacional.", "Mais casos lidos como perda operacional.", { formula: "unidades vendidas ÷ unidades abastecidas" }),

  /* ------------------------------ confidence ---------------------------- */
  "confidence.highMin": e("confidence", "analytic", "70 dos 100 pontos possíveis: exige evidência forte em quase todos os fatores. Régua de MVP, a recalibrar com o desempenho das recomendações.", "Menos recomendações com confiança Alta.", "Mais recomendações com confiança Alta.", { formula: "100 × pontos ganhos ÷ pontos possíveis dos fatores aplicáveis" }),
  "confidence.mediumMin": e("confidence", "analytic", "45 dos 100 pontos: o piso de uma recomendação que vale validar. Régua de MVP.", "Mais recomendações com confiança Baixa.", "Mais recomendações com confiança Média.", { formula: "100 × pontos ganhos ÷ pontos possíveis dos fatores aplicáveis" }),
  "confidence.daysFull": e("confidence", "analytic", "Um mês quase inteiro de vendas dá a pontuação cheia de dias com venda.", "Exige mais dias para a pontuação cheia.", "A pontuação cheia vem com menos dias.", { formula: "dias do período com ao menos uma venda" }),
  "confidence.daysMid": e("confidence", "analytic", "Duas semanas de vendas dão pontuação parcial.", "Exige mais dias para a pontuação parcial.", "A pontuação parcial vem com menos dias.", { formula: "dias do período com ao menos uma venda" }),
  "confidence.daysMin": e("confidence", "quality", "Com menos de uma semana de vendas a confiança é no máximo Baixa.", "Mais recomendações ficam com teto Baixa.", "Menos recomendações ficam com teto Baixa.", { formula: "dias do período com ao menos uma venda" }),
  "confidence.evidencePairMid": e("confidence", "analytic", "Patamar de compras conjuntas que rende a pontuação intermediária de evidência.", "Exige mais compras conjuntas para a pontuação intermediária.", "A pontuação intermediária vem com menos compras.", { formula: "cestas com A e B" }),
  "confidence.evidencePairHigh": e("confidence", "analytic", "Patamar de compras conjuntas que rende a pontuação máxima de evidência.", "Exige mais compras conjuntas para a pontuação máxima.", "A pontuação máxima vem com menos compras.", { formula: "cestas com A e B" }),
  "confidence.evidenceAnchorMid": e("confidence", "analytic", "Patamar de cestas com a âncora que rende a pontuação intermediária de evidência.", "Exige mais cestas âncora para a pontuação intermediária.", "A pontuação intermediária vem com menos cestas.", { formula: "cestas com ao menos um item da categoria âncora" }),
  "confidence.evidenceAnchorHigh": e("confidence", "analytic", "Patamar de cestas com a âncora que rende a pontuação máxima de evidência.", "Exige mais cestas âncora para a pontuação máxima.", "A pontuação máxima vem com menos cestas.", { formula: "cestas com ao menos um item da categoria âncora" }),
  "confidence.evidenceUnitsMid": e("confidence", "analytic", "Patamar de unidades vendidas que rende a pontuação intermediária de evidência de produto.", "Exige mais unidades para a pontuação intermediária.", "A pontuação intermediária vem com menos unidades.", { formula: "unidades vendidas do produto no escopo" }),
  "confidence.evidenceUnitsHigh": e("confidence", "analytic", "Patamar de unidades vendidas que rende a pontuação máxima de evidência de produto.", "Exige mais unidades para a pontuação máxima.", "A pontuação máxima vem com menos unidades.", { formula: "unidades vendidas do produto no escopo" }),
  "confidence.couponCoverageMid": e("confidence", "analytic", "Cobertura de 90% rende dois terços da pontuação de cupom (a cheia usa a cobertura que libera a rede).", "Exige mais cobertura para a pontuação intermediária.", "A pontuação intermediária vem com menos cobertura.", { formula: "linhas OK com cupom ÷ linhas OK, no escopo da recomendação" }),
  "confidence.costHigh": e("confidence", "quality", "Com 95% dos produtos envolvidos com custo resolvido a afirmação de margem é sólida.", "Exige mais custo resolvido para pontuar alto.", "Pontua alto com menos custo resolvido.", { formula: "produtos envolvidos com custo resolvido ÷ produtos envolvidos" }),
  "confidence.costMid": e("confidence", "quality", "Abaixo de 80% de custo resolvido as afirmações de margem são retidas.", "Retém afirmações de margem com mais frequência.", "Retém afirmações de margem com menos frequência.", { formula: "produtos envolvidos com custo resolvido ÷ produtos envolvidos" }),
  "confidence.reconciliationFlaggedStoreShare": e("confidence", "quality", "Se 20% ou mais dos produtos de uma loja estão sinalizados, até um produto limpo merece menos pontos.", "Tolera mais produtos sinalizados na loja.", "Reduz pontos com menos produtos sinalizados.", { formula: "produtos vendidos sinalizados na reconciliação da loja ÷ produtos vendidos da loja" }),
  "confidence.storeMinBaskets": e("confidence", "quality", "Uma loja com menos de 100 compras tem confiança no máximo Baixa.", "Mais lojas com teto Baixa.", "Menos lojas com teto Baixa.", { formula: "compras da loja no período" }),
  "confidence.scopeMinOkLines": e("confidence", "quality", "Um escopo com menos de 200 linhas concluídas não sustenta nenhuma recomendação.", "Mais escopos sem recomendação.", "Aceita escopos menores.", { formula: "linhas concluídas do escopo no período" }),

  /* ------------------------------- quality ------------------------------ */
  "quality.catalogSparseCategoryShare": e("quality", "quality", "Uma categoria com menos de 5% dos produtos vendidos é apontada como pouco usada no catálogo.", "Aponta mais categorias como pouco usadas.", "Aponta menos categorias.", { formula: "produtos vendidos da categoria ÷ produtos vendidos" }),
  "quality.unresolvedCostRevenueShareAttention": e("quality", "quality", "Produtos sem custo pesando 5% da receita já distorcem a margem: o aviso deixa de ser só informativo.", "O aviso vira “atenção” só com mais receita sem custo.", "O aviso vira “atenção” com menos receita sem custo.", { formula: "receita dos produtos sem custo resolvido ÷ receita do escopo" }),
  "quality.historyMonthsFull": e("quality", "quality", "Com três meses há alguma estabilidade entre meses; com menos, a comparação tem ressalva.", "Exige mais meses para histórico completo.", "Histórico completo com menos meses.", { formula: "meses com detalhe por transação carregados" }),
  "quality.datedLinesFull": e("quality", "quality", "Com 95% das linhas com horário legível a leitura por horário é confiável.", "Exige mais linhas datadas para disponibilidade plena.", "Disponibilidade plena com mais linhas sem horário.", { formula: "linhas com horário legível ÷ linhas OK" }),
  "quality.datedLinesMin": e("quality", "quality", "Abaixo de 80% das linhas com horário legível a leitura por horário engana.", "Mais casos de “Dados insuficientes” para horário.", "Aceita mais linhas sem horário.", { formula: "linhas com horário legível ÷ linhas OK" }),
  "quality.eligibleSkuRevenueFull": e("quality", "quality", "Se 80% da receita vem de produtos com amostra mínima, a classificação cobre o que importa.", "Exige mais receita com amostra para disponibilidade plena.", "Disponibilidade plena com menos receita com amostra.", { formula: "receita dos produtos com unidades e dias com venda mínimos ÷ receita do escopo" }),
  "quality.eligibleSkuRevenueMin": e("quality", "quality", "Abaixo de metade da receita com amostra mínima a classificação de produtos engana.", "Mais casos de “Dados insuficientes” para retorno de produtos.", "Aceita classificar com menos receita coberta.", { formula: "receita dos produtos com unidades e dias com venda mínimos ÷ receita do escopo" }),
};

/** Every parameter path by kind: the interface groups, and the checks count, from here. */
export const PARAMETER_KINDS: Record<ParameterKind, ParameterPath[]> = { business: [], quality: [], analytic: [] };
for (const [path, extra] of Object.entries(PARAMETER_EXTRA) as [ParameterPath, ParameterExtra][]) PARAMETER_KINDS[extra.kind].push(path);

export function parameterKind(path: ParameterPath): ParameterKind {
  return PARAMETER_EXTRA[path].kind;
}

export const KIND_LABELS: Record<ParameterKind, { title: string; description: string }> = {
  business: {
    title: "Regras de negócio",
    description: "Decisões da empresa, com um único valor para toda a operação. Não são ajustes de navegador.",
  },
  quality: {
    title: "Critérios de qualidade dos dados",
    description: "Decidem se há dados suficientes para cada análise. Na experiência principal aparecem como indicadores e bloqueios, não como configurações.",
  },
  analytic: {
    title: "Modelo analítico",
    description: "Como associação, tendência, similaridade, confiança e oportunidade são calculadas. Calibração interna.",
  },
};
