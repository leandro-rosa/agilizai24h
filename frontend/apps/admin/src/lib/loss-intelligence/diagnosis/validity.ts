import type { InterventionPotential, LossAction, NetworkComparison, PerReasonMetrics, Period, ReasonDiagnosis } from "../types";
import type { LossIntelligenceParameters } from "../parameters";
import { clampSeverity } from "../severity";

export interface ValidityDiagnosisInput {
  /** byReason.expired da janela principal. Assume-se qtyLost > 0 — engine.ts só chama esta função quando houver perda de validade no período. */
  metrics: PerReasonMetrics;
  qtySold: number;
  saleToSupplyRatio: number | null;
  monthsWithRestock: number;
  /** Períodos do lookback de recorrência (§8) com perda de validade — de recurrence.ts, filtrado por reason="expired". */
  recurrencePeriodsWithLoss: Period[];
  /** null na passe 1 (rede ainda não calculada); resolvido na passe 2. */
  networkComparison: NetworkComparison | null;
  firstSeenRecently: boolean;
  overwhelmingEvidence: boolean;
  parameters: LossIntelligenceParameters;
}

/** true quando o diagnóstico local (sem escalada de rede) caiu no "lado ruim" — usado por engine.ts para alimentar network-comparison.ts (Task 7) com `hasBadSignal`. */
export function isValidityBadSignal(action: LossAction): boolean {
  return action === "suspender_abastecimento" || action === "reduzir_abastecimento";
}

export function diagnoseValidity(input: ValidityDiagnosisInput): ReasonDiagnosis {
  const p = input.parameters.validity;
  const { metrics, qtySold, saleToSupplyRatio, monthsWithRestock, recurrencePeriodsWithLoss } = input;
  const isRecurrent = recurrencePeriodsWithLoss.length >= 2;
  const isIsolated = recurrencePeriodsWithLoss.length <= 1;

  let action: LossAction;
  let potencialIntervencao: InterventionPotential | null;
  let signals: string[];

  if (qtySold === 0 && monthsWithRestock >= p.minRepeatedSupplyMonths) {
    action = "suspender_abastecimento";
    potencialIntervencao = "alto";
    signals = ["ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS"];
  } else if (qtySold > 0 && saleToSupplyRatio !== null && saleToSupplyRatio < p.lowSaleRatio && isRecurrent) {
    action = "reduzir_abastecimento";
    potencialIntervencao = "alto";
    signals = ["LOW_SALE_RATIO_RECURRING_EXPIRY"];
  } else if (saleToSupplyRatio !== null && saleToSupplyRatio >= p.lowSaleRatio && isIsolated) {
    action = "manter_monitorar";
    potencialIntervencao = "baixo";
    signals = ["HEALTHY_SALE_RATIO_ISOLATED_EXPIRY"];
  } else {
    return { reason: "expired", metrics, sinaisDetectados: ["INSUFFICIENT_EVIDENCE"], regrasAcionadas: ["INSUFFICIENT_EVIDENCE"], acao: "dados_insuficientes", potencialIntervencao: null, hipoteses: [] };
  }

  // Escalada por rede (casos D/E) — só na passe 2, e só refina suspender/reduzir.
  if (input.networkComparison && input.networkComparison !== "dado_insuficiente" && (action === "suspender_abastecimento" || action === "reduzir_abastecimento")) {
    const nc = input.networkComparison;
    if (nc.affectedShare <= p.localOutlierMaxShare) {
      action = "avaliar_retirada_loja";
      potencialIntervencao = "alto";
      signals = [...signals, "LOCAL_OUTLIER_VS_HEALTHY_NETWORK"];
    } else if (nc.affectedShare >= p.networkWideMinShare) {
      action = "avaliar_retirada_rede";
      potencialIntervencao = "alto";
      signals = [...signals, "NETWORK_WIDE_LOW_PERFORMANCE_EXPIRY"];
    }
  }

  // Teto de histórico recente (spec §9) — nunca mais severo que "reduzir_abastecimento" nesta condição, salvo evidência esmagadora.
  if (input.firstSeenRecently && !input.overwhelmingEvidence) {
    const capped = clampSeverity(action, "reduzir_abastecimento");
    if (capped !== action) signals = [...signals, "CAPPED_RECENT_HISTORY"];
    action = capped;
  }

  return { reason: "expired", metrics, sinaisDetectados: signals, regrasAcionadas: signals, acao: action, potencialIntervencao, hipoteses: [] };
}
