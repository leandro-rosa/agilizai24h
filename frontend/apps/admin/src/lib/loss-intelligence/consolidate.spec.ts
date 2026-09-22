import { describe, it, expect } from "@jest/globals";
import { consolidate } from "./consolidate";
import type { ConsolidateInput } from "./consolidate";
import type { Confidence, InterventionPotential, LossAction, LossReason, PerReasonMetrics, ReasonDiagnosis } from "./types";

// Only 3 LossReason values exist ("expired", "damaged_product", "other_reason") — engine.ts calls
// consolidate() once per Produto×Loja with at most one ReasonDiagnosis per reason, so every
// fixture below has at most 3 diagnoses. Alphabetically: "damaged_product" < "expired" <
// "other_reason" (d < e < o) — relevant for every criterion-(e) test below.

function metricsFixture(qtyLost: number, valueLostCents: number): PerReasonMetrics {
  return { qtyLost, valueLostCents, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null };
}

function diagnosis(
  reason: LossReason,
  acao: LossAction,
  opts: { potencialIntervencao?: InterventionPotential | null; qtyLost?: number; valueLostCents?: number } = {},
): ReasonDiagnosis {
  const { potencialIntervencao = "medio", qtyLost = 1, valueLostCents = 1000 } = opts;
  return { reason, metrics: metricsFixture(qtyLost, valueLostCents), sinaisDetectados: [], regrasAcionadas: [], acao, potencialIntervencao, hipoteses: [] };
}

function recurrenceMap(overrides: Partial<Record<LossReason, number>> = {}): Record<LossReason, number> {
  return { expired: 0, damaged_product: 0, other_reason: 0, ...overrides };
}

function confidenceMap(overrides: Partial<Record<LossReason, Confidence>> = {}): Record<LossReason, Confidence> {
  return { expired: "media", damaged_product: "media", other_reason: "media", ...overrides };
}

function buildInput(
  diagnoses: ReasonDiagnosis[],
  recurrence: Partial<Record<LossReason, number>> = {},
  confidence: Partial<Record<LossReason, Confidence>> = {},
): ConsolidateInput {
  return { diagnoses, recurrencePeriodCountByReason: recurrenceMap(recurrence), confidenceByReason: confidenceMap(confidence) };
}

describe("consolidate — empty input", () => {
  it("diagnoses=[] → all fields null/empty, acaoPrioritaria='dados_insuficientes'", () => {
    const result = consolidate(buildInput([]));
    expect(result).toEqual({
      maiorImpactoFinanceiroMotivo: null,
      maiorImpactoFinanceiroValueCents: 0,
      motivoDiagnosticoPrioritario: null,
      motivosSecundarios: [],
      acaoPrioritaria: "dados_insuficientes",
      acoesSecundarias: [],
    });
  });
});

describe("consolidate — §11.3 headline divergence example", () => {
  it("damaged_product R$300 pontual (investigar) vs expired R$220 recorrente (suspender_abastecimento): maiorImpactoFinanceiroMotivo and motivoDiagnosticoPrioritario genuinely disagree", () => {
    // damaged_product: highest financial value (R$300 = 30000 cents), but a mild, non-recurring
    // signal — acao="investigar" (severity rank 6), potencialIntervencao="baixo", low recurrence.
    const damaged = diagnosis("damaged_product", "investigar", { potencialIntervencao: "baixo", qtyLost: 3, valueLostCents: 30000 });
    // expired: lower financial value (R$220 = 22000 cents), but recurrent for 4 months with no
    // sales — acao="suspender_abastecimento" (severity rank 4, strictly more severe than rank 6),
    // potencialIntervencao="alto", high recurrence.
    const expired = diagnosis("expired", "suspender_abastecimento", { potencialIntervencao: "alto", qtyLost: 2, valueLostCents: 22000 });

    const result = consolidate(buildInput([damaged, expired], { expired: 4, damaged_product: 1 }, { expired: "alta", damaged_product: "media" }));

    // Hand trace §11.1 (byValue): 30000 > 22000 → damaged_product wins on pure R$, no tie-break needed.
    expect(result.maiorImpactoFinanceiroMotivo).toBe("damaged_product");
    expect(result.maiorImpactoFinanceiroValueCents).toBe(30000);

    // Hand trace §11.2 (bySeverity): severityRank("suspender_abastecimento") = 4 <
    // severityRank("investigar") = 6 → expired wins outright on severity alone; the 5-step
    // tie-break chain never even runs (ranks differ at the first comparison).
    expect(result.motivoDiagnosticoPrioritario).toBe("expired");
    expect(result.acaoPrioritaria).toBe("suspender_abastecimento");
    expect(result.motivosSecundarios).toEqual(["damaged_product"]);
    expect(result.acoesSecundarias).toEqual(["investigar"]);

    // The two headline fields disagree in the SAME result — proves neither secretly reuses the
    // other's sort.
    expect(result.maiorImpactoFinanceiroMotivo).not.toBe(result.motivoDiagnosticoPrioritario);
  });

  it("no divergence when only one reason has loss: both headline fields coincide, motivosSecundarios=[]", () => {
    const expired = diagnosis("expired", "reduzir_abastecimento", { potencialIntervencao: "medio", qtyLost: 2, valueLostCents: 22000 });
    const result = consolidate(buildInput([expired], { expired: 2 }, { expired: "media" }));

    expect(result.maiorImpactoFinanceiroMotivo).toBe("expired");
    expect(result.maiorImpactoFinanceiroValueCents).toBe(22000);
    expect(result.motivoDiagnosticoPrioritario).toBe("expired");
    expect(result.acaoPrioritaria).toBe("reduzir_abastecimento");
    expect(result.motivosSecundarios).toEqual([]);
    expect(result.acoesSecundarias).toEqual([]);
  });
});

describe("consolidate — severity ordering (ACTION_SEVERITY_ORDER, not an assumed order)", () => {
  // Each pair isolates two ADJACENT entries of ACTION_SEVERITY_ORDER's first 5 slots
  // (avaliar_retirada_rede > avaliar_permanencia_rede > avaliar_retirada_loja >
  // avaliar_permanencia_loja > suspender_abastecimento). Severity differs outright for every
  // pair, so no tie-break step runs — this isolates the primary severity comparison itself.

  it("avaliar_retirada_rede outranks avaliar_permanencia_rede", () => {
    const a = diagnosis("damaged_product", "avaliar_retirada_rede");
    const b = diagnosis("expired", "avaliar_permanencia_rede");
    const result = consolidate(buildInput([a, b]));
    expect(result.motivoDiagnosticoPrioritario).toBe("damaged_product");
    expect(result.acaoPrioritaria).toBe("avaliar_retirada_rede");
    expect(result.motivosSecundarios).toEqual(["expired"]);
  });

  it("avaliar_permanencia_rede outranks avaliar_retirada_loja", () => {
    const a = diagnosis("damaged_product", "avaliar_permanencia_rede");
    const b = diagnosis("expired", "avaliar_retirada_loja");
    const result = consolidate(buildInput([a, b]));
    expect(result.motivoDiagnosticoPrioritario).toBe("damaged_product");
    expect(result.acaoPrioritaria).toBe("avaliar_permanencia_rede");
    expect(result.motivosSecundarios).toEqual(["expired"]);
  });

  it("avaliar_retirada_loja outranks avaliar_permanencia_loja", () => {
    const a = diagnosis("damaged_product", "avaliar_retirada_loja");
    const b = diagnosis("expired", "avaliar_permanencia_loja");
    const result = consolidate(buildInput([a, b]));
    expect(result.motivoDiagnosticoPrioritario).toBe("damaged_product");
    expect(result.acaoPrioritaria).toBe("avaliar_retirada_loja");
    expect(result.motivosSecundarios).toEqual(["expired"]);
  });

  it("avaliar_permanencia_loja outranks suspender_abastecimento", () => {
    const a = diagnosis("damaged_product", "avaliar_permanencia_loja");
    const b = diagnosis("expired", "suspender_abastecimento");
    const result = consolidate(buildInput([a, b]));
    expect(result.motivoDiagnosticoPrioritario).toBe("damaged_product");
    expect(result.acaoPrioritaria).toBe("avaliar_permanencia_loja");
    expect(result.motivosSecundarios).toEqual(["expired"]);
  });
});

describe("consolidate — tie-break chain, each step isolated (all earlier steps forced to tie)", () => {
  it("(a) same severity, different recurrence → more recurrence periods wins", () => {
    // Both suspender_abastecimento (severity tie). potencialIntervencao, confidence, and value
    // all held equal so only recurrence can decide.
    const low = diagnosis("damaged_product", "suspender_abastecimento", { potencialIntervencao: "medio", valueLostCents: 10000 });
    const high = diagnosis("expired", "suspender_abastecimento", { potencialIntervencao: "medio", valueLostCents: 10000 });
    const result = consolidate(buildInput([low, high], { damaged_product: 2, expired: 5 }, { damaged_product: "media", expired: "media" }));

    // Hand trace: severity tie → (a) recA=2, recB=5 → recB (expired) is higher → expired wins.
    expect(result.motivoDiagnosticoPrioritario).toBe("expired");
    expect(result.motivosSecundarios).toEqual(["damaged_product"]);
  });

  it("(b) same severity+recurrence, different potencialIntervencao → higher potential (ordinal, not numeric) wins", () => {
    const alto = diagnosis("damaged_product", "suspender_abastecimento", { potencialIntervencao: "alto", valueLostCents: 10000 });
    const medio = diagnosis("expired", "suspender_abastecimento", { potencialIntervencao: "medio", valueLostCents: 10000 });
    const result = consolidate(buildInput([alto, medio], { damaged_product: 3, expired: 3 }, { damaged_product: "media", expired: "media" }));

    // Hand trace: severity tie, recurrence tie (3=3) → (b) INTERVENTION_POTENTIAL_ORDER =
    // ["alto","medio","baixo"] → indexOf("alto")=0 < indexOf("medio")=1 → lower index (damaged_product,
    // "alto") wins. This is an ORDINAL comparison via indexOf, never a numeric/string compare of
    // "alto" vs "medio" directly.
    expect(result.motivoDiagnosticoPrioritario).toBe("damaged_product");
    expect(result.motivosSecundarios).toEqual(["expired"]);
  });

  it("(b) 'alto'×'alto' is a genuine tie — falls through to (c) confidence, does not stop at a false tie", () => {
    // Both potencialIntervencao="alto" (tied at (b)). Input order deliberately lists the LOSING
    // reason (expired, lower confidence) FIRST, so a bug that just returned the first array
    // element on a false (b)-tie would report "expired" instead of the correct "damaged_product".
    const expiredFirst = diagnosis("expired", "suspender_abastecimento", { potencialIntervencao: "alto", valueLostCents: 10000 });
    const damagedSecond = diagnosis("damaged_product", "suspender_abastecimento", { potencialIntervencao: "alto", valueLostCents: 10000 });
    const result = consolidate(buildInput([expiredFirst, damagedSecond], { damaged_product: 3, expired: 3 }, { damaged_product: "alta", expired: "baixa" }));

    // Hand trace: severity tie, recurrence tie (3=3), potencial tie ("alto"="alto", potA=potB=0)
    // → (c) CONFIDENCE_ORDER = ["alta","media","baixa","insuficiente"] → indexOf("alta")=0 <
    // indexOf("baixa")=2 → damaged_product (higher confidence) wins, despite being listed second
    // in the input array.
    expect(result.motivoDiagnosticoPrioritario).toBe("damaged_product");
    expect(result.motivosSecundarios).toEqual(["expired"]);
  });

  it("(c) tied through (b) with a non-edge potencial ('medio'='medio'), different confidence → higher confidence wins", () => {
    const alta = diagnosis("damaged_product", "suspender_abastecimento", { potencialIntervencao: "medio", valueLostCents: 10000 });
    const baixa = diagnosis("expired", "suspender_abastecimento", { potencialIntervencao: "medio", valueLostCents: 10000 });
    const result = consolidate(buildInput([alta, baixa], { damaged_product: 2, expired: 2 }, { damaged_product: "alta", expired: "baixa" }));

    expect(result.motivoDiagnosticoPrioritario).toBe("damaged_product");
    expect(result.motivosSecundarios).toEqual(["expired"]);
  });

  it("(d) tied through (c), different valueLostCents → higher value wins", () => {
    const lowValue = diagnosis("damaged_product", "suspender_abastecimento", { potencialIntervencao: "medio", valueLostCents: 5000 });
    const highValue = diagnosis("expired", "suspender_abastecimento", { potencialIntervencao: "medio", valueLostCents: 8000 });
    const result = consolidate(buildInput([lowValue, highValue], { damaged_product: 2, expired: 2 }, { damaged_product: "media", expired: "media" }));

    // Hand trace: severity tie, recurrence tie, potencial tie, confidence tie ("media"="media")
    // → (d) 8000 > 5000 → expired (higher value) wins.
    expect(result.motivoDiagnosticoPrioritario).toBe("expired");
    expect(result.motivosSecundarios).toEqual(["damaged_product"]);
  });

  it("(e) everything tied → alphabetical, and the result is identical run twice with the input array in different orders (deterministic, not accidentally stable-by-input-order)", () => {
    // All 3 reasons tied on acao, recurrence, potencialIntervencao, confidence, AND value —
    // only reason string is left to decide. Alphabetically: damaged_product < expired < other_reason.
    const damaged = diagnosis("damaged_product", "suspender_abastecimento", { potencialIntervencao: "medio", qtyLost: 5, valueLostCents: 10000 });
    const expired = diagnosis("expired", "suspender_abastecimento", { potencialIntervencao: "medio", qtyLost: 5, valueLostCents: 10000 });
    const other = diagnosis("other_reason", "suspender_abastecimento", { potencialIntervencao: "medio", qtyLost: 5, valueLostCents: 10000 });
    const tiedRecurrence = { damaged_product: 2, expired: 2, other_reason: 2 };
    const tiedConfidence: Record<LossReason, Confidence> = { damaged_product: "media", expired: "media", other_reason: "media" };

    const runA = consolidate(buildInput([other, expired, damaged], tiedRecurrence, tiedConfidence)); // reverse-alphabetical input order
    const runB = consolidate(buildInput([expired, damaged, other], tiedRecurrence, tiedConfidence)); // a different permutation

    const expected = {
      maiorImpactoFinanceiroMotivo: "damaged_product",
      maiorImpactoFinanceiroValueCents: 10000,
      motivoDiagnosticoPrioritario: "damaged_product",
      motivosSecundarios: ["expired", "other_reason"],
      acaoPrioritaria: "suspender_abastecimento",
      acoesSecundarias: ["suspender_abastecimento", "suspender_abastecimento"],
    };
    expect(runA).toEqual(expected);
    expect(runB).toEqual(expected);
    // Same object shape from both runs, proving the sort output does not depend on input order.
    expect(runA).toEqual(runB);
  });
});

describe("consolidate — security exception: a diagnosis that loses on tie-break is never dropped", () => {
  it("an avaliar_retirada_rede diagnosis that is NOT prioritário (loses the tie-break to another avaliar_retirada_rede) still appears in motivosSecundarios/acoesSecundarias", () => {
    // Two reasons both get the single most severe action in ACTION_SEVERITY_ORDER
    // (avaliar_retirada_rede, rank 0) — nothing in the enum outranks it by severity alone, so the
    // only way one of them is NOT prioritário is for it to lose the tie-break chain. A third
    // (much milder) reason fills out a realistic 3-diagnosis Produto×Loja fixture.
    const damaged = diagnosis("damaged_product", "avaliar_retirada_rede", { potencialIntervencao: "alto", valueLostCents: 50000 });
    const expired = diagnosis("expired", "avaliar_retirada_rede", { potencialIntervencao: "baixo", valueLostCents: 1000 });
    const other = diagnosis("other_reason", "manter", { potencialIntervencao: "baixo", valueLostCents: 500 });

    const result = consolidate(
      buildInput([damaged, expired, other], { damaged_product: 1, expired: 5, other_reason: 0 }, { damaged_product: "alta", expired: "baixa", other_reason: "media" }),
    );

    // Hand trace: damaged_product and expired tie on severity (both rank 0) → (a) recurrence:
    // expired=5 > damaged_product=1 → expired wins the tie-break and becomes prioritário, despite
    // damaged_product having higher potencialIntervencao/confidence/value (those criteria are
    // never reached — (a) already decided). damaged_product's avaliar_retirada_rede diagnosis is
    // NOT the prioritário, but it MUST still surface as secondary — never silently dropped.
    expect(result.motivoDiagnosticoPrioritario).toBe("expired");
    expect(result.acaoPrioritaria).toBe("avaliar_retirada_rede");
    expect(result.motivosSecundarios).toEqual(["damaged_product", "other_reason"]);
    expect(result.acoesSecundarias).toEqual(["avaliar_retirada_rede", "manter"]);

    // The security-critical assertion: the losing avaliar_retirada_rede diagnosis is present.
    expect(result.motivosSecundarios).toContain("damaged_product");
    expect(result.acoesSecundarias).toContain("avaliar_retirada_rede");
  });
});

describe("consolidate — does not mutate its input", () => {
  it("leaves input.diagnoses in its original order after sorting internally", () => {
    const a = diagnosis("other_reason", "manter");
    const b = diagnosis("expired", "avaliar_retirada_rede");
    const c = diagnosis("damaged_product", "investigar");
    const diagnoses = [a, b, c];
    const original = [...diagnoses];

    consolidate(buildInput(diagnoses));

    expect(diagnoses).toEqual(original);
    expect(diagnoses[0]).toBe(a);
    expect(diagnoses[1]).toBe(b);
    expect(diagnoses[2]).toBe(c);
  });
});
