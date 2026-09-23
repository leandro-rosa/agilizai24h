import { describe, it, expect } from "@jest/globals";
import { diagnoseOtherReason, isOtherReasonSevereSignal } from "./other-reason";
import type { OtherReasonDiagnosisInput } from "./other-reason";
import { DEFAULT_PARAMETERS } from "../parameters";
import type { NetworkComparisonResult, PerReasonMetrics } from "../types";

// otherReason: { minHealthyUnits: 20, viabilityMaxRatio: 0.3, negligibleValueCents: 5000, localConcentrationMin: 0.7, minRecurringPeriods: 3 }
// validity.networkWideMinShare: 0.7 (deliberately reused by other-reason.ts, see its own comment)
const parameters = DEFAULT_PARAMETERS;

function metricsFixture(qtyLost: number, valueLostCents: number, lossToMarginRatio: number | null): PerReasonMetrics {
  return { qtyLost, valueLostCents, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio };
}

/** Base: healthy-isolated shape (the request's literal example — 84 vendidos, margem positiva, 1 período com perda). */
function baseInput(overrides: Partial<OtherReasonDiagnosisInput> = {}): OtherReasonDiagnosisInput {
  return {
    metrics: metricsFixture(5, 20000, 0.1),
    qtySold: 84,
    grossMarginCents: 100000,
    recurrencePeriodsWithLoss: ["2026-06"],
    concentrationShareStore: 0.1,
    networkComparison: null,
    firstSeenRecently: false,
    overwhelmingEvidence: false,
    parameters,
    ...overrides,
  };
}

/** Severe-and-recurrent base: lossToMarginRatio (0.35) ≥ viabilityMaxRatio (0.3), 3 periods ≥ minRecurringPeriods (3). */
function severeInput(overrides: Partial<OtherReasonDiagnosisInput> = {}): OtherReasonDiagnosisInput {
  return baseInput({
    metrics: metricsFixture(20, 50000, 0.35),
    recurrencePeriodsWithLoss: ["2026-04", "2026-05", "2026-06"],
    ...overrides,
  });
}

const networkHealthy: NetworkComparisonResult = {
  storesCarryingSku: 10,
  storesWithSameSignal: 2,
  affectedShare: 0.2, // < validity.networkWideMinShare (0.7)
  storesHealthy: ["Loja 03", "Loja 04", "Loja 05", "Loja 06", "Loja 07", "Loja 08", "Loja 09", "Loja 10"],
};

const networkSevere: NetworkComparisonResult = {
  storesCarryingSku: 10,
  storesWithSameSignal: 8,
  affectedShare: 0.8, // ≥ validity.networkWideMinShare (0.7)
  storesHealthy: ["Loja 09", "Loja 10"],
};

describe("diagnoseOtherReason — impacto desprezível", () => {
  it("valueLostCents (1000) < negligibleValueCents (5000) → manter, baixo, OTHER_REASON_NEGLIGIBLE", () => {
    const input = baseInput({ metrics: metricsFixture(1, 1000, 0.9) }); // lossToMarginRatio would be "severe" on its own — proves the negligible check runs first
    const result = diagnoseOtherReason(input);

    expect(result).toEqual({
      reason: "other_reason",
      metrics: input.metrics,
      sinaisDetectados: ["OTHER_REASON_NEGLIGIBLE"],
      regrasAcionadas: ["OTHER_REASON_NEGLIGIBLE"],
      acao: "manter",
      potencialIntervencao: "baixo",
      hipoteses: [],
    });
  });

  it("valueLostCents fires the negligible branch even when grossMarginCents is null — negligible is checked before margin-unknown", () => {
    const input = baseInput({ metrics: metricsFixture(1, 1000, null), grossMarginCents: null });
    const result = diagnoseOtherReason(input);

    expect(result.acao).toBe("manter");
    expect(result.sinaisDetectados).toEqual(["OTHER_REASON_NEGLIGIBLE"]);
  });
});

describe("diagnoseOtherReason — margem desconhecida", () => {
  it("grossMarginCents=null (valueLostCents above negligible floor) → dados_insuficientes, never assumes margin", () => {
    const input = baseInput({ grossMarginCents: null });
    const result = diagnoseOtherReason(input);

    expect(result).toEqual({
      reason: "other_reason",
      metrics: input.metrics,
      sinaisDetectados: ["OTHER_REASON_MARGIN_UNKNOWN"],
      regrasAcionadas: ["OTHER_REASON_MARGIN_UNKNOWN"],
      acao: "dados_insuficientes",
      potencialIntervencao: null,
      hipoteses: [],
    });
  });
});

describe("diagnoseOtherReason — saudável e pontual", () => {
  it("84 vendidos, margem positiva, 1 período com perda, sem concentração → manter_monitorar, baixo", () => {
    const input = baseInput();
    const result = diagnoseOtherReason(input);

    // Hand trace: valueLostCents(20000) >= 5000 → not negligible. grossMarginCents(100000) !== null.
    // isSevere: lossToMarginRatio(0.1) >= 0.3? false → isSevere=false.
    // isHealthy: qtySold(84)>=20 true, grossMarginCents>0 true, ratio!==null true, ratio(0.1)<0.3 true → true.
    // isRecurrent: periods.length(1)>=2 → false. isConcentrated: 0.1>=0.7 → false.
    // First branch (isHealthy && !isRecurrent && !isConcentrated) fires.
    expect(result).toEqual({
      reason: "other_reason",
      metrics: input.metrics,
      sinaisDetectados: ["OTHER_REASON_HEALTHY_ISOLATED"],
      regrasAcionadas: ["OTHER_REASON_HEALTHY_ISOLATED"],
      acao: "manter_monitorar",
      potencialIntervencao: "baixo",
      hipoteses: [],
    });
  });
});

describe("diagnoseOtherReason — saudável mas recorrente", () => {
  it("mesma base saudável, mas 2 períodos com perda (≥2) → investigar, medio — nunca pula direto para permanência", () => {
    const input = baseInput({ recurrencePeriodsWithLoss: ["2026-05", "2026-06"] });
    const result = diagnoseOtherReason(input);

    // isSevere still false (only 2 periods < minRecurringPeriods=3, and ratio 0.1 < 0.3 anyway).
    // isRecurrent = 2>=2 → true. First branch requires !isRecurrent → fails.
    // else-if (isRecurrent || isConcentrated) → true → investigar.
    expect(result.acao).toBe("investigar");
    expect(result.potencialIntervencao).toBe("medio");
    expect(result.sinaisDetectados).toEqual(["OTHER_REASON_RECURRING_OR_CONCENTRATED"]);
  });
});

describe("diagnoseOtherReason — saudável mas concentrado", () => {
  it("concentrationShareStore=0.75 (≥ 0.7), apenas 1 período (sem recorrência) → investigar, medio", () => {
    const input = baseInput({ concentrationShareStore: 0.75 });
    const result = diagnoseOtherReason(input);

    // isRecurrent stays false (1 period). isConcentrated: 0.75>=0.7 → true.
    // First branch requires !isConcentrated → fails. else-if (isRecurrent || isConcentrated) → true.
    expect(result.acao).toBe("investigar");
    expect(result.potencialIntervencao).toBe("medio");
    expect(result.sinaisDetectados).toEqual(["OTHER_REASON_RECURRING_OR_CONCENTRATED"]);
  });
});

describe("diagnoseOtherReason — concentrationShareStore=null nunca conta como concentrado", () => {
  it("null (poucas lojas), isolado (1 período) → manter_monitorar — null não é tratado como concentrado", () => {
    const input = baseInput({ concentrationShareStore: null });
    const result = diagnoseOtherReason(input);

    // isConcentrated: input.concentrationShareStore !== null → false (short-circuits before any
    // comparison against localConcentrationMin) → isConcentrated=false regardless of the threshold.
    expect(result.acao).toBe("manter_monitorar");
    expect(result.sinaisDetectados).toEqual(["OTHER_REASON_HEALTHY_ISOLATED"]);
  });

  it("null, mas recorrente (2 períodos) → investigar — só a recorrência empurra para investigar, não a concentração nula", () => {
    const input = baseInput({ concentrationShareStore: null, recurrencePeriodsWithLoss: ["2026-05", "2026-06"] });
    const result = diagnoseOtherReason(input);

    expect(result.acao).toBe("investigar");
    expect(result.sinaisDetectados).toEqual(["OTHER_REASON_RECURRING_OR_CONCENTRATED"]);
  });
});

describe("diagnoseOtherReason — severo e recorrente (loja vs. rede)", () => {
  it("lossToMarginRatio=0.35 (≥0.3), 3 períodos (≥3), rede saudável (affectedShare=0.2 < 0.7) → avaliar_permanencia_loja, alto", () => {
    const input = severeInput({ networkComparison: networkHealthy });
    const result = diagnoseOtherReason(input);

    // isSevere: 0.35>=0.3 (true) AND 3>=3 (true) → true. action=avaliar_permanencia_loja, alto.
    // Network escalation guard: networkComparison truthy, !== "dado_insuficiente",
    // affectedShare(0.2) >= networkWideMinShare(0.7)? false → stays avaliar_permanencia_loja.
    expect(result).toEqual({
      reason: "other_reason",
      metrics: input.metrics,
      sinaisDetectados: ["OTHER_REASON_SEVERE_RECURRING"],
      regrasAcionadas: ["OTHER_REASON_SEVERE_RECURRING"],
      acao: "avaliar_permanencia_loja",
      potencialIntervencao: "alto",
      hipoteses: [],
    });
  });

  it("mesma severidade, rede também severa (affectedShare=0.8 ≥ 0.7) → avaliar_permanencia_rede, alto, sinal de rede anexado", () => {
    const input = severeInput({ networkComparison: networkSevere });
    const result = diagnoseOtherReason(input);

    expect(result.acao).toBe("avaliar_permanencia_rede");
    expect(result.potencialIntervencao).toBe("alto");
    expect(result.sinaisDetectados).toEqual(["OTHER_REASON_SEVERE_RECURRING", "OTHER_REASON_NETWORK_WIDE"]);
    expect(result.regrasAcionadas).toEqual(["OTHER_REASON_SEVERE_RECURRING", "OTHER_REASON_NETWORK_WIDE"]);
  });

  it("networkComparison=null (passe 1) nunca escala para rede — fica em avaliar_permanencia_loja mesmo sem saber ainda", () => {
    const input = severeInput({ networkComparison: null });
    const result = diagnoseOtherReason(input);

    expect(result.acao).toBe("avaliar_permanencia_loja");
    expect(result.sinaisDetectados).toEqual(["OTHER_REASON_SEVERE_RECURRING"]);
  });

  it("networkComparison='dado_insuficiente' se comporta como null — nunca escala para rede", () => {
    const input = severeInput({ networkComparison: "dado_insuficiente" });
    const result = diagnoseOtherReason(input);

    expect(result.acao).toBe("avaliar_permanencia_loja");
    expect(result.sinaisDetectados).toEqual(["OTHER_REASON_SEVERE_RECURRING"]);
  });

  it("boundary: affectedShare exatamente 0.7 (== networkWideMinShare) ainda escala (código usa >=)", () => {
    const boundary: NetworkComparisonResult = { ...networkSevere, affectedShare: 0.7 };
    const input = severeInput({ networkComparison: boundary });
    const result = diagnoseOtherReason(input);

    expect(result.acao).toBe("avaliar_permanencia_rede");
  });
});

describe("diagnoseOtherReason — severo mas NÃO recorrente (abaixo de minRecurringPeriods)", () => {
  it("lossToMarginRatio=0.35, apenas 1 período (< minRecurringPeriods=3), sem concentração → nunca permanência, cai em dados_insuficientes", () => {
    const input = severeInput({ recurrencePeriodsWithLoss: ["2026-06"], concentrationShareStore: null });
    const result = diagnoseOtherReason(input);

    // isSevere: periods.length(1)>=3 → false → isSevere=false, entra no ramo else.
    // isHealthy: lossToMarginRatio(0.35) < viabilityMaxRatio(0.3)? false → isHealthy=false.
    // isRecurrent: 1>=2 → false. isConcentrated: null → false.
    // Nem o primeiro `if` nem o `else if` disparam → cai no `else` final → dados_insuficientes.
    expect(result.acao).toBe("dados_insuficientes");
    expect(result.potencialIntervencao).toBeNull();
    expect(result.sinaisDetectados).toEqual(["INSUFFICIENT_EVIDENCE"]);
    expect(["avaliar_permanencia_loja", "avaliar_permanencia_rede", "avaliar_retirada_loja", "avaliar_retirada_rede"]).not.toContain(result.acao);
  });

  it("mesmo ratio severo, 2 períodos (ainda < minRecurringPeriods=3) → isRecurrent (≥2) por si só leva a investigar, não a permanência", () => {
    const input = severeInput({ recurrencePeriodsWithLoss: ["2026-05", "2026-06"] });
    const result = diagnoseOtherReason(input);

    // isSevere: periods.length(2)>=3 → false → isSevere=false.
    // isHealthy: ratio(0.35)<0.3 → false. isRecurrent: 2>=2 → true. else-if fires → investigar.
    expect(result.acao).toBe("investigar");
    expect(result.potencialIntervencao).toBe("medio");
    expect(result.sinaisDetectados).toEqual(["OTHER_REASON_RECURRING_OR_CONCENTRATED"]);
  });
});

describe("diagnoseOtherReason — teto de histórico recente (deviation from the brief's literal code, controller-approved)", () => {
  it("caso severo + firstSeenRecently=true, overwhelmingEvidence=false → acao=investigar E potencialIntervencao=medio, CAPPED_RECENT_HISTORY anexado", () => {
    const input = severeInput({ networkComparison: networkHealthy, firstSeenRecently: true, overwhelmingEvidence: false });
    const result = diagnoseOtherReason(input);

    // Hand trace: isSevere fires → action=avaliar_permanencia_loja (rank 3), potencialIntervencao=alto,
    // signals=[OTHER_REASON_SEVERE_RECURRING]. Network: affectedShare(0.2)<0.7 → no escalation.
    // Cap block: firstSeenRecently(true) && !overwhelmingEvidence(!false=true) → fires.
    // clampSeverity("avaliar_permanencia_loja", "investigar"): severityRank(avaliar_permanencia_loja)=3
    // < severityRank(investigar)=6 → true → capped="investigar". capped !== action → true →
    // signals gets CAPPED_RECENT_HISTORY appended, AND (the deviation) potencialIntervencao is
    // reset to "medio" — matching what "investigar" natively means everywhere else in this file
    // (see the OTHER_REASON_RECURRING_OR_CONCENTRATED branch), instead of leaving the stale "alto".
    expect(result.acao).toBe("investigar");
    expect(result.potencialIntervencao).toBe("medio");
    expect(result.sinaisDetectados).toEqual(["OTHER_REASON_SEVERE_RECURRING", "CAPPED_RECENT_HISTORY"]);
    expect(result.regrasAcionadas).toEqual(["OTHER_REASON_SEVERE_RECURRING", "CAPPED_RECENT_HISTORY"]);
  });

  it("caso severo → rede + firstSeenRecently=true, overwhelmingEvidence=false → também capado para investigar/medio (nunca deixa avaliar_permanencia_rede passar)", () => {
    const input = severeInput({ networkComparison: networkSevere, firstSeenRecently: true, overwhelmingEvidence: false });
    const result = diagnoseOtherReason(input);

    // action before cap = avaliar_permanencia_rede (rank 1) — even more severe than the loja case.
    // clampSeverity("avaliar_permanencia_rede", "investigar"): 1 < 6 → true → capped="investigar".
    expect(result.acao).toBe("investigar");
    expect(result.potencialIntervencao).toBe("medio");
    expect(result.sinaisDetectados).toEqual(["OTHER_REASON_SEVERE_RECURRING", "OTHER_REASON_NETWORK_WIDE", "CAPPED_RECENT_HISTORY"]);
  });

  it("exceção de evidência esmagadora: mesmo cenário severo, overwhelmingEvidence=true → avaliar_permanencia_loja passa sem cap, potencialIntervencao nativo alto intacto", () => {
    const input = severeInput({ networkComparison: networkHealthy, firstSeenRecently: true, overwhelmingEvidence: true });
    const result = diagnoseOtherReason(input);

    // Cap block: firstSeenRecently(true) && !overwhelmingEvidence(!true=false) → condition false →
    // block skipped entirely. action and potencialIntervencao stay exactly as isSevere branch set them.
    expect(result.acao).toBe("avaliar_permanencia_loja");
    expect(result.potencialIntervencao).toBe("alto");
    expect(result.sinaisDetectados).toEqual(["OTHER_REASON_SEVERE_RECURRING"]);
  });

  it("firstSeenRecently=false (mesmo com overwhelmingEvidence=false) nunca aciona o cap — condição exige os dois", () => {
    const input = severeInput({ networkComparison: networkHealthy, firstSeenRecently: false, overwhelmingEvidence: false });
    const result = diagnoseOtherReason(input);

    expect(result.acao).toBe("avaliar_permanencia_loja");
    expect(result.potencialIntervencao).toBe("alto");
    expect(result.sinaisDetectados).toEqual(["OTHER_REASON_SEVERE_RECURRING"]);
  });

  it("o cap não afeta uma ação já mais branda que investigar (manter_monitorar) — sem sinal espúrio, sem mudar potencialIntervencao", () => {
    const input = baseInput({ firstSeenRecently: true, overwhelmingEvidence: false });
    const result = diagnoseOtherReason(input);

    // clampSeverity("manter_monitorar", "investigar"): severityRank(manter_monitorar)=7 <
    // severityRank(investigar)=6 is false (7 is NOT < 6) → capped=action unchanged → no cap fires.
    expect(result.acao).toBe("manter_monitorar");
    expect(result.potencialIntervencao).toBe("baixo");
    expect(result.sinaisDetectados).toEqual(["OTHER_REASON_HEALTHY_ISOLATED"]);
  });

  it("o cap não afeta uma ação já em investigar (recorrente) — capped===action, sem sinal duplicado, potencialIntervencao já medio permanece medio", () => {
    const input = baseInput({ recurrencePeriodsWithLoss: ["2026-05", "2026-06"], firstSeenRecently: true, overwhelmingEvidence: false });
    const result = diagnoseOtherReason(input);

    // clampSeverity("investigar", "investigar"): severityRank(investigar)=6 < 6 is false → unchanged.
    expect(result.acao).toBe("investigar");
    expect(result.potencialIntervencao).toBe("medio");
    expect(result.sinaisDetectados).toEqual(["OTHER_REASON_RECURRING_OR_CONCENTRATED"]);
  });
});

// ---- Matriz estrutural: cobre todo ramo do arquivo (negligível, margem desconhecida, saudável
// isolado, recorrente, concentrado, severo→loja, severo→rede, capado por histórico recente) ----

const fixtureMatrix: { label: string; input: OtherReasonDiagnosisInput }[] = [
  { label: "negligível", input: baseInput({ metrics: metricsFixture(1, 1000, 0.9) }) },
  { label: "margem desconhecida", input: baseInput({ grossMarginCents: null }) },
  { label: "saudável isolado", input: baseInput() },
  { label: "saudável mas recorrente", input: baseInput({ recurrencePeriodsWithLoss: ["2026-05", "2026-06"] }) },
  { label: "saudável mas concentrado", input: baseInput({ concentrationShareStore: 0.75 }) },
  { label: "concentrationShareStore=null, isolado", input: baseInput({ concentrationShareStore: null }) },
  { label: "concentrationShareStore=null, recorrente", input: baseInput({ concentrationShareStore: null, recurrencePeriodsWithLoss: ["2026-05", "2026-06"] }) },
  { label: "severo → permanência loja", input: severeInput({ networkComparison: networkHealthy }) },
  { label: "severo → permanência rede", input: severeInput({ networkComparison: networkSevere }) },
  { label: "severo mas não recorrente (1 período) → dados_insuficientes", input: severeInput({ recurrencePeriodsWithLoss: ["2026-06"], concentrationShareStore: null }) },
  { label: "severo mas não recorrente o bastante (2 períodos) → investigar", input: severeInput({ recurrencePeriodsWithLoss: ["2026-05", "2026-06"] }) },
  { label: "capado por histórico recente (loja→investigar)", input: severeInput({ networkComparison: networkHealthy, firstSeenRecently: true, overwhelmingEvidence: false }) },
  { label: "capado por histórico recente (rede→investigar)", input: severeInput({ networkComparison: networkSevere, firstSeenRecently: true, overwhelmingEvidence: false }) },
  { label: "severo, recente mas evidência esmagadora (sem cap)", input: severeInput({ networkComparison: networkHealthy, firstSeenRecently: true, overwhelmingEvidence: true }) },
];

describe("regra estrutural: diagnoseOtherReason NUNCA produz avaliar_retirada_loja nem avaliar_retirada_rede", () => {
  it.each(fixtureMatrix.map(({ label, input }) => [label, input] as const))("%s", (_label, input) => {
    const result = diagnoseOtherReason(input);
    expect(result.acao).not.toBe("avaliar_retirada_loja");
    expect(result.acao).not.toBe("avaliar_retirada_rede");
  });

  it("nenhum resultado da matriz inteira é avaliar_retirada_*, mesmo agregando todos de uma vez", () => {
    const actions = fixtureMatrix.map(({ input }) => diagnoseOtherReason(input).acao);
    expect(actions).not.toContain("avaliar_retirada_loja");
    expect(actions).not.toContain("avaliar_retirada_rede");
  });
});

describe("regra de nomenclatura: nenhuma string de other-reason.ts menciona roubo/furto/theft", () => {
  it.each(fixtureMatrix.map(({ label, input }) => [label, input] as const))("%s — sinaisDetectados/regrasAcionadas/hipoteses ficam neutros", (_label, input) => {
    const result = diagnoseOtherReason(input);
    const allStrings = [...result.sinaisDetectados, ...result.regrasAcionadas, ...result.hipoteses];
    for (const s of allStrings) {
      expect(s.toLowerCase()).not.toMatch(/roubo|furto|theft/);
    }
  });
});

describe("isOtherReasonSevereSignal", () => {
  it("lossToMarginRatio=null → false, independente da recorrência", () => {
    expect(isOtherReasonSevereSignal({ lossToMarginRatio: null, recurrencePeriodsWithLoss: ["2026-04", "2026-05", "2026-06"], parameters })).toBe(false);
  });

  it("ratio acima do limiar mas períodos insuficientes → false", () => {
    expect(isOtherReasonSevereSignal({ lossToMarginRatio: 0.5, recurrencePeriodsWithLoss: ["2026-06"], parameters })).toBe(false);
  });

  it("ratio abaixo do limiar mesmo com períodos suficientes → false", () => {
    expect(isOtherReasonSevereSignal({ lossToMarginRatio: 0.29, recurrencePeriodsWithLoss: ["2026-04", "2026-05", "2026-06"], parameters })).toBe(false);
  });

  it("boundary: ratio exatamente 0.3 e exatamente 3 períodos → true (código usa >= nos dois)", () => {
    expect(isOtherReasonSevereSignal({ lossToMarginRatio: 0.3, recurrencePeriodsWithLoss: ["2026-04", "2026-05", "2026-06"], parameters })).toBe(true);
  });

  it("ratio acima do limiar e períodos acima do mínimo → true", () => {
    expect(isOtherReasonSevereSignal({ lossToMarginRatio: 0.6, recurrencePeriodsWithLoss: ["2026-03", "2026-04", "2026-05", "2026-06"], parameters })).toBe(true);
  });
});
