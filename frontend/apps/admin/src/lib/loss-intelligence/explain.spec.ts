import { describe, it, expect } from "@jest/globals";
import { explainRecommendation } from "./explain";
import { ACTION_SEVERITY_ORDER, LOSS_REASONS } from "./types";
import type {
  LossAction,
  LossIntelligenceRecommendation,
  LossMetrics,
  LossReason,
  NetworkComparison,
  PerReasonMetrics,
  ReasonDiagnosis,
} from "./types";

// §22.3 acceptance criterion — see explain.ts's ACTION_LABELS/REASON_LABELS: the template must
// never leak stock-level or theft-suggestive vocabulary, since the engine only ever diagnoses
// loss by reason (expired/damaged/other), never inventory-count discrepancy or accusations.
const FORBIDDEN_WORDS = ["estoque", "saldo", "disponibilidade", "ruptura", "cobertura", "sell-through", "roubo", "furto", "theft"];

function perReasonMetrics(overrides: Partial<PerReasonMetrics> = {}): PerReasonMetrics {
  return { qtyLost: 0, valueLostCents: 0, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null, ...overrides };
}

function byReasonMap(overrides: Partial<Record<LossReason, PerReasonMetrics>> = {}): Record<LossReason, PerReasonMetrics> {
  return { expired: perReasonMetrics(), damaged_product: perReasonMetrics(), other_reason: perReasonMetrics(), ...overrides };
}

function lossMetricsFixture(overrides: Partial<LossMetrics> = {}): LossMetrics {
  return {
    qtyRestocked: 0,
    qtySold: 0,
    revenueCents: 0,
    grossMarginCents: null,
    netMarginAfterLossCents: null,
    saleToSupplyRatio: null,
    monthsWithRestock: 0,
    monthsWithSales: 0,
    monthsAnalyzed: 0,
    firstSeenPeriod: null,
    monthsSinceFirstSeen: null,
    byReason: byReasonMap(),
    ...overrides,
  };
}

function reasonDiagnosisFixture(reason: LossReason, acao: LossAction, opts: { qtyLost?: number; valueLostCents?: number } = {}): ReasonDiagnosis {
  const { qtyLost = 1, valueLostCents = 100 } = opts;
  return {
    reason,
    metrics: perReasonMetrics({ qtyLost, valueLostCents }),
    sinaisDetectados: [],
    regrasAcionadas: [],
    acao,
    potencialIntervencao: "medio",
    hipoteses: [],
  };
}

function networkComparisonMapFixture(overrides: Partial<Record<LossReason, NetworkComparison>> = {}): Record<LossReason, NetworkComparison> {
  return { expired: "dado_insuficiente", damaged_product: "dado_insuficiente", other_reason: "dado_insuficiente", ...overrides };
}

function recommendationFixture(overrides: Partial<LossIntelligenceRecommendation> = {}): LossIntelligenceRecommendation {
  return {
    sku: "SKU-TEST",
    storeId: 1,
    janelaAnalisada: { primaryMonths: ["2026-01", "2026-02", "2026-03"], recurrenceLookbackMonths: [] },
    metricasObservadas: lossMetricsFixture(),
    diagnosticosPorMotivo: [],
    maiorImpactoFinanceiroMotivo: null,
    maiorImpactoFinanceiroValueCents: 0,
    motivoDiagnosticoPrioritario: null,
    motivosSecundarios: [],
    acaoPrioritaria: "dados_insuficientes",
    acoesSecundarias: [],
    sinaisTransversais: [],
    prioridade: null,
    confianca: "insuficiente",
    comparacaoRede: networkComparisonMapFixture(),
    limitacoesDosDados: [],
    firstSeenRecently: false,
    versaoMotor: "test",
    versaoParametros: "test",
    ...overrides,
  };
}

describe("explainRecommendation — Paçoquita literal example (spec §10.1 caso A / plan's own worked request)", () => {
  it("18 abastecidos / 0 vendidos / 5 perdidos por validade / 3 meses com abastecimento / suspender → output contains exactly those 4 numbers plus the action label", () => {
    const diagnosis = reasonDiagnosisFixture("expired", "suspender_abastecimento", { qtyLost: 5, valueLostCents: 12000 });
    const recommendation = recommendationFixture({
      metricasObservadas: lossMetricsFixture({ qtyRestocked: 18, qtySold: 0, monthsWithRestock: 3 }),
      janelaAnalisada: { primaryMonths: ["2026-01", "2026-02", "2026-03"], recurrenceLookbackMonths: [] },
      diagnosticosPorMotivo: [diagnosis],
      motivoDiagnosticoPrioritario: "expired",
      acaoPrioritaria: "suspender_abastecimento",
      comparacaoRede: networkComparisonMapFixture({ expired: "dado_insuficiente" }),
    });

    const output = explainRecommendation(recommendation);

    // Hand trace: factsSentence = "18 abastecidos, 0 vendidos, 5 perdidos por validade em 3 meses
    // com abastecimento nos últimos 3 meses." networkSentence = null (dado_insuficiente, filtered
    // out). recommendationSentence = "Suspender novos abastecimentos." Joined with a single space.
    expect(output).toBe(
      "18 abastecidos, 0 vendidos, 5 perdidos por validade em 3 meses com abastecimento nos últimos 3 meses. Suspender novos abastecimentos.",
    );

    // The 4 numbers from the request, individually, plus the exact action label text from
    // explain.ts's ACTION_LABELS["suspender_abastecimento"].
    expect(output).toContain("18 abastecidos");
    expect(output).toContain("0 vendidos");
    expect(output).toContain("5 perdidos");
    expect(output).toContain("3 meses com abastecimento");
    expect(output).toContain("Suspender novos abastecimentos");
  });
});

describe("explainRecommendation — motivoDiagnosticoPrioritario=null (no priority diagnosis)", () => {
  it("returns the fallback insufficient-evidence message, without throwing", () => {
    const recommendation = recommendationFixture({ motivoDiagnosticoPrioritario: null, diagnosticosPorMotivo: [] });
    expect(() => explainRecommendation(recommendation)).not.toThrow();
    expect(explainRecommendation(recommendation)).toBe("Evidência insuficiente para uma leitura detalhada neste período.");
  });

  it("also falls back when motivoDiagnosticoPrioritario is set but diagnosticosPorMotivo has no matching entry — defensive: .find() returning undefined must not be dereferenced", () => {
    // motivoDiagnosticoPrioritario="expired" but the only diagnosis present is for
    // "damaged_product" — r.diagnosticosPorMotivo.find(...) resolves to undefined, and the
    // function must still take the fallback branch instead of reading `prioritario.metrics` on
    // undefined.
    const recommendation = recommendationFixture({
      motivoDiagnosticoPrioritario: "expired",
      diagnosticosPorMotivo: [reasonDiagnosisFixture("damaged_product", "investigar")],
    });
    expect(() => explainRecommendation(recommendation)).not.toThrow();
    expect(explainRecommendation(recommendation)).toBe("Evidência insuficiente para uma leitura detalhada neste período.");
  });
});

describe("explainRecommendation — no network comparison available", () => {
  it("comparacaoRede[motivo] === 'dado_insuficiente' → network sentence omitted, no 'undefined', no double-space/stray-empty-segment artifact", () => {
    const diagnosis = reasonDiagnosisFixture("damaged_product", "investigar", { qtyLost: 2 });
    const recommendation = recommendationFixture({
      metricasObservadas: lossMetricsFixture({ qtyRestocked: 20, qtySold: 4, monthsWithRestock: 2 }),
      diagnosticosPorMotivo: [diagnosis],
      motivoDiagnosticoPrioritario: "damaged_product",
      acaoPrioritaria: "investigar",
      comparacaoRede: networkComparisonMapFixture({ damaged_product: "dado_insuficiente" }),
    });

    const output = explainRecommendation(recommendation);

    expect(output.toLowerCase()).not.toContain("undefined");
    expect(output).not.toMatch(/ {2}/); // no double space from a stray empty joined segment
    expect(output).not.toMatch(/^\s|\s$/); // no leading/trailing whitespace artifact
    // Exactly 2 sentences survive the join (facts + recommendation) — the network sentence's
    // "slot" produces no empty middle segment at all, not even a blank one.
    expect(output.split(". ")).toHaveLength(2);
    expect(output).toBe("20 abastecidos, 4 vendidos, 2 perdidos por danificado em 2 meses com abastecimento nos últimos 3 meses. Investigar.");
  });

  it("comparacaoRede is missing the key for the priority motivo entirely (nc === undefined) → same as dado_insuficiente: no crash, no 'undefined' text", () => {
    const diagnosis = reasonDiagnosisFixture("other_reason", "manter_monitorar");
    // Deliberately construct a map missing the "other_reason" key — simulates a caller that built
    // comparacaoRede from a partial source. r.comparacaoRede[r.motivoDiagnosticoPrioritario] then
    // reads as `undefined`, not the string "dado_insuficiente".
    const incompleteMap = { expired: "dado_insuficiente", damaged_product: "dado_insuficiente" } as unknown as Record<LossReason, NetworkComparison>;
    const recommendation = recommendationFixture({
      diagnosticosPorMotivo: [diagnosis],
      motivoDiagnosticoPrioritario: "other_reason",
      acaoPrioritaria: "manter_monitorar",
      comparacaoRede: incompleteMap,
    });

    expect(() => explainRecommendation(recommendation)).not.toThrow();
    const output = explainRecommendation(recommendation);
    expect(output.toLowerCase()).not.toContain("undefined");
    expect(output).not.toMatch(/ {2}/);
  });
});

describe("explainRecommendation — network comparison available, storesHealthy.length > 0", () => {
  it("produces the 'desempenho saudável em N outras lojas' sentence with the correct count", () => {
    const diagnosis = reasonDiagnosisFixture("expired", "reduzir_abastecimento");
    const recommendation = recommendationFixture({
      diagnosticosPorMotivo: [diagnosis],
      motivoDiagnosticoPrioritario: "expired",
      acaoPrioritaria: "reduzir_abastecimento",
      comparacaoRede: networkComparisonMapFixture({
        expired: { storesCarryingSku: 10, storesWithSameSignal: 1, affectedShare: 0.1, storesHealthy: ["Loja A", "Loja B", "Loja C"] },
      }),
    });

    const output = explainRecommendation(recommendation);
    expect(output).toContain("O SKU tem desempenho saudável em 3 outras lojas.");
  });
});

describe("explainRecommendation — network comparison available, storesHealthy.length === 0", () => {
  it("produces the 'padrão se repete em X de Y lojas comparáveis' sentence instead", () => {
    const diagnosis = reasonDiagnosisFixture("damaged_product", "avaliar_retirada_loja");
    const recommendation = recommendationFixture({
      diagnosticosPorMotivo: [diagnosis],
      motivoDiagnosticoPrioritario: "damaged_product",
      acaoPrioritaria: "avaliar_retirada_loja",
      comparacaoRede: networkComparisonMapFixture({
        damaged_product: { storesCarryingSku: 17, storesWithSameSignal: 14, affectedShare: 0.82, storesHealthy: [] },
      }),
    });

    const output = explainRecommendation(recommendation);
    expect(output).toContain("O padrão se repete em 14 de 17 lojas comparáveis.");
    expect(output).not.toContain("desempenho saudável");
  });
});

describe("explainRecommendation — §22.3 acceptance criterion: forbidden words never appear in any output", () => {
  // Three network-comparison shapes exercise all 3 branches of the network-sentence ternary
  // (omitted / storesHealthy>0 / storesWithSameSignal fallback) on top of every action×reason pair.
  const networkVariants: NetworkComparison[] = [
    "dado_insuficiente",
    { storesCarryingSku: 12, storesWithSameSignal: 5, affectedShare: 0.42, storesHealthy: ["Loja Alfa", "Loja Beta"] },
    { storesCarryingSku: 12, storesWithSameSignal: 5, affectedShare: 0.42, storesHealthy: [] },
  ];

  const totalCombinations = ACTION_SEVERITY_ORDER.length * LOSS_REASONS.length * networkVariants.length;

  it(`covers all ${ACTION_SEVERITY_ORDER.length} LossAction values × ${LOSS_REASONS.length} LossReason values × ${networkVariants.length} network-comparison shapes (${totalCombinations} combinations, exhaustive — not a sample) — none contain any of the 9 forbidden words, case-insensitive`, () => {
    let checked = 0;
    for (const acao of ACTION_SEVERITY_ORDER) {
      for (const reason of LOSS_REASONS) {
        for (const nc of networkVariants) {
          const diagnosis = reasonDiagnosisFixture(reason, acao, { qtyLost: 7, valueLostCents: 5000 });
          const recommendation = recommendationFixture({
            metricasObservadas: lossMetricsFixture({ qtyRestocked: 20, qtySold: 4, monthsWithRestock: 2 }),
            diagnosticosPorMotivo: [diagnosis],
            motivoDiagnosticoPrioritario: reason,
            acaoPrioritaria: acao,
            comparacaoRede: networkComparisonMapFixture({ [reason]: nc }),
          });

          const output = explainRecommendation(recommendation).toLowerCase();
          for (const word of FORBIDDEN_WORDS) {
            expect(output).not.toContain(word);
          }
          checked++;
        }
      }
    }
    // Proves the triple loop actually walked the full matrix, not an accidentally-empty one.
    expect(checked).toBe(totalCombinations);
  });

  it("also covers the motivoDiagnosticoPrioritario=null fallback path (a real input this function receives)", () => {
    const recommendation = recommendationFixture({ motivoDiagnosticoPrioritario: null, diagnosticosPorMotivo: [] });
    const output = explainRecommendation(recommendation).toLowerCase();
    for (const word of FORBIDDEN_WORDS) {
      expect(output).not.toContain(word);
    }
  });
});
