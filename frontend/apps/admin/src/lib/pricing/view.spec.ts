import { describe, expect, it } from "@jest/globals";

import type { PricingProduct } from "@/lib/api/pricing";

import { applyFilters, belowTarget, costChanges, filterOptions, marginBandOf, NO_FILTERS, noRecommendationReason, paginate, sortProducts, topOpportunities } from "./view";

const product = (overrides: Partial<PricingProduct> = {}): PricingProduct => ({
  sku: "COCA",
  name: "Coca-Cola Lata 350ml",
  ean: "789490001537",
  supplierId: 9,
  supplierName: "Coca-Cola FEMSA",
  category: "beverage",
  categoryLabel: "Bebidas",
  subcategory: null,
  status: "adjust",
  confidence: "high",
  minimumPriceCents: 560,
  targetPriceCents: 610,
  recommendedPriceCents: 610,
  currentPriceCents: 590,
  currentMargin: 0.321,
  currentMarkup: 1.9,
  targetMargin: 0.35,
  minimumMargin: 0.3,
  marginFromCategory: false,
  structure: { productCostCents: 309, lossAdjustedCostCents: 315, taxRate: 0.0707, lossRate: 0.02, lossLevel: "product", paymentRate: 0.02, paymentFixedCents: 0, voucherShare: 0.22, voucherBasis: "sales_weighted", operatingShare: 0.04, statement: "x" },
  costVariation: 0.104,
  marginAtPreviousCost: 0.36,
  marginChangeFromCost: -0.039,
  monthlyUnits: 325,
  monthlyMarginCents: 80000,
  impactCentsPerMonth: 42000,
  impactLabel: "Impacto potencial estimado",
  recommendedMargin: 0.35,
  reasons: [],
  insufficientReasons: [],
  engineVersion: "pricing-1",
  ...overrides,
});

const NO_COST = product({ sku: "MARM", name: "Marmita", ean: null, supplierId: null, supplierName: null, category: "meal", categoryLabel: "Refeições", status: "insufficient_data", confidence: "insufficient_data", recommendedPriceCents: null, currentMargin: null, structure: null, costVariation: null, impactCentsPerMonth: null, marginChangeFromCost: null, monthlyUnits: 0, insufficientReasons: ["Sem custo cadastrado"] });

describe("filtros", () => {
  const list = [product(), product({ sku: "MONS", name: "Monster Energy", ean: null, supplierId: 4, supplierName: "Monster", status: "opportunity", currentMargin: 0.358, costVariation: 0.0002 }), NO_COST];

  it("combinam e cada um recorta o que sobra", () => {
    expect(applyFilters(list, { ...NO_FILTERS, category: "beverage", status: "adjust" }).map((p) => p.sku)).toEqual(["COCA"]);
    expect(applyFilters(list, { ...NO_FILTERS, supplierId: 4 }).map((p) => p.sku)).toEqual(["MONS"]);
  });

  it("buscam por nome sem acento, por SKU e por EAN", () => {
    expect(applyFilters(list, { ...NO_FILTERS, query: "marmíta" }).map((p) => p.sku)).toEqual(["MARM"]);
    expect(applyFilters(list, { ...NO_FILTERS, query: "mons" }).map((p) => p.sku)).toEqual(["MONS"]);
    expect(applyFilters(list, { ...NO_FILTERS, query: "789490001537" }).map((p) => p.sku)).toEqual(["COCA"]);
  });

  it("abaixo da meta e custo alterado: produto sem margem não é 'abaixo da meta'", () => {
    expect(applyFilters(list, { ...NO_FILTERS, belowTarget: true }).map((p) => p.sku)).toEqual(["COCA"]);
    expect(applyFilters(list, { ...NO_FILTERS, costChanged: true }).map((p) => p.sku)).toEqual(["COCA"]);
    expect(belowTarget(NO_COST)).toBe(false);
  });

  it("faixa de margem inclui 'sem margem calculada'", () => {
    expect(marginBandOf(0.321)).toBe("30_35");
    expect(marginBandOf(null)).toBe("no_margin");
    expect(applyFilters(list, { ...NO_FILTERS, marginBand: "no_margin" }).map((p) => p.sku)).toEqual(["MARM"]);
  });

  it("sem filtro devolve tudo", () => expect(applyFilters(list, NO_FILTERS)).toHaveLength(3));
});

describe("ordenação", () => {
  const a = product({ sku: "A", name: "A", impactCentsPerMonth: 10000, currentMargin: 0.3, monthlyUnits: 10, costVariation: 0.02 });
  const b = product({ sku: "B", name: "B", impactCentsPerMonth: 90000, currentMargin: 0.33, monthlyUnits: 500, costVariation: -0.2 });
  const c = product({ sku: "C", name: "C", impactCentsPerMonth: 50000, currentMargin: 0.1, monthlyUnits: 100, costVariation: 0.05 });

  it("por maior impacto", () => expect(sortProducts([a, b, c], "impact").map((p) => p.sku)).toEqual(["B", "C", "A"]));
  it("por menor margem", () => expect(sortProducts([a, b, c], "lowest_margin").map((p) => p.sku)).toEqual(["C", "A", "B"]));
  it("por maior venda", () => expect(sortProducts([a, b, c], "most_sold").map((p) => p.sku)).toEqual(["B", "C", "A"]));
  it("por maior variação de custo, em módulo", () => expect(sortProducts([a, b, c], "cost_variation").map((p) => p.sku)).toEqual(["B", "C", "A"]));

  it("por maior oportunidade: a maior distância até a meta entre quem tem recomendação", () => {
    expect(sortProducts([a, b, c], "opportunity").map((p) => p.sku)).toEqual(["C", "A", "B"]);
  });

  it("quem não tem o número vai para o fim, nunca para o topo, e a lista original não muda", () => {
    const list = [NO_COST, a, b];
    const sorted = sortProducts(list, "lowest_margin");

    expect(sorted.map((p) => p.sku)).toEqual(["A", "B", "MARM"]);
    expect(sortProducts(list, "impact").map((p) => p.sku)).toEqual(["B", "A", "MARM"]);
    expect(list.map((p) => p.sku)).toEqual(["MARM", "A", "B"]);
  });
});

describe("paginação", () => {
  it("limita a página e nunca sai do intervalo", () => {
    const items = Array.from({ length: 25 }, (_, i) => i);

    expect(paginate(items, 1, 10)).toMatchObject({ rows: items.slice(0, 10), pages: 3, page: 1 });
    expect(paginate(items, 99, 10)).toMatchObject({ rows: items.slice(20), page: 3 });
    expect(paginate([], 1, 10)).toMatchObject({ rows: [], pages: 1, page: 1 });
  });
});

describe("opções de filtro", () => {
  it("saem do relatório: só categorias e fornecedores que existem, sem fornecedor fantasma", () => {
    const options = filterOptions([product(), NO_COST]);

    expect(options.categories.map((c) => c.label)).toEqual(["Bebidas", "Refeições"]);
    expect(options.suppliers).toEqual([{ id: 9, name: "Coca-Cola FEMSA" }]);
  });
});

describe("seções de apoio", () => {
  it("principais oportunidades: só com recomendação e impacto positivo, maior primeiro, com frase factual", () => {
    const small = product({ sku: "S", name: "S", impactCentsPerMonth: 1000 });
    const list = topOpportunities([small, product(), NO_COST, product({ sku: "N", impactCentsPerMonth: -500 })]);

    expect(list.map((o) => o.product.sku)).toEqual(["COCA", "S"]);
    expect(list[0].text).toContain("32,1%");
    expect(list[0].text).toContain("meta de 35,0%");
    expect(list[0].text).toContain("Custo subiu 10,4%");
    expect(list[0].text).toContain("impacto potencial estimado");
  });

  it("custos que mais mudaram: custo anterior vem da variação do motor, maior em módulo primeiro", () => {
    const fell = product({ sku: "F", name: "F", costVariation: -0.2, structure: { ...product().structure!, productCostCents: 200 } });
    const rows = costChanges([product(), fell, NO_COST, product({ sku: "Z", costVariation: 0 })]);

    expect(rows.map((r) => r.product.sku)).toEqual(["F", "COCA"]);
    expect(rows[1]).toMatchObject({ currentCostCents: 309, previousCostCents: 280, marginChange: -0.039 });
    expect(rows[0].previousCostCents).toBe(250);
  });

  it("explica por que não há recomendação", () => {
    expect(noRecommendationReason(NO_COST)).toBe("Sem custo cadastrado");
    expect(noRecommendationReason(product())).toBeNull();
  });
});
