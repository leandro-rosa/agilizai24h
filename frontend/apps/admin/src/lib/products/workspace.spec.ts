import type { PricingProduct } from "@/lib/api/pricing";
import type { Product } from "@/lib/api/products";
import { buildPendencyGroups, buildRows, filterRows, isBelowTarget, matchesSearch, NO_WORKSPACE_FILTERS, pendencySummary, quickCounts, sortRows, type Dated } from "./workspace";

const product = (sku: string, name: string, over: Partial<Product> = {}): Product => ({ id: Number(sku), sku, name, category: "beverage", units_per_package: null, package_type: null, fractionable: null, ...over });
const dated = (cents: number, from = "2026-09-01"): Dated => ({ cents, from });
const analysis = (sku: string, over: Partial<PricingProduct> = {}): PricingProduct =>
  ({
    sku, name: sku, status: "healthy", currentPriceCents: 1190, currentMargin: 0.382, targetMargin: 0.35, recommendedPriceCents: 1120, insufficientReasons: [], validated: true,
    structure: { productCostCents: 570 } as never, ...over,
  }) as PricingProduct;

const world = () => {
  const products = [product("100103", "Monster"), product("100109", "Quiche"), product("2265", "Milka"), product("100200", "Novo sem preço"), product("100201", "Sem custo")];
  const costs = new Map<string, Dated>([["100103", dated(570)], ["100109", dated(837)], ["2265", dated(1399)], ["100200", dated(500)]]);
  const prices = new Map<string, Dated>([["100103", dated(1190)], ["100109", dated(1490)], ["2265", dated(2800)], ["100201", dated(900)]]);
  const report = [
    analysis("100103"),
    analysis("100109", { currentPriceCents: 1490, currentMargin: 0.266, recommendedPriceCents: 1730, status: "adjust", structure: { productCostCents: 837 } as never }),
    // Milka's price changed after the calculation: the stored 2800 no longer describes today's 3000.
    analysis("2265", { currentPriceCents: 2500, currentMargin: 0.336, status: "adjust", structure: { productCostCents: 1399 } as never }),
  ];

  return { products, costs, prices, report };
};

describe("buildRows", () => {
  it("shows margin and suggestion only when the stored calculation describes today's price and cost", () => {
    const rows = buildRows(world());
    const monster = rows.find((r) => r.product.sku === "100103")!;

    expect(monster).toMatchObject({ situation: "healthy", margin: 0.382, suggestedCents: 1120, targetMargin: 0.35 });
    expect(rows.find((r) => r.product.sku === "100109")).toMatchObject({ situation: "review", suggestedCents: 1730 });
  });

  it("a price changed after the calculation hides the old margin and suggestion and asks to refresh the list", () => {
    const rows = buildRows(world());
    const milka = rows.find((r) => r.product.sku === "2265")!;

    expect(milka).toMatchObject({ situation: "stale", margin: null, suggestedCents: null, stale: true });
    expect(milka.pending.join(" ")).toMatch(/atualize a lista/);
  });

  it("a cost changed after the calculation is stale too", () => {
    const data = world();
    data.costs.set("100103", dated(600));

    expect(buildRows(data).find((r) => r.product.sku === "100103")).toMatchObject({ situation: "stale", margin: null });
  });

  it("a product without a price is 'no price': never a margin, never a zero", () => {
    const row = buildRows(world()).find((r) => r.product.sku === "100200")!;

    expect(row).toMatchObject({ situation: "no_price", margin: null, suggestedCents: null, price: null });
  });

  it("a product with a price and no cost is pending, and says so", () => {
    const row = buildRows(world()).find((r) => r.product.sku === "100201")!;

    expect(row.situation).toBe("pending");
    expect(row.pending).toContain("Sem custo cadastrado");
  });

  it("without any stored calculation nobody gets a margin, and priced products are pending with the reason", () => {
    const rows = buildRows({ ...world(), report: null });

    expect(rows.every((r) => r.margin === null && r.suggestedCents === null)).toBe(true);
    expect(rows.find((r) => r.product.sku === "100103")!.pending.join(" ")).toMatch(/Ainda não há cálculo de hoje/);
  });

  it("insufficient data in the calculation is pending with the calculation's own reasons", () => {
    const data = world();
    data.report[0] = analysis("100103", { status: "insufficient_data", insufficientReasons: ["Custo desatualizado (sem compra no período)"], currentMargin: null, recommendedPriceCents: null });
    const row = buildRows(data).find((r) => r.product.sku === "100103")!;

    expect(row).toMatchObject({ situation: "pending", margin: null, suggestedCents: null });
    expect(row.pending).toContain("Custo desatualizado (sem compra no período)");
  });
});

describe("quick filters and counts", () => {
  it("counts each quick filter on the whole list, and 'below target' only counts calculations in date", () => {
    const rows = buildRows(world());

    expect(quickCounts(rows)).toEqual({ all: 5, no_price: 1, below_target: 1, pending: 2 });
    expect(rows.filter(isBelowTarget).map((r) => r.product.sku)).toEqual(["100109"]);
  });

  it("filters by quick filter, category and search together", () => {
    const rows = buildRows(world());

    expect(filterRows(rows, { ...NO_WORKSPACE_FILTERS, quick: "no_price" }).map((r) => r.product.name)).toEqual(["Novo sem preço"]);
    expect(filterRows(rows, { ...NO_WORKSPACE_FILTERS, category: "snack" })).toHaveLength(0);
    expect(filterRows(rows, { ...NO_WORKSPACE_FILTERS, search: "quich" })).toHaveLength(1);
  });
});

describe("matchesSearch", () => {
  it("finds by name (accent- and case-insensitive), SKU, or ANY linked EAN, active or old", () => {
    const withEans = product("100103", "Energético Açaí", { ean: "7891000000001", eans: [{ id: 1, ean: "7891000000001", status: "active", is_primary: true, valid_from: null, valid_to: null, source: "other", actor: null, note: null }, { id: 2, ean: "7891000000999", status: "inactive", is_primary: false, valid_from: null, valid_to: null, source: "other", actor: null, note: null }] });

    expect(matchesSearch(withEans, "acai")).toBe(true);
    expect(matchesSearch(withEans, "100103")).toBe(true);
    expect(matchesSearch(withEans, "7891000000999")).toBe(true);
    expect(matchesSearch(withEans, "zzz")).toBe(false);
  });
});

describe("sortRows", () => {
  it("never treats a missing value as zero: empty values go last in either direction", () => {
    const rows = buildRows(world());

    expect(sortRows(rows, "margin", "asc").map((r) => r.product.sku).slice(0, 2)).toEqual(["100109", "100103"]);
    expect(sortRows(rows, "margin", "desc").map((r) => r.product.sku).slice(0, 2)).toEqual(["100103", "100109"]);
    expect(sortRows(rows, "price", "asc").at(-1)!.price).toBeNull();
    expect(sortRows(rows, "price", "desc").at(-1)!.price).toBeNull();
  });
});

describe("pendency groups", () => {
  it("groups by reason with the affected products and counts the groups", () => {
    const rows = buildRows(world());
    const groups = buildPendencyGroups(rows, [{ code: "rules", label: "Alíquota de imposto não configurada", action: "open_rules", actionLabel: "Abrir regras", skus: [] }]);

    expect(groups.map((g) => g.code)).toEqual(["no_cost", "stale", "rules"]);
    expect(groups[0].skus).toEqual(["100201"]);
    expect(groups[1].skus).toEqual(["2265"]);
    expect(pendencySummary(groups)).toBe("3 pendências");
    expect(pendencySummary([])).toBeNull();
    expect(pendencySummary(groups.slice(0, 1))).toBe("1 pendência");
  });
});
