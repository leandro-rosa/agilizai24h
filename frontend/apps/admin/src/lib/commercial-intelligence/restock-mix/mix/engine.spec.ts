import { describe, it, expect } from "@jest/globals";
import { computeMixOpportunities, computeMixRecommendations, type MixEngineInput } from "./engine";
import { DEFAULT_MIX_PARAMETERS } from "./parameters";
import { DEFAULT_PARAMETERS as DEFAULT_LOSS_PARAMETERS } from "@/lib/loss-intelligence/parameters";
import type { LossIntelligenceRecommendation, LossIntelligenceResult } from "@/lib/loss-intelligence/types";
import type { Store } from "@/lib/api/stores";
import type { Product } from "@/lib/api/products";
import type { StoreMonthSales } from "@/lib/api/sales";

const TODAY = "2026-09-01";
const MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
const PRODUCTS: Product[] = [{ id: 1, sku: "SKU-1", name: "Produto 1", category: "beverage" } as Product];

function salesFor(storeId: number, sku: string, qty: number[], unitPriceCents = 500): StoreMonthSales[] {
  return MONTHS.map((period, i) => ({ storeId, period, bySku: qty[i] > 0 ? [{ store_id: storeId, period, sku, quantity_sold: qty[i], revenue_cents: qty[i] * unitPriceCents, ingestion_id: "x" }] : [] }));
}

function mergeSales(...groups: StoreMonthSales[][]): StoreMonthSales[] {
  const byKey = new Map<string, StoreMonthSales>();
  for (const group of groups) {
    for (const month of group) {
      const key = `${month.storeId}:${month.period}`;
      const existing = byKey.get(key);
      if (existing) existing.bySku.push(...month.bySku);
      else byKey.set(key, { ...month, bySku: [...month.bySku] });
    }
  }
  return [...byKey.values()];
}

function lossResult(recommendations: LossIntelligenceRecommendation[] = []): LossIntelligenceResult {
  return { recommendations, countsByAction: {} as LossIntelligenceResult["countsByAction"], valueLostInPrioritizedCasesCents: 0, impactEstimateCents: { conservative: 0, expected: 0, optimistic: 0 } };
}

function buildLossRecommendation(overrides: Partial<LossIntelligenceRecommendation> = {}): LossIntelligenceRecommendation {
  return {
    sku: "SKU-1", storeId: 1,
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
    historico: [], maiorImpactoFinanceiroMotivo: null, maiorImpactoFinanceiroValueCents: 0, motivoDiagnosticoPrioritario: "other_reason",
    motivosSecundarios: [], acaoPrioritaria: "investigar", acoesSecundarias: [], sinaisTransversais: [], prioridade: "media", confianca: "alta",
    comparacaoRede: { expired: "dado_insuficiente", damaged_product: "dado_insuficiente", other_reason: "dado_insuficiente" },
    limitacoesDosDados: [], firstSeenRecently: false, versaoMotor: "test", versaoParametros: "test",
    ...overrides,
  };
}

const STORES: Store[] = [{ id: 1, name: "Loja A" } as Store];

function baseInput(overrides: Partial<MixEngineInput> = {}): MixEngineInput {
  return {
    stores: STORES,
    products: PRODUCTS,
    salesByStoreMonth: salesFor(1, "SKU-1", [10, 10, 10, 10, 10, 10]),
    supplyByStoreMonth: [],
    reconciliationByStoreMonth: [],
    lossResult: lossResult(),
    today: TODAY,
    lossParameters: DEFAULT_LOSS_PARAMETERS,
    mixParameters: DEFAULT_MIX_PARAMETERS,
    costsBySkuAsOf: () => 200,
    ...overrides,
  };
}

describe("computeMixRecommendations", () => {
  it("passes through suspender_abastecimento from Loss Intelligence directly", () => {
    const result = computeMixRecommendations(baseInput({ lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "suspender_abastecimento" })]) }));
    expect(result[0].classificacao).toBe("suspender_abastecimento");
  });

  it("maps both avaliar_retirada_* and avaliar_permanencia_* to the single 'avaliar_retirada' classification", () => {
    const retirada = computeMixRecommendations(baseInput({ lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "avaliar_retirada_loja" })]) }));
    const permanencia = computeMixRecommendations(baseInput({ lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "avaliar_permanencia_rede" })]) }));
    expect(retirada[0].classificacao).toBe("avaliar_retirada");
    expect(permanencia[0].classificacao).toBe("avaliar_retirada");
  });

  it("maps reduzir_abastecimento to 'reduzir'", () => {
    const result = computeMixRecommendations(baseInput({ lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: "reduzir_abastecimento" })]) }));
    expect(result[0].classificacao).toBe("reduzir");
  });

  it("classifies dados_insuficientes below the evidence gate, absent any loss signal", () => {
    const result = computeMixRecommendations(baseInput({ salesByStoreMonth: salesFor(1, "SKU-1", [0, 0, 0, 0, 0, 10]) }));
    expect(result[0].classificacao).toBe("dados_insuficientes");
  });

  it("classifies explorar for a growing, high-affinity, margin-healthy product with no loss signal", () => {
    // 2 lojas: SKU-1 é 100% da receita da Loja A, mas só ~31% da receita da rede (Loja B vende SKU-2) -> affinity ~3.2, acima do piso de 1.2
    const stores: Store[] = [{ id: 1, name: "Loja A" } as Store, { id: 2, name: "Loja B" } as Store];
    const sales = mergeSales(salesFor(1, "SKU-1", [10, 12, 14, 20, 24, 28]), salesFor(2, "SKU-2", [20, 20, 20, 20, 20, 20], 1000));
    const result = computeMixRecommendations(baseInput({ stores, salesByStoreMonth: sales }));
    const row = result.find((r) => r.storeId === 1 && r.sku === "SKU-1");
    expect(row).toBeDefined();
    expect(row!.tendencia).toBe("crescendo");
    expect(row!.classificacao).toBe("explorar");
  });

  it("classifies reduzir for a declining product with no loss signal", () => {
    const result = computeMixRecommendations(baseInput({ salesByStoreMonth: salesFor(1, "SKU-1", [30, 28, 25, 20, 16, 12]) }));
    expect(result[0].classificacao).toBe("reduzir");
  });

  it("skips a sku with no matching product", () => {
    expect(computeMixRecommendations(baseInput({ products: [] }))).toHaveLength(0);
  });
});

describe("computeMixOpportunities", () => {
  const MANY_STORES: Store[] = [1, 2, 3].map((id) => ({ id, name: `Loja ${id}` }) as Store);
  const TIGHT_PARAMETERS = { ...DEFAULT_MIX_PARAMETERS, opportunity: { ...DEFAULT_MIX_PARAMETERS.opportunity, minNetworkStores: 2 } };

  it("surfaces a sku absent from a store as an opportunity when enough other stores show good performance", () => {
    const sales = mergeSales(salesFor(2, "SKU-1", [10, 12, 14, 20, 24, 28]), salesFor(3, "SKU-1", [10, 12, 14, 20, 24, 28]));
    const result = computeMixOpportunities(baseInput({ stores: MANY_STORES, salesByStoreMonth: sales, mixParameters: TIGHT_PARAMETERS }));
    expect(result.some((o) => o.storeId === 1 && o.sku === "SKU-1")).toBe(true);
  });

  it("never surfaces a sku already present in that store", () => {
    const sales = mergeSales(salesFor(1, "SKU-1", [10, 12, 14, 20, 24, 28]), salesFor(2, "SKU-1", [10, 12, 14, 20, 24, 28]), salesFor(3, "SKU-1", [10, 12, 14, 20, 24, 28]));
    const result = computeMixOpportunities(baseInput({ stores: MANY_STORES, salesByStoreMonth: sales, mixParameters: TIGHT_PARAMETERS }));
    expect(result.some((o) => o.storeId === 1)).toBe(false);
  });

  it("never surfaces an opportunity below the minimum store count", () => {
    const sales = salesFor(2, "SKU-1", [10, 12, 14, 20, 24, 28]); // só 1 outra loja com bom desempenho, mínimo é 2
    const result = computeMixOpportunities(baseInput({ stores: MANY_STORES, salesByStoreMonth: sales, mixParameters: TIGHT_PARAMETERS }));
    expect(result).toHaveLength(0);
  });

  it("never returns confianca alta for an opportunity", () => {
    const sales = mergeSales(salesFor(2, "SKU-1", [10, 12, 14, 20, 24, 28]), salesFor(3, "SKU-1", [10, 12, 14, 20, 24, 28]));
    const result = computeMixOpportunities(baseInput({ stores: MANY_STORES, salesByStoreMonth: sales, mixParameters: TIGHT_PARAMETERS }));
    expect(result.every((o) => o.confianca !== "alta")).toBe(true);
  });
});
