import { describe, it, expect } from "@jest/globals";
import { buildStoreSkuSeries } from "./series";
import type { Store } from "@/lib/api/stores";
import type { StoreMonthSales } from "@/lib/api/sales";
import type { StoreMonthSupply } from "@/lib/api/supply";
import type { PerStoreMonthlyTotal } from "@/lib/api/finance";
import type { ReconciliationTotals } from "@/lib/reconciliation-aggregate";

const STORES: Store[] = [{ id: 1, name: "Loja A" } as Store, { id: 2, name: "Loja B" } as Store];
const PERIODS = ["2026-06", "2026-07", "2026-08"];

function totals(overrides: Partial<ReconciliationTotals> = {}): ReconciliationTotals {
  return {
    monthsWithData: 1,
    restocked_value_cents: 0,
    cogs_cents: 0,
    remaining_value_cents: 0,
    loss_value_cents: 0,
    loss_quantity: 0,
    unclassified_stock_adjustment_value_cents: 0,
    complete: true,
    loss_by_reason: [],
    loss_by_sku: [],
    loss_by_reason_sku: [],
    ...overrides,
  } as ReconciliationTotals;
}

describe("buildStoreSkuSeries", () => {
  it("combines sales, supply and losses into one row per period, oldest to newest", () => {
    const sales: StoreMonthSales[] = [
      { storeId: 1, period: "2026-06", bySku: [{ store_id: 1, period: "2026-06", sku: "SKU-1", quantity_sold: 10, revenue_cents: 5000, ingestion_id: "x" }] },
      { storeId: 1, period: "2026-07", bySku: [{ store_id: 1, period: "2026-07", sku: "SKU-1", quantity_sold: 12, revenue_cents: 6000, ingestion_id: "x" }] },
      { storeId: 1, period: "2026-08", bySku: [{ store_id: 1, period: "2026-08", sku: "SKU-1", quantity_sold: 15, revenue_cents: 7500, ingestion_id: "x" }] },
    ];
    const supply: StoreMonthSupply[] = [
      { storeId: 1, period: "2026-06", restocks: [{ sku: "SKU-1", quantity_restocked: 20 }] },
      { storeId: 1, period: "2026-07", restocks: [{ sku: "SKU-1", quantity_restocked: 0 }] },
      { storeId: 1, period: "2026-08", restocks: [{ sku: "SKU-1", quantity_restocked: 18 }] },
    ];
    const reconciliation: PerStoreMonthlyTotal[] = [
      { storeId: 1, period: "2026-06", totals: totals() },
      { storeId: 1, period: "2026-07", totals: totals({ loss_by_reason_sku: [{ reason: "expired", sku: "SKU-1", quantity: 2, value_cents: 1000 }] }) },
      { storeId: 1, period: "2026-08", totals: totals() },
    ];

    const result = buildStoreSkuSeries(STORES, sales, supply, reconciliation, PERIODS);

    expect(result).toHaveLength(1);
    expect(result[0].storeId).toBe(1);
    expect(result[0].sku).toBe("SKU-1");
    expect(result[0].meses).toEqual([
      { period: "2026-06", vendido: 10, abastecido: 20, perdido: 0, receitaCents: 5000 },
      { period: "2026-07", vendido: 12, abastecido: 0, perdido: 2, receitaCents: 6000 },
      { period: "2026-08", vendido: 15, abastecido: 18, perdido: 0, receitaCents: 7500 },
    ]);
  });

  it("sums loss quantity across every reason for the same sku in the same month", () => {
    const reconciliation: PerStoreMonthlyTotal[] = [
      {
        storeId: 1,
        period: "2026-08",
        totals: totals({
          loss_by_reason_sku: [
            { reason: "expired", sku: "SKU-2", quantity: 3, value_cents: 300 },
            { reason: "damaged_product", sku: "SKU-2", quantity: 1, value_cents: 100 },
          ],
        }),
      },
    ];

    const result = buildStoreSkuSeries(STORES, [], [], reconciliation, ["2026-08"]);

    expect(result[0].meses[0].perdido).toBe(4);
  });

  it("emits one row per period in the window even when a period has no data for that sku", () => {
    const sales: StoreMonthSales[] = [{ storeId: 1, period: "2026-08", bySku: [{ store_id: 1, period: "2026-08", sku: "SKU-3", quantity_sold: 5, revenue_cents: 500, ingestion_id: "x" }] }];

    const result = buildStoreSkuSeries(STORES, sales, [], [], PERIODS);

    expect(result[0].meses.map((m) => m.period)).toEqual(PERIODS);
    expect(result[0].meses[0]).toEqual({ period: "2026-06", vendido: 0, abastecido: 0, perdido: 0, receitaCents: 0 });
  });

  it("keeps stores and skus separate — never mixes SKU-1 of store 1 with SKU-1 of store 2", () => {
    const sales: StoreMonthSales[] = [
      { storeId: 1, period: "2026-08", bySku: [{ store_id: 1, period: "2026-08", sku: "SKU-1", quantity_sold: 10, revenue_cents: 1000, ingestion_id: "x" }] },
      { storeId: 2, period: "2026-08", bySku: [{ store_id: 2, period: "2026-08", sku: "SKU-1", quantity_sold: 40, revenue_cents: 4000, ingestion_id: "x" }] },
    ];

    const result = buildStoreSkuSeries(STORES, sales, [], [], ["2026-08"]);

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.storeId === 1)?.meses[0].vendido).toBe(10);
    expect(result.find((r) => r.storeId === 2)?.meses[0].vendido).toBe(40);
  });

  it("never emits a series for a sku with zero activity in every field across the whole window", () => {
    const supply: StoreMonthSupply[] = [{ storeId: 1, period: "2026-08", restocks: [{ sku: "SKU-4", quantity_restocked: 0 }] }];
    const result = buildStoreSkuSeries(STORES, [], supply, [], ["2026-08"]);
    expect(result).toHaveLength(0);
  });
});
