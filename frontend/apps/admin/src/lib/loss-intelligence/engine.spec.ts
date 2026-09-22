import { describe, it, expect } from "@jest/globals";
import { analyzeLossIntelligence } from "./engine";
import { diagnoseValidity } from "./diagnosis/validity";
import { DEFAULT_PARAMETERS } from "./parameters";
import type {
  LossAction,
  LossByReasonSkuRow,
  LossIntelligenceInput,
  LossIntelligenceResult,
  LossReason,
  Period,
  ReconciliationInput,
  SalesRecordInput,
  StoreInput,
  SupplyRecordInput,
} from "./types";

// Integration test for engine.ts — the single public entry point that wires together Tasks 2-16.
// Every fixture below is synthetic/in-memory (never real DB data), and is built up stage by stage
// (window → metrics → per-reason diagnosis → consolidate → priority/confidence) in the comments so
// a fixture arithmetic mistake can't masquerade as an engine bug or vice versa.
//
// `today` is the same for every scenario in this file, so every fixture shares the same resolved
// window (spec §8, DEFAULT_PARAMETERS.window = {primaryWindowMonths: 3, recurrenceLookbackMonths: 6}):
//   currentInProgressPeriod = "2026-09"
//   primaryClosedPeriods    = ["2026-06", "2026-07", "2026-08"]   (resolveAnalysisWindow, verified by hand against temporal.ts's addMonths/lastNClosedPeriods)
//   recurrenceLookbackPeriods = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]
//   asOfPeriod (most recent primary period) = "2026-08"
const TODAY = "2026-09-22";
const PRIMARY = ["2026-06", "2026-07", "2026-08"];

// Flat R$10,00/unit cost for every SKU and period in this file. None of the 8 required scenarios
// need cost to vary by SKU or period — where a scenario needs a specific grossMarginCents, the
// fixture varies revenue/quantity instead, keeping this one constant.
const flatCost = (_sku: string, _asOfPeriod: Period): number | null => 1000;

// ---- fixture builders -------------------------------------------------------------------------

function store(id: number, name: string): StoreInput {
  return { id, name };
}
function loss(reason: LossReason, sku: string, quantity: number, value_cents: number): LossByReasonSkuRow {
  return { reason, sku, quantity, value_cents };
}
function reconciliation(store_id: number, period: Period, rows: LossByReasonSkuRow[]): ReconciliationInput {
  return { store_id, period, loss_by_reason_sku: rows };
}
function sale(store_id: number, period: Period, sku: string, quantity_sold: number, revenue_cents: number): SalesRecordInput {
  return { store_id, period, sku, quantity_sold, revenue_cents };
}
function supply(store_id: number, period: Period, sku: string, quantity_restocked: number): SupplyRecordInput {
  return { store_id, period, sku, quantity_restocked };
}

// ---- generic safety-net helpers, applied across every scenario --------------------------------

/** Recursively walks any output value and collects every non-finite number found, with its path. */
function collectNonFinite(value: unknown, path: string, out: string[]): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) out.push(`${path} = ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectNonFinite(v, `${path}[${i}]`, out));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collectNonFinite(v, `${path}.${k}`, out);
  }
}

/** spec §19 edge-case guard — no NaN/Infinity anywhere in the output, not just the fields a test happens to check. */
function assertNoNaNOrInfinity(result: LossIntelligenceResult): void {
  const offenders: string[] = [];
  collectNonFinite(result, "result", offenders);
  expect(offenders).toEqual([]);
}

/** countsByAction (spec §15.1 base) must always sum to exactly the number of Produto×Loja pairs analyzed. */
function assertCountsSumToPairs(result: LossIntelligenceResult): void {
  const sum = Object.values(result.countsByAction).reduce((total, n) => total + n, 0);
  expect(sum).toBe(result.recommendations.length);
}

// A "🔴/⚫" action, per validity.spec.ts's own definition (suspender_abastecimento,
// avaliar_retirada_loja, avaliar_retirada_rede) extended with other-reason.ts's two equally severe
// "avaliar_permanencia_*" actions — every one of these must carry at least one named signal,
// checked here across the WHOLE recommendations array, not just inside one isolated diagnosis tree.
const RED_BLACK_ACTIONS: LossAction[] = [
  "suspender_abastecimento",
  "avaliar_retirada_loja",
  "avaliar_retirada_rede",
  "avaliar_permanencia_loja",
  "avaliar_permanencia_rede",
];
function assertRedBlackActionsCarrySignal(result: LossIntelligenceResult): void {
  for (const rec of result.recommendations) {
    for (const diagnosis of rec.diagnosticosPorMotivo) {
      if (RED_BLACK_ACTIONS.includes(diagnosis.acao)) {
        expect(diagnosis.sinaisDetectados.length).toBeGreaterThan(0);
        expect(diagnosis.regrasAcionadas.length).toBeGreaterThan(0);
      }
    }
  }
}

// =================================================================================================
// Scenario 1 (required §18): 3 lojas, 1 SKU, all 3 reasons at once in the analyzed store,
// reproducing the §11.3 divergence example (damage = highest R$, expiry = lower R$ but more
// severe/recurrent) — now coming out of the full pipeline, not consolidate.spec.ts's synthetic
// ReasonDiagnosis fixtures.
// =================================================================================================
describe("analyzeLossIntelligence — §11.3 divergence example from the full pipeline (3 lojas, 1 SKU)", () => {
  const SKU = "SKU-DIVERGENCIA";

  function buildInput(): LossIntelligenceInput {
    return {
      stores: [store(1, "Loja 1"), store(2, "Loja 2"), store(3, "Loja 3")],
      today: TODAY,
      parameters: DEFAULT_PARAMETERS,
      costsBySkuAsOf: flatCost,
      salesByStorePeriodSku: [], // qtySold = 0 for store 1 → satisfies diagnoseValidity's Caso A (zero vendas)
      supplyByStorePeriodSku: [
        supply(1, "2025-01", SKU, 10), // pre-window restock → firstSeenPeriod = "2025-01", far enough back that firstSeenRecently = false
        supply(1, "2026-06", SKU, 6),
        supply(1, "2026-07", SKU, 6),
        supply(1, "2026-08", SKU, 6), // monthsWithRestock = 3, qtyRestocked (window) = 18
      ],
      reconciliations: [
        // Store 1: expired recurrent across all 3 window months (5 units, R$200 total) + damaged
        // concentrated in store 1 (8 of 10 network units, R$400 total) + other_reason negligible.
        reconciliation(1, "2026-06", [loss("expired", SKU, 2, 8000), loss("damaged_product", SKU, 3, 15000)]),
        reconciliation(1, "2026-07", [loss("expired", SKU, 2, 8000), loss("damaged_product", SKU, 3, 15000)]),
        reconciliation(1, "2026-08", [loss("expired", SKU, 1, 4000), loss("damaged_product", SKU, 2, 10000), loss("other_reason", SKU, 1, 1000)]),
        // Stores 2 and 3: a little damage too, so the network has 3 stores carrying damage
        // (>= damage.minStoresCarryingForConcentration = 3) and store 1's 8-of-10 share clears
        // damage.localConcentrationMin (0.7).
        reconciliation(2, "2026-07", [loss("damaged_product", SKU, 1, 500)]),
        reconciliation(3, "2026-07", [loss("damaged_product", SKU, 1, 500)]),
      ],
    };
  }

  it("expired (rank 4, suspender_abastecimento) outranks damaged (rank 6, investigar) on severity, even though damaged has the higher R$ value — maiorImpactoFinanceiroMotivo and motivoDiagnosticoPrioritario genuinely diverge", () => {
    const result = analyzeLossIntelligence(buildInput());
    const store1 = result.recommendations.find((r) => r.storeId === 1 && r.sku === SKU)!;

    // Hand trace — metrics: qtyRestocked (window) = 18, qtySold = 0, monthsWithRestock = 3.
    expect(store1.metricasObservadas.qtyRestocked).toBe(18);
    expect(store1.metricasObservadas.qtySold).toBe(0);
    expect(store1.metricasObservadas.monthsWithRestock).toBe(3);

    // Hand trace — diagnoseValidity (expired): qtySold===0 && monthsWithRestock(3)>=2 → Caso A →
    // suspender_abastecimento. Only 3 stores total carry SKU-DIVERGENCIA (<
    // network.minStoresForNetworkVerdict=5) → network comparison is "dado_insuficiente" in both
    // passes → no Caso D/E escalation possible here (this scenario deliberately keeps the network
    // too small — the escalation path itself is exercised by the Paçoquita and 17-lojas scenarios
    // below). firstSeenRecently=false (pre-window restock in 2025-01) → no recent-history cap.
    const expiredDiag = store1.diagnosticosPorMotivo.find((d) => d.reason === "expired")!;
    expect(expiredDiag.acao).toBe("suspender_abastecimento");
    expect(expiredDiag.metrics.valueLostCents).toBe(20000); // R$200 (8000 + 8000 + 4000, one loss row per window month)

    // Hand trace — diagnoseDamage: qtyLostDamagedByStore = [{1,8},{2,1},{3,1}], total=10,
    // storesCarrying.length=3 >= minStoresCarryingForConcentration(3). concentrationShare =
    // 8/10 = 0.8 >= localConcentrationMin(0.7) → local concentration → "investigar", alto.
    const damagedDiag = store1.diagnosticosPorMotivo.find((d) => d.reason === "damaged_product")!;
    expect(damagedDiag.acao).toBe("investigar");
    expect(damagedDiag.metrics.valueLostCents).toBe(40000); // R$400 (15000+15000+10000)

    // Hand trace — diagnoseOtherReason: valueLostCents(1000) < negligibleValueCents(5000) → "manter".
    const otherDiag = store1.diagnosticosPorMotivo.find((d) => d.reason === "other_reason")!;
    expect(otherDiag.acao).toBe("manter");

    // §11.1 (maiorImpactoFinanceiro): pure R$ — damaged (40000) > expired (20000) > other (1000).
    expect(store1.maiorImpactoFinanceiroMotivo).toBe("damaged_product");
    expect(store1.maiorImpactoFinanceiroValueCents).toBe(40000);

    // §11.2 (motivoDiagnosticoPrioritario): severityRank(suspender_abastecimento)=4 <
    // severityRank(investigar)=6 < severityRank(manter)=8 → expired wins outright, no tie-break
    // needed.
    expect(store1.motivoDiagnosticoPrioritario).toBe("expired");
    expect(store1.acaoPrioritaria).toBe("suspender_abastecimento");
    expect(store1.motivosSecundarios).toEqual(["damaged_product", "other_reason"]);

    // The headline: exactly the §11.3 divergence, now produced by the real two-pass pipeline.
    expect(store1.maiorImpactoFinanceiroMotivo).not.toBe(store1.motivoDiagnosticoPrioritario);

    assertNoNaNOrInfinity(result);
  });
});

// =================================================================================================
// Scenario 2 (required §18): the literal Paçoquita example — 18 abastecido / 0 vendido / 5 perdido
// por validade / 3 meses com abastecimento — "saudável em 9 de 10 lojas".
//
// Note on the final action: 9-of-10-healthy is EXACTLY validity.spec.ts's already-shipped "Caso D"
// fixture (outlierNetworkComparison: storesCarryingSku=10, storesWithSameSignal=1, affectedShare=
// 0.1 <= localOutlierMaxShare=0.3), which that test asserts resolves to "avaliar_retirada_loja", not
// "suspender_abastecimento" — a lone bad store against a healthy network is a LOCAL OUTLIER, and
// Caso D's escalation is specifically about identifying and acting on that (see
// diagnosis/validity.ts's LOCAL_OUTLIER_VS_HEALTHY_NETWORK signal). Keeping the final action at
// "suspender_abastecimento" here would make this test unable to prove the two-pass mechanism
// matters at all (pass 1 and pass 2 would look identical). This test asserts the actual,
// already-verified behavior: pass 1 alone → suspender_abastecimento; the full two-pass pipeline →
// avaliar_retirada_loja.
// =================================================================================================
describe("analyzeLossIntelligence — Paçoquita literal (18/0/5, 3 meses, saudável em 9 de 10 lojas → Caso D escalation)", () => {
  const SKU = "PACOQUITA";
  const BAD_STORE_ID = 1;
  const TOTAL_STORES = 10;

  function buildInput(): LossIntelligenceInput {
    const stores = Array.from({ length: TOTAL_STORES }, (_, i) => store(i + 1, `Loja ${i + 1}`));
    const supplyRows: SupplyRecordInput[] = [
      supply(BAD_STORE_ID, "2025-01", SKU, 20), // pre-window → firstSeenRecently = false
      supply(BAD_STORE_ID, "2026-06", SKU, 6),
      supply(BAD_STORE_ID, "2026-07", SKU, 6),
      supply(BAD_STORE_ID, "2026-08", SKU, 6), // 18 abastecido, 3 meses com abastecimento
    ];
    const salesRows: SalesRecordInput[] = [];
    for (let i = 2; i <= TOTAL_STORES; i++) {
      // 9 healthy stores: some sales, zero expiry loss at all — so no "expired" diagnosis is ever
      // created for them, which is the simplest possible way to be "healthy" (isBadSignalFor
      // returns false when no diagnosis exists for that reason).
      salesRows.push(sale(i, "2026-08", SKU, 5, 5 * 1500));
    }
    const reconciliations: ReconciliationInput[] = [
      // Store 1 (the affected store): 5 perdido por validade, spread over the 3 primary months.
      reconciliation(BAD_STORE_ID, "2026-06", [loss("expired", SKU, 2, 2000)]),
      reconciliation(BAD_STORE_ID, "2026-07", [loss("expired", SKU, 2, 2000)]),
      reconciliation(BAD_STORE_ID, "2026-08", [loss("expired", SKU, 1, 1000)]),
    ];
    return { stores, today: TODAY, parameters: DEFAULT_PARAMETERS, costsBySkuAsOf: flatCost, salesByStorePeriodSku: salesRows, supplyByStorePeriodSku: supplyRows, reconciliations };
  }

  it("qtySold=0, monthsWithRestock=3 → Caso A locally (suspender_abastecimento); pass 2's network comparison (10 stores carrying, only store 1 bad, affectedShare=0.1) escalates to avaliar_retirada_loja", () => {
    const result = analyzeLossIntelligence(buildInput());
    const badStore = result.recommendations.find((r) => r.storeId === BAD_STORE_ID)!;

    // Metrics hand trace, exactly the Paçoquita numbers.
    expect(badStore.metricasObservadas.qtyRestocked).toBe(18);
    expect(badStore.metricasObservadas.qtySold).toBe(0);
    expect(badStore.metricasObservadas.monthsWithRestock).toBe(3);
    expect(badStore.metricasObservadas.byReason.expired.qtyLost).toBe(5);
    expect(badStore.firstSeenRecently).toBe(false);

    // ---- PROOF that the two-pass mechanism genuinely matters -----------------------------------
    // Independent pass-1-equivalent computation: exact same metrics, networkComparison explicitly
    // null (this is exactly what pass 1 of analyzeLossIntelligence computes internally, before any
    // network comparison exists).
    const pass1Equivalent = diagnoseValidity({
      metrics: badStore.metricasObservadas.byReason.expired,
      qtySold: badStore.metricasObservadas.qtySold,
      saleToSupplyRatio: badStore.metricasObservadas.saleToSupplyRatio,
      monthsWithRestock: badStore.metricasObservadas.monthsWithRestock,
      recurrencePeriodsWithLoss: PRIMARY,
      networkComparison: null,
      firstSeenRecently: badStore.firstSeenRecently,
      overwhelmingEvidence: false,
      parameters: DEFAULT_PARAMETERS,
    });
    expect(pass1Equivalent.acao).toBe("suspender_abastecimento");

    // The full pipeline's actual (pass 2) result: escalated by the network comparison that only
    // becomes available after pass 1 ran across all 10 stores.
    expect(badStore.comparacaoRede.expired).toEqual({
      storesCarryingSku: 10,
      storesWithSameSignal: 1,
      affectedShare: 0.1,
      storesHealthy: expect.arrayContaining(["Loja 2", "Loja 10"]),
    });
    expect(badStore.diagnosticosPorMotivo[0].acao).toBe("avaliar_retirada_loja");
    expect(badStore.diagnosticosPorMotivo[0].sinaisDetectados).toEqual(["ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS", "LOCAL_OUTLIER_VS_HEALTHY_NETWORK"]);
    expect(badStore.acaoPrioritaria).toBe("avaliar_retirada_loja");

    // Pass 1 alone and the full (pass 2) pipeline genuinely disagree — the escalation only exists
    // because pass 2 had pass 1's aggregated hasBadSignal results available.
    expect(pass1Equivalent.acao).not.toBe(badStore.acaoPrioritaria);

    // ---- countsByAction sums exactly to the number of Produto×Loja pairs (10 stores × 1 SKU) ----
    expect(result.recommendations).toHaveLength(10);
    assertCountsSumToPairs(result);
    expect(result.countsByAction.avaliar_retirada_loja).toBe(1);
    expect(result.countsByAction.dados_insuficientes).toBe(9); // 9 healthy stores: no loss of any reason → consolidate([]) → dados_insuficientes

    assertRedBlackActionsCarrySignal(result);
    assertNoNaNOrInfinity(result);
  });
});

// =================================================================================================
// Scenario 3 (required §18): 17 lojas, SKU com baixo desempenho recorrente em 14 delas → a loja em
// análise recebe avaliar_retirada_rede — confirms the second pass genuinely uses pass 1's result,
// this time via Caso E (network-wide, not local-outlier).
// =================================================================================================
describe("analyzeLossIntelligence — 17 lojas, 14 com baixo desempenho recorrente (Caso E network-wide escalation)", () => {
  const SKU = "SKU-REDE-BAIXA";
  const BAD_STORE_IDS = Array.from({ length: 14 }, (_, i) => i + 1); // stores 1..14
  const HEALTHY_STORE_IDS = [15, 16, 17];

  function buildInput(): LossIntelligenceInput {
    const stores = [...BAD_STORE_IDS, ...HEALTHY_STORE_IDS].map((id) => store(id, `Loja ${id}`));
    const supplyRows: SupplyRecordInput[] = [];
    const salesRows: SalesRecordInput[] = [];
    const reconciliations: ReconciliationInput[] = [];

    for (const id of BAD_STORE_IDS) {
      // Caso B profile (validity.spec.ts's own caseBInput numbers): 50 abastecido / 20 vendido
      // (ratio 0.4 < lowSaleRatio 0.5), recorrente em 2 períodos do lookback.
      supplyRows.push(supply(id, "2025-01", SKU, 30)); // pre-window → firstSeenRecently = false
      supplyRows.push(supply(id, "2026-06", SKU, 20), supply(id, "2026-07", SKU, 15), supply(id, "2026-08", SKU, 15)); // 50 total
      salesRows.push(sale(id, "2026-06", SKU, 8, 8000), sale(id, "2026-07", SKU, 6, 6000), sale(id, "2026-08", SKU, 6, 6000)); // 20 total
      reconciliations.push(reconciliation(id, "2026-07", [loss("expired", SKU, 2, 1400)]), reconciliation(id, "2026-08", [loss("expired", SKU, 2, 1400)]));
    }
    for (const id of HEALTHY_STORE_IDS) {
      salesRows.push(sale(id, "2026-08", SKU, 5, 7500)); // just enough to count as "carrying", zero expiry loss
    }

    return { stores, today: TODAY, parameters: DEFAULT_PARAMETERS, costsBySkuAsOf: flatCost, salesByStorePeriodSku: salesRows, supplyByStorePeriodSku: supplyRows, reconciliations };
  }

  it("Caso B locally (reduzir_abastecimento) for all 14; network-wide affectedShare=14/17≈0.82 >= networkWideMinShare(0.7) escalates all 14 to avaliar_retirada_rede", () => {
    const result = analyzeLossIntelligence(buildInput());
    const store1 = result.recommendations.find((r) => r.storeId === 1)!;

    // Metrics hand trace for store 1 (representative of all 14 bad stores — identical profile).
    expect(store1.metricasObservadas.qtyRestocked).toBe(50);
    expect(store1.metricasObservadas.qtySold).toBe(20);
    expect(store1.metricasObservadas.saleToSupplyRatio).toBeCloseTo(0.4);
    expect(store1.firstSeenRecently).toBe(false);

    // Pass-1-equivalent: same metrics, networkComparison=null → Caso B (branch B: qtySold>0,
    // ratio<0.5, isRecurrent — recurrencePeriodsWithLoss=["2026-07","2026-08"], length 2 >= 2).
    const pass1Equivalent = diagnoseValidity({
      metrics: store1.metricasObservadas.byReason.expired,
      qtySold: store1.metricasObservadas.qtySold,
      saleToSupplyRatio: store1.metricasObservadas.saleToSupplyRatio,
      monthsWithRestock: store1.metricasObservadas.monthsWithRestock,
      recurrencePeriodsWithLoss: ["2026-07", "2026-08"],
      networkComparison: null,
      firstSeenRecently: store1.firstSeenRecently,
      overwhelmingEvidence: false,
      parameters: DEFAULT_PARAMETERS,
    });
    expect(pass1Equivalent.acao).toBe("reduzir_abastecimento");

    // Network comparison: all 17 stores carry the SKU (>= minStoresForNetworkVerdict=5), 14 have
    // the bad signal → affectedShare = 14/17 ≈ 0.8235 >= networkWideMinShare(0.7) → Caso E.
    expect(store1.comparacaoRede.expired).not.toBe("dado_insuficiente");
    if (store1.comparacaoRede.expired !== "dado_insuficiente") {
      expect(store1.comparacaoRede.expired.storesCarryingSku).toBe(17);
      expect(store1.comparacaoRede.expired.storesWithSameSignal).toBe(14);
      expect(store1.comparacaoRede.expired.affectedShare).toBeCloseTo(14 / 17);
    }
    expect(store1.acaoPrioritaria).toBe("avaliar_retirada_rede");
    expect(pass1Equivalent.acao).not.toBe(store1.acaoPrioritaria); // pass 2 genuinely changed the outcome

    // Every one of the 14 bad stores escalates uniformly — this is a network-wide verdict, not a
    // single-store one (contrast with the Paçoquita/Caso D scenario above, where only the one
    // affected store escalates).
    for (const id of BAD_STORE_IDS) {
      const rec = result.recommendations.find((r) => r.storeId === id)!;
      expect(rec.acaoPrioritaria).toBe("avaliar_retirada_rede");
    }
    for (const id of HEALTHY_STORE_IDS) {
      const rec = result.recommendations.find((r) => r.storeId === id)!;
      expect(rec.acaoPrioritaria).toBe("dados_insuficientes"); // no loss of any reason at all
    }

    // countsByAction sums exactly to the 17 Produto×Loja pairs.
    expect(result.recommendations).toHaveLength(17);
    assertCountsSumToPairs(result);
    expect(result.countsByAction.avaliar_retirada_rede).toBe(14);
    expect(result.countsByAction.dados_insuficientes).toBe(3);

    assertRedBlackActionsCarrySignal(result);
    assertNoNaNOrInfinity(result);
  });
});

// =================================================================================================
// Scenario 4 (required §18): "Outro motivo" severo e recorrente, rede majoritariamente saudável →
// avaliar_permanencia_loja, nunca avaliar_retirada_* — checked explicitly across the whole
// recommendations array (structurally guaranteed by diagnoseOtherReason never emitting a retirada
// action, but verified end-to-end here rather than assumed).
// =================================================================================================
describe("analyzeLossIntelligence — Outro motivo severo e recorrente, rede majoritariamente saudável", () => {
  const SKU = "SKU-OUTRO-MOTIVO-SEVERO";
  const BAD_STORE_ID = 1;
  const HEALTHY_STORE_IDS = [2, 3, 4, 5, 6];

  function buildInput(): LossIntelligenceInput {
    const stores = [store(BAD_STORE_ID, "Loja 1"), ...HEALTHY_STORE_IDS.map((id) => store(id, `Loja ${id}`))];
    const supplyRows: SupplyRecordInput[] = [
      supply(BAD_STORE_ID, "2025-01", SKU, 20), // pre-window → firstSeenRecently = false
      supply(BAD_STORE_ID, "2026-06", SKU, 12),
      supply(BAD_STORE_ID, "2026-07", SKU, 12),
      supply(BAD_STORE_ID, "2026-08", SKU, 12), // 36 total
    ];
    const salesRows: SalesRecordInput[] = [
      sale(BAD_STORE_ID, "2026-06", SKU, 10, 18000),
      sale(BAD_STORE_ID, "2026-07", SKU, 10, 18000),
      sale(BAD_STORE_ID, "2026-08", SKU, 10, 18000), // qtySold=30, revenue=54000
    ];
    for (const id of HEALTHY_STORE_IDS) {
      salesRows.push(sale(id, "2026-08", SKU, 5, 7500)); // just enough to count as "carrying", zero other_reason loss
    }
    const reconciliations: ReconciliationInput[] = [
      reconciliation(BAD_STORE_ID, "2026-06", [loss("other_reason", SKU, 3, 2700)]),
      reconciliation(BAD_STORE_ID, "2026-07", [loss("other_reason", SKU, 3, 2700)]),
      reconciliation(BAD_STORE_ID, "2026-08", [loss("other_reason", SKU, 3, 2600)]), // qtyLost=9, valueLostCents=8000
    ];
    return { stores, today: TODAY, parameters: DEFAULT_PARAMETERS, costsBySkuAsOf: flatCost, salesByStorePeriodSku: salesRows, supplyByStorePeriodSku: supplyRows, reconciliations };
  }

  it("severe (lossToMarginRatio >= 0.3, recurrent >= 3 periods) + network mostly healthy (1 of 6 bad, affectedShare=0.167 < 0.7) → avaliar_permanencia_loja, never avaliar_retirada_* anywhere in the output", () => {
    const result = analyzeLossIntelligence(buildInput());
    const badStore = result.recommendations.find((r) => r.storeId === BAD_STORE_ID)!;

    // Hand trace — grossMarginCents = revenue(54000) - cost(1000)*qtySold(30) = 24000.
    expect(badStore.metricasObservadas.grossMarginCents).toBe(24000);
    // lossToMarginRatio = 8000 / 24000 = 0.3333... >= otherReason.viabilityMaxRatio (0.3).
    const otherDiag = badStore.diagnosticosPorMotivo.find((d) => d.reason === "other_reason")!;
    expect(otherDiag.metrics.lossToMarginRatio).toBeCloseTo(8000 / 24000);
    // recurrencePeriodsWithLoss (lookback) = ["2026-06","2026-07","2026-08"], length 3 >=
    // minRecurringPeriods(3) → isOtherReasonSevereSignal = true → native action =
    // avaliar_permanencia_loja (never avaliar_retirada_*, per diagnosis/other-reason.ts's
    // mandatory §10.2 rule: "a causa continua desconhecida mesmo quando o impacto é severo").
    expect(otherDiag.sinaisDetectados).toContain("OTHER_REASON_SEVERE_RECURRING");

    // Network: 6 stores carry the SKU (>= minStoresForNetworkVerdict=5), only store 1 has the bad
    // signal (avaliar_permanencia_*) → affectedShare = 1/6 ≈ 0.167, well below
    // validity.networkWideMinShare (0.7, reused by other-reason.ts per its own comment) → no
    // escalation to avaliar_permanencia_rede.
    expect(badStore.comparacaoRede.other_reason).not.toBe("dado_insuficiente");
    if (badStore.comparacaoRede.other_reason !== "dado_insuficiente") {
      expect(badStore.comparacaoRede.other_reason.affectedShare).toBeCloseTo(1 / 6);
    }
    expect(badStore.firstSeenRecently).toBe(false); // pre-window history → no recent-history cap either
    expect(otherDiag.acao).toBe("avaliar_permanencia_loja");
    expect(badStore.acaoPrioritaria).toBe("avaliar_permanencia_loja");

    // The exhaustive check requested: no recommendation in the WHOLE array — priority or
    // secondary — is ever an avaliar_retirada_* action (structurally impossible for other_reason,
    // verified end to end rather than assumed).
    for (const rec of result.recommendations) {
      expect(rec.acaoPrioritaria).not.toBe("avaliar_retirada_loja");
      expect(rec.acaoPrioritaria).not.toBe("avaliar_retirada_rede");
      expect(rec.acoesSecundarias).not.toContain("avaliar_retirada_loja");
      expect(rec.acoesSecundarias).not.toContain("avaliar_retirada_rede");
      for (const diagnosis of rec.diagnosticosPorMotivo) {
        expect(diagnosis.acao).not.toBe("avaliar_retirada_loja");
        expect(diagnosis.acao).not.toBe("avaliar_retirada_rede");
      }
    }

    assertRedBlackActionsCarrySignal(result);
    assertNoNaNOrInfinity(result);
  });
});

// =================================================================================================
// Scenario 5 (required §18): SKU novo (firstSeenRecently=true expected) → no recommendation for
// this Produto×Loja pair exceeds the severity of reduzir_abastecimento/investigar, and prioridade
// never exceeds "media". Also exercises the documented other-reason.ts cap deviation: when the cap
// downgrades avaliar_permanencia_* to investigar, potencialIntervencao resets to "medio" (not left
// stale at "alto").
// =================================================================================================
describe("analyzeLossIntelligence — SKU novo (firstSeenRecently) caps every action and prioridade", () => {
  const SKU = "SKU-NOVO";
  const STORE_ID = 1;

  function buildInput(): LossIntelligenceInput {
    return {
      stores: [store(STORE_ID, "Loja Nova")],
      today: TODAY,
      parameters: DEFAULT_PARAMETERS,
      costsBySkuAsOf: flatCost,
      // No history before 2026-07 anywhere — genuinely a brand-new SKU. firstSeenPeriod = "2026-07",
      // monthsSinceFirstSeen(asOf="2026-08") = 1 < recentHistory.minClosedMonths(2) → firstSeenRecently=true.
      supplyByStorePeriodSku: [supply(STORE_ID, "2026-07", SKU, 15), supply(STORE_ID, "2026-08", SKU, 15)], // 30 total
      salesByStorePeriodSku: [sale(STORE_ID, "2026-07", SKU, 6, 15000), sale(STORE_ID, "2026-08", SKU, 4, 10000)], // qtySold=10, revenue=25000
      reconciliations: [
        reconciliation(STORE_ID, "2026-06", [loss("other_reason", SKU, 2, 2000)]),
        reconciliation(STORE_ID, "2026-07", [loss("expired", SKU, 2, 1000), loss("other_reason", SKU, 2, 2000)]),
        reconciliation(STORE_ID, "2026-08", [loss("expired", SKU, 2, 1000), loss("other_reason", SKU, 2, 2000)]),
      ],
    };
  }

  it("expired: Caso B (reduzir_abastecimento, already at its own ceiling — cap is a no-op). other_reason: severe native avaliar_permanencia_loja capped down to investigar, potencialIntervencao reset to medio (documented Task 11 deviation)", () => {
    const result = analyzeLossIntelligence(buildInput());
    const rec = result.recommendations.find((r) => r.storeId === STORE_ID && r.sku === SKU)!;

    expect(rec.firstSeenRecently).toBe(true);
    expect(rec.limitacoesDosDados).toContain("historico_recente");

    // Hand trace — expired: qtySold(10)>0, saleToSupplyRatio=10/30=0.333 < lowSaleRatio(0.5),
    // recurrencePeriodsWithLoss(lookback)=["2026-07","2026-08"] length 2 → isRecurrent → Caso B →
    // native action = reduzir_abastecimento (rank 5). Cap: clampSeverity(reduzir_abastecimento,
    // reduzir_abastecimento) — equal rank, not strictly less severe than the ceiling → unchanged,
    // no CAPPED_RECENT_HISTORY signal (it's already sitting exactly at its own cap).
    const expiredDiag = rec.diagnosticosPorMotivo.find((d) => d.reason === "expired")!;
    expect(expiredDiag.acao).toBe("reduzir_abastecimento");
    expect(expiredDiag.sinaisDetectados).toEqual(["LOW_SALE_RATIO_RECURRING_EXPIRY"]);

    // Hand trace — other_reason: grossMarginCents = 25000 - 1000*10 = 15000. valueLostCents=6000
    // (2000+2000+2000) >= negligibleValueCents(5000) → not negligible. lossToMarginRatio =
    // 6000/15000 = 0.4 >= viabilityMaxRatio(0.3). recurrencePeriodsWithLoss(lookback) =
    // ["2026-06","2026-07","2026-08"], length 3 >= minRecurringPeriods(3) → isSevere=true → native
    // action = avaliar_permanencia_loja (rank 3), potencialIntervencao native "alto". Only 1 store
    // total → network "dado_insuficiente" → no rede escalation regardless. Cap:
    // firstSeenRecently(true) && !overwhelmingEvidence(true, qtySold=10≠0) → clampSeverity(
    // avaliar_permanencia_loja, investigar): rank 3 < rank 6 → capped to "investigar" — AND, per
    // the documented other-reason.ts deviation, potencialIntervencao is explicitly reset to
    // "medio" here (not left stale at "alto", unlike validity.ts's cap where the values coincide).
    expect(rec.metricasObservadas.grossMarginCents).toBe(15000);
    const otherDiag = rec.diagnosticosPorMotivo.find((d) => d.reason === "other_reason")!;
    expect(otherDiag.metrics.lossToMarginRatio).toBeCloseTo(0.4);
    expect(otherDiag.sinaisDetectados).toEqual(["OTHER_REASON_SEVERE_RECURRING", "CAPPED_RECENT_HISTORY"]);
    expect(otherDiag.acao).toBe("investigar");
    expect(otherDiag.potencialIntervencao).toBe("medio"); // NOT "alto" — the deviation this test targets

    // Neither diagnosis exceeds its own designated ceiling (reduzir_abastecimento / investigar):
    // both are AT the ceiling, never past it (no suspender_abastecimento, no avaliar_*).
    for (const diagnosis of rec.diagnosticosPorMotivo) {
      expect(["reduzir_abastecimento", "investigar"]).toContain(diagnosis.acao);
    }

    // §11.2: severityRank(reduzir_abastecimento)=5 < severityRank(investigar)=6 → expired wins.
    expect(rec.acaoPrioritaria).toBe("reduzir_abastecimento");
    expect(rec.motivoDiagnosticoPrioritario).toBe("expired");

    // prioridade: reduzir_abastecimento ∈ HIGH_ACTIONS → would be "alta", but firstSeenRecently
    // caps HIGH/CRITICA down to "media" (priority.ts spec §9/§10.4) — never higher.
    expect(rec.prioridade).toBe("media");

    assertNoNaNOrInfinity(result);
  });
});

// =================================================================================================
// Required (task instructions, beyond the brief's 8 bullets): impactEstimateCents.conservative <=
// expected <= optimistic, and the sum explicitly excludes "manter"/"dados_insuficientes" lines —
// including a line with a HIGH maiorImpactoFinanceiroValueCents that ends up "manter" as its
// PRIORITY action (because its highest-value reason is itself "dados_insuficientes" and therefore
// less severe than "manter"), proving the exclusion is driven by acaoPrioritaria, not by a
// low-value coincidence.
// =================================================================================================
describe("analyzeLossIntelligence — impactEstimateCents: ordering and manter/dados_insuficientes exclusion", () => {
  const MANTER_STORE_ID = 1;
  const MANTER_SKU = "SKU-MANTER-ALTO";
  const ACIONAVEL_STORE_ID = 2;
  const ACIONAVEL_SKU = "SKU-ACIONAVEL-SUSPENDER";

  function buildInput(): LossIntelligenceInput {
    return {
      stores: [store(MANTER_STORE_ID, "Loja Alto Valor"), store(ACIONAVEL_STORE_ID, "Loja Acionável")],
      today: TODAY,
      parameters: DEFAULT_PARAMETERS,
      costsBySkuAsOf: flatCost,
      salesByStorePeriodSku: [],
      supplyByStorePeriodSku: [
        supply(ACIONAVEL_STORE_ID, "2025-01", ACIONAVEL_SKU, 20),
        supply(ACIONAVEL_STORE_ID, "2026-06", ACIONAVEL_SKU, 8),
        supply(ACIONAVEL_STORE_ID, "2026-07", ACIONAVEL_SKU, 8),
        supply(ACIONAVEL_STORE_ID, "2026-08", ACIONAVEL_SKU, 8), // 24 total, monthsWithRestock=3
      ],
      reconciliations: [
        // Store 1: damaged_product is HIGH value (R$1000) but only 1 store total carries damage
        // for this SKU (< damage.minStoresCarryingForConcentration=3) → dados_insuficientes
        // (rank 9). other_reason is negligible value (R$10 < negligibleValueCents R$50) → manter
        // (rank 8, more severe than dados_insuficientes) → wins as motivoDiagnosticoPrioritario.
        reconciliation(MANTER_STORE_ID, "2026-08", [loss("damaged_product", MANTER_SKU, 50, 100000), loss("other_reason", MANTER_SKU, 1, 1000)]),
        // Store 2: a clean Caso A (zero vendas, abastecimento repetido) → suspender_abastecimento, R$200.
        reconciliation(ACIONAVEL_STORE_ID, "2026-06", [loss("expired", ACIONAVEL_SKU, 4, 8000)]),
        reconciliation(ACIONAVEL_STORE_ID, "2026-07", [loss("expired", ACIONAVEL_SKU, 3, 6000)]),
        reconciliation(ACIONAVEL_STORE_ID, "2026-08", [loss("expired", ACIONAVEL_SKU, 3, 6000)]),
      ],
    };
  }

  it("manter pair's high maiorImpactoFinanceiroValueCents (R$1000, from a dados_insuficientes damaged_product diagnosis) never leaks into the sum; only the suspender_abastecimento pair's R$200 does", () => {
    const result = analyzeLossIntelligence(buildInput());
    const manterRec = result.recommendations.find((r) => r.storeId === MANTER_STORE_ID)!;
    const acionavelRec = result.recommendations.find((r) => r.storeId === ACIONAVEL_STORE_ID)!;

    // Confirm the "high value manter" setup: acaoPrioritaria="manter" while
    // maiorImpactoFinanceiroValueCents (a DIFFERENT field, from the higher-value but
    // dados_insuficientes damaged_product diagnosis) is conspicuously high.
    expect(manterRec.acaoPrioritaria).toBe("manter");
    expect(manterRec.motivoDiagnosticoPrioritario).toBe("other_reason");
    expect(manterRec.metricasObservadas.byReason.other_reason.valueLostCents).toBe(1000);
    expect(manterRec.maiorImpactoFinanceiroMotivo).toBe("damaged_product");
    expect(manterRec.maiorImpactoFinanceiroValueCents).toBe(100000); // conspicuously high — must NOT leak into the sum below

    expect(acionavelRec.acaoPrioritaria).toBe("suspender_abastecimento");
    expect(acionavelRec.metricasObservadas.byReason.expired.valueLostCents).toBe(20000);

    // computeImpactEstimate only sums eligible (non-manter, non-dados_insuficientes) pairs' PRIORITY
    // reason value: here, only acionavelRec's 20000 — never manterRec's 1000 (excluded by action
    // type) NOR manterRec's headline 100000 (never even read, since motivoDiagnosticoPrioritario
    // for that pair is other_reason, not damaged_product).
    expect(result.impactEstimateCents).toEqual({
      conservative: Math.round(20000 * 0.2), // 4000
      expected: Math.round(20000 * 0.4), // 8000
      optimistic: Math.round(20000 * 0.6), // 12000
    });
    expect(result.impactEstimateCents.conservative).toBeLessThanOrEqual(result.impactEstimateCents.expected);
    expect(result.impactEstimateCents.expected).toBeLessThanOrEqual(result.impactEstimateCents.optimistic);

    // If the exclusion were broken (e.g. summing maiorImpactoFinanceiroValueCents, or forgetting to
    // filter "manter"), optimistic would be at least 0.6*100000=60000 — far from the correct 12000.
    expect(result.impactEstimateCents.optimistic).toBeLessThan(60000);

    assertNoNaNOrInfinity(result);
  });
});

// =================================================================================================
// Required (task instructions, spec §19 edge case): all-zero-denominators store — only losses
// registered, zero supply, zero sales — confirms no field in the output is NaN/Infinity, and the
// engine never throws.
// =================================================================================================
describe("analyzeLossIntelligence — all-zero-denominators store (only losses, no supply, no sales)", () => {
  const SKU = "SKU-SO-PERDA";
  const STORE_ID = 1;

  function buildInput(): LossIntelligenceInput {
    return {
      stores: [store(STORE_ID, "Loja Só Perda")],
      today: TODAY,
      parameters: DEFAULT_PARAMETERS,
      costsBySkuAsOf: flatCost,
      salesByStorePeriodSku: [],
      supplyByStorePeriodSku: [],
      reconciliations: [reconciliation(STORE_ID, "2026-08", [loss("expired", SKU, 3, 3000)])],
    };
  }

  it("qtyRestocked=0, qtySold=0, revenueCents=0 → every ratio resolves to null (never division-by-zero NaN), grossMarginCents=0 (not null, no sales to price), diagnosis falls through to dados_insuficientes, priority=null — no throw, no NaN/Infinity anywhere", () => {
    const input = buildInput();
    expect(() => analyzeLossIntelligence(input)).not.toThrow();

    const result = analyzeLossIntelligence(input);
    expect(result.recommendations).toHaveLength(1);
    const rec = result.recommendations[0];

    expect(rec.metricasObservadas.qtyRestocked).toBe(0);
    expect(rec.metricasObservadas.qtySold).toBe(0);
    expect(rec.metricasObservadas.revenueCents).toBe(0);
    expect(rec.metricasObservadas.grossMarginCents).toBe(0); // no sales in window → stays at the initial 0, never null
    expect(rec.metricasObservadas.saleToSupplyRatio).toBeNull(); // qtyRestocked=0 → explicitly null, never 0/0
    expect(rec.metricasObservadas.byReason.expired.lossToSupplyRatio).toBeNull();
    expect(rec.metricasObservadas.byReason.expired.lossToRevenueRatio).toBeNull();
    expect(rec.metricasObservadas.byReason.expired.lossToMarginRatio).toBeNull(); // grossMarginCents=0 is not >0 → null, not 3000/0=Infinity

    // No supply/sales history at all → firstSeenPeriod=null → guard's "no_history" branch (an
    // explicit early return, never a division) → firstSeenRecently=true.
    expect(rec.firstSeenRecently).toBe(true);
    expect(rec.metricasObservadas.firstSeenPeriod).toBeNull();
    expect(rec.metricasObservadas.monthsSinceFirstSeen).toBeNull();

    // diagnoseValidity: qtySold===0 but monthsWithRestock(0) < minRepeatedSupplyMonths(2) → Caso A
    // fails; qtySold>0 fails (branch B); saleToSupplyRatio===null fails the branch-C guard (proven
    // not to throw, per validity.spec.ts's own "guarda de saleToSupplyRatio=null" test) → falls to
    // dados_insuficientes.
    expect(rec.diagnosticosPorMotivo).toHaveLength(1);
    expect(rec.diagnosticosPorMotivo[0].acao).toBe("dados_insuficientes");
    expect(rec.diagnosticosPorMotivo[0].potencialIntervencao).toBeNull();
    expect(rec.acaoPrioritaria).toBe("dados_insuficientes");
    expect(rec.prioridade).toBeNull(); // computePriority returns null for dados_insuficientes, never NaN
    expect(rec.confianca).toBe("insuficiente");

    expect(result.impactEstimateCents).toEqual({ conservative: 0, expected: 0, optimistic: 0 });
    assertCountsSumToPairs(result);
    assertNoNaNOrInfinity(result);
  });
});
