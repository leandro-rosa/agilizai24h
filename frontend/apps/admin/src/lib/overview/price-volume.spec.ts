import { buildPriceVolume, hasRepricing, PRICE_VOLUME } from "./price-volume";
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
