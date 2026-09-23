import type { InterventionPotential, LossAction, NetworkComparison, PerReasonMetrics, Period, ReasonDiagnosis } from "../types";
import type { LossIntelligenceParameters } from "../parameters";
import { clampSeverity } from "../severity";

/** true quando o critério "severo e recorrente" (spec §10.2) já está satisfeito, ANTES de decidir loja vs rede — usado por engine.ts como `hasBadSignal` na passe 1 de network-comparison.ts (Task 7). */
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
    return { reason: "other_reason", metrics, sinaisDetectados: ["OTHER_REASON_NEGLIGIBLE"], regrasAcionadas: ["OTHER_REASON_NEGLIGIBLE"], acao: "manter", potencialIntervencao: "baixo", hipoteses: [] };
  }

  if (grossMarginCents === null) {
    return { reason: "other_reason", metrics, sinaisDetectados: ["OTHER_REASON_MARGIN_UNKNOWN"], regrasAcionadas: ["OTHER_REASON_MARGIN_UNKNOWN"], acao: "dados_insuficientes", potencialIntervencao: null, hipoteses: [] };
  }

  const isSevere = isOtherReasonSevereSignal({ lossToMarginRatio: metrics.lossToMarginRatio, recurrencePeriodsWithLoss, parameters: input.parameters });

  let action: LossAction;
  let potencialIntervencao: InterventionPotential;
  let signals: string[];

  if (isSevere) {
    // "Permanência", nunca "retirada": a causa continua desconhecida mesmo quando o impacto é severo (regra obrigatória §10.2).
    action = "avaliar_permanencia_loja";
    potencialIntervencao = "alto";
    signals = ["OTHER_REASON_SEVERE_RECURRING"];

    // Reaproveita deliberadamente validity.networkWideMinShare — não existe um 6º parâmetro
    // otherReason.networkWideMinShare na spec aprovada (§14 lista só 5 para este namespace);
    // a spec pede "a mesma comparação de rede do §12... igual aos casos D/E de validade".
    if (input.networkComparison && input.networkComparison !== "dado_insuficiente" && input.networkComparison.affectedShare >= input.parameters.validity.networkWideMinShare) {
      action = "avaliar_permanencia_rede";
      signals = [...signals, "OTHER_REASON_NETWORK_WIDE"];
    }
  } else {
    const isHealthy = qtySold >= p.minHealthyUnits && grossMarginCents > 0 && metrics.lossToMarginRatio !== null && metrics.lossToMarginRatio < p.viabilityMaxRatio;
    const isConcentrated = input.concentrationShareStore !== null && input.concentrationShareStore >= p.localConcentrationMin;

    if (isHealthy && !isRecurrent && !isConcentrated) {
      action = "manter_monitorar";
      potencialIntervencao = "baixo";
      signals = ["OTHER_REASON_HEALTHY_ISOLATED"];
    } else if (isRecurrent || isConcentrated) {
      action = "investigar";
      potencialIntervencao = "medio";
      signals = ["OTHER_REASON_RECURRING_OR_CONCENTRATED"];
    } else {
      return { reason: "other_reason", metrics, sinaisDetectados: ["INSUFFICIENT_EVIDENCE"], regrasAcionadas: ["INSUFFICIENT_EVIDENCE"], acao: "dados_insuficientes", potencialIntervencao: null, hipoteses: [] };
    }
  }

  // Teto de histórico recente (spec §9). Deliberadamente diferente de validity.ts/damage.ts aqui:
  // quando o cap efetivamente rebaixa "avaliar_permanencia_*" (potencialIntervencao nativo "alto")
  // para "investigar", também rebaixamos potencialIntervencao para "medio" — o valor nativo de
  // "investigar" em TODO o resto deste arquivo (ramo isRecurrent || isConcentrated, linha acima).
  // Deixar "alto" stale aqui seria inconsistente com o próprio "investigar" deste arquivo, ao
  // contrário de validity.ts, onde o teto ("reduzir_abastecimento") já é nativamente "alto" e o
  // não-reatribuir é inofensivo por coincidência.
  if (input.firstSeenRecently && !input.overwhelmingEvidence) {
    const capped = clampSeverity(action, "investigar");
    if (capped !== action) {
      signals = [...signals, "CAPPED_RECENT_HISTORY"];
      potencialIntervencao = "medio";
    }
    action = capped;
  }

  return { reason: "other_reason", metrics, sinaisDetectados: signals, regrasAcionadas: signals, acao: action, potencialIntervencao, hipoteses: [] };
}
