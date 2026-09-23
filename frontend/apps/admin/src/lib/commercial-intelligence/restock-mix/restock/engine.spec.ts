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
});
