import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";
import { fetchOr404, firstError } from "./fan-out";
import type { Store } from "./stores";
import type { PeriodRange } from "@/lib/period-range";
import { monthsInRange } from "@/lib/period-range";

/** One row per SKU for a store's period — the real grain, not a per-transaction feed. */
export interface SalesRecord {
  store_id: number;
  period: string;
  sku: string;
  quantity_sold: number;
  revenue_cents: number;
  ingestion_id: string;
}

/** Sales summed across a range of months — a single month is a range of one. */
export interface SalesRangeResult {
  storeId: number;
  range: PeriodRange;
  /** Per-SKU totals, summed across every month in the range. */
  bySku: SalesRecord[];
  totalQuantitySold: number;
  totalRevenueCents: number;
  /** Months in the range with no ingested sales at all — never silently folded into a zero. */
  monthsWithNoData: string[];
}

function sumSales(storeId: number, range: PeriodRange, perMonth: (SalesRecord[] | undefined)[], months: string[]): SalesRangeResult {
  const bySkuMap = new Map<string, SalesRecord>();
  const monthsWithNoData: string[] = [];

  perMonth.forEach((rows, index) => {
    if (!rows) {
      monthsWithNoData.push(months[index]);
      return;
    }
    for (const row of rows) {
      const existing = bySkuMap.get(row.sku);
      if (existing) {
        existing.quantity_sold += row.quantity_sold;
        existing.revenue_cents += row.revenue_cents;
      } else {
        bySkuMap.set(row.sku, { ...row, period: range.start === range.end ? row.period : `${range.start}..${range.end}` });
      }
    }
  });

  const bySku = [...bySkuMap.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  return {
    storeId,
    range,
    bySku,
    totalQuantitySold: bySku.reduce((sum, row) => sum + row.quantity_sold, 0),
    totalRevenueCents: bySku.reduce((sum, row) => sum + row.revenue_cents, 0),
    monthsWithNoData,
  };
}

export const salesApi = createApi({
  reducerPath: "salesApi",
  baseQuery: gatewayBaseQuery,
  endpoints: (builder) => ({
    /**
     * Sums a store's sales across every month in the range. Each month is
     * its own request (sales-service has no range query, only one period
     * at a time) — a month with no ingested data 404s and is recorded in
     * `monthsWithNoData` rather than silently contributing a zero. Any
     * *other* failure (403, 500, unreachable) fails the whole query rather
     * than being folded into the same "no data" bucket.
     */
    getSalesRange: builder.query<SalesRangeResult, { storeId: number; range: PeriodRange }>({
      async queryFn({ storeId, range }, _api, _extra, fetchWithBQ) {
        const months = monthsInRange(range);
        const perMonth = await Promise.all(
          months.map((period) => fetchOr404<SalesRecord[]>(fetchWithBQ, `/sales/${storeId}?period=${encodeURIComponent(period)}`)),
        );
        const error = firstError(perMonth);
        if (error) return { error };
        return { data: sumSales(storeId, range, perMonth.map((r) => r.data), months) };
      },
    }),
    /** No network-wide sales total exists — sums each store's range client-side, same reasoning as finance's network fan-out. */
    getNetworkSalesRange: builder.query<SalesRangeResult[], { stores: Store[]; range: PeriodRange }>({
      async queryFn({ stores, range }, _api, _extra, fetchWithBQ) {
        const months = monthsInRange(range);
        const perStorePerMonth = await Promise.all(
          stores.map((store) =>
            Promise.all(
              months.map((period) => fetchOr404<SalesRecord[]>(fetchWithBQ, `/sales/${store.id}?period=${encodeURIComponent(period)}`)),
            ),
          ),
        );
        const error = firstError(perStorePerMonth.flat());
        if (error) return { error };

        const rows = stores.map((store, index) => sumSales(store.id, range, perStorePerMonth[index].map((r) => r.data), months));
        return { data: rows };
      },
    }),
  }),
});

export const { useGetSalesRangeQuery, useGetNetworkSalesRangeQuery } = salesApi;
