import type { Confidence, LossAction, LossIntelligenceResult } from "@/lib/loss-intelligence/types";
import type { LossIntelligenceParameters } from "@/lib/loss-intelligence/parameters";
import { resolveAnalysisWindow } from "@/lib/loss-intelligence/temporal";
import type { Product } from "@/lib/api/products";
import type { Store } from "@/lib/api/stores";
import type { StoreMonthSales } from "@/lib/api/sales";
import type { StoreMonthSupply } from "@/lib/api/supply";
import type { PerStoreMonthlyTotal } from "@/lib/api/finance";
import { buildStoreSkuSeries } from "../series";
import { computeTrend } from "../trend";
import type { LossSignal, RestockAction, RestockRecommendation, StoreSkuParametrizacao } from "../types";
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
  parametrizacaoFor: (storeId: number, sku: string) => StoreSkuParametrizacao | null;
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

    const parametrizacao = input.parametrizacaoFor(series.storeId, series.sku);
    const totalAbastecido = series.meses.reduce((sum, m) => sum + m.abastecido, 0);
    const totalVendido = series.meses.reduce((sum, m) => sum + m.vendido, 0);
    const aproveitamento = totalAbastecido > 0 ? totalVendido / totalAbastecido : null;

    const deltaFor = (quantidade: number): number | null =>
      parametrizacao?.nivelDePar != null ? quantidade - parametrizacao.nivelDePar : null;

    // Tier 1 (hard-stop): HARD_STOP_ACTIONS always win, regardless of evidence
    if (sinalPerdas && HARD_STOP_ACTIONS.includes(sinalPerdas.acao)) {
      recommendations.push({
        sku: series.sku, storeId: series.storeId, categoria: product.category, vendasUltimoMes, historicoMensal: series.meses,
        ultimoAbastecimento, mesesComVenda, mesesAnalisados, tendencia: "indeterminada", faixaEstimada: { min: 0, max: 0 },
        sinalPerdas, quantidadeSugeridaIA: 0, acao: "nao_abastecer",
        motivo: `Recomendação ativa da Inteligência de Perdas: ${LOSS_ACTION_LABEL[sinalPerdas.acao]}.`,
        confianca: sinalPerdas.confianca, limitacoes: sinalPerdas.limitacoesDosDados, versaoMotor: RESTOCK_LOGIC_VERSION, versaoParametros: "provisional",
        parametrizacao, deltaVsParametrizado: deltaFor(0), aproveitamento,
      });
      continue;
    }

    // Tier 2 (reduce): reduzir_abastecimento always wins, but needs trend (safe to compute even with sparse data)
    if (sinalPerdas?.acao === "reduzir_abastecimento") {
      const trend = computeTrend(qtySeries, input.restockParameters.trend);
      const factor = input.restockParameters.lossIntegration.reduceFactor;
      const quantidadeReduzida = Math.round(trend.estimativaCentral * factor);
      recommendations.push({
        sku: series.sku, storeId: series.storeId, categoria: product.category, vendasUltimoMes, historicoMensal: series.meses,
        ultimoAbastecimento, mesesComVenda, mesesAnalisados, tendencia: trend.tendencia,
        faixaEstimada: { min: Math.round(trend.faixaEstimada.min * factor), max: Math.round(trend.faixaEstimada.max * factor) },
        sinalPerdas, quantidadeSugeridaIA: quantidadeReduzida, acao: "reduzir",
        motivo: `Recomendação ativa da Inteligência de Perdas: ${LOSS_ACTION_LABEL.reduzir_abastecimento}.`,
        confianca: sinalPerdas.confianca, limitacoes: sinalPerdas.limitacoesDosDados, versaoMotor: RESTOCK_LOGIC_VERSION, versaoParametros: "provisional",
        parametrizacao, deltaVsParametrizado: deltaFor(quantidadeReduzida), aproveitamento,
      });
      continue;
    }

    // Evidence gate: tiers 3 and 4 depend on sufficient data
    if (mesesComVenda < input.restockParameters.evidence.minMonthsWithSales) {
      recommendations.push({
        sku: series.sku, storeId: series.storeId, categoria: product.category, vendasUltimoMes, historicoMensal: series.meses,
        ultimoAbastecimento, mesesComVenda, mesesAnalisados, tendencia: "indeterminada", faixaEstimada: { min: 0, max: 0 },
        sinalPerdas, quantidadeSugeridaIA: 0, acao: "dados_insuficientes",
        motivo: `Evidência insuficiente: apenas ${mesesComVenda} ${mesesComVenda === 1 ? "mês" : "meses"} com venda nos últimos ${mesesAnalisados}.`,
        confianca: "insuficiente", limitacoes: sinalPerdas?.limitacoesDosDados ?? [], versaoMotor: RESTOCK_LOGIC_VERSION, versaoParametros: "provisional",
        parametrizacao, deltaVsParametrizado: deltaFor(0), aproveitamento,
      });
      continue;
    }

    // Tier 3 and 4: normal formula logic
    const trend = computeTrend(qtySeries, input.restockParameters.trend);
    const reconciliacaoLimpa = !sinalPerdas || sinalPerdas.limitacoesDosDados.length === 0;

    let quantidadeSugeridaIA = trend.estimativaCentral;
    const faixaEstimada = trend.faixaEstimada;
    const motivo = `${vendasUltimoMes} vendidos no último mês analisado, tendência ${TREND_LABEL[trend.tendencia]} nos últimos ${mesesAnalisados} meses.`;
    let confianca: Confidence;
    const limitacoes = [...(sinalPerdas?.limitacoesDosDados ?? [])];

    confianca = computeRestockConfidence({ mesesComVenda, mesesAnalisados, tendencia: trend.tendencia, reconciliacaoLimpa }, input.restockParameters);
    if (sinalPerdas && CAVEAT_ACTIONS.includes(sinalPerdas.acao)) {
      limitacoes.push("Este produto está sob avaliação da Inteligência de Perdas — decisão estrutural pendente.");
      if (confianca === "alta") confianca = "media";
    }

    // Arredondamento nunca sempre pra cima: sem dado de embalagem ainda, pende
    // para o piso da faixa quando há sinal de risco de sobra/perda, em vez de
    // sempre usar o centro da estimativa.
    const shortShelfLife = product.shelf_life_days != null && product.shelf_life_days <= input.restockParameters.rounding.shortShelfLifeDays;
    const lowAproveitamento = aproveitamento != null && aproveitamento < input.restockParameters.rounding.lowAproveitamentoThreshold;
    const lowConfidence = confianca === "baixa" || confianca === "insuficiente";
    if (shortShelfLife || lowAproveitamento || lowConfidence) {
      const leaned = Math.round(faixaEstimada.min + (faixaEstimada.max - faixaEstimada.min) * input.restockParameters.rounding.leanToMinFraction);
      quantidadeSugeridaIA = Math.min(quantidadeSugeridaIA, leaned);
    }

    const acao = determineAction(quantidadeSugeridaIA, ultimoAbastecimento, input.restockParameters.action);

    recommendations.push({
      sku: series.sku, storeId: series.storeId, categoria: product.category, vendasUltimoMes, historicoMensal: series.meses,
      ultimoAbastecimento, mesesComVenda, mesesAnalisados, tendencia: trend.tendencia, faixaEstimada, sinalPerdas,
      quantidadeSugeridaIA, acao, motivo, confianca, limitacoes, versaoMotor: RESTOCK_LOGIC_VERSION, versaoParametros: "provisional",
      parametrizacao, deltaVsParametrizado: deltaFor(quantidadeSugeridaIA), aproveitamento,
    });
  }

  return recommendations;
}
