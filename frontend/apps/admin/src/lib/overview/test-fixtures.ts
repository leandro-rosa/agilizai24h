import { buildOverview } from "./build";
import type { MonthInput, Overview, OverviewInput, StoreMonthPnl } from "./types";

// Fixture SINTÉTICA: só para specs de apresentação; nunca vai a banco nem a tela real.
const pnl = (net: number, c: number, op: number) => ({ netRevenueCents: net, grossRevenueCents: net, contributionMarginCents: c, operatingProfitCents: op, computedAt: "2026-10-06T13:15:00Z" });
const fin = (loss: number) => ({
  restockedValueCents: 5_000_000,
  cogsCents: 0,
  lossValueCents: loss,
  lossByReason: [{ reason: "expired", valueCents: loss * 0.51 }, { reason: "other_reason", valueCents: loss * 0.48 }, { reason: "damaged_product", valueCents: loss * 0.01 }],
  lossBySku: [{ sku: "A", valueCents: 64_900 }, { sku: "B", valueCents: 18_800 }],
  incompleteStores: 21,
});
const store = (id: number, name: string, net: number): StoreMonthPnl => ({ storeId: id, name, netRevenueCents: net, contributionMarginCents: net * 0.4, operatingProfitCents: net * 0.2, lossCents: 0 });
const month = (period: string, p: ReturnType<typeof pnl>, over: Partial<MonthInput> = {}): MonthInput => ({ period, pnl: p, cash: null, treasury: null, finance: null, capex: null, investors: null, ...over });
const tr = (stock: number, inv: number) => ({ byCategory: [{ category: "Estoque", outflowCents: stock }, { category: "Combustível", outflowCents: 88_000 }], unresolvedCount: 0, pendingCount: 0, investmentCents: inv, investmentByCategory: [{ category: "Equipamento", cents: inv }] });

/** Setembro: vende menos, sobra mais (3 produtos reajustados), perdas menores, caixa maior. */
export function fixtureInput(): OverviewInput {
  const cells = ["A", "B", "C"].flatMap((s) => [
    { storeId: 1, period: "2026-08", sku: s, quantity: 100, revenueCents: 100_000 },
    { storeId: 1, period: "2026-09", sku: s, quantity: 80, revenueCents: 96_000 },
  ]);
  return {
    period: "2026-09",
    months: [
      month("2026-09", pnl(12_038_100, 5_633_800, 3_751_400), { cash: { openingCents: 421_000, inflowCents: 15_253_700, outflowCents: 10_183_500, closingCents: 571_200 }, finance: fin(419_500), treasury: tr(4_391_800, 131_100) }),
      month("2026-08", pnl(12_295_000, 5_137_000, 3_219_000), { finance: fin(473_000), treasury: tr(4_773_000, 2_670_300) }),
      month("2026-07", pnl(11_700_000, 5_000_000, 3_000_000), { finance: fin(450_000) }),
      month("2026-06", pnl(11_500_000, 4_900_000, 2_900_000), { finance: fin(440_000) }),
    ],
    stores: { current: [store(1, "Ascenty PLN01", 700_000), store(2, "HTL05", 1_100_000)], previous: [store(1, "Ascenty PLN01", 866_000), store(2, "HTL05", 1_219_000)], activeCount: 20 },
    sales: { ingestedPeriods: ["2026-08", "2026-09"], seriesPeriods: ["2026-08", "2026-09"], cells },
    costBySku: { A: 500, B: 500, C: 500 },
    productNames: { A: "Produto A", B: "Produto B", C: "Produto C" },
    storeList: [{ id: 1, name: "L1" }],
    tickets: { previous: { baskets: 300, revenueCents: 300_000, items: 300, couponCoverage: 0 }, current: { baskets: 240, revenueCents: 288_000, items: 240, couponCoverage: 0 } },
    catalogue: [],
    skuLinks: [],
    supply: null,
    aging: { referenceDate: "2026-10-06", overdueCents: 3_334_800, notDueCents: 0, openCents: 3_334_800, openInvoices: [{ clientName: "Ascenty", amountCents: 3_334_800, dueOn: "2026-10-04" }] },
    closed: true,
    previousClosed: true,
  };
}

export const fixtureOverview = (): Overview => buildOverview(fixtureInput());
