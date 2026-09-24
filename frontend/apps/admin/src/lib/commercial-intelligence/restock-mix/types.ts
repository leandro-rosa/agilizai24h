import type { Confidence, EscopoProblema, LossAction, Priority } from "@/lib/loss-intelligence/types";
import type { Product } from "@/lib/api/products";

/**
 * `import type` só existe em tempo de compilação — este módulo continua sem
 * nenhuma dependência de runtime em fetch/React mesmo importando de
 * `lib/api/products` (mesma regra que já vale pro resto do motor puro).
 */
export type ProductCategory = Product["category"];

export type Trend = "crescendo" | "estavel" | "caindo" | "volatil" | "indeterminada";

export interface TrendResult {
  tendencia: Trend;
  estimativaCentral: number;
  faixaEstimada: { min: number; max: number };
}

/** Um mês da série loja×SKU — sempre um por período da janela, mesmo com tudo zero. */
export interface StoreSkuMonth {
  period: string;
  vendido: number;
  abastecido: number;
  perdido: number;
  receitaCents: number;
}

/** Série mensal de um SKU numa loja, do mês mais antigo ao mais recente da janela. */
export interface StoreSkuSeries {
  storeId: number;
  sku: string;
  meses: StoreSkuMonth[];
}

/** Leitura do Loss Intelligence já computado — nunca recalculada aqui (Global Constraint). */
export interface LossSignal {
  acao: LossAction;
  prioridade: Priority | null;
  confianca: Confidence;
  escopoProblema: EscopoProblema;
  limitacoesDosDados: string[];
}

/**
 * Parametrização atual de um Produto × Loja — sempre um fato observado ou
 * definido pelo operador, nunca inferido. `quantidadeAtual` é referência
 * apenas: nenhum motor deste arquivo a usa para calcular sugestão/faixa/delta
 * (Global Constraint, decisão do operador 2026-09-24).
 */
export interface StoreSkuParametrizacao {
  minimo: number | null;
  nivelDePar: number | null;
  quantidadeAtual: number | null;
  quantidadeAtualEm: string | null;
}

// ---- Abastecimento Inteligente ----

export type RestockAction = "aumentar" | "manter" | "reduzir" | "nao_abastecer" | "testar" | "dados_insuficientes";

export interface RestockRecommendation {
  sku: string;
  storeId: number;
  categoria: ProductCategory;
  vendasUltimoMes: number;
  historicoMensal: StoreSkuMonth[];
  ultimoAbastecimento: number | null;
  mesesComVenda: number;
  mesesAnalisados: number;
  tendencia: Trend;
  faixaEstimada: { min: number; max: number };
  sinalPerdas: LossSignal | null;
  quantidadeSugeridaIA: number;
  acao: RestockAction;
  motivo: string;
  confianca: Confidence;
  limitacoes: string[];
  versaoMotor: string;
  versaoParametros: string;
  parametrizacao: StoreSkuParametrizacao | null;
  /** quantidadeSugeridaIA − parametrizacao.nivelDePar; null quando nivelDePar não configurado. */
  deltaVsParametrizado: number | null;
  /** vendido ÷ abastecido somados na janela; null quando nada foi abastecido (nunca divide por zero). */
  aproveitamento: number | null;
}

// ---- Mix das Lojas ----

export type MixClassification = "manter" | "explorar" | "reduzir" | "suspender_abastecimento" | "avaliar_retirada" | "dados_insuficientes";

export interface MixRecommendation {
  sku: string;
  storeId: number;
  categoria: ProductCategory;
  classificacao: MixClassification;
  evidencia: string;
  tendencia: Trend;
  affinity: number | null;
  margemPct: number | null;
  sinalPerdas: LossSignal | null;
  confianca: Confidence;
  limitacoes: string[];
  versaoMotor: string;
  versaoParametros: string;
  historicoMensal: StoreSkuMonth[];
  parametrizacao: StoreSkuParametrizacao | null;
}

/** SKU ausente na loja, candidato por bom desempenho na rede (spec §8 — v1 sem "lojas parecidas"). */
export interface MixOpportunity {
  sku: string;
  storeId: number;
  origem: "rede_inteira";
  evidencia: string;
  quantidadeTeste: number;
  confianca: Confidence;
  versaoMotor: string;
  versaoParametros: string;
}
