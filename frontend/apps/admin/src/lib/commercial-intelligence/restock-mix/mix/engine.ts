import type { Confidence, LossIntelligenceResult } from "@/lib/loss-intelligence/types";
import type { LossIntelligenceParameters } from "@/lib/loss-intelligence/parameters";
import { resolveAnalysisWindow } from "@/lib/loss-intelligence/temporal";
import type { Product } from "@/lib/api/products";
import type { Store } from "@/lib/api/stores";
import type { StoreMonthSales } from "@/lib/api/sales";
import type { StoreMonthSupply } from "@/lib/api/supply";
import type { PerStoreMonthlyTotal } from "@/lib/api/finance";
import { buildStoreSkuSeries } from "../series";
import { computeTrend } from "../trend";
import type { LossSignal, MixClassification, MixOpportunity, MixRecommendation, StoreSkuSeries, Trend } from "../types";
import { computeMixConfidence, computeOpportunityConfidence } from "./confidence";
import { MIX_LOGIC_VERSION } from "./logic-version";
import type { MixParameters } from "./parameters";

export interface MixEngineInput {
  stores: Store[];
  products: Product[];
  salesByStoreMonth: StoreMonthSales[];
  supplyByStoreMonth: StoreMonthSupply[];
  reconciliationByStoreMonth: PerStoreMonthlyTotal[];
  lossResult: LossIntelligenceResult;
  today: string;
  lossParameters: LossIntelligenceParameters;
  mixParameters: MixParameters;
  costsBySkuAsOf: (sku: string) => number | null;
}

const RETIRADA_ACTIONS = new Set(["avaliar_retirada_loja", "avaliar_retirada_rede", "avaliar_permanencia_loja", "avaliar_permanencia_rede"]);
const LOSS_ACTION_LABEL: Record<string, string> = {
  suspender_abastecimento: "suspender abastecimento", avaliar_retirada_loja: "avaliar retirada da loja", avaliar_retirada_rede: "avaliar retirada da rede",
  avaliar_permanencia_loja: "avaliar permanência na loja", avaliar_permanencia_rede: "avaliar permanência na rede", reduzir_abastecimento: "reduzir abastecimento",
};

function lossSignalFor(result: LossIntelligenceResult, storeId: number, sku: string): LossSignal | null {
  const rec = result.recommendations.find((r) => r.storeId === storeId && r.sku === sku);
  if (!rec) return null;
  const diagnosis = rec.motivoDiagnosticoPrioritario ? rec.diagnosticosPorMotivo.find((d) => d.reason === rec.motivoDiagnosticoPrioritario) : undefined;
  return { acao: rec.acaoPrioritaria, prioridade: rec.prioridade, confianca: rec.confianca, escopoProblema: diagnosis?.escopoProblema ?? "indeterminado", limitacoesDosDados: rec.limitacoesDosDados };
}

function buildSeries(input: MixEngineInput): StoreSkuSeries[] {
  const window = resolveAnalysisWindow({ storeId: 0, sku: "", today: input.today, allKnownRestockPeriods: [], parameters: input.lossParameters });
  return buildStoreSkuSeries(input.stores, input.salesByStoreMonth, input.supplyByStoreMonth, input.reconciliationByStoreMonth, window.recurrenceLookbackPeriods);
}

/** Participação do SKU na loja ÷ participação na rede, sobre a mesma série mensal confiável usada em todo o motor (nunca SalesTransaction — ver nota do Task 10). */
function computeNetworkAffinity(seriesList: StoreSkuSeries[], storeId: number, sku: string): number {
  let storeRevenue = 0, storeTotalRevenue = 0, networkRevenue = 0, networkTotalRevenue = 0;
  for (const s of seriesList) {
    const revenue = s.meses.reduce((sum, m) => sum + m.receitaCents, 0);
    networkTotalRevenue += revenue;
    if (s.sku === sku) networkRevenue += revenue;
    if (s.storeId === storeId) {
      storeTotalRevenue += revenue;
      if (s.sku === sku) storeRevenue += revenue;
    }
  }
  const storeShare = storeTotalRevenue > 0 ? storeRevenue / storeTotalRevenue : 0;
  const networkShare = networkTotalRevenue > 0 ? networkRevenue / networkTotalRevenue : 0;
  return networkShare > 0 ? storeShare / networkShare : storeShare > 0 ? Infinity : 0;
}

function computeMarginPct(series: StoreSkuSeries, costsBySkuAsOf: (sku: string) => number | null): number | null {
  const cost = costsBySkuAsOf(series.sku);
  if (cost === null) return null;
  const totalRevenue = series.meses.reduce((sum, m) => sum + m.receitaCents, 0);
  const totalSold = series.meses.reduce((sum, m) => sum + m.vendido, 0);
  if (totalRevenue === 0) return null;
  return (totalRevenue - cost * totalSold) / totalRevenue;
}

function pushRecommendation(
  list: MixRecommendation[],
  series: StoreSkuSeries,
  product: Product,
  fields: { classificacao: MixClassification; evidencia: string; confianca: Confidence; sinalPerdas: LossSignal | null; limitacoes: string[]; tendencia: Trend; affinity: number | null; margemPct: number | null },
) {
  list.push({
    sku: series.sku, storeId: series.storeId, categoria: product.category, classificacao: fields.classificacao, evidencia: fields.evidencia,
    tendencia: fields.tendencia, affinity: fields.affinity, margemPct: fields.margemPct, sinalPerdas: fields.sinalPerdas, confianca: fields.confianca,
    limitacoes: fields.limitacoes, versaoMotor: MIX_LOGIC_VERSION, versaoParametros: "provisional",
  });
}

export function computeMixRecommendations(input: MixEngineInput): MixRecommendation[] {
  const productBySku = new Map(input.products.map((p) => [p.sku, p]));
  const seriesList = buildSeries(input);
  const recommendations: MixRecommendation[] = [];

  for (const series of seriesList) {
    const product = productBySku.get(series.sku);
    if (!product) continue;

    const sinalPerdas = lossSignalFor(input.lossResult, series.storeId, series.sku);
    const limitacoes = [...(sinalPerdas?.limitacoesDosDados ?? [])];

    if (sinalPerdas?.acao === "suspender_abastecimento") {
      pushRecommendation(recommendations, series, product, { classificacao: "suspender_abastecimento", evidencia: `Recomendação ativa da Inteligência de Perdas: ${LOSS_ACTION_LABEL.suspender_abastecimento}.`, confianca: sinalPerdas.confianca, sinalPerdas, limitacoes, tendencia: "indeterminada", affinity: null, margemPct: null });
      continue;
    }
    if (sinalPerdas && RETIRADA_ACTIONS.has(sinalPerdas.acao)) {
      pushRecommendation(recommendations, series, product, { classificacao: "avaliar_retirada", evidencia: `Recomendação ativa da Inteligência de Perdas: ${LOSS_ACTION_LABEL[sinalPerdas.acao]}.`, confianca: sinalPerdas.confianca, sinalPerdas, limitacoes, tendencia: "indeterminada", affinity: null, margemPct: null });
      continue;
    }
    if (sinalPerdas?.acao === "reduzir_abastecimento") {
      pushRecommendation(recommendations, series, product, { classificacao: "reduzir", evidencia: `Recomendação ativa da Inteligência de Perdas: ${LOSS_ACTION_LABEL.reduzir_abastecimento}.`, confianca: sinalPerdas.confianca, sinalPerdas, limitacoes, tendencia: "indeterminada", affinity: null, margemPct: null });
      continue;
    }

    const qtySeries = series.meses.map((m) => m.vendido);
    const mesesComVenda = qtySeries.filter((q) => q > 0).length;

    if (mesesComVenda < input.mixParameters.evidence.minMonthsWithSales) {
      pushRecommendation(recommendations, series, product, { classificacao: "dados_insuficientes", evidencia: `Evidência insuficiente: apenas ${mesesComVenda} ${mesesComVenda === 1 ? "mês" : "meses"} com venda.`, confianca: "insuficiente", sinalPerdas, limitacoes, tendencia: "indeterminada", affinity: null, margemPct: null });
      continue;
    }

    const trend = computeTrend(qtySeries, input.mixParameters.trend);
    const affinity = computeNetworkAffinity(seriesList, series.storeId, series.sku);
    const margemPct = computeMarginPct(series, input.costsBySkuAsOf);
    const marginHealthy = margemPct !== null && margemPct >= input.mixParameters.classification.marginHealthyMinPct;
    const reconciliacaoLimpa = !sinalPerdas || sinalPerdas.limitacoesDosDados.length === 0;

    let classificacao: MixClassification;
    let evidencia: string;
    if (trend.tendencia === "crescendo" && affinity >= input.mixParameters.classification.affinityExploreMin && marginHealthy) {
      classificacao = "explorar";
      evidencia = "Tendência de crescimento, participação acima da esperada pela rede, margem saudável.";
    } else if (trend.tendencia === "caindo" || affinity < input.mixParameters.classification.affinityHealthyMin) {
      classificacao = "reduzir";
      evidencia = trend.tendencia === "caindo" ? "Tendência de queda nas vendas." : "Participação abaixo do esperado pela rede.";
    } else {
      classificacao = "manter";
      evidencia = "Sem sinal de crescimento nem de queda — presença estável.";
    }

    let confianca = computeMixConfidence({ mesesComVenda, mesesAnalisados: series.meses.length, tendencia: trend.tendencia, reconciliacaoLimpa }, input.mixParameters);
    if (sinalPerdas?.acao === "investigar") {
      limitacoes.push("Este produto está sob investigação da Inteligência de Perdas.");
      if (confianca === "alta") confianca = "media";
    }

    pushRecommendation(recommendations, series, product, { classificacao, evidencia, confianca, sinalPerdas, limitacoes, tendencia: trend.tendencia, affinity, margemPct });
  }

  return recommendations;
}

export function computeMixOpportunities(input: MixEngineInput): MixOpportunity[] {
  const productBySku = new Map(input.products.map((p) => [p.sku, p]));
  const seriesList = buildSeries(input);

  const presentByStore = new Map<number, Set<string>>();
  const allSkus = new Set<string>();
  for (const s of seriesList) {
    allSkus.add(s.sku);
    if (!presentByStore.has(s.storeId)) presentByStore.set(s.storeId, new Set());
    presentByStore.get(s.storeId)!.add(s.sku);
  }

  const opportunities: MixOpportunity[] = [];
  for (const store of input.stores) {
    const present = presentByStore.get(store.id) ?? new Set<string>();
    for (const sku of allSkus) {
      if (present.has(sku) || !productBySku.has(sku)) continue;

      let storesComBomDesempenho = 0;
      for (const s of seriesList) {
        if (s.sku !== sku || s.storeId === store.id) continue;
        const qtySeries = s.meses.map((m) => m.vendido);
        if (qtySeries.filter((q) => q > 0).length < input.mixParameters.evidence.minMonthsWithSales) continue;
        const trend = computeTrend(qtySeries, input.mixParameters.trend);
        const margemPct = computeMarginPct(s, input.costsBySkuAsOf);
        const marginHealthy = margemPct !== null && margemPct >= input.mixParameters.classification.marginHealthyMinPct;
        if (trend.tendencia !== "caindo" && marginHealthy) storesComBomDesempenho++;
      }

      if (storesComBomDesempenho >= input.mixParameters.opportunity.minNetworkStores) {
        opportunities.push({
          sku, storeId: store.id, origem: "rede_inteira", evidencia: `Bom desempenho em ${storesComBomDesempenho} lojas da rede.`,
          quantidadeTeste: input.mixParameters.opportunity.testQuantity, confianca: computeOpportunityConfidence(storesComBomDesempenho, input.mixParameters),
          versaoMotor: MIX_LOGIC_VERSION, versaoParametros: "provisional",
        });
      }
    }
  }

  return opportunities;
}
