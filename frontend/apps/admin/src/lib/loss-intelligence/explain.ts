import type { LossAction, LossIntelligenceRecommendation, LossReason } from "./types";

const REASON_LABELS: Record<LossReason, string> = { expired: "validade", damaged_product: "danificado", other_reason: "Outro motivo" };

const ACTION_LABELS: Record<LossAction, string> = {
  manter: "Manter",
  manter_monitorar: "Manter e monitorar",
  reduzir_abastecimento: "Reduzir abastecimento",
  investigar: "Investigar",
  suspender_abastecimento: "Suspender novos abastecimentos",
  avaliar_retirada_loja: "Avaliar retirada da loja",
  avaliar_retirada_rede: "Avaliar retirada da rede",
  avaliar_permanencia_loja: "Avaliar permanência na loja",
  avaliar_permanencia_rede: "Avaliar permanência na rede",
  dados_insuficientes: "Dados insuficientes",
};

/**
 * Template determinístico — nunca um LLM (spec §15.4/§21). Só usa campos já
 * presentes em `recommendation`; nunca inventa um número.
 */
export function explainRecommendation(recommendation: LossIntelligenceRecommendation): string {
  const r = recommendation;
  const prioritario = r.diagnosticosPorMotivo.find((d) => d.reason === r.motivoDiagnosticoPrioritario);

  if (!prioritario || !r.motivoDiagnosticoPrioritario) {
    return "Evidência insuficiente para uma leitura detalhada neste período.";
  }

  const motivoLabel = REASON_LABELS[r.motivoDiagnosticoPrioritario];
  const factsSentence = `${r.metricasObservadas.qtyRestocked} abastecidos, ${r.metricasObservadas.qtySold} vendidos, ${prioritario.metrics.qtyLost} perdidos por ${motivoLabel} em ${r.metricasObservadas.monthsWithRestock} meses com abastecimento nos últimos ${r.janelaAnalisada.primaryMonths.length} meses.`;

  const nc = r.comparacaoRede[r.motivoDiagnosticoPrioritario];
  const networkSentence =
    nc && nc !== "dado_insuficiente"
      ? nc.storesHealthy.length > 0
        ? `O SKU tem desempenho saudável em ${nc.storesHealthy.length} outras lojas.`
        : `O padrão se repete em ${nc.storesWithSameSignal} de ${nc.storesCarryingSku} lojas comparáveis.`
      : null;

  const recommendationSentence = `${ACTION_LABELS[r.acaoPrioritaria]}.`;

  return [factsSentence, networkSentence, recommendationSentence].filter((sentence): sentence is string => sentence !== null).join(" ");
}
