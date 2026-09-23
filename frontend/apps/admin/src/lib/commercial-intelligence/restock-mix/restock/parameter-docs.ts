export type ParameterKind = "business" | "quality" | "analytic";
export type ParameterUnit = "share" | "months" | "number";

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
    why: "Menos de 2 meses com venda não sustenta uma quantidade sugerida — vira dados insuficientes.",
    controls: "Gate de entrada do motor (§6 passo 1) — abaixo disso, ação vira dados_insuficientes.",
    up: "Mais SKUs caem em dados insuficientes.",
    down: "Menos exigente para sugerir uma quantidade.",
    min: 1,
    max: 6,
    integer: true,
  }),
  "trend.recentMonthsCount": d({
    label: "Quantos meses contam como 'recentes'",
    kind: "analytic",
    unit: "months",
    why: "3 dos 6 meses da janela pesarem mais equilibra reagir ao presente sem esquecer o histórico.",
    controls: "Quantos meses do fim da série recebem o peso maior na média ponderada (§6 passo 2).",
    up: "Menos meses pesam mais — motor reage mais rápido a mudanças recentes.",
    down: "Mais meses pesam igual — motor mais estável, mais lento para reagir.",
    min: 1,
    max: 6,
    integer: true,
  }),
  "trend.recentWeightMultiplier": d({
    label: "Quanto mais pesam os meses recentes",
    kind: "analytic",
    unit: "number",
    why: "Peso 2x é o corte inicial de julgamento entre 'ignorar o passado' e 'não dar nenhuma prioridade ao presente'.",
    controls: "Multiplicador de peso dos meses recentes na média ponderada (§6 passo 2).",
    up: "Meses recentes dominam ainda mais a estimativa.",
    down: "Estimativa se aproxima de uma média simples de todo o histórico.",
    min: 1,
    max: 5,
    integer: false,
  }),
  "trend.upThresholdPct": d({
    label: "Corte para considerar 'crescendo'",
    kind: "analytic",
    unit: "share",
    why: "20% de alta entre as duas metades recentes é o piso de julgamento para chamar de tendência, não ruído de mês a mês.",
    controls: "Compara os últimos 2 meses com os 2 anteriores (§6 passo 4).",
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
    controls: "Compara os últimos 2 meses com os 2 anteriores (§6 passo 4).",
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
    why: "Decisão de negócio: quanto a sugestão sobe/desce quando o motor já confirmou uma direção clara.",
    controls: "Nudge sobre a estimativa central quando tendência é crescendo/caindo (§6 passo 4).",
    up: "Sugestão reage mais forte à tendência detectada.",
    down: "Sugestão fica mais próxima da média histórica, mesmo com tendência clara.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "trend.volatilityThreshold": d({
    label: "Corte de volatilidade",
    kind: "analytic",
    unit: "share",
    why: "Coeficiente de variação acima de 40% indica série instável demais para uma leitura de tendência confiável.",
    controls: "Sobrepõe a tendência para 'volátil' e alarga a faixa estimada (§6 passo 4).",
    up: "Menos séries são classificadas como voláteis.",
    down: "Mais séries são classificadas como voláteis, com faixa mais larga e confiança capada.",
    min: 0,
    max: 2,
    integer: false,
  }),
  "action.increaseThresholdPct": d({
    label: "Corte para sugerir 'aumentar'",
    kind: "analytic",
    unit: "share",
    why: "15% acima do último abastecimento é o piso de julgamento para recomendar aumentar, não só oscilação normal.",
    controls: "Compara quantidadeSugeridaIA com o último abastecimento (§6 passo 6).",
    up: "Mais difícil sugerir aumentar.",
    down: "Mais fácil sugerir aumentar.",
    min: 0,
    max: 2,
    integer: false,
  }),
  "action.decreaseThresholdPct": d({
    label: "Corte para sugerir 'reduzir'",
    kind: "analytic",
    unit: "share",
    why: "Mesmo raciocínio do corte de aumentar, para o lado da redução.",
    controls: "Compara quantidadeSugeridaIA com o último abastecimento (§6 passo 6).",
    up: "Mais difícil sugerir reduzir.",
    down: "Mais fácil sugerir reduzir.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "lossIntegration.reduceFactor": d({
    label: "Fator de corte quando a Inteligência de Perdas já sinaliza reduzir",
    kind: "business",
    unit: "share",
    why: "Decisão de negócio: quando o Loss Intelligence já decidiu reduzir_abastecimento, a quantidade cai pela metade em vez de zerar — o produto continua vendendo, só menos.",
    controls: "Precedência do Loss Intelligence sobre a fórmula própria (§4, §6 passo 5).",
    up: "Corta menos a quantidade quando há sinal de perdas para reduzir.",
    down: "Corta mais a quantidade quando há sinal de perdas para reduzir.",
    min: 0,
    max: 1,
    integer: false,
  }),
  "confidence.highMin": d({
    label: "Pontuação mínima para confiança Alta",
    kind: "quality",
    unit: "number",
    why: "70 de 100 pontos possíveis é o piso de julgamento para confiar bastante na quantidade sugerida.",
    controls: "Corte Alta vs Média na régua de confiança (Task 4).",
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
    why: "40 de 100 pontos possíveis separa 'alguma evidência' de 'evidência fraca demais'.",
    controls: "Corte Média vs Baixa na régua de confiança (Task 4).",
    up: "Mais exigente para confiança Média — mais casos caem em Baixa.",
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
  quality: { title: "Critérios de qualidade dos dados", description: "Decidem se há evidência suficiente para uma sugestão — nunca um ajuste de negócio." },
  analytic: { title: "Modelo analítico", description: "Como o motor de Abastecimento calcula tendência, faixa e ação." },
};

export const PARAMETER_GROUP_LABELS: Record<string, string> = {
  evidence: "Evidência mínima",
  trend: "Tendência",
  action: "Ação operacional",
  lossIntegration: "Integração com a Inteligência de Perdas",
  confidence: "Confiança",
};
