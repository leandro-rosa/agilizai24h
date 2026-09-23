import type { Confidence, LossAction, LossIntelligenceParameters, LossIntelligenceResult } from "@/lib/loss-intelligence/types";
import { resolveAnalysisWindow } from "@/lib/loss-intelligence/temporal";
import type { Product } from "@/lib/api/products";
import type { Store } from "@/lib/api/stores";
import type { StoreMonthSales } from "@/lib/api/sales";
import type { StoreMonthSupply } from "@/lib/api/supply";
import type { PerStoreMonthlyTotal } from "@/lib/api/finance";
import { buildStoreSkuSeries } from "../series";
import { computeTrend } from "../trend";
import type { LossSignal, RestockAction, RestockRecommendation } from "../types";
import { computeRestockConfidence } from "./confidence";
import { RESTOCK_LOGIC_VERSION } from "./logic-version";
import type { RestockParameters } from "./parameters";

export interface RestockEngineInput {
  stores: Store[];
  products: Product[];
  salesByStoreMonth: StoreMonthSales[];
  supplyByStoreMonth: StoreMonthSupply[];
  reconciliationByStoreMonth: PerStoreMonthlyTotal[];
  lossResult: LossIntelligenceResult;
  /** YYYY-MM-DD — mesma janela do Loss Intelligence, resolvida por `resolveAnalysisWindow`. */
  today: string;
  lossParameters: LossIntelligenceParameters;
  restockParameters: RestockParameters;
}

const HARD_STOP_ACTIONS: LossAction[] = ["suspender_abastecimento", "avaliar_retirada_loja", "avaliar_retirada_rede"];
const CAVEAT_ACTIONS: LossAction[] = ["investigar", "avaliar_permanencia_loja", "avaliar_permanencia_rede"];

const LOSS_ACTION_LABEL: Partial<Record<LossAction, string>> = {
  suspender_abastecimento: "suspender abastecimento",
  avaliar_retirada_loja: "avaliar retirada da loja",
  avaliar_retirada_rede: "avaliar retirada da rede",
  reduzir_abastecimento: "reduzir abastecimento",
};

function lossSignalFor(result: LossIntelligenceResult, storeId: number, sku: string): LossSignal | null {
  const rec = result.recommendations.find((r) => r.storeId === storeId && r.sku === sku);
  if (!rec) return null;
  const diagnosis = rec.motivoDiagnosticoPrioritario ? rec.diagnosticosPorMotivo.find((d) => d.reason === rec.motivoDiagnosticoPrioritario) : undefined;
  return { acao: rec.acaoPrioritaria, prioridade: rec.prioridade, confianca: rec.confianca, escopoProblema: diagnosis?.escopoProblema ?? "indeterminado", limitacoesDosDados: rec.limitacoesDosDados };
}

function lastRestocked(meses: { abastecido: number }[]): number | null {
  for (let i = meses.length - 1; i >= 0; i--) if (meses[i].abastecido > 0) return meses[i].abastecido;
  return null;
}

function determineAction(quantidade: number, ultimoAbastecimento: number | null, parameters: RestockParameters["action"]): RestockAction {
  if (ultimoAbastecimento === null) return quantidade > 0 ? "manter" : "nao_abastecer";
  if (quantidade === 0) return "nao_abastecer";
  if (quantidade >= ultimoAbastecimento * (1 + parameters.increaseThresholdPct)) return "aumentar";
  if (quantidade <= ultimoAbastecimento * (1 - parameters.decreaseThresholdPct)) return "reduzir";
  return "manter";
}

const TREND_LABEL: Record<string, string> = { crescendo: "crescendo", estavel: "estável", caindo: "caindo", volatil: "volátil", indeterminada: "indeterminada" };

export function computeRestockRecommendations(input: RestockEngineInput): RestockRecommendation[] {
  const productBySku = new Map(input.products.map((p) => [p.sku, p]));
  const window = resolveAnalysisWindow({ storeId: 0, sku: "", today: input.today, allKnownRestockPeriods: [], parameters: input.lossParameters });
  const seriesList = buildStoreSkuSeries(input.stores, input.salesByStoreMonth, input.supplyByStoreMonth, input.reconciliationByStoreMonth, window.recurrenceLookbackPeriods);

  const recommendations: RestockRecommendation[] = [];

  for (const series of seriesList) {
    const product = productBySku.get(series.sku);
    if (!product) continue;

    const qtySeries = series.meses.map((m) => m.vendido);
    const mesesComVenda = qtySeries.filter((q) => q > 0).length;
    const mesesAnalisados = series.meses.length;
    const sinalPerdas = lossSignalFor(input.lossResult, series.storeId, series.sku);
    const vendasUltimoMes = qtySeries[qtySeries.length - 1] ?? 0;
    const ultimoAbastecimento = lastRestocked(series.meses);

    if (mesesComVenda < input.restockParameters.evidence.minMonthsWithSales) {
      recommendations.push({
        sku: series.sku, storeId: series.storeId, categoria: product.category, vendasUltimoMes, historicoMensal: series.meses,
        ultimoAbastecimento, mesesComVenda, mesesAnalisados, tendencia: "indeterminada", faixaEstimada: { min: 0, max: 0 },
        sinalPerdas, quantidadeSugeridaIA: 0, acao: "dados_insuficientes",
        motivo: `Evidência insuficiente: apenas ${mesesComVenda} ${mesesComVenda === 1 ? "mês" : "meses"} com venda nos últimos ${mesesAnalisados}.`,
        confianca: "insuficiente", limitacoes: sinalPerdas?.limitacoesDosDados ?? [], versaoMotor: RESTOCK_LOGIC_VERSION, versaoParametros: "provisional",
      });
      continue;
    }

    const trend = computeTrend(qtySeries, input.restockParameters.trend);
    const reconciliacaoLimpa = !sinalPerdas || sinalPerdas.limitacoesDosDados.length === 0;

    let quantidadeSugeridaIA = trend.estimativaCentral;
    let faixaEstimada = trend.faixaEstimada;
    let acao: RestockAction;
    let motivo: string;
    let confianca: Confidence;
    const limitacoes = [...(sinalPerdas?.limitacoesDosDados ?? [])];

    if (sinalPerdas && HARD_STOP_ACTIONS.includes(sinalPerdas.acao)) {
      quantidadeSugeridaIA = 0;
      faixaEstimada = { min: 0, max: 0 };
      acao = "nao_abastecer";
      confianca = sinalPerdas.confianca;
      motivo = `Recomendação ativa da Inteligência de Perdas: ${LOSS_ACTION_LABEL[sinalPerdas.acao]}.`;
    } else if (sinalPerdas?.acao === "reduzir_abastecimento") {
      const factor = input.restockParameters.lossIntegration.reduceFactor;
      quantidadeSugeridaIA = Math.round(trend.estimativaCentral * factor);
      faixaEstimada = { min: Math.round(trend.faixaEstimada.min * factor), max: Math.round(trend.faixaEstimada.max * factor) };
      acao = "reduzir";
      confianca = sinalPerdas.confianca;
      motivo = `Recomendação ativa da Inteligência de Perdas: ${LOSS_ACTION_LABEL.reduzir_abastecimento}.`;
    } else {
      acao = determineAction(quantidadeSugeridaIA, ultimoAbastecimento, input.restockParameters.action);
      motivo = `${vendasUltimoMes} vendidos no último mês analisado, tendência ${TREND_LABEL[trend.tendencia]} nos últimos ${mesesAnalisados} meses.`;
      confianca = computeRestockConfidence({ mesesComVenda, mesesAnalisados, tendencia: trend.tendencia, reconciliacaoLimpa }, input.restockParameters);
      if (sinalPerdas && CAVEAT_ACTIONS.includes(sinalPerdas.acao)) {
        limitacoes.push("Este produto está sob avaliação da Inteligência de Perdas — decisão estrutural pendente.");
        if (confianca === "alta") confianca = "media";
      }
    }

    recommendations.push({
      sku: series.sku, storeId: series.storeId, categoria: product.category, vendasUltimoMes, historicoMensal: series.meses,
      ultimoAbastecimento, mesesComVenda, mesesAnalisados, tendencia: trend.tendencia, faixaEstimada, sinalPerdas,
      quantidadeSugeridaIA, acao, motivo, confianca, limitacoes, versaoMotor: RESTOCK_LOGIC_VERSION, versaoParametros: "provisional",
    });
  }

  return recommendations;
}
