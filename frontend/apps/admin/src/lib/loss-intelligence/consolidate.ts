import type { Confidence, LossAction, LossReason, ReasonDiagnosis } from "./types";
import { INTERVENTION_POTENTIAL_ORDER } from "./types";
import { severityRank } from "./severity";

const CONFIDENCE_ORDER: Confidence[] = ["alta", "media", "baixa", "insuficiente"];

export interface ConsolidateInput {
  /** Só diagnósticos de motivos com qtyLost > 0 no período — engine.ts já filtra antes de chamar. */
  diagnoses: ReasonDiagnosis[];
  /** Nº de períodos do lookback de recorrência com perda, por motivo — usado no desempate (a). */
  recurrencePeriodCountByReason: Record<LossReason, number>;
  confidenceByReason: Record<LossReason, Confidence>;
}

export interface ConsolidateResult {
  maiorImpactoFinanceiroMotivo: LossReason | null;
  maiorImpactoFinanceiroValueCents: number;
  motivoDiagnosticoPrioritario: LossReason | null;
  motivosSecundarios: LossReason[];
  acaoPrioritaria: LossAction;
  acoesSecundarias: LossAction[];
}

export function consolidate(input: ConsolidateInput): ConsolidateResult {
  if (input.diagnoses.length === 0) {
    return { maiorImpactoFinanceiroMotivo: null, maiorImpactoFinanceiroValueCents: 0, motivoDiagnosticoPrioritario: null, motivosSecundarios: [], acaoPrioritaria: "dados_insuficientes", acoesSecundarias: [] };
  }

  // §11.1 — maior impacto financeiro: puramente por valor, desempatado por unidades e depois alfabética.
  const byValue = [...input.diagnoses].sort((a, b) => {
    if (b.metrics.valueLostCents !== a.metrics.valueLostCents) return b.metrics.valueLostCents - a.metrics.valueLostCents;
    if (b.metrics.qtyLost !== a.metrics.qtyLost) return b.metrics.qtyLost - a.metrics.qtyLost;
    return a.reason.localeCompare(b.reason);
  });

  // §11.2 — diagnóstico e ação prioritária: por severidade da ação, depois os 4 critérios de desempate em ordem.
  const bySeverity = [...input.diagnoses].sort((a, b) => {
    const rankA = severityRank(a.acao);
    const rankB = severityRank(b.acao);
    if (rankA !== rankB) return rankA - rankB;

    const recA = input.recurrencePeriodCountByReason[a.reason] ?? 0;
    const recB = input.recurrencePeriodCountByReason[b.reason] ?? 0;
    if (recA !== recB) return recB - recA; // (a) mais recorrência vence

    const potA = a.potencialIntervencao ? INTERVENTION_POTENTIAL_ORDER.indexOf(a.potencialIntervencao) : INTERVENTION_POTENTIAL_ORDER.length;
    const potB = b.potencialIntervencao ? INTERVENTION_POTENTIAL_ORDER.indexOf(b.potencialIntervencao) : INTERVENTION_POTENTIAL_ORDER.length;
    if (potA !== potB) return potA - potB; // (b) maior potencial (índice menor) vence

    const confA = CONFIDENCE_ORDER.indexOf(input.confidenceByReason[a.reason]);
    const confB = CONFIDENCE_ORDER.indexOf(input.confidenceByReason[b.reason]);
    if (confA !== confB) return confA - confB; // (c) maior confiança vence

    if (b.metrics.valueLostCents !== a.metrics.valueLostCents) return b.metrics.valueLostCents - a.metrics.valueLostCents; // (d) maior valor vence

    return a.reason.localeCompare(b.reason); // (e) alfabética
  });

  const prioritario = bySeverity[0];
  const secundarios = bySeverity.slice(1);

  return {
    maiorImpactoFinanceiroMotivo: byValue[0].reason,
    maiorImpactoFinanceiroValueCents: byValue[0].metrics.valueLostCents,
    motivoDiagnosticoPrioritario: prioritario.reason,
    motivosSecundarios: secundarios.map((d) => d.reason),
    acaoPrioritaria: prioritario.acao,
    acoesSecundarias: secundarios.map((d) => d.acao),
  };
}
