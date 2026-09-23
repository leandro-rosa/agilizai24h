export type ParameterKind = "business" | "quality" | "analytic";
export type ParameterUnit = "share" | "months" | "number" | "count";

export interface ParameterDoc {
  label: string;
  kind: ParameterKind;
  unit: ParameterUnit;
  why: string;
  controls: string;
  up: string;
  down: string;
  min: number;
  max: number;
  integer: boolean;
}

const d = (doc: ParameterDoc): ParameterDoc => doc;

export const PARAMETER_DOCS = {
  "evidence.minMonthsWithSales": d({
    label: "Meses mínimos com venda",
    kind: "quality",
    unit: "months",
    why: "Menos de 2 meses com venda não sustenta uma classificação de mix — vira dados insuficientes.",
    controls: "Gate de entrada do motor (§7) — abaixo disso, classificação vira dados_insuficientes.",
    up: "Mais SKUs caem em dados insuficientes.",
    down: "Menos exigente para classificar.",
    min: 1,
    max: 6,
    integer: true,
  }),
  "trend.recentMonthsCount": d({
    label: "Quantos meses contam como 'recentes'",
    kind: "analytic",
    unit: "months",
    why: "Mesmo piso de julgamento do motor de Abastecimento (Task 2/3) — 3 dos 6 meses da janela pesarem mais.",
    controls: "Quantos meses do fim da série recebem o peso maior na tendência usada pela classificação (§7).",
    up: "Menos meses pesam mais — classificação reage mais rápido a mudanças recentes.",
    down: "Mais meses pesam igual — classificação mais estável.",
    min: 1,
    max: 6,
    integer: true,
  }),
  "trend.recentWeightMultiplier": d({
    label: "Quanto mais pesam os meses recentes",
    kind: "analytic",
    unit: "number",
    why: "Mesmo piso de julgamento do motor de Abastecimento — peso 2x.",
    controls: "Multiplicador de peso dos meses recentes na tendência usada pela classificação (§7).",
    up: "Meses recentes dominam ainda mais a leitura de tendência.",
    down: "Tendência se aproxima de uma média simples de todo o histórico.",
    min: 1,
    max: 5,
    integer: false,
  }),
  "trend.upThresholdPct": d({
    label: "Corte para considerar 'crescendo'",
    kind: "analytic",
    unit: "share",
    why: "Mesmo piso de julgamento do motor de Abastecimento — 20% de alta entre as duas metades recentes.",
    controls: "Compara os últimos 2 meses com os 2 anteriores para a classificação (§7).",
    up: "Mais difícil classificar como crescendo.",
    down: "Mais fácil classificar como crescendo.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "trend.downThresholdPct": d({
    label: "Corte para considerar 'caindo'",
    kind: "analytic",
    unit: "share",
    why: "Mesmo raciocínio do corte de alta, para o lado da queda.",
    controls: "Compara os últimos 2 meses com os 2 anteriores para a classificação (§7).",
    up: "Mais difícil classificar como caindo.",
    down: "Mais fácil classificar como caindo.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "trend.adjustPct": d({
    label: "Ajuste aplicado quando há tendência",
    kind: "business",
    unit: "share",
    why: "Mesmo piso de julgamento do motor de Abastecimento — não muda a classificação de Mix diretamente, mantido para as duas árvores usarem a mesma fórmula de tendência sem depender uma da outra.",
    controls: "Parte da fórmula de tendência compartilhada (Task 2), recalculada aqui com parâmetros próprios do Mix.",
    up: "N/A para classificação de Mix — afeta só a estimativa central interna do cálculo de tendência.",
    down: "N/A para classificação de Mix.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "trend.volatilityThreshold": d({
    label: "Corte de volatilidade",
    kind: "analytic",
    unit: "share",
    why: "Mesmo piso de julgamento do motor de Abastecimento — coeficiente de variação acima de 40%.",
    controls: "Sobrepõe a tendência para 'volátil' — a classificação cai em 'manter' cauteloso com confiança capada (§7).",
    up: "Menos séries são classificadas como voláteis.",
    down: "Mais séries são classificadas como voláteis.",
    min: 0,
    max: 2,
    integer: false,
  }),
  "classification.affinityExploreMin": d({
    label: "Afinidade mínima para 'explorar'",
    kind: "analytic",
    unit: "number",
    why: "1.2x a participação esperada na rede é o piso de julgamento para considerar o produto proporcionalmente mais importante nesta loja do que na média.",
    controls: "Combinado com tendência crescendo e margem saudável define 'explorar' (§7).",
    up: "Mais difícil classificar como explorar.",
    down: "Mais fácil classificar como explorar.",
    min: 1,
    max: 5,
    integer: false,
  }),
  "classification.affinityHealthyMin": d({
    label: "Afinidade mínima para 'saudável'",
    kind: "analytic",
    unit: "number",
    why: "Abaixo de 0.8x a participação esperada na rede, o produto já vende proporcionalmente menos aqui do que deveria.",
    controls: "Abaixo disso, entra como sinal de 'reduzir' junto com tendência caindo (§7).",
    up: "Mais produtos classificados como abaixo do esperado.",
    down: "Menos produtos classificados como abaixo do esperado.",
    min: 0,
    max: 2,
    integer: false,
  }),
  "classification.marginHealthyMinPct": d({
    label: "Margem mínima saudável",
    kind: "business",
    unit: "share",
    why: "Decisão de negócio: 15% de margem sobre a receita é o piso inicial de julgamento para considerar o produto rentável o suficiente para manter/explorar.",
    controls: "Uma das 3 condições de 'explorar'/'manter' em §7.",
    up: "Mais exigente — menos produtos contam como margem saudável.",
    down: "Menos exigente.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "opportunity.minNetworkStores": d({
    label: "Mínimo de lojas com bom desempenho para virar candidato",
    kind: "quality",
    unit: "count",
    why: "5 lojas com bom desempenho é o piso de julgamento para considerar um SKU ausente como candidato de mix, mesmo sem comparação por loja parecida (spec §8, v1 sem esse recorte).",
    controls: "Gate de `computeMixOpportunities` (§8).",
    up: "Menos SKUs viram candidatos a oportunidade.",
    down: "Mais SKUs viram candidatos, com evidência mais fraca cada um.",
    min: 1,
    max: 50,
    integer: true,
  }),
  "opportunity.testQuantity": d({
    label: "Quantidade de teste sugerida",
    kind: "business",
    unit: "count",
    why: "Decisão de negócio: 4 unidades é o tamanho de teste inicial — pequeno o bastante para não arriscar capital, grande o bastante para gerar sinal de venda.",
    controls: "Quantidade sugerida em toda `MixOpportunity` (§8).",
    up: "Testes maiores, mais capital em risco por produto testado.",
    down: "Testes menores, sinal de venda mais fraco.",
    min: 1,
    max: 50,
    integer: true,
  }),
  "confidence.highMin": d({
    label: "Pontuação mínima para confiança Alta",
    kind: "quality",
    unit: "number",
    why: "Mesmo piso de julgamento do motor de Abastecimento (Task 4) — 70 de 100 pontos possíveis.",
    controls: "Corte Alta vs Média na régua de confiança (Task 9). Nunca se aplica a oportunidades de novo mix — essas nunca chegam a 'alta' (decisão do operador, spec §8).",
    up: "Mais exigente para confiança Alta.",
    down: "Menos exigente.",
    min: 0,
    max: 100,
    integer: true,
  }),
  "confidence.mediumMin": d({
    label: "Pontuação mínima para confiança Média",
    kind: "quality",
    unit: "number",
    why: "Mesmo piso de julgamento do motor de Abastecimento (Task 4) — 40 de 100 pontos possíveis.",
    controls: "Corte Média vs Baixa na régua de confiança (Task 9).",
    up: "Mais exigente para confiança Média.",
    down: "Menos exigente.",
    min: 0,
    max: 100,
    integer: true,
  }),
} as const;

export type ParameterPath = keyof typeof PARAMETER_DOCS;
export const PARAMETER_PATHS = Object.keys(PARAMETER_DOCS) as ParameterPath[];

export const PARAMETER_KINDS: Record<ParameterKind, ParameterPath[]> = {
  business: PARAMETER_PATHS.filter((p) => PARAMETER_DOCS[p].kind === "business"),
  quality: PARAMETER_PATHS.filter((p) => PARAMETER_DOCS[p].kind === "quality"),
  analytic: PARAMETER_PATHS.filter((p) => PARAMETER_DOCS[p].kind === "analytic"),
};

export const KIND_LABELS: Record<ParameterKind, { title: string; description: string }> = {
  business: { title: "Regras de negócio", description: "Decisões da empresa — poucas, editáveis pelo gestor quando o registro oficial existir." },
  quality: { title: "Critérios de qualidade dos dados", description: "Decidem se há evidência suficiente para uma classificação — nunca um ajuste de negócio." },
  analytic: { title: "Modelo analítico", description: "Como o motor de Mix classifica presença e identifica oportunidades." },
};

export const PARAMETER_GROUP_LABELS: Record<string, string> = {
  evidence: "Evidência mínima",
  trend: "Tendência",
  classification: "Classificação",
  opportunity: "Oportunidades de novo mix",
  confidence: "Confiança",
};
