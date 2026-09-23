import type { InterventionPotential, LossAction, NetworkComparison, PerReasonMetrics, Period, ReasonDiagnosis } from "../types";
import type { LossIntelligenceParameters } from "../parameters";
import { deriveEscopoProblemaFromNetworkComparison } from "../network-comparison";

/**
 * true quando perda economicamente relevante (razão perda/margem) E recorrência em períodos
 * fechados JÁ estão presentes juntas — usado por engine.ts como `hasBadSignal` na passe 1 de
 * network-comparison.ts (Task 7). Continua sendo só 2 dos 3 sinais que agora decidem a AÇÃO
 * (adenda 2026-09-23 §B): de propósito, a agregação de rede pergunta "quantas lojas mostram este
 * padrão objetivamente?", não "esta loja tem histórico suficiente pra eu confiar nisso sozinha?" —
 * histórico curto reduz a confiança de agir NESTA loja, mas não invalida o número que ela reporta
 * quando comparada com as outras (mesmo raciocínio já documentado antes desta mudança).
 */
export function isOtherReasonSevereSignal(input: { lossToMarginRatio: number | null; recurrencePeriodsWithLoss: Period[]; parameters: LossIntelligenceParameters }): boolean {
  return (
    input.lossToMarginRatio !== null &&
    input.lossToMarginRatio >= input.parameters.otherReason.viabilityMaxRatio &&
    input.recurrencePeriodsWithLoss.length >= input.parameters.otherReason.minRecurringPeriods
  );
}

export interface OtherReasonDiagnosisInput {
  /** byReason.other_reason da janela principal. Assume-se qtyLost > 0. */
  metrics: PerReasonMetrics;
  qtySold: number;
  grossMarginCents: number | null;
  recurrencePeriodsWithLoss: Period[];
  /** null quando não há lojas suficientes para calcular concentração (mesmo piso de network.minStoresForNetworkVerdict). */
  concentrationShareStore: number | null;
  /** null na passe 1; resolvido na passe 2, só usado quando isOtherReasonSevereSignal já é true. */
  networkComparison: NetworkComparison | null;
  firstSeenRecently: boolean;
  overwhelmingEvidence: boolean;
  parameters: LossIntelligenceParameters;
}

export function diagnoseOtherReason(input: OtherReasonDiagnosisInput): ReasonDiagnosis {
  const p = input.parameters.otherReason;
  const { metrics, qtySold, grossMarginCents, recurrencePeriodsWithLoss } = input;
  const isRecurrent = recurrencePeriodsWithLoss.length >= 2;

  if (metrics.valueLostCents < p.negligibleValueCents) {
    return {
      reason: "other_reason", metrics, sinaisDetectados: ["OTHER_REASON_NEGLIGIBLE"], regrasAcionadas: ["OTHER_REASON_NEGLIGIBLE"],
      acao: "manter", potencialIntervencao: "baixo", hipoteses: [], escopoProblema: "indeterminado",
    };
  }

  if (grossMarginCents === null) {
    return {
      reason: "other_reason", metrics, sinaisDetectados: ["OTHER_REASON_MARGIN_UNKNOWN"], regrasAcionadas: ["OTHER_REASON_MARGIN_UNKNOWN"],
      acao: "dados_insuficientes", potencialIntervencao: null, hipoteses: [], escopoProblema: "indeterminado",
    };
  }

  // isSevere = perda economicamente relevante E recorrente em períodos fechados — já uma
  // combinação de 2 sinais, não 1 threshold isolado. Continua sendo a base do "bad signal" pra
  // rede (função acima), mas deixou de ser suficiente sozinha pra ação estrutural: adenda
  // 2026-09-23 §B soma um 3º sinal (histórico suficiente) antes de liberar avaliar_permanencia_*.
  const isSevere = isOtherReasonSevereSignal({ lossToMarginRatio: metrics.lossToMarginRatio, recurrencePeriodsWithLoss, parameters: input.parameters });
  const sufficientHistory = !input.firstSeenRecently || input.overwhelmingEvidence;
  const isHealthy = qtySold >= p.minHealthyUnits && grossMarginCents > 0 && metrics.lossToMarginRatio !== null && metrics.lossToMarginRatio < p.viabilityMaxRatio;
  const isConcentrated = input.concentrationShareStore !== null && input.concentrationShareStore >= p.localConcentrationMin;

  let action: LossAction;
  let potencialIntervencao: InterventionPotential;
  let signals: string[];

  if (isSevere) {
    signals = ["OTHER_REASON_SEVERE_RECURRING"];

    // Reaproveita deliberadamente validity.networkWideMinShare — não existe um 6º parâmetro
    // otherReason.networkWideMinShare na spec aprovada (§14 lista só 5 para este namespace);
    // a spec pede "a mesma comparação de rede do §12... igual aos casos D/E de validade".
    // Calculado ANTES do teto de histórico: mesmo capado, o texto documenta se o padrão já era
    // de rede — o teto muda a AÇÃO, nunca apaga o que o dado mostrou.
    const isNetworkWide =
      input.networkComparison !== null &&
      input.networkComparison !== "dado_insuficiente" &&
      input.networkComparison.affectedShare >= input.parameters.validity.networkWideMinShare;
    if (isNetworkWide) signals = [...signals, "OTHER_REASON_NETWORK_WIDE"];

    if (sufficientHistory) {
      // Nível 2 (pedido do operador §B): perda relevante + recorrência em períodos fechados +
      // histórico suficiente, as 3 juntas — nunca a razão financeira isolada. "Permanência",
      // nunca "retirada": a causa continua desconhecida mesmo quando o impacto é severo (§10.2).
      action = isNetworkWide ? "avaliar_permanencia_rede" : "avaliar_permanencia_loja";
      potencialIntervencao = "alto";
    } else {
      // Os 2 sinais financeiro+recorrência já bateriam o nível 2, mas o histórico ainda é curto
      // demais para tratar isso como padrão estabelecido (§9) — fica em Investigar até o
      // histórico crescer (ou a evidência ficar esmagadora o bastante pra `overwhelmingEvidence`
      // liberar o ramo acima), nunca pula direto pra avaliar permanência só por caixa curto de
      // tempo. Mantém os sinais nativos (não troca por um genérico) — descrevem com precisão o
      // que de fato já bateu; CAPPED_RECENT_HISTORY documenta por que não escalou mesmo assim.
      action = "investigar";
      potencialIntervencao = "medio";
      signals = [...signals, "CAPPED_RECENT_HISTORY"];
    }
  } else if (isHealthy && !isRecurrent && !isConcentrated) {
    action = "manter_monitorar";
    potencialIntervencao = "baixo";
    signals = ["OTHER_REASON_HEALTHY_ISOLATED"];
  } else if (isRecurrent || isConcentrated) {
    // Nível 1: perda relevante por recorrência OU concentração, mas sem a combinação completa do
    // nível 2 — causa ainda desconhecida, evidência não fecha pra uma decisão estrutural.
    action = "investigar";
    potencialIntervencao = "medio";
    signals = ["OTHER_REASON_RECURRING_OR_CONCENTRATED"];
  } else {
    return {
      reason: "other_reason", metrics, sinaisDetectados: ["INSUFFICIENT_EVIDENCE"], regrasAcionadas: ["INSUFFICIENT_EVIDENCE"],
      acao: "dados_insuficientes", potencialIntervencao: null, hipoteses: [], escopoProblema: "indeterminado",
    };
  }

  const escopoProblema = input.networkComparison
    ? deriveEscopoProblemaFromNetworkComparison(input.networkComparison, input.parameters.validity)
    : "indeterminado";

  return { reason: "other_reason", metrics, sinaisDetectados: signals, regrasAcionadas: signals, acao: action, potencialIntervencao, hipoteses: [], escopoProblema };
}
