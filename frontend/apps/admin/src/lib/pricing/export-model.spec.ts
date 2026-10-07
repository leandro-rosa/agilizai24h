import { describe, expect, it } from "@jest/globals";
import * as XLSX from "xlsx";

import type { LatestPricingReport, PricingProduct } from "@/lib/api/pricing";

import { buildExportModel } from "./export-model";
import { buildWorkbook, workbookFileName } from "./excel";

const product = (overrides: Partial<PricingProduct> = {}): PricingProduct => ({
  sku: "COCA", name: "Coca-Cola Lata 350ml", ean: null, supplierId: 9, supplierName: "FEMSA", category: "beverage", categoryLabel: "Bebidas", subcategory: null,
  status: "adjust", confidence: "high", minimumPriceCents: 560, targetPriceCents: 610, recommendedPriceCents: 610, currentPriceCents: 590, currentMargin: 0.321, currentMarkup: 1.9,
  targetMargin: 0.35, minimumMargin: 0.3, marginFromCategory: false,
  structure: { productCostCents: 309, lossAdjustedCostCents: 315, taxRate: 0.0707, lossRate: 0.02, lossLevel: "product", paymentRate: 0.02, paymentFixedCents: 0, voucherShare: 0.22, voucherBasis: "sales_weighted", operatingShare: 0.04, statement: "x" },
  costVariation: 0.104, marginAtPreviousCost: 0.36, marginChangeFromCost: -0.039, monthlyUnits: 325, monthlyRevenueCents: 191750, monthlyMarginCents: 80000, impactCentsPerMonth: 42000,
  impactLabel: "Impacto potencial estimado", recommendedMargin: 0.35, reasons: [], insufficientReasons: [], engineVersion: "pricing-1", ...overrides,
});

const NO_COST = product({ sku: "MARM", name: "Marmita", status: "insufficient_data", confidence: "insufficient_data", recommendedPriceCents: null, minimumPriceCents: null, targetPriceCents: null, currentMargin: null, structure: null, costVariation: null, impactCentsPerMonth: null, marginChangeFromCost: null, category: "meal", categoryLabel: "Refeições" });

const latest = (): LatestPricingReport => ({
  scope: { period: "2026-09", storeId: null },
  state: "ready",
  run: { id: "r1", period: "2026-09", storeId: null, status: "completed", engineVersion: "pricing-1", parameterVersion: 3, computedAt: "2026-10-07T10:00:00.000Z", createdAt: "2026-10-07T09:59:00.000Z", error: null },
  report: {
    meta: { engineVersion: "pricing-1", parameterVersion: 3, months: ["2026-07", "2026-08", "2026-09"], asOf: "2026-09-30", storeId: null, payment: { rate: 0.02, voucherShare: 0.2, voucherBasis: "simple_average", unresolvedShare: 0, complete: true, notes: ["VR/VA pela média simples das bandeiras"], components: [] }, paymentMixMonthsWithoutTransactions: [], operating: null, notes: ["Nenhuma taxa de pagamento cadastrada."] },
    summary: { analysed: 2, averageMargin: 0.321, targetMargin: 0.35, withinTarget: 0, belowTarget: 1, opportunities: 0, insufficientData: 1, review: 0, potentialImpactCentsPerMonth: 42000, impactLabel: "Impacto potencial estimado", shares: { withinTarget: 0, belowTarget: 0.5, opportunities: 0, insufficientData: 0.5 } },
    categories: [{ category: "Bebidas", categoryKey: "beverage", averageMargin: 0.321, targetMargin: 0.35, difference: -0.029, revenueCents: 191750, revenueShare: 1, products: 1 }],
    products: [product(), NO_COST],
  },
  inProgress: null, lastFailure: null, currentParameterVersion: 3, parametersStale: false,
});

const model = (products = [product(), NO_COST]) => buildExportModel({ latest: latest(), products, scopeLabel: "Todas as lojas", filtersLabel: "nenhum", categories: latest().report!.categories })!;

describe("buildExportModel", () => {
  it("não existe sem relatório carregado", () => {
    expect(buildExportModel({ latest: { ...latest(), report: null, run: null, state: "none" }, products: [], scopeLabel: "x", filtersLabel: "x", categories: [] })).toBeNull();
  });

  it("reúne as observações de qualidade dos dados, sem repetir, e cita os produtos sem dados", () => {
    const m = model();

    expect(m.notes).toEqual(expect.arrayContaining(["Nenhuma taxa de pagamento cadastrada.", "VR/VA pela média simples das bandeiras", "1 produto(s) sem dados suficientes não recebem recomendação."]));
    expect(new Set(m.notes).size).toBe(m.notes.length);
  });

  it("avisa quando as regras mudaram depois do cálculo", () => {
    const m = buildExportModel({ latest: { ...latest(), parametersStale: true }, products: [product()], scopeLabel: "x", filtersLabel: "x", categories: [] })!;

    expect(m.notes.join(" ")).toContain("regras de negócio mudaram");
  });

  it("usa só os produtos recebidos (já filtrados) e separa os abaixo da meta com recomendação", () => {
    expect(model([product()]).products).toHaveLength(1);
    expect(model().belowTarget.map((p) => p.sku)).toEqual(["COCA"]);
  });
});

describe("planilha", () => {
  const book = () => buildWorkbook(model());
  const rows = (name: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(book().Sheets[name]);

  it("tem as quatro abas", () => {
    expect(book().SheetNames).toEqual(["Produtos", "Custos que mudaram", "Margem por categoria", "Informações"]);
  });

  it("exporta números como número (reais e frações), não texto formatado", () => {
    const coca = rows("Produtos").find((row) => row["Código"] === "COCA")!;

    expect(coca["Preço atual (R$)"]).toBe(5.9);
    expect(coca["Preço recomendado (R$)"]).toBe(6.1);
    expect(coca["Margem atual"]).toBe(0.321);
    expect(coca["Impacto potencial estimado (R$/mês)"]).toBe(420);
    expect(typeof coca["Custo médio (R$)"]).toBe("number");
  });

  it("deixa vazia a célula de um valor ausente, nunca zero", () => {
    const marmita = rows("Produtos").find((row) => row["Código"] === "MARM")!;

    expect(marmita["Preço recomendado (R$)"]).toBeUndefined();
    expect(marmita["Impacto potencial estimado (R$/mês)"]).toBeUndefined();
    expect(marmita["Margem atual"]).toBeUndefined();
    expect(marmita["Situação"]).toBe("Dados insuficientes");
  });

  it("registra período, versões e as observações na aba de informações", () => {
    const info = XLSX.utils.sheet_to_json<unknown[]>(book().Sheets["Informações"], { header: 1 }).flat().map(String);

    expect(info).toEqual(expect.arrayContaining(["2026-09", "Todas as lojas", "pricing-1", "Nenhuma taxa de pagamento cadastrada."]));
  });

  it("nomeia o arquivo pelo período", () => expect(workbookFileName(model())).toBe("Precificacao-Agiliz-2026-09.xlsx"));
});
