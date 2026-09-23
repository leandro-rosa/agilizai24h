import { describe, it, expect } from "@jest/globals";
import { diagnoseValidity, isValidityBadSignal } from "./validity";
import type { ValidityDiagnosisInput } from "./validity";
import { DEFAULT_PARAMETERS } from "../parameters";
import { ACTION_SEVERITY_ORDER, type LossAction, type NetworkComparisonResult, type PerReasonMetrics } from "../types";

// validity: { minRepeatedSupplyMonths: 2, lowSaleRatio: 0.5, localOutlierMaxShare: 0.3, networkWideMinShare: 0.7 }
const parameters = DEFAULT_PARAMETERS;

function metricsFixture(qtyLost: number): PerReasonMetrics {
  return { qtyLost, valueLostCents: qtyLost * 500, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null };
}

/** Caso A — the request's literal Paçoquita example: 18 abastecido / 0 vendido / 5 vencido / 3 meses com abastecimento. */
function caseAInput(overrides: Partial<ValidityDiagnosisInput> = {}): ValidityDiagnosisInput {
  return {
    metrics: metricsFixture(5),
    qtySold: 0,
    saleToSupplyRatio: 0, // 0 vendido / 18 abastecido = 0
    monthsWithRestock: 3,
    recurrencePeriodsWithLoss: ["2026-04", "2026-05", "2026-06"], // not read by branch A, but realistic (repeated expiry)
    networkComparison: null,
    firstSeenRecently: false,
    overwhelmingEvidence: false,
    parameters,
    ...overrides,
  };
}

/**
 * Caso B — adjusted per the plan's own documented caveat: the request's literal numbers
 * (50 abastecido / 42 vendido / 4 vencido) give saleToSupplyRatio = 42/50 = 0.84, which is
 * ABOVE lowSaleRatio (0.5) and therefore does NOT satisfy Caso B's condition
 * (saleToSupplyRatio < lowSaleRatio). Using 50 abastecido / 20 vendido instead:
 * ratio = 20/50 = 0.4 < 0.5, with real recurrence (2 periods in the lookback).
 */
function caseBInput(overrides: Partial<ValidityDiagnosisInput> = {}): ValidityDiagnosisInput {
  return {
    metrics: metricsFixture(4),
    qtySold: 20,
    saleToSupplyRatio: 0.4,
    monthsWithRestock: 3,
    recurrencePeriodsWithLoss: ["2026-05", "2026-06"], // 2 periods → isRecurrent = true
    networkComparison: null,
    firstSeenRecently: false,
    overwhelmingEvidence: false,
    parameters,
    ...overrides,
  };
}

const outlierNetworkComparison: NetworkComparisonResult = {
  storesCarryingSku: 10,
  storesWithSameSignal: 1,
  affectedShare: 0.1, // ≤ localOutlierMaxShare (0.3) → Caso D
  storesHealthy: ["Loja 02", "Loja 03", "Loja 04", "Loja 05", "Loja 06", "Loja 07", "Loja 08", "Loja 09", "Loja 10"],
};

const networkWideNetworkComparison: NetworkComparisonResult = {
  storesCarryingSku: 10,
  storesWithSameSignal: 8,
  affectedShare: 0.8, // ≥ networkWideMinShare (0.7) → Caso E
  storesHealthy: ["Loja 09", "Loja 10"],
};

const noEscalationNetworkComparison: NetworkComparisonResult = {
  storesCarryingSku: 10,
  storesWithSameSignal: 5,
  affectedShare: 0.5, // strictly between localOutlierMaxShare (0.3) and networkWideMinShare (0.7)
  storesHealthy: ["Loja 06", "Loja 07", "Loja 08", "Loja 09", "Loja 10"],
};

const boundaryLocalOutlierNetworkComparison: NetworkComparisonResult = {
  storesCarryingSku: 10,
  storesWithSameSignal: 3,
  affectedShare: 0.3, // exactly localOutlierMaxShare — code uses `<=`, so this must still escalate
  storesHealthy: ["Loja 04", "Loja 05", "Loja 06", "Loja 07", "Loja 08", "Loja 09", "Loja 10"],
};

const boundaryNetworkWideNetworkComparison: NetworkComparisonResult = {
  storesCarryingSku: 10,
  storesWithSameSignal: 7,
  affectedShare: 0.7, // exactly networkWideMinShare — code uses `>=`, so this must still escalate
  storesHealthy: ["Loja 08", "Loja 09", "Loja 10"],
};

describe("diagnoseValidity — Caso A (zero vendas, abastecimento repetido)", () => {
  it("Paçoquita literal: qtySold=0, monthsWithRestock=3, qtyLost=5 → suspender_abastecimento, alto, ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS", () => {
    const input = caseAInput();
    const result = diagnoseValidity(input);

    // Hand trace: qtySold === 0 (true) AND monthsWithRestock (3) >= minRepeatedSupplyMonths (2) (true)
    // → first branch fires. networkComparison is null (pass 1) → escalation block's outer `if`
    // short-circuits on `input.networkComparison` being falsy → skipped entirely.
    // firstSeenRecently is false → recent-history cap block's `if` is false → skipped entirely.
    // Final action is exactly what branch A set, untouched by either later block.
    expect(result).toEqual({
      reason: "expired",
      metrics: input.metrics,
      sinaisDetectados: ["ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS"],
      regrasAcionadas: ["ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS"],
      acao: "suspender_abastecimento",
      potencialIntervencao: "alto",
      hipoteses: [],
    });
  });

  it("monthsWithRestock=1 (below minRepeatedSupplyMonths=2) does NOT suspend — falls through to dados_insuficientes", () => {
    const input = caseAInput({ monthsWithRestock: 1 });
    const result = diagnoseValidity(input);

    // Hand trace: qtySold === 0 (true) AND monthsWithRestock (1) >= 2 (false) → branch A fails.
    // Branch B requires qtySold > 0 (false, qtySold=0) → fails.
    // Branch C requires saleToSupplyRatio !== null (true, it's 0) AND saleToSupplyRatio (0) >= lowSaleRatio (0.5)
    // → 0 >= 0.5 is false → fails.
    // All three branches fail → the `else` returns dados_insuficientes directly (early return,
    // never reaches the escalation or cap blocks).
    expect(result.acao).toBe("dados_insuficientes");
    expect(result.potencialIntervencao).toBeNull();
    expect(result.sinaisDetectados).toEqual(["INSUFFICIENT_EVIDENCE"]);
    expect(result.regrasAcionadas).toEqual(["INSUFFICIENT_EVIDENCE"]);
  });
});

describe("diagnoseValidity — Caso B (venda baixa em relação ao abastecido, recorrente)", () => {
  it("50 abastecido / 20 vendido (ratio 0.4 < 0.5), recorrente em 2 períodos → reduzir_abastecimento, alto, never avaliar_retirada_*", () => {
    const input = caseBInput();
    const result = diagnoseValidity(input);

    // Hand trace: branch A fails (qtySold=20 !== 0). Branch B: qtySold > 0 (true) AND
    // saleToSupplyRatio (0.4) !== null (true) AND 0.4 < lowSaleRatio (0.5) (true) AND
    // isRecurrent = recurrencePeriodsWithLoss.length (2) >= 2 (true) → branch B fires.
    // networkComparison is null → no escalation. firstSeenRecently is false → no cap.
    expect(result).toEqual({
      reason: "expired",
      metrics: input.metrics,
      sinaisDetectados: ["LOW_SALE_RATIO_RECURRING_EXPIRY"],
      regrasAcionadas: ["LOW_SALE_RATIO_RECURRING_EXPIRY"],
      acao: "reduzir_abastecimento",
      potencialIntervencao: "alto",
      hipoteses: [],
    });
  });

  it("documents the discrepancy: the request's literal 50/42 (ratio 0.84 ≥ 0.5), even if recorrente, does NOT satisfy Caso B — falls to dados_insuficientes, not reduzir/retirada", () => {
    // saleToSupplyRatio = 42/50 = 0.84. Recurrent (2 periods) so isIsolated = false.
    const input = caseBInput({ qtySold: 42, saleToSupplyRatio: 0.84 });
    const result = diagnoseValidity(input);

    // Hand trace: branch A fails (qtySold=42 !== 0). Branch B: 0.84 < lowSaleRatio (0.5) is false
    // → branch B fails. Branch C requires isIsolated (recurrencePeriodsWithLoss.length <= 1); here
    // it's 2, so isIsolated = false → branch C also fails (even though the ratio itself is healthy).
    // All three branches fail → dados_insuficientes. This is exactly why the fixture above uses
    // 20 (not 42) as qtySold — the plan's own caveat, verified here at the code level.
    expect(result.acao).toBe("dados_insuficientes");
    expect(result.potencialIntervencao).toBeNull();
  });
});

describe("diagnoseValidity — Caso C (venda saudável, perda pontual)", () => {
  it("saleToSupplyRatio=0.84, perda isolada (1 período no lookback) → manter_monitorar, baixo", () => {
    const input: ValidityDiagnosisInput = {
      metrics: metricsFixture(2),
      qtySold: 42,
      saleToSupplyRatio: 0.84,
      monthsWithRestock: 3,
      recurrencePeriodsWithLoss: ["2026-06"], // 1 period → isIsolated = true
      networkComparison: null,
      firstSeenRecently: false,
      overwhelmingEvidence: false,
      parameters,
    };
    const result = diagnoseValidity(input);

    // Hand trace: branch A fails (qtySold=42 !== 0). Branch B: 0.84 < 0.5 is false → fails.
    // Branch C: saleToSupplyRatio (0.84) !== null (true) AND 0.84 >= lowSaleRatio (0.5) (true) AND
    // isIsolated = recurrencePeriodsWithLoss.length (1) <= 1 (true) → branch C fires.
    expect(result).toEqual({
      reason: "expired",
      metrics: input.metrics,
      sinaisDetectados: ["HEALTHY_SALE_RATIO_ISOLATED_EXPIRY"],
      regrasAcionadas: ["HEALTHY_SALE_RATIO_ISOLATED_EXPIRY"],
      acao: "manter_monitorar",
      potencialIntervencao: "baixo",
      hipoteses: [],
    });
  });
});

describe("diagnoseValidity — escalada por rede (Casos D/E, passe 2)", () => {
  it("Caso D: Caso A + affectedShare=0.1 (≤ localOutlierMaxShare) → avaliar_retirada_loja, alto, signal appended (not replaced)", () => {
    const input = caseAInput({ networkComparison: outlierNetworkComparison });
    const result = diagnoseValidity(input);

    // Hand trace: branch A fires first → action=suspender_abastecimento, signals=[ZERO_SALES...].
    // Escalation guard: networkComparison is truthy, !== "dado_insuficiente", and action is
    // suspender_abastecimento → guard passes. nc.affectedShare (0.1) <= localOutlierMaxShare (0.3)
    // → true → action=avaliar_retirada_loja, potencialIntervencao stays "alto", signal APPENDED
    // (not replacing the original) via [...signals, "LOCAL_OUTLIER_VS_HEALTHY_NETWORK"].
    expect(result.acao).toBe("avaliar_retirada_loja");
    expect(result.potencialIntervencao).toBe("alto");
    expect(result.sinaisDetectados).toEqual(["ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS", "LOCAL_OUTLIER_VS_HEALTHY_NETWORK"]);
    expect(result.regrasAcionadas).toEqual(["ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS", "LOCAL_OUTLIER_VS_HEALTHY_NETWORK"]);
  });

  it("Caso D from Caso B base: reduzir_abastecimento + affectedShare=0.1 also escalates to avaliar_retirada_loja", () => {
    const input = caseBInput({ networkComparison: outlierNetworkComparison });
    const result = diagnoseValidity(input);

    expect(result.acao).toBe("avaliar_retirada_loja");
    expect(result.sinaisDetectados).toEqual(["LOW_SALE_RATIO_RECURRING_EXPIRY", "LOCAL_OUTLIER_VS_HEALTHY_NETWORK"]);
  });

  it("Caso E: Caso B + affectedShare=0.8 (≥ networkWideMinShare) → avaliar_retirada_rede, alto", () => {
    const input = caseBInput({ networkComparison: networkWideNetworkComparison });
    const result = diagnoseValidity(input);

    // Hand trace: branch B fires → action=reduzir_abastecimento. Escalation: affectedShare (0.8)
    // <= localOutlierMaxShare (0.3)? false. affectedShare (0.8) >= networkWideMinShare (0.7)? true
    // → action=avaliar_retirada_rede, signal appended.
    expect(result.acao).toBe("avaliar_retirada_rede");
    expect(result.potencialIntervencao).toBe("alto");
    expect(result.sinaisDetectados).toEqual(["LOW_SALE_RATIO_RECURRING_EXPIRY", "NETWORK_WIDE_LOW_PERFORMANCE_EXPIRY"]);
  });

  it("Caso E from Caso A base: suspender_abastecimento + affectedShare=0.8 also escalates to avaliar_retirada_rede", () => {
    const input = caseAInput({ networkComparison: networkWideNetworkComparison });
    const result = diagnoseValidity(input);

    expect(result.acao).toBe("avaliar_retirada_rede");
    expect(result.sinaisDetectados).toEqual(["ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS", "NETWORK_WIDE_LOW_PERFORMANCE_EXPIRY"]);
  });

  it("boundary: affectedShare exactly 0.3 (== localOutlierMaxShare) still escalates to D (code uses <=, not <)", () => {
    const input = caseAInput({ networkComparison: boundaryLocalOutlierNetworkComparison });
    const result = diagnoseValidity(input);

    expect(result.acao).toBe("avaliar_retirada_loja");
  });

  it("boundary: affectedShare exactly 0.7 (== networkWideMinShare) still escalates to E (code uses >=, not >)", () => {
    const input = caseBInput({ networkComparison: boundaryNetworkWideNetworkComparison });
    const result = diagnoseValidity(input);

    expect(result.acao).toBe("avaliar_retirada_rede");
  });

  it("zona sem escalada: affectedShare=0.5 (strictly between the two thresholds) leaves the Caso A/B action exactly unchanged — no upgrade, no downgrade", () => {
    const caseAResult = diagnoseValidity(caseAInput({ networkComparison: noEscalationNetworkComparison }));
    const caseBResult = diagnoseValidity(caseBInput({ networkComparison: noEscalationNetworkComparison }));

    // Hand trace: 0.5 <= 0.3 is false, and 0.5 >= 0.7 is also false → neither branch of the
    // escalation `if`/`else if` fires. `action` and `signals` pass through the block untouched.
    expect(caseAResult.acao).toBe("suspender_abastecimento");
    expect(caseAResult.sinaisDetectados).toEqual(["ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS"]); // no extra signal appended
    expect(caseBResult.acao).toBe("reduzir_abastecimento");
    expect(caseBResult.sinaisDetectados).toEqual(["LOW_SALE_RATIO_RECURRING_EXPIRY"]);
  });

  it("Caso D/E are refinements of A/B, not independent branches: a Caso C (healthy) diagnosis never escalates, even with a networkComparison that numerically would trigger D or E", () => {
    // Same affectedShare values that trigger escalation for Caso A/B above (0.1 and 0.8), but
    // applied to a Caso C (manter_monitorar) base. The escalation block's guard requires
    // `action === "suspender_abastecimento" || action === "reduzir_abastecimento"` — manter_monitorar
    // satisfies neither, so the guard short-circuits false and the whole block is skipped,
    // regardless of how "bad" networkComparison looks.
    const caseCBase: ValidityDiagnosisInput = {
      metrics: metricsFixture(2),
      qtySold: 42,
      saleToSupplyRatio: 0.84,
      monthsWithRestock: 3,
      recurrencePeriodsWithLoss: ["2026-06"],
      networkComparison: null,
      firstSeenRecently: false,
      overwhelmingEvidence: false,
      parameters,
    };

    const withOutlierShare = diagnoseValidity({ ...caseCBase, networkComparison: outlierNetworkComparison });
    const withNetworkWideShare = diagnoseValidity({ ...caseCBase, networkComparison: networkWideNetworkComparison });

    expect(withOutlierShare.acao).toBe("manter_monitorar");
    expect(withOutlierShare.sinaisDetectados).toEqual(["HEALTHY_SALE_RATIO_ISOLATED_EXPIRY"]);
    expect(withNetworkWideShare.acao).toBe("manter_monitorar");
    expect(withNetworkWideShare.sinaisDetectados).toEqual(["HEALTHY_SALE_RATIO_ISOLATED_EXPIRY"]);
  });

  it("networkComparison=null (passe 1) never escalates, even though the same base numbers escalate once the network comparison resolves (see Caso D above)", () => {
    const input = caseAInput({ networkComparison: null });
    const result = diagnoseValidity(input);

    // Contrast with the Caso D test above (identical caseAInput(), differing only in
    // networkComparison): here the escalation `if (input.networkComparison && ...)` short-circuits
    // on `input.networkComparison` being null itself, so `nc.affectedShare` is never even read.
    expect(result.acao).toBe("suspender_abastecimento");
    expect(result.sinaisDetectados).toEqual(["ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS"]);
  });

  it("networkComparison='dado_insuficiente' behaves identically to null — never escalates", () => {
    const input = caseAInput({ networkComparison: "dado_insuficiente" });
    const result = diagnoseValidity(input);

    // The guard is `input.networkComparison !== "dado_insuficiente"` — false here, so the escalation
    // block is skipped exactly like the null case, even though `input.networkComparison` is truthy
    // (the string "dado_insuficiente" is a non-empty string, hence truthy) — proves the code checks
    // BOTH conditions, not just falsiness.
    expect(result.acao).toBe("suspender_abastecimento");
    expect(result.sinaisDetectados).toEqual(["ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS"]);
  });
});

describe("diagnoseValidity — teto de histórico recente (spec §9)", () => {
  it("Caso A + firstSeenRecently=true, overwhelmingEvidence=false → capped down to reduzir_abastecimento (never suspender), CAPPED_RECENT_HISTORY appended", () => {
    const input = caseAInput({ firstSeenRecently: true, overwhelmingEvidence: false });
    const result = diagnoseValidity(input);

    // Hand trace: branch A fires → action=suspender_abastecimento (severity rank 4), signals=[ZERO_SALES...].
    // No escalation (networkComparison null). Cap block: firstSeenRecently (true) AND
    // !overwhelmingEvidence (!false = true) → fires. clampSeverity("suspender_abastecimento",
    // "reduzir_abastecimento"): severityRank(suspender_abastecimento)=4 < severityRank(reduzir_abastecimento)=5
    // → true → returns the ceiling "reduzir_abastecimento". capped ("reduzir_abastecimento") !==
    // action ("suspender_abastecimento") → CAPPED_RECENT_HISTORY appended.
    // Note: the cap block only reassigns `action`, never `potencialIntervencao` — it stays "alto"
    // from branch A even though the action was downgraded (this is the code's actual behavior,
    // not something to "fix").
    expect(result.acao).toBe("reduzir_abastecimento");
    expect(result.potencialIntervencao).toBe("alto");
    expect(result.sinaisDetectados).toEqual(["ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS", "CAPPED_RECENT_HISTORY"]);
    expect(result.regrasAcionadas).toEqual(["ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS", "CAPPED_RECENT_HISTORY"]);
  });

  it("exceção de evidência esmagadora: same scenario but overwhelmingEvidence=true → suspender_abastecimento passes through uncapped", () => {
    const input = caseAInput({ firstSeenRecently: true, overwhelmingEvidence: true });
    const result = diagnoseValidity(input);

    // Cap block: firstSeenRecently (true) AND !overwhelmingEvidence (!true = false) → condition
    // is false → block skipped entirely. action stays "suspender_abastecimento", no
    // CAPPED_RECENT_HISTORY signal.
    expect(result.acao).toBe("suspender_abastecimento");
    expect(result.potencialIntervencao).toBe("alto");
    expect(result.sinaisDetectados).toEqual(["ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS"]);
  });

  it("the cap also clamps an escalated avaliar_retirada_loja (Caso D) down to reduzir_abastecimento — never lets a 🔴/⚫ action through", () => {
    const input = caseAInput({ networkComparison: outlierNetworkComparison, firstSeenRecently: true, overwhelmingEvidence: false });
    const result = diagnoseValidity(input);

    // Hand trace: branch A → suspender_abastecimento. Escalation (affectedShare 0.1 <= 0.3) →
    // avaliar_retirada_loja (severity rank 2), signals=[ZERO_SALES..., LOCAL_OUTLIER...].
    // Cap: clampSeverity("avaliar_retirada_loja", "reduzir_abastecimento"):
    // severityRank(avaliar_retirada_loja)=2 < severityRank(reduzir_abastecimento)=5 → true →
    // capped to "reduzir_abastecimento". CAPPED_RECENT_HISTORY appended as a third signal.
    expect(result.acao).toBe("reduzir_abastecimento");
    expect(result.sinaisDetectados).toEqual(["ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS", "LOCAL_OUTLIER_VS_HEALTHY_NETWORK", "CAPPED_RECENT_HISTORY"]);
  });

  it("the cap does not affect an action already milder than reduzir_abastecimento (Caso C's manter_monitorar) — no spurious signal", () => {
    const input: ValidityDiagnosisInput = {
      metrics: metricsFixture(2),
      qtySold: 42,
      saleToSupplyRatio: 0.84,
      monthsWithRestock: 3,
      recurrencePeriodsWithLoss: ["2026-06"],
      networkComparison: null,
      firstSeenRecently: true,
      overwhelmingEvidence: false,
      parameters,
    };
    const result = diagnoseValidity(input);

    // clampSeverity("manter_monitorar", "reduzir_abastecimento"): severityRank(manter_monitorar)=7
    // < severityRank(reduzir_abastecimento)=5 is false (7 is NOT < 5) → returns action unchanged.
    // capped === action → no CAPPED_RECENT_HISTORY signal appended.
    expect(result.acao).toBe("manter_monitorar");
    expect(result.sinaisDetectados).toEqual(["HEALTHY_SALE_RATIO_ISOLATED_EXPIRY"]);
  });
});

describe("diagnoseValidity — guarda de saleToSupplyRatio=null", () => {
  it("saleToSupplyRatio=null (qtyRestocked=0 na janela, com perda registrada de abastecimento anterior) → dados_insuficientes, never divides by zero or throws", () => {
    const input: ValidityDiagnosisInput = {
      metrics: metricsFixture(3), // historical loss recorded before this window's restock
      qtySold: 5, // sales can still happen from stock carried over from before the window
      saleToSupplyRatio: null, // qtyRestocked=0 in the window → undefined ratio, computed upstream as null
      monthsWithRestock: 0,
      recurrencePeriodsWithLoss: [],
      networkComparison: null,
      firstSeenRecently: false,
      overwhelmingEvidence: false,
      parameters,
    };

    // Hand trace: branch A: qtySold === 0? false (5) → fails, short-circuits before touching
    // saleToSupplyRatio. Branch B: qtySold > 0 (true) AND saleToSupplyRatio !== null (false, it IS
    // null) → short-circuits false BEFORE the `saleToSupplyRatio < p.lowSaleRatio` comparison would
    // ever run — proves the null check guards the comparison, not just decorates it. Branch C:
    // saleToSupplyRatio !== null? false → fails the same way. All three branches fail → dados_insuficientes.
    expect(() => diagnoseValidity(input)).not.toThrow();
    const result = diagnoseValidity(input);
    expect(result.acao).toBe("dados_insuficientes");
    expect(result.potencialIntervencao).toBeNull();
    expect(result.sinaisDetectados).toEqual(["INSUFFICIENT_EVIDENCE"]);
  });
});

describe("regra: toda ação 🔴/⚫ (suspender/avaliar_retirada_*) carrega pelo menos um sinal", () => {
  it("suspender_abastecimento, avaliar_retirada_loja and avaliar_retirada_rede all carry ≥1 sinalDetectado and regraAcionada", () => {
    const redBlackScenarios: ValidityDiagnosisInput[] = [
      caseAInput(), // suspender_abastecimento
      caseAInput({ networkComparison: outlierNetworkComparison }), // avaliar_retirada_loja
      caseBInput({ networkComparison: networkWideNetworkComparison }), // avaliar_retirada_rede
    ];

    for (const input of redBlackScenarios) {
      const result = diagnoseValidity(input);
      expect(["suspender_abastecimento", "avaliar_retirada_loja", "avaliar_retirada_rede"]).toContain(result.acao);
      expect(result.sinaisDetectados.length).toBeGreaterThan(0);
      expect(result.regrasAcionadas.length).toBeGreaterThan(0);
    }
  });
});

describe("isValidityBadSignal", () => {
  it("true exactly for suspender_abastecimento and reduzir_abastecimento, false for all other 8 LossAction values", () => {
    const badActions: LossAction[] = ["suspender_abastecimento", "reduzir_abastecimento"];
    for (const action of ACTION_SEVERITY_ORDER) {
      expect(isValidityBadSignal(action)).toBe(badActions.includes(action));
    }
  });
});
