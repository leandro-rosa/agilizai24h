/**
 * Contratos do motor de Loss Intelligence (Fase 1). Ver
 * docs/superpowers/specs/2026-09-21-loss-intelligence-agent-phase-1-design.md
 * §6, §7, §13 — este arquivo é a tradução literal dessas seções para TypeScript.
 */

export type Period = string; // "YYYY-MM"

export type LossReason = "expired" | "damaged_product" | "other_reason";

export const LOSS_REASONS: LossReason[] = ["expired", "damaged_product", "other_reason"];

export type LossAction =
  | "manter"
  | "manter_monitorar"
  | "reduzir_abastecimento"
  | "investigar"
  | "suspender_abastecimento"
  | "avaliar_retirada_loja"
  | "avaliar_retirada_rede"
  | "avaliar_permanencia_loja"
  | "avaliar_permanencia_rede"
  | "dados_insuficientes";

/** Ordem de severidade, da mais para a menos grave — índice 0 é a mais severa. Espelha spec §11.2 passo 2. */
export const ACTION_SEVERITY_ORDER: LossAction[] = [
  "avaliar_retirada_rede",
  "avaliar_permanencia_rede",
  "avaliar_retirada_loja",
  "avaliar_permanencia_loja",
  "suspender_abastecimento",
  "reduzir_abastecimento",
  "investigar",
  "manter_monitorar",
  "manter",
  "dados_insuficientes",
];

export type InterventionPotential = "alto" | "medio" | "baixo";

/** Ordem para comparação ordinal — nunca numérica (spec §11.2). */
export const INTERVENTION_POTENTIAL_ORDER: InterventionPotential[] = ["alto", "medio", "baixo"];

export type Confidence = "alta" | "media" | "baixa" | "insuficiente";
export type Priority = "critica" | "alta" | "media" | "baixa";

// ---- Fontes de dado (formas mínimas que o motor precisa — a origem real, mais rica, é responsabilidade do caller) ----

export interface LossByReasonSkuRow {
  reason: string;
  sku: string;
  quantity: number;
  value_cents: number;
}

export interface ReconciliationInput {
  store_id: number;
  period: Period;
  loss_by_reason_sku: LossByReasonSkuRow[];
}

export interface SalesRecordInput {
  store_id: number;
  period: Period;
  sku: string;
  quantity_sold: number;
  revenue_cents: number;
}

export interface SupplyRecordInput {
  store_id: number;
  period: Period;
  sku: string;
  quantity_restocked: number;
}

export interface StoreInput {
  id: number;
  name: string;
}

// ---- Contrato de entrada (spec §6) ----

export interface LossIntelligenceInput {
  reconciliations: ReconciliationInput[];
  salesByStorePeriodSku: SalesRecordInput[];
  supplyByStorePeriodSku: SupplyRecordInput[];
  /** Custo datado — null quando o custo não é conhecido naquele período (nunca assumir zero). */
  costsBySkuAsOf: (sku: string, asOfPeriod: Period) => number | null;
  stores: StoreInput[];
  /** YYYY-MM-DD — decide qual período é "em andamento" (spec §8). */
  today: string;
  parameters: import("./parameters").LossIntelligenceParameters;
}

// ---- Métricas observadas (spec §7) ----

export interface PerReasonMetrics {
  qtyLost: number;
  valueLostCents: number;
  lossToSupplyRatio: number | null;
  lossToRevenueRatio: number | null;
  lossToMarginRatio: number | null;
}

export interface LossMetrics {
  qtyRestocked: number;
  qtySold: number;
  revenueCents: number;
  /** null = custo desconhecido para ao menos uma venda do período — nunca assume zero. */
  grossMarginCents: number | null;
  /** Só para exibição — nunca reentra como denominador de outra métrica (spec §7). */
  netMarginAfterLossCents: number | null;
  /** null quando qtyRestocked = 0 — indefinido, nunca chamado de "sell-through". */
  saleToSupplyRatio: number | null;
  monthsWithRestock: number;
  monthsWithSales: number;
  monthsAnalyzed: number;
  firstSeenPeriod: Period | null;
  monthsSinceFirstSeen: number | null;
  byReason: Record<LossReason, PerReasonMetrics>;
}

// ---- Janela temporal (spec §8) ----

export interface AnalysisWindow {
  storeId: number;
  sku: string;
  /** Períodos fechados dentro da janela principal, do mais antigo ao mais recente. */
  primaryClosedPeriods: Period[];
  /** Igual a primaryClosedPeriods, exceto o mais recente — a não ser que esse seja o único abastecimento de todo o histórico (spec §8). */
  qualifyingRestockPeriods: Period[];
  /** Período em andamento, se existir dentro da janela — nunca decide uma ação estrutural sozinho. */
  currentInProgressPeriod: Period | null;
  /** Períodos fechados do lookback de recorrência (mais longo que a janela principal). */
  recurrenceLookbackPeriods: Period[];
}

// ---- Comparação com a rede (spec §12) ----

export interface NetworkComparisonResult {
  storesCarryingSku: number;
  storesWithSameSignal: number;
  affectedShare: number;
  storesHealthy: string[];
}

export type NetworkComparison = NetworkComparisonResult | "dado_insuficiente";

// ---- Diagnóstico por motivo (spec §10, §13) ----

export interface ReasonDiagnosis {
  reason: LossReason;
  metrics: PerReasonMetrics;
  sinaisDetectados: string[];
  regrasAcionadas: string[];
  acao: LossAction;
  /** null quando acao === "dados_insuficientes". Nunca uma fórmula cross-motivo (spec §11.2). */
  potencialIntervencao: InterventionPotential | null;
  /** Só quando a árvore gera hipótese não-afirmada (hoje só danificado, §10.3). */
  hipoteses: string[];
}

// ---- Saída consolidada (spec §11, §13) ----

export interface LossIntelligenceRecommendation {
  sku: string;
  storeId: number;
  janelaAnalisada: { primaryMonths: Period[]; recurrenceLookbackMonths: Period[] };

  metricasObservadas: LossMetrics;
  diagnosticosPorMotivo: ReasonDiagnosis[];

  /** Uma entrada por período do lookback de recorrência, do mais antigo ao mais recente — spec §15.3. */
  historico: { period: Period; qtyRestocked: number; qtySold: number; qtyLostByReason: Record<LossReason, number> }[];

  maiorImpactoFinanceiroMotivo: LossReason | null;
  maiorImpactoFinanceiroValueCents: number;

  motivoDiagnosticoPrioritario: LossReason | null;
  motivosSecundarios: LossReason[];

  acaoPrioritaria: LossAction;
  acoesSecundarias: LossAction[];

  sinaisTransversais: string[];

  prioridade: Priority | null; // null quando acaoPrioritaria === "dados_insuficientes"
  confianca: Confidence;

  comparacaoRede: Record<LossReason, NetworkComparison>;

  limitacoesDosDados: string[];
  firstSeenRecently: boolean;

  versaoMotor: string;
  versaoParametros: string;
}

export interface LossIntelligenceResult {
  recommendations: LossIntelligenceRecommendation[];
  /** Contagem por acaoPrioritaria — base do painel §15.1. */
  countsByAction: Record<LossAction, number>;
  impactEstimateCents: { conservative: number; expected: number; optimistic: number };
}
