import { describe, it, expect } from "@jest/globals";
import { diagnoseDamage } from "./damage";
import type { DamageDiagnosisInput } from "./damage";
import { DEFAULT_PARAMETERS } from "../parameters";
import type { PerReasonMetrics } from "../types";

// damage: { localConcentrationMin: 0.7, minStoresCarryingForConcentration: 3, minStoresForSystemic: 4 }
const parameters = DEFAULT_PARAMETERS;

function metricsFixture(qtyLost: number): PerReasonMetrics {
  return { qtyLost, valueLostCents: qtyLost * 500, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null };
}

const THIS_STORE_ID = 1;

describe("diagnoseDamage — concentração local (spec §10.3)", () => {
  it("literal do pedido: 12 de 14 unidades danificadas nesta loja, mesmo SKU em 3 lojas → concentrationShare≈0.857 ≥ 0.7 → investigar, alto, DAMAGE_CONCENTRATED_LOCAL", () => {
    const input: DamageDiagnosisInput = {
      metrics: metricsFixture(12),
      qtyLostDamagedByStore: [
        { storeId: THIS_STORE_ID, qtyLost: 12 },
        { storeId: 2, qtyLost: 1 },
        { storeId: 3, qtyLost: 1 },
      ],
      thisStoreId: THIS_STORE_ID,
      parameters,
    };
    const result = diagnoseDamage(input);

    // Hand trace: storesCarrying = filter(qtyLost>0) → all 3 entries (12,1,1) → length=3, NOT
    // < minStoresCarryingForConcentration (3) → first guard does not fire.
    // totalNetwork = 12+1+1 = 14. thisStoreQty = metrics.qtyLost = 12.
    // concentrationShare = 14>0 ? 12/14 : 0 = 0.857142857... ≥ localConcentrationMin (0.7) → true
    // → DAMAGE_CONCENTRATED_LOCAL branch fires, returns before ever checking minStoresForSystemic.
    expect(result).toEqual({
      reason: "damaged_product",
      metrics: input.metrics,
      sinaisDetectados: ["DAMAGE_CONCENTRATED_LOCAL"],
      regrasAcionadas: ["DAMAGE_CONCENTRATED_LOCAL"],
      acao: "investigar",
      potencialIntervencao: "alto",
      hipoteses: ["manuseio", "armazenamento", "exposição"],
    });
  });

  it("hipóteses são substantivos, nunca uma causa afirmada como fato", () => {
    const input: DamageDiagnosisInput = {
      metrics: metricsFixture(12),
      qtyLostDamagedByStore: [
        { storeId: THIS_STORE_ID, qtyLost: 12 },
        { storeId: 2, qtyLost: 1 },
        { storeId: 3, qtyLost: 1 },
      ],
      thisStoreId: THIS_STORE_ID,
      parameters,
    };
    const result = diagnoseDamage(input);

    // Cada string é um substantivo/tema (ex.: "manuseio"), nunca uma frase afirmativa como
    // "foi manuseio incorreto" ou "produto foi mal manuseado" — o motor nunca declara a causa,
    // só lista hipóteses a investigar.
    expect(result.hipoteses.length).toBeGreaterThan(0);
    for (const hipotese of result.hipoteses) {
      expect(hipotese).not.toMatch(/foi|causou|confirmado|comprovado/i);
    }
  });

  it("boundary: concentrationShare exatamente 0.7 (== localConcentrationMin) ainda dispara (código usa >=, não >)", () => {
    const input: DamageDiagnosisInput = {
      metrics: metricsFixture(7),
      qtyLostDamagedByStore: [
        { storeId: THIS_STORE_ID, qtyLost: 7 },
        { storeId: 2, qtyLost: 2 },
        { storeId: 3, qtyLost: 1 },
      ],
      thisStoreId: THIS_STORE_ID,
      parameters,
    };
    const result = diagnoseDamage(input);

    // totalNetwork = 7+2+1 = 10. concentrationShare = 7/10 = 0.7 exatamente = localConcentrationMin.
    expect(result.acao).toBe("investigar");
    expect(result.potencialIntervencao).toBe("alto");
    expect(result.sinaisDetectados).toEqual(["DAMAGE_CONCENTRATED_LOCAL"]);
  });
});

describe("diagnoseDamage — dano sistêmico na rede (spec §10.3)", () => {
  it("dano espalhado por 4 lojas sem concentração em nenhuma → DAMAGE_SYSTEMIC_NETWORK, investigar, medio (menor que o caso local, que é alto)", () => {
    const localCaseInput: DamageDiagnosisInput = {
      metrics: metricsFixture(12),
      qtyLostDamagedByStore: [
        { storeId: THIS_STORE_ID, qtyLost: 12 },
        { storeId: 2, qtyLost: 1 },
        { storeId: 3, qtyLost: 1 },
      ],
      thisStoreId: THIS_STORE_ID,
      parameters,
    };
    const systemicInput: DamageDiagnosisInput = {
      metrics: metricsFixture(5),
      qtyLostDamagedByStore: [
        { storeId: THIS_STORE_ID, qtyLost: 5 },
        { storeId: 2, qtyLost: 5 },
        { storeId: 3, qtyLost: 5 },
        { storeId: 4, qtyLost: 5 },
      ],
      thisStoreId: THIS_STORE_ID,
      parameters,
    };

    const localResult = diagnoseDamage(localCaseInput);
    const systemicResult = diagnoseDamage(systemicInput);

    // Hand trace (systemicInput): storesCarrying = 4 entries (5,5,5,5), length=4, not < 3 → passes
    // first guard. totalNetwork = 20. thisStoreQty = 5. concentrationShare = 5/20 = 0.25, NOT
    // >= localConcentrationMin (0.7) → local-concentration branch does not fire.
    // storesCarrying.length (4) >= minStoresForSystemic (4) → true → DAMAGE_SYSTEMIC_NETWORK,
    // investigar, medio.
    expect(systemicResult).toEqual({
      reason: "damaged_product",
      metrics: systemicInput.metrics,
      sinaisDetectados: ["DAMAGE_SYSTEMIC_NETWORK"],
      regrasAcionadas: ["DAMAGE_SYSTEMIC_NETWORK"],
      acao: "investigar",
      potencialIntervencao: "medio",
      hipoteses: ["embalagem", "transporte", "característica do produto"],
    });

    // The required distinction: both diagnoses reach the SAME acao ("investigar"), but their
    // potencialIntervencao values must differ (alto vs medio) — proving the tree distinguishes
    // local concentration from systemic spread by severity, not just by sinaisDetectados label.
    expect(localResult.acao).toBe("investigar");
    expect(systemicResult.acao).toBe("investigar");
    expect(localResult.potencialIntervencao).toBe("alto");
    expect(systemicResult.potencialIntervencao).toBe("medio");
    expect(localResult.potencialIntervencao).not.toBe(systemicResult.potencialIntervencao);
  });

  it("hipóteses do caso sistêmico também são substantivos, nunca causa afirmada", () => {
    const input: DamageDiagnosisInput = {
      metrics: metricsFixture(5),
      qtyLostDamagedByStore: [
        { storeId: THIS_STORE_ID, qtyLost: 5 },
        { storeId: 2, qtyLost: 5 },
        { storeId: 3, qtyLost: 5 },
        { storeId: 4, qtyLost: 5 },
      ],
      thisStoreId: THIS_STORE_ID,
      parameters,
    };
    const result = diagnoseDamage(input);

    expect(result.hipoteses).toEqual(["embalagem", "transporte", "característica do produto"]);
    for (const hipotese of result.hipoteses) {
      expect(hipotese).not.toMatch(/foi|causou|confirmado|comprovado/i);
    }
  });
});

describe("diagnoseDamage — dados insuficientes (spec §10.3)", () => {
  it("menos de 3 lojas carregando o SKU (apenas esta) → dados_insuficientes, mesmo com 100% de concentração aparente", () => {
    const input: DamageDiagnosisInput = {
      metrics: metricsFixture(10),
      qtyLostDamagedByStore: [
        { storeId: THIS_STORE_ID, qtyLost: 10 },
        { storeId: 2, qtyLost: 0 }, // não carrega o SKU danificado neste período — filtrado
        { storeId: 3, qtyLost: 0 },
      ],
      thisStoreId: THIS_STORE_ID,
      parameters,
    };
    const result = diagnoseDamage(input);

    // Hand trace / armadilha: se a concentração fosse calculada mesmo assim, seria 10/10 = 100% —
    // o número mais "concentrado" possível. Mas storesCarrying = filter(qtyLost>0) → só a loja 1
    // (as outras duas têm qtyLost=0, filtradas fora) → length=1, < minStoresCarryingForConcentration
    // (3) → a função retorna dados_insuficientes NO PRIMEIRO guard, antes até de calcular
    // totalNetwork/concentrationShare — a "concentração aparente" nunca chega a ser computada.
    expect(result).toEqual({
      reason: "damaged_product",
      metrics: input.metrics,
      sinaisDetectados: ["INSUFFICIENT_STORES_FOR_DAMAGE_PATTERN"],
      regrasAcionadas: ["INSUFFICIENT_STORES_FOR_DAMAGE_PATTERN"],
      acao: "dados_insuficientes",
      potencialIntervencao: null,
      hipoteses: [],
    });
  });

  it("3 lojas carregando (suficiente para calcular concentração) mas sem concentração local e abaixo do mínimo sistêmico (3 < 4) → cai no fallback final, dados_insuficientes", () => {
    const input: DamageDiagnosisInput = {
      metrics: metricsFixture(3),
      qtyLostDamagedByStore: [
        { storeId: THIS_STORE_ID, qtyLost: 3 },
        { storeId: 2, qtyLost: 4 },
        { storeId: 3, qtyLost: 3 },
      ],
      thisStoreId: THIS_STORE_ID,
      parameters,
    };
    const result = diagnoseDamage(input);

    // Hand trace: storesCarrying.length = 3, not < 3 → first guard passes (does NOT return early
    // here, unlike the case above). totalNetwork = 3+4+3 = 10. thisStoreQty = 3.
    // concentrationShare = 3/10 = 0.3, NOT >= localConcentrationMin (0.7) → local branch fails.
    // storesCarrying.length (3) >= minStoresForSystemic (4)? false (3 < 4) → systemic branch also
    // fails. Falls through to the final `return` (the fallback, same signal as the guard above but
    // reached via a different code path — this one after computing a real concentrationShare).
    expect(result.acao).toBe("dados_insuficientes");
    expect(result.potencialIntervencao).toBeNull();
    expect(result.hipoteses).toEqual([]);
    expect(result.sinaisDetectados).toEqual(["INSUFFICIENT_STORES_FOR_DAMAGE_PATTERN"]);
  });
});

describe("diagnoseDamage — guarda de divisão por zero (totalNetwork=0)", () => {
  it("nunca lança nem produz NaN/Infinity mesmo se a invariante (storesCarrying só contém qtyLost>0) for violada", () => {
    // Por construção, storesCarrying = qtyLostDamagedByStore.filter(qtyLost > 0), então sua soma
    // não pode legitimamente ser 0 quando seu length >= 1 — soma de números > 0 é sempre > 0. Por
    // isso o brief chama esse cenário de "não deveria acontecer". Para exercitar mesmo assim a
    // guarda `totalNetwork > 0 ? thisStoreQty / totalNetwork : 0`, fakeamos `.filter` no array de
    // entrada para devolver 3 lojas "carregando" com qtyLost=0 cada — uma violação deliberada da
    // invariante que só a guarda evita virar Infinity/NaN.
    const zeroEntries: { storeId: number; qtyLost: number }[] = [
      { storeId: 1, qtyLost: 0 },
      { storeId: 2, qtyLost: 0 },
      { storeId: 3, qtyLost: 0 },
    ];
    const riggedQtyLostDamagedByStore = { filter: () => zeroEntries } as unknown as { storeId: number; qtyLost: number }[];

    const input: DamageDiagnosisInput = {
      metrics: metricsFixture(5), // thisStoreQty=5 positivo — sem a guarda, 5/0 daria Infinity (não NaN)
      qtyLostDamagedByStore: riggedQtyLostDamagedByStore,
      thisStoreId: THIS_STORE_ID,
      parameters,
    };

    expect(() => diagnoseDamage(input)).not.toThrow();
    const result = diagnoseDamage(input);

    // Hand trace: storesCarrying = riggedQtyLostDamagedByStore.filter(...) = zeroEntries (rig
    // ignora o predicado real) → length=3, not < minStoresCarryingForConcentration (3) → guarda
    // inicial passa. totalNetwork = zeroEntries.reduce(sum) = 0. thisStoreQty = 5.
    // concentrationShare = totalNetwork (0) > 0 ? ... : 0 → cai no ramo `: 0` do ternário — nunca
    // calcula 5/0 (que daria Infinity em JS, ≥ localConcentrationMin, e diagnosticaria
    // erroneamente DAMAGE_CONCENTRATED_LOCAL). concentrationShare=0 >= 0.7? false.
    // storesCarrying.length (3) >= minStoresForSystemic (4)? false (3 < 4) → fallback final.
    expect(result.acao).toBe("dados_insuficientes");
    expect(result.potencialIntervencao).toBeNull();
    expect(result.sinaisDetectados).toEqual(["INSUFFICIENT_STORES_FOR_DAMAGE_PATTERN"]);
  });
});

describe("regra: toda ação investigar (🟠) carrega pelo menos um sinal", () => {
  it("os dois casos que chegam a investigar (concentração local e sistêmico) carregam ≥1 sinalDetectado e regraAcionada", () => {
    const localConcentrationInput: DamageDiagnosisInput = {
      metrics: metricsFixture(12),
      qtyLostDamagedByStore: [
        { storeId: THIS_STORE_ID, qtyLost: 12 },
        { storeId: 2, qtyLost: 1 },
        { storeId: 3, qtyLost: 1 },
      ],
      thisStoreId: THIS_STORE_ID,
      parameters,
    };
    const systemicInput: DamageDiagnosisInput = {
      metrics: metricsFixture(5),
      qtyLostDamagedByStore: [
        { storeId: THIS_STORE_ID, qtyLost: 5 },
        { storeId: 2, qtyLost: 5 },
        { storeId: 3, qtyLost: 5 },
        { storeId: 4, qtyLost: 5 },
      ],
      thisStoreId: THIS_STORE_ID,
      parameters,
    };

    for (const input of [localConcentrationInput, systemicInput]) {
      const result = diagnoseDamage(input);
      expect(result.acao).toBe("investigar");
      expect(result.sinaisDetectados.length).toBeGreaterThan(0);
      expect(result.regrasAcionadas.length).toBeGreaterThan(0);
    }
  });
});
