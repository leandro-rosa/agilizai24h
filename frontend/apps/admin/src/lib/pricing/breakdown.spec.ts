import { describe, expect, it } from "@jest/globals";

import type { PricingProduct } from "@/lib/api/pricing";

import { costBreakdown } from "./breakdown";

const base = {
  currentPriceCents: 590,
  structure: { productCostCents: 309, lossAdjustedCostCents: 309 / 0.98, taxRate: 0.0707, lossRate: 0.02, lossLevel: "product", paymentRate: 0.02, paymentFixedCents: 10, voucherShare: 0.22, voucherBasis: "sales_weighted", operatingShare: 0.04, statement: "Rateio operacional utilizado exclusivamente para análise de preço. Não representa novo lançamento financeiro." },
} as unknown as PricingProduct;

describe("costBreakdown", () => {
  it("decompõe a estrutura por unidade ao preço atual e soma o custo econômico", () => {
    const result = costBreakdown(base)!;
    const by = Object.fromEntries(result.rows.map((row) => [row.key, row]));

    expect(by.product.cents).toBe(309);
    expect(by.tax.cents).toBeCloseTo(590 * 0.0707, 6);
    expect(by.loss.cents).toBeCloseTo(309 / 0.98 - 309, 6);
    expect(by.payment.cents).toBeCloseTo(590 * 0.02 + 10, 6);
    expect(by.operating.cents).toBeCloseTo(590 * 0.04, 6);
    expect(result.economicCostCents).toBeCloseTo(309 + 590 * 0.0707 + (309 / 0.98 - 309) + (590 * 0.02 + 10) + 590 * 0.04, 6);
    expect(result.economicCostShare).toBeCloseTo(result.economicCostCents / 590, 8);
  });

  it("mostra o VR/VA sem somá-lo de novo: a taxa já está nas taxas de pagamento", () => {
    const voucher = costBreakdown(base)!.rows.find((row) => row.key === "voucher")!;

    expect(voucher.cents).toBe(0);
    expect(voucher.detail).toContain("22,00% das vendas");
    expect(voucher.detail).toContain("já incluso");
  });

  it("carrega a frase de rateio só para análise", () => {
    expect(costBreakdown(base)!.statement).toContain("exclusivamente para análise de preço");
  });

  it("devolve null sem estrutura ou sem preço, em vez de inventar linhas", () => {
    expect(costBreakdown({ ...base, structure: null } as PricingProduct)).toBeNull();
    expect(costBreakdown({ ...base, currentPriceCents: null } as PricingProduct)).toBeNull();
  });
});
