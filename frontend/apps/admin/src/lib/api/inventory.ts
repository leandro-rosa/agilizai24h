import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";
import { fetchOr404, firstError } from "./fan-out";
import type { PeriodRange } from "@/lib/period-range";
import { monthsInRange } from "@/lib/period-range";

export interface StockItem {
  store_id: number;
  sku: string;
  period: string;
  restocked: number;
  sold: number;
  removed: number;
  adjustment: number;
  closing_stock: number;
  /** True when `closing_stock` is negative — a data problem, never rendered as zero. */
  inconsistent: boolean;
  recorded_closing_balance: number | null;
  minimum?: number;
  below_minimum?: boolean;
}

export interface StoreStock {
  store_id: number;
  period: string;
  items: StockItem[];
  has_inconsistencies: boolean;
}

/**
 * Stock over a range: movements (restocked/sold/removed/adjustment) summed
 * across every month in the range, but the closing balance is a
 * point-in-time snapshot — it is *as of the end of the range*, never
 * summed (a running stock level has no meaning summed across months).
 */
export interface StockRangeResult {
  storeId: number;
  range: PeriodRange;
  items: StockItem[];
  has_inconsistencies: boolean;
}

export const inventoryApi = createApi({
  reducerPath: "inventoryApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Minimum"],
  endpoints: (builder) => ({
    /**
     * `/inventory/:storeId?period=` already collapses to "the latest
     * snapshot at or before that period" server-side, so it only ever
     * reports one month's own movements — not summed across a range. This
     * queries every month in the range to sum restocked/sold/removed/
     * adjustment, while taking closing_stock/inconsistent/
     * recorded_closing_balance from the range's last month only. A month
     * with nothing ingested 404s and contributes nothing; any *other*
     * failure fails the whole query.
     */
    getStockRange: builder.query<StockRangeResult, { storeId: number; range: PeriodRange }>({
      async queryFn({ storeId, range }, _api, _extra, fetchWithBQ) {
        const months = monthsInRange(range);
        const perMonth = await Promise.all(
          months.map((period) => fetchOr404<StoreStock>(fetchWithBQ, `/inventory/${storeId}?period=${encodeURIComponent(period)}`)),
        );
        const error = firstError(perMonth);
        if (error) return { error };

        const movementBySku = new Map<string, { restocked: number; sold: number; removed: number; adjustment: number }>();
        for (const { data: month } of perMonth) {
          if (!month) continue;
          for (const item of month.items) {
            const existing = movementBySku.get(item.sku) ?? { restocked: 0, sold: 0, removed: 0, adjustment: 0 };
            existing.restocked += item.restocked;
            existing.sold += item.sold;
            existing.removed += item.removed;
            existing.adjustment += item.adjustment;
            movementBySku.set(item.sku, existing);
          }
        }

        // The snapshot (closing balance, inconsistency, minimums) as of the
        // end of the range — the last month that actually returned data,
        // since a trailing month with nothing ingested yet 404s.
        const lastKnown = [...perMonth].reverse().find((r) => r.data !== undefined)?.data;
        const items: StockItem[] = (lastKnown?.items ?? []).map((item) => {
          const movement = movementBySku.get(item.sku);
          return {
            ...item,
            restocked: movement?.restocked ?? 0,
            sold: movement?.sold ?? 0,
            removed: movement?.removed ?? 0,
            adjustment: movement?.adjustment ?? 0,
          };
        });

        return {
          data: {
            storeId,
            range,
            items,
            has_inconsistencies: items.some((item) => item.inconsistent),
          },
        };
      },
      providesTags: ["Minimum"],
    }),
    setMinimum: builder.mutation<unknown, { storeId: number; sku: string; minimum: number }>({
      query: ({ storeId, sku, minimum }) => ({
        url: `/inventory/${storeId}/${encodeURIComponent(sku)}/minimum`,
        method: "PUT",
        body: { minimum },
      }),
      invalidatesTags: ["Minimum"],
    }),
  }),
});

export const { useGetStockRangeQuery, useSetMinimumMutation } = inventoryApi;
