import { buildPriceChanges, buildPriceVolume, hasRepricing, PRICE_VOLUME, priceImpactReading } from "./price-volume";
import type { SalesCell } from "./types";

const cell = (sku: string, period: string, quantity: number, revenueCents: number, storeId = 1): SalesCell => ({ storeId, period, sku, quantity, revenueCents });
const both = ["2026-08", "2026-09"];

describe("buildPriceVolume", () => {
  it("separa preço e volume de forma exata e fecha com a variação total", () => {
    // A: 100 un a R$10 -> 80 un a R$12 (reajuste +20%). B: preço estável. C: só em setembro.
    const cells = [
      cell("A", "2026-08", 100, 100_000), cell("A", "2026-09", 80, 96_000),
      cell("B", "2026-08", 50, 25_000), cell("B", "2026-09", 40, 20_000),
      cell("C", "2026-09", 5, 5_000),
    ];
    const pv = buildPriceVolume("2026-09", "2026-08", cells, both)!;
    expect(pv.repriced.count).toBe(1);
    expect(pv.repriced.priceEffectCents).toBe(16_000); // (1200-1000)*80
    expect(pv.repriced.volumeEffectCents).toBe(-20_000); // (80-100)*1000
    expect(pv.others.deltaCents).toBe(-5_000);
    expect(pv.entriesExits.deltaCents).toBe(5_000);
    const parts = pv.repriced.priceEffectCents + pv.repriced.volumeEffectCents + pv.others.deltaCents + pv.entriesExits.deltaCents;
    expect(parts).toBe(pv.deltaCents);
    expect(pv.days).toEqual({ before: 31, after: 30 });
  });

  it("não chama de reajuste SKU com pouco volume ou variação pequena", () => {
    const cells = [
      cell("A", "2026-08", PRICE_VOLUME.MIN_UNITS - 1, 9_000), cell("A", "2026-09", 20, 30_000), // pouco volume antes
      cell("B", "2026-08", 100, 100_000), cell("B", "2026-09", 100, 102_000), // +2%
    ];
    const pv = buildPriceVolume("2026-09", "2026-08", cells, both)!;
    expect(pv.repriced.count).toBe(0);
    expect(hasRepricing(pv)).toBe(false);
  });

  it("sem um dos meses importados não há base: null, nunca zero", () => {
    expect(buildPriceVolume("2026-09", "2026-08", [cell("A", "2026-09", 10, 1000)], ["2026-09"])).toBeNull();
  });
});


describe("buildPriceChanges", () => {
  it("lista cada produto reajustado com preço, unidades e margem antes e depois", () => {
    const cells = ["A", "B", "C"].flatMap((k) => [cell(k, "2026-08", 100, 100_000), cell(k, "2026-09", 80, 96_000)]);
    const pv = buildPriceVolume("2026-09", "2026-08", cells, both)!;
    const pc = buildPriceChanges(pv, { A: "Produto A" }, { A: 500 })!;
    expect(pc.count).toBe(3);
    const a = pc.rows.find((r) => r.sku === "A")!;
    expect(a.name).toBe("Produto A");
    expect([a.priceBeforeCents, a.priceAfterCents]).toEqual([1000, 1200]);
    expect(a.pricePct).toBeCloseTo(0.2);
    expect([a.unitsBefore, a.unitsAfter]).toEqual([100, 80]);
    expect(a.unitsPct).toBeCloseTo(-0.2);
    expect(a.marginBefore).toBeCloseTo(0.5);
    expect(a.marginAfter).toBeCloseTo(1 - 500 / 1200);
    // Sem custo resolvido a margem é null, nunca 0.
    expect(pc.rows.find((r) => r.sku === "B")!.marginBefore).toBeNull();
  });

  it("sem reajuste relevante não há bloco", () => {
    const pv = buildPriceVolume("2026-09", "2026-08", [cell("A", "2026-08", 100, 100_000), cell("A", "2026-09", 100, 100_000)], both)!;
    expect(buildPriceChanges(pv, {}, null)).toBeNull();
  });
});

describe("buildPriceChanges — saldo do reajuste", () => {
  // A: 100 un a R$10 -> 80 un a R$12, custo R$5. Receita 1000 -> 960. Margem R$ 500 -> 560.
  const cells = [cell("A", "2026-08", 100, 100_000), cell("A", "2026-09", 80, 96_000), cell("B", "2026-08", 100, 100_000), cell("B", "2026-09", 80, 96_000), cell("C", "2026-08", 100, 100_000), cell("C", "2026-09", 80, 96_000)];
  const pc = () => buildPriceChanges(buildPriceVolume("2026-09", "2026-08", cells, both)!, {}, { A: 500, B: 500, C: 500 })!;

  it("faturamento caiu e a margem em R$ subiu: os efeitos de preço e volume fecham com a variação", () => {
    const i = pc().impact;
    expect([i.revenueBeforeCents, i.revenueAfterCents]).toEqual([300_000, 288_000]);
    const m = i.margin!;
    expect([m.beforeCents, m.afterCents]).toEqual([150_000, 168_000]);
    expect(m.priceEffectCents).toBe(48_000); // (1200-1000)*80*3
    expect(m.volumeEffectCents).toBe(-30_000); // (80-100)*(1000-500)*3
    expect(m.priceEffectCents + m.volumeEffectCents).toBe(m.afterCents - m.beforeCents);
    expect(m.pctBefore).toBeCloseTo(0.5);
    expect(m.pctAfter).toBeCloseTo(168_000 / 288_000);
  });

  it("sem custo resolvido não há margem (null), mas o faturamento continua", () => {
    const i = buildPriceChanges(buildPriceVolume("2026-09", "2026-08", cells, both)!, {}, null)!.impact;
    expect(i.margin).toBeNull();
    expect(i.revenueAfterCents).toBe(288_000);
  });
});


describe("priceImpactReading", () => {
  it("diz o saldo em faturamento e margem sem afirmar causa", () => {
    const cells2 = ["A", "B", "C"].flatMap((k) => [cell(k, "2026-08", 100, 100_000), cell(k, "2026-09", 80, 96_000)]);
    const pc = buildPriceChanges(buildPriceVolume("2026-09", "2026-08", cells2, both)!, {}, { A: 500, B: 500, C: 500 })!;
    const r = priceImpactReading(pc, (c) => `R$${Math.round(c / 100)}`);
    expect(r.headline).toBe("Nos reajustados, o faturamento caiu R$120 e a margem de contribuição em R$ subiu R$180.");
    expect(r.lines.join(" ")).toMatch(/ganho de preço \(\+R\$480\) foi maior que o efeito das unidades \(−R\$300\)/);
    expect(r.lines.join(" ")).toMatch(/Vendas: unidades −20%/);
    expect(r.lines.join(" ")).not.toMatch(/\bcausou\b/);
  });
});
