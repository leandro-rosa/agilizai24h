import type { PricingProduct } from "@/lib/api/pricing";
import type { Product } from "@/lib/api/products";
import { buildBatch, savable } from "./batch";
import { buildRows, type Dated } from "./workspace";

const product = (sku: string): Product => ({ id: Number(sku), sku, name: `P${sku}`, category: "beverage", units_per_package: null, package_type: null, fractionable: null });
const dated = (cents: number): Dated => ({ cents, from: "2026-09-01" });
const analysis = (sku: string, over: Partial<PricingProduct>): PricingProduct => ({ sku, name: sku, status: "adjust", currentPriceCents: 1490, currentMargin: 0.266, targetMargin: 0.35, recommendedPriceCents: 1730, recommendedMargin: 0.352, insufficientReasons: [], validated: true, structure: { productCostCents: 837 } as never, ...over }) as PricingProduct;

const rows = () =>
  buildRows({
    products: [product("1"), product("2"), product("3"), product("4"), product("5"), product("6")],
    costs: new Map([["1", dated(837)], ["2", dated(837)], ["3", dated(837)], ["4", dated(837)], ["6", dated(837)]]),
    prices: new Map([["1", dated(1490)], ["2", dated(1490)], ["3", dated(1730)], ["5", dated(900)], ["6", dated(1490)]]),
    report: [
      analysis("1", {}),
      analysis("2", { currentPriceCents: 1500 }), // price changed after the calculation
      analysis("3", { currentPriceCents: 1730, recommendedPriceCents: 1730 }), // already at the recommendation
      analysis("6", { status: "insufficient_data", insufficientReasons: ["Custo desatualizado"], recommendedPriceCents: null, recommendedMargin: null }),
    ],
  });

describe("buildBatch", () => {
  it("proposes the stored recommendation, with the margin at it, only for a calculation that is up to date", () => {
    const [first] = buildBatch(rows().filter((r) => r.product.sku === "1"));

    expect(first).toMatchObject({ proposedCents: 1730, resultingMargin: 0.352, blocked: null });
  });

  it("every blocked product carries its reason and proposes nothing", () => {
    const items = buildBatch(rows());
    const byReason = Object.fromEntries(items.map((item) => [item.row.product.sku, item.blocked]));

    expect(byReason["2"]).toMatch(/atualize a lista/);
    expect(byReason["3"]).toBe("O preço atual já é o recomendado");
    expect(byReason["4"]).toMatch(/Sem preço atual/);
    expect(byReason["5"]).toBe("Sem custo cadastrado");
    expect(byReason["6"]).toBe("Custo desatualizado");
    expect(items.filter((i) => i.blocked !== null).every((i) => i.proposedCents === null && i.resultingMargin === null)).toBe(true);
  });

  it("only the products without a block can be saved", () => {
    expect(savable(buildBatch(rows())).map((i) => i.row.product.sku)).toEqual(["1"]);
  });
});
