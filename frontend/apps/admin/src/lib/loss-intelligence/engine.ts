import {
  LOSS_REASONS,
  type Confidence,
  type LossAction,
  type LossIntelligenceInput,
  type LossIntelligenceRecommendation,
  type LossIntelligenceResult,
  type LossReason,
  type NetworkComparison,
  type Period,
  type ReasonDiagnosis,
  type SalesRecordInput,
} from "./types";
import type { LossIntelligenceParameters } from "./parameters";
import { resolveAnalysisWindow } from "./temporal";
import { computeLossMetrics } from "./metrics";
import { evaluateRecentHistory, hasOverwhelmingEvidence } from "./recent-history-guard";
import { periodsWithLoss } from "./recurrence";
import { computeNetworkComparison, type StoreSignal } from "./network-comparison";
import { diagnoseValidity, isValidityBadSignal } from "./diagnosis/validity";
import { diagnoseDamage } from "./diagnosis/damage";
import { diagnoseOtherReason } from "./diagnosis/other-reason";
import { detectUnnecessarySupply } from "./unnecessary-supply";
import { consolidate } from "./consolidate";
import { computePriority } from "./priority";
import { computeConfidence } from "./confidence";

const ENGINE_VERSION = "loss-intelligence/0.1.0-provisional";
const PARAMETERS_VERSION = "loss-parameters/0.1.0-provisional";

// Mesmos três cenários já usados em commercial-intelligence (20/40/60%) — constantes fixas, não
// um parâmetro configurável: a spec aprovada (§14) lista os 20 thresholds do motor de perdas e
// este não é um deles. Recalibrar exigiria uma nova aprovação de spec, não uma env var.
const IMPACT_SCENARIOS = { conservative: 0.2, expected: 0.4, optimistic: 0.6 } as const;

export function analyzeLossIntelligence(input: LossIntelligenceInput): LossIntelligenceResult {
  const pairs = uniqueStoreSkuPairs(input);

  const pass1 = pairs.map((pair) => computePairAnalysis(pair.storeId, pair.sku, input, null));
  const networkComparisons = computeAllNetworkComparisons(pass1, input);
  const pass2 = pairs.map((pair) => computePairAnalysis(pair.storeId, pair.sku, input, networkComparisons));

  const countsByAction = {} as Record<LossAction, number>;
  for (const rec of pass2) countsByAction[rec.acaoPrioritaria] = (countsByAction[rec.acaoPrioritaria] ?? 0) + 1;

  return { recommendations: pass2, countsByAction, impactEstimateCents: computeImpactEstimate(pass2) };
}

function uniqueStoreSkuPairs(input: LossIntelligenceInput): { storeId: number; sku: string }[] {
  const set = new Set<string>();
  for (const row of input.salesByStorePeriodSku) set.add(`${row.store_id}::${row.sku}`);
  for (const row of input.supplyByStorePeriodSku) set.add(`${row.store_id}::${row.sku}`);
  for (const reconciliation of input.reconciliations) {
    for (const row of reconciliation.loss_by_reason_sku) set.add(`${reconciliation.store_id}::${row.sku}`);
  }
  return [...set].map((key) => {
    const [storeId, sku] = key.split("::");
    return { storeId: Number(storeId), sku };
  });
}

function networkKey(sku: string, reason: LossReason): string {
  return `${sku}::${reason}`;
}

function qtyLostByStoreForSkuReason(input: LossIntelligenceInput, sku: string, reason: LossReason, periods: Period[]): { storeId: number; qtyLost: number }[] {
  return input.stores.map((store) => {
    const qty = input.reconciliations
      .filter((r) => r.store_id === store.id && periods.includes(r.period))
      .flatMap((r) => r.loss_by_reason_sku.filter((row) => row.sku === sku && row.reason === reason))
      .reduce((total, row) => total + row.quantity, 0);
    return { storeId: store.id, qtyLost: qty };
  });
}

function computeConcentrationShareStore(input: LossIntelligenceInput, sku: string, storeId: number, periods: Period[], parameters: LossIntelligenceParameters): number | null {
  const byStore = qtyLostByStoreForSkuReason(input, sku, "other_reason", periods);
  const storesCarrying = byStore.filter((s) => s.qtyLost > 0);
  if (storesCarrying.length < parameters.network.minStoresForNetworkVerdict) return null;
  const total = storesCarrying.reduce((sum, s) => sum + s.qtyLost, 0);
  const thisStore = byStore.find((s) => s.storeId === storeId)?.qtyLost ?? 0;
  return total > 0 ? thisStore / total : 0;
}

/** Zero vendas num período fechado seguido de vendas positivas no seguinte, dentro da janela principal — a checagem mais simples que o exemplo do spec §17 cita, documentada como tal. */
function hasContradictoryPattern(salesRows: SalesRecordInput[], periods: Period[]): boolean {
  const sorted = [...periods].sort();
  const soldByPeriod = new Map(sorted.map((period) => [period, salesRows.filter((row) => row.period === period).reduce((total, row) => total + row.quantity_sold, 0)]));
  for (let i = 0; i < sorted.length - 1; i++) {
    if ((soldByPeriod.get(sorted[i]) ?? 0) === 0 && (soldByPeriod.get(sorted[i + 1]) ?? 0) > 0) return true;
  }
  return false;
}

function computePairAnalysis(storeId: number, sku: string, input: LossIntelligenceInput, network: Map<string, NetworkComparison> | null): LossIntelligenceRecommendation {
  const salesRows = input.salesByStorePeriodSku.filter((r) => r.store_id === storeId && r.sku === sku);
  const supplyRows = input.supplyByStorePeriodSku.filter((r) => r.store_id === storeId && r.sku === sku);
  const reconciliationsForStore = input.reconciliations.filter((r) => r.store_id === storeId);
  const allKnownRestockPeriods = [...new Set(supplyRows.filter((r) => r.quantity_restocked > 0).map((r) => r.period))];

  const window = resolveAnalysisWindow({ storeId, sku, today: input.today, allKnownRestockPeriods, parameters: input.parameters });
  const asOfPeriod = window.primaryClosedPeriods[window.primaryClosedPeriods.length - 1] ?? window.currentInProgressPeriod;

  const metrics = computeLossMetrics({
    storeId, sku,
    allSalesRows: salesRows, allSupplyRows: supplyRows, allReconciliations: reconciliationsForStore,
    costsBySkuAsOf: input.costsBySkuAsOf,
    windowPeriods: window.primaryClosedPeriods,
    asOfPeriod,
  });

  const guard = evaluateRecentHistory({ firstSeenPeriod: metrics.firstSeenPeriod, monthsSinceFirstSeen: metrics.monthsSinceFirstSeen, allSupplyRows: supplyRows, parameters: input.parameters });
  const overwhelming = hasOverwhelmingEvidence({ qtySold: metrics.qtySold, qtyRestocked: metrics.qtyRestocked, parameters: input.parameters });

  const diagnoses: ReasonDiagnosis[] = [];
  const confidenceByReason = {} as Record<LossReason, Confidence>;
  const recurrenceCountByReason = {} as Record<LossReason, number>;

  for (const reason of LOSS_REASONS) {
    const perReason = metrics.byReason[reason];
    if (perReason.qtyLost === 0) continue; // spec §11 item 1

    const recurrencePeriods = periodsWithLoss(reconciliationsForStore, sku, reason, window.recurrenceLookbackPeriods);
    recurrenceCountByReason[reason] = recurrencePeriods.length;

    let diagnosis: ReasonDiagnosis;
    let networkMissingButNeeded = false;
    let marginUnknownButNeeded = false;

    if (reason === "expired") {
      const nc = network?.get(networkKey(sku, "expired")) ?? null;
      diagnosis = diagnoseValidity({
        metrics: perReason, qtySold: metrics.qtySold, saleToSupplyRatio: metrics.saleToSupplyRatio,
        monthsWithRestock: metrics.monthsWithRestock, recurrencePeriodsWithLoss: recurrencePeriods,
        networkComparison: nc, firstSeenRecently: guard.firstSeenRecently, overwhelmingEvidence: overwhelming,
        parameters: input.parameters,
      });
      networkMissingButNeeded = (diagnosis.acao === "suspender_abastecimento" || diagnosis.acao === "reduzir_abastecimento") && nc === "dado_insuficiente";
    } else if (reason === "damaged_product") {
      const qtyLostByStore = qtyLostByStoreForSkuReason(input, sku, "damaged_product", window.primaryClosedPeriods);
      diagnosis = diagnoseDamage({ metrics: perReason, qtyLostDamagedByStore: qtyLostByStore, thisStoreId: storeId, parameters: input.parameters });
    } else {
      const nc = network?.get(networkKey(sku, "other_reason")) ?? null;
      const concentration = computeConcentrationShareStore(input, sku, storeId, window.primaryClosedPeriods, input.parameters);
      marginUnknownButNeeded = metrics.grossMarginCents === null;
      diagnosis = diagnoseOtherReason({
        metrics: perReason, qtySold: metrics.qtySold, grossMarginCents: metrics.grossMarginCents,
        recurrencePeriodsWithLoss: recurrencePeriods, concentrationShareStore: concentration,
        networkComparison: nc, firstSeenRecently: guard.firstSeenRecently, overwhelmingEvidence: overwhelming,
        parameters: input.parameters,
      });
      networkMissingButNeeded = (diagnosis.acao === "avaliar_permanencia_loja" || diagnosis.acao === "avaliar_permanencia_rede") && nc === "dado_insuficiente";
    }

    diagnoses.push(diagnosis);
    confidenceByReason[reason] = computeConfidence({
      qualifyingPeriodsCount: window.qualifyingRestockPeriods.length,
      firstSeenRecently: guard.firstSeenRecently, overwhelmingEvidence: overwhelming,
      marginUnknownButNeeded, networkComparisonMissingButNeeded: networkMissingButNeeded,
      hasContradictoryData: hasContradictoryPattern(salesRows, window.primaryClosedPeriods),
      parameters: input.parameters,
    });
  }

  const consolidated = consolidate({ diagnoses, recurrencePeriodCountByReason: recurrenceCountByReason, confidenceByReason });

  const expiryPeriods = periodsWithLoss(reconciliationsForStore, sku, "expired", window.primaryClosedPeriods);
  const restockPeriods = [...new Set(supplyRows.filter((r) => window.primaryClosedPeriods.includes(r.period) && r.quantity_restocked > 0).map((r) => r.period))];
  // Deduped: a single period with losses from 2+ reasons (e.g. expired AND damaged_product in the
  // same month) must count once, not once per reason — otherwise it inflates unnecessary-supply.ts's
  // OVERSUPPLY_WITH_RECURRING_LOSS check (>=2 periods) with a single calendar month, which also
  // feeds computePriority's Crítica escalation via sinaisTransversais (found in review).
  const anyReasonRecurrencePeriods = [...new Set(LOSS_REASONS.flatMap((reason) => periodsWithLoss(reconciliationsForStore, sku, reason, window.recurrenceLookbackPeriods)))];

  const unnecessary = detectUnnecessarySupply({
    qtySold: metrics.qtySold, monthsWithRestock: metrics.monthsWithRestock, saleToSupplyRatio: metrics.saleToSupplyRatio,
    periodsWithExpiryLoss: expiryPeriods, periodsWithRestock: restockPeriods,
    recurrencePeriodsWithAnyLoss: anyReasonRecurrencePeriods, parameters: input.parameters,
  });

  const overallConfidence: Confidence = consolidated.motivoDiagnosticoPrioritario ? confidenceByReason[consolidated.motivoDiagnosticoPrioritario] : "insuficiente";

  const priority = computePriority({
    acaoPrioritaria: consolidated.acaoPrioritaria, confianca: overallConfidence, sinaisTransversais: unnecessary.sinaisTransversais,
    valueLostCentsPrioritario: consolidated.motivoDiagnosticoPrioritario ? metrics.byReason[consolidated.motivoDiagnosticoPrioritario].valueLostCents : 0,
    firstSeenRecently: guard.firstSeenRecently, parameters: input.parameters,
  });

  const comparacaoRede = {} as Record<LossReason, NetworkComparison>;
  for (const reason of LOSS_REASONS) comparacaoRede[reason] = network?.get(networkKey(sku, reason)) ?? "dado_insuficiente";

  const limitacoesDosDados: string[] = [];
  if (metrics.grossMarginCents === null) limitacoesDosDados.push("margem_desconhecida");
  if (guard.firstSeenRecently) limitacoesDosDados.push("historico_recente");

  // Uma entrada por período do lookback de recorrência (não a janela principal) — cada número é
  // real para aquele período específico, nunca a soma agregada que `metrics` já expõe. Spec §15.3.
  const historico = window.recurrenceLookbackPeriods.map((period) => ({
    period,
    qtyRestocked: supplyRows.filter((r) => r.period === period).reduce((total, r) => total + r.quantity_restocked, 0),
    qtySold: salesRows.filter((r) => r.period === period).reduce((total, r) => total + r.quantity_sold, 0),
    qtyLostByReason: Object.fromEntries(
      LOSS_REASONS.map((reason) => [
        reason,
        reconciliationsForStore
          .filter((r) => r.period === period)
          .flatMap((r) => r.loss_by_reason_sku.filter((row) => row.sku === sku && row.reason === reason))
          .reduce((total, row) => total + row.quantity, 0),
      ]),
    ) as Record<LossReason, number>,
  }));

  return {
    sku, storeId,
    janelaAnalisada: { primaryMonths: window.primaryClosedPeriods, recurrenceLookbackMonths: window.recurrenceLookbackPeriods },
    metricasObservadas: metrics,
    diagnosticosPorMotivo: diagnoses,
    historico,
    maiorImpactoFinanceiroMotivo: consolidated.maiorImpactoFinanceiroMotivo,
    maiorImpactoFinanceiroValueCents: consolidated.maiorImpactoFinanceiroValueCents,
    motivoDiagnosticoPrioritario: consolidated.motivoDiagnosticoPrioritario,
    motivosSecundarios: consolidated.motivosSecundarios,
    acaoPrioritaria: consolidated.acaoPrioritaria,
    acoesSecundarias: consolidated.acoesSecundarias,
    sinaisTransversais: unnecessary.sinaisTransversais,
    prioridade: priority,
    confianca: overallConfidence,
    comparacaoRede,
    limitacoesDosDados,
    firstSeenRecently: guard.firstSeenRecently,
    versaoMotor: ENGINE_VERSION,
    versaoParametros: PARAMETERS_VERSION,
  };
}

function isBadSignalFor(reason: LossReason, rec: LossIntelligenceRecommendation): boolean {
  const diagnosis = rec.diagnosticosPorMotivo.find((d) => d.reason === reason);
  if (!diagnosis) return false;
  if (reason === "expired") return isValidityBadSignal(diagnosis.acao);
  // Reads whether isOtherReasonSevereSignal fired (the OTHER_REASON_SEVERE_RECURRING signal is
  // set once in that branch and only ever appended to afterwards, never removed — see
  // diagnosis/other-reason.ts), not the final `acao`: a genuinely severe case that
  // firstSeenRecently later capped down to "investigar" is still a bad signal for the network's
  // purposes (found in review — checking `acao` alone wrongly read a capped-down store as healthy).
  if (reason === "other_reason") return diagnosis.sinaisDetectados.includes("OTHER_REASON_SEVERE_RECURRING");
  return false; // damaged_product não usa network-comparison.ts — calcula concentração inline.
}

function computeAllNetworkComparisons(pass1: LossIntelligenceRecommendation[], input: LossIntelligenceInput): Map<string, NetworkComparison> {
  const map = new Map<string, NetworkComparison>();
  const skus = [...new Set(pass1.map((r) => r.sku))];

  for (const sku of skus) {
    // damaged_product is deliberately skipped: diagnosis/damage.ts never consumes
    // NetworkComparison (it computes its own concentration inline from
    // qtyLostByStoreForSkuReason), and isBadSignalFor always returns false for it — computing a
    // "real" NetworkComparisonResult here would fabricate a misleading "0% of the network has
    // this problem" figure that engine.ts's fallback (`?? "dado_insuficiente"`) is supposed to
    // prevent (found in review — this conflicts with the project's FATO/MÉTRICA
    // DERIVADA/PREMISSA/ESTIMATIVA labeling rule: an artifact must never be presented as measured).
    for (const reason of LOSS_REASONS.filter((r) => r !== "damaged_product")) {
      const perStore: StoreSignal[] = input.stores.map((store) => {
        const rec = pass1.find((r) => r.sku === sku && r.storeId === store.id);
        return {
          storeId: store.id,
          storeName: store.name,
          qtyRestocked: rec?.metricasObservadas.qtyRestocked ?? 0,
          qtySold: rec?.metricasObservadas.qtySold ?? 0,
          hasBadSignal: rec ? isBadSignalFor(reason, rec) : false,
        };
      });
      map.set(networkKey(sku, reason), computeNetworkComparison({ perStore, parameters: input.parameters }));
    }
  }
  return map;
}

function computeImpactEstimate(recommendations: LossIntelligenceRecommendation[]): { conservative: number; expected: number; optimistic: number } {
  const eligible = recommendations.filter((r) => r.acaoPrioritaria !== "manter" && r.acaoPrioritaria !== "dados_insuficientes");
  const totalValueLostCents = eligible.reduce((sum, r) => {
    const reason = r.motivoDiagnosticoPrioritario;
    return sum + (reason ? r.metricasObservadas.byReason[reason].valueLostCents : 0);
  }, 0);
  return {
    conservative: Math.round(totalValueLostCents * IMPACT_SCENARIOS.conservative),
    expected: Math.round(totalValueLostCents * IMPACT_SCENARIOS.expected),
    optimistic: Math.round(totalValueLostCents * IMPACT_SCENARIOS.optimistic),
  };
}
