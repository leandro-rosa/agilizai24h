import { describe, it, expect } from "@jest/globals";
import { computeRestockRecommendations, type RestockEngineInput } from "./engine";
import { DEFAULT_RESTOCK_PARAMETERS } from "./parameters";
import { DEFAULT_PARAMETERS as DEFAULT_LOSS_PARAMETERS } from "@/lib/loss-intelligence/parameters";
import type { LossIntelligenceRecommendation, LossIntelligenceResult } from "@/lib/loss-intelligence/types";
import type { Store } from "@/lib/api/stores";
import type { Product } from "@/lib/api/products";
import type { StoreMonthSales } from "@/lib/api/sales";
import type { StoreMonthSupply } from "@/lib/api/supply";

const TODAY = "2026-09-01"; // currentPeriod "2026-09" -> lookback fecha em mar..ago/2026 (6 meses)
const MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
const STORES: Store[] = [{ id: 1, name: "Loja A" } as Store];
const PRODUCTS: Product[] = [{ id: 1, sku: "SKU-1", name: "Produto 1", category: "beverage" } as Product];

function salesFor(qty: number[]): StoreMonthSales[] {
  return MONTHS.map((period, i) => ({ storeId: 1, period, bySku: qty[i] > 0 ? [{ store_id: 1, period, sku: "SKU-1", quantity_sold: qty[i], revenue_cents: qty[i] * 500, ingestion_id: "x" }] : [] }));
}

function supplyFor(qty: (number | null)[]): StoreMonthSupply[] {
  return MONTHS.map((period, i) => ({ storeId: 1, period, restocks: qty[i] !== null ? [{ sku: "SKU-1", quantity_restocked: qty[i]! }] : [] }));
}

function buildLossRecommendation(overrides: Partial<LossIntelligenceRecommendation> = {}): LossIntelligenceRecommendation {
  return {
    sku: "SKU-1",
    storeId: 1,
    janelaAnalisada: { primaryMonths: MONTHS.slice(3), recurrenceLookbackMonths: MONTHS },
    metricasObservadas: {
      qtyRestocked: 0, qtySold: 0, revenueCents: 0, grossMarginCents: null, netMarginAfterLossCents: null, saleToSupplyRatio: null,
      monthsWithRestock: 0, monthsWithSales: 0, monthsAnalyzed: 6, firstSeenPeriod: null, monthsSinceFirstSeen: null,
      byReason: {
        expired: { qtyLost: 0, valueLostCents: 0, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null },
        damaged_product: { qtyLost: 0, valueLostCents: 0, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null },
        other_reason: { qtyLost: 0, valueLostCents: 0, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null },
      },
    },
    diagnosticosPorMotivo: [
      { reason: "other_reason", metrics: { qtyLost: 0, valueLostCents: 0, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null }, sinaisDetectados: [], regrasAcionadas: [], acao: "investigar", potencialIntervencao: "medio", hipoteses: [], escopoProblema: "indeterminado" },
    ],
    historico: [],
    maiorImpactoFinanceiroMotivo: null,
    maiorImpactoFinanceiroValueCents: 0,
    motivoDiagnosticoPrioritario: "other_reason",
    motivosSecundarios: [],
    acaoPrioritaria: "investigar",
    acoesSecundarias: [],
    sinaisTransversais: [],
    prioridade: "media",
    confianca: "alta",
    comparacaoRede: { expired: "dado_insuficiente", damaged_product: "dado_insuficiente", other_reason: "dado_insuficiente" },
    limitacoesDosDados: [],
    firstSeenRecently: false,
    versaoMotor: "test",
    versaoParametros: "test",
    ...overrides,
  };
}

function lossResult(recommendations: LossIntelligenceRecommendation[]): LossIntelligenceResult {
  return { recommendations, countsByAction: {} as LossIntelligenceResult["countsByAction"], valueLostInPrioritizedCasesCents: 0, impactEstimateCents: { conservative: 0, expected: 0, optimistic: 0 } };
}

function baseInput(overrides: Partial<RestockEngineInput> = {}): RestockEngineInput {
  return {
    stores: STORES,
    products: PRODUCTS,
    salesByStoreMonth: salesFor([10, 10, 10, 10, 10, 10]),
    supplyByStoreMonth: supplyFor([12, 12, 12, 12, 12, 12]),
    reconciliationByStoreMonth: [],
    lossResult: lossResult([]),
    today: TODAY,
    lossParameters: DEFAULT_LOSS_PARAMETERS,
    restockParameters: DEFAULT_RESTOCK_PARAMETERS,
    parametrizacaoFor: () => null,
    ...overrides,
  };
}

describe("computeRestockRecommendations", () => {
  it("marks dados_insuficientes with zero quantity when fewer than the minimum months have sales", () => {
    const result = computeRestockRecommendations(baseInput({ salesByStoreMonth: salesFor([0, 0, 0, 0, 0, 10]) }));
    expect(result[0].acao).toBe("dados_insuficientes");
    expect(result[0].confianca).toBe("insuficiente");
    expect(result[0].quantidadeSugeridaIA).toBe(0);
  });

  it("suspender_abastecimento from Loss Intelligence overrides the formula to zero and 'não abastecer', inheriting its confidence", () => {
    const result = computeRestockRecommendations(
      baseInput({ lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "suspender_abastecimento", confianca: "baixa" })]) }),
    );
    expect(result[0].quantidadeSugeridaIA).toBe(0);
    expect(result[0].acao).toBe("nao_abastecer");
    expect(result[0].confianca).toBe("baixa");
    expect(result[0].motivo).toMatch(/Inteligência de Perdas/);
  });

  it("reduzir_abastecimento from Loss Intelligence cuts the formula's quantity by the configured factor", () => {
    const withoutOverride = computeRestockRecommendations(baseInput());
    const withOverride = computeRestockRecommendations(
      baseInput({ lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "reduzir_abastecimento", confianca: "media" })]) }),
    );
    expect(withOverride[0].acao).toBe("reduzir");
    expect(withOverride[0].quantidadeSugeridaIA).toBe(Math.round(withoutOverride[0].quantidadeSugeridaIA * DEFAULT_RESTOCK_PARAMETERS.lossIntegration.reduceFactor));
    expect(withOverride[0].confianca).toBe("media");
  });

  it("investigar adds a caveat and caps confidence at media without forcing the quantity to change", () => {
    const result = computeRestockRecommendations(
      baseInput({ lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "investigar" })]) }),
    );
    expect(result[0].limitacoes.some((l) => l.includes("Inteligência de Perdas"))).toBe(true);
    expect(["media", "baixa", "insuficiente"]).toContain(result[0].confianca);
  });

  it("avaliar_retirada_loja from Loss Intelligence also produces the hard-stop, zeroing quantity and inheriting confidence", () => {
    const result = computeRestockRecommendations(
      baseInput({ lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "avaliar_retirada_loja", confianca: "baixa" })]) }),
    );
    expect(result[0].quantidadeSugeridaIA).toBe(0);
    expect(result[0].acao).toBe("nao_abastecer");
    expect(result[0].confianca).toBe("baixa");
    expect(result[0].motivo).toMatch(/Inteligência de Perdas/);
  });

  it("avaliar_permanencia_loja adds the same caveat as investigar and caps confidence at media", () => {
    const result = computeRestockRecommendations(
      baseInput({ lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "avaliar_permanencia_loja" })]) }),
    );
    expect(result[0].limitacoes.some((l) => l.includes("Inteligência de Perdas"))).toBe(true);
    expect(["media", "baixa", "insuficiente"]).toContain(result[0].confianca);
  });

  it("suggests aumentar when the formula's quantity clearly exceeds the last restock", () => {
    const result = computeRestockRecommendations(baseInput({ salesByStoreMonth: salesFor([10, 12, 14, 20, 24, 28]), supplyByStoreMonth: supplyFor([15, 15, 15, 15, 15, 15]) }));
    expect(result[0].acao).toBe("aumentar");
  });

  it("suggests reduzir when the formula's quantity is clearly below the last restock, absent any loss signal", () => {
    const result = computeRestockRecommendations(baseInput({ salesByStoreMonth: salesFor([10, 8, 6, 4, 3, 2]), supplyByStoreMonth: supplyFor([30, 30, 30, 30, 30, 30]) }));
    expect(result[0].acao).toBe("reduzir");
  });

  it("skips a sku that has no matching entry in the products catalogue", () => {
    const result = computeRestockRecommendations(baseInput({ products: [] }));
    expect(result).toHaveLength(0);
  });

  it("always attaches a faixaEstimada and never a bare point estimate", () => {
    const result = computeRestockRecommendations(baseInput());
    expect(result[0].faixaEstimada.min).toBeLessThanOrEqual(result[0].faixaEstimada.max);
  });

  it("suspender_abastecimento from Loss Intelligence overrides evidence gate, even with insufficient months of sales", () => {
    // Sparse sales (only 1 month with sales, below the minimum threshold)
    const result = computeRestockRecommendations(
      baseInput({
        salesByStoreMonth: salesFor([0, 0, 0, 0, 0, 10]),
        lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "suspender_abastecimento", confianca: "media" })]),
      }),
    );
    expect(result[0].acao).toBe("nao_abastecer");
    expect(result[0].quantidadeSugeridaIA).toBe(0);
    expect(result[0].confianca).toBe("media"); // Inherited from Loss Intelligence, not "insuficiente"
    expect(result[0].motivo).toMatch(/Inteligência de Perdas/);
  });

  it("reduzir_abastecimento from Loss Intelligence overrides evidence gate, even with insufficient months of sales", () => {
    // Sparse sales (only 1 month with sales, below the minimum threshold)
    const withoutSignal = computeRestockRecommendations(
      baseInput({
        salesByStoreMonth: salesFor([0, 0, 0, 0, 0, 10]),
      }),
    );
    const withSignal = computeRestockRecommendations(
      baseInput({
        salesByStoreMonth: salesFor([0, 0, 0, 0, 0, 10]),
        lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "reduzir_abastecimento", confianca: "baixa" })]),
      }),
    );
    // Without Loss Intelligence signal, sparse data falls back to "dados_insuficientes"
    expect(withoutSignal[0].acao).toBe("dados_insuficientes");
    // reduzir should compute trend and scale by factor, not return dados_insuficientes
    expect(withSignal[0].acao).toBe("reduzir");
    expect(withSignal[0].confianca).toBe("baixa"); // Inherited from Loss Intelligence, not "insuficiente"
    expect(withSignal[0].motivo).toMatch(/Inteligência de Perdas/);
    // The recommendation should not be the default "no evidence" quantity
    expect(withSignal[0].quantidadeSugeridaIA).not.toBe(0); // Should be some scaled value, not 0
  });
});

describe("parametrização", () => {
  it("attaches parametrizacao and deltaVsParametrizado when a par level is configured", () => {
    const result = computeRestockRecommendations(baseInput({
      parametrizacaoFor: (storeId, sku) => (storeId === 1 && sku === "SKU-1" ? { minimo: 3, nivelDePar: 24, quantidadeAtual: 5, quantidadeAtualEm: "2026-09-24T00:00:00.000Z" } : null),
    }));
    expect(result[0].parametrizacao).toEqual({ minimo: 3, nivelDePar: 24, quantidadeAtual: 5, quantidadeAtualEm: "2026-09-24T00:00:00.000Z" });
    expect(result[0].deltaVsParametrizado).toBe(result[0].quantidadeSugeridaIA - 24);
  });

  it("parametrizacao and deltaVsParametrizado are null when nothing is configured for that store×sku", () => {
    const result = computeRestockRecommendations(baseInput({ parametrizacaoFor: () => null }));
    expect(result[0].parametrizacao).toBeNull();
    expect(result[0].deltaVsParametrizado).toBeNull();
  });

  it("attaches parametrizacao even on a hard-stop (suspender_abastecimento) row", () => {
    const result = computeRestockRecommendations(baseInput({
      lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "suspender_abastecimento" })]),
      parametrizacaoFor: () => ({ minimo: 0, nivelDePar: 20, quantidadeAtual: null, quantidadeAtualEm: null }),
    }));
    expect(result[0].acao).toBe("nao_abastecer");
    expect(result[0].parametrizacao?.nivelDePar).toBe(20);
    expect(result[0].deltaVsParametrizado).toBe(0 - 20);
  });

  it("attaches parametrizacao even when the evidence gate fires (dados_insuficientes)", () => {
    const result = computeRestockRecommendations(baseInput({
      salesByStoreMonth: salesFor([0, 0, 0, 0, 0, 10]),
      parametrizacaoFor: () => ({ minimo: 2, nivelDePar: 18, quantidadeAtual: 4, quantidadeAtualEm: "2026-09-01T00:00:00.000Z" }),
    }));
    expect(result[0].acao).toBe("dados_insuficientes");
    expect(result[0].parametrizacao?.nivelDePar).toBe(18);
  });
});

describe("aproveitamento", () => {
  it("computes vendido/abastecido over the analysed window", () => {
    const result = computeRestockRecommendations(baseInput({
      salesByStoreMonth: salesFor([10, 10, 10, 10, 10, 10]),
      supplyByStoreMonth: supplyFor([20, 20, 20, 20, 20, 20]),
    }));
    // 6 months x 10 sold = 60; 6 months x 20 restocked = 120; 60/120 = 0.5
    expect(result[0].aproveitamento).toBe(0.5);
  });

  it("is null when nothing was restocked in the window (never divides by zero)", () => {
    const result = computeRestockRecommendations(baseInput({ supplyByStoreMonth: supplyFor([null, null, null, null, null, null]) }));
    expect(result[0].aproveitamento).toBeNull();
  });
});

describe("rounding lean toward the lower end of the range", () => {
  it("leans toward faixaEstimada.min when the product has a short shelf life", () => {
    const shortShelfProduct = { ...PRODUCTS[0], shelf_life_days: 5 };
    const result = computeRestockRecommendations(baseInput({
      products: [shortShelfProduct],
      salesByStoreMonth: salesFor([10, 12, 14, 20, 24, 28]),
      supplyByStoreMonth: supplyFor([15, 15, 15, 15, 15, 15]),
    }));
    const leaned = Math.round(result[0].faixaEstimada.min + (result[0].faixaEstimada.max - result[0].faixaEstimada.min) * DEFAULT_RESTOCK_PARAMETERS.rounding.leanToMinFraction);
    expect(result[0].quantidadeSugeridaIA).toBeLessThanOrEqual(leaned);
  });

  it("does not lean when shelf_life_days is null (most products today)", () => {
    const noShelfLifeProduct = { ...PRODUCTS[0], shelf_life_days: null };
    const withNullShelfLife = computeRestockRecommendations(baseInput({
      products: [noShelfLifeProduct],
      salesByStoreMonth: salesFor([10, 12, 14, 20, 24, 28]),
      supplyByStoreMonth: supplyFor([15, 15, 15, 15, 15, 15]),
    }));
    const longShelfProduct = { ...PRODUCTS[0], shelf_life_days: 365 };
    const withLongShelfLife = computeRestockRecommendations(baseInput({
      products: [longShelfProduct],
      salesByStoreMonth: salesFor([10, 12, 14, 20, 24, 28]),
      supplyByStoreMonth: supplyFor([15, 15, 15, 15, 15, 15]),
    }));
    // null shelf life must behave like a long/healthy shelf life, not like a short one
    expect(withNullShelfLife[0].quantidadeSugeridaIA).toBe(withLongShelfLife[0].quantidadeSugeridaIA);
  });

  it("leans toward faixaEstimada.min when historical aproveitamento is low", () => {
    const result = computeRestockRecommendations(baseInput({
      salesByStoreMonth: salesFor([5, 6, 7, 20, 24, 28]),
      supplyByStoreMonth: supplyFor([30, 30, 30, 30, 30, 30]),
    }));
    expect(result[0].aproveitamento).toBeLessThan(DEFAULT_RESTOCK_PARAMETERS.rounding.lowAproveitamentoThreshold);
    const leaned = Math.round(result[0].faixaEstimada.min + (result[0].faixaEstimada.max - result[0].faixaEstimada.min) * DEFAULT_RESTOCK_PARAMETERS.rounding.leanToMinFraction);
    expect(result[0].quantidadeSugeridaIA).toBeLessThanOrEqual(leaned);
  });

  it("never leans on tier-1 (hard-stop) or tier-2 (reduce) rows — those already have a forced/scaled quantity", () => {
    const withoutLean = computeRestockRecommendations(baseInput({
      lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "reduzir_abastecimento" })]),
    }));
    const withShortShelfLife = computeRestockRecommendations(baseInput({
      products: [{ ...PRODUCTS[0], shelf_life_days: 1 }],
      lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "reduzir_abastecimento" })]),
    }));
    expect(withShortShelfLife[0].quantidadeSugeridaIA).toBe(withoutLean[0].quantidadeSugeridaIA);
  });
});
