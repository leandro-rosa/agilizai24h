import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";
import { fetchOr404, firstError } from "./fan-out";
import type { PeriodRange } from "@/lib/period-range";
import { monthsInRange } from "@/lib/period-range";

export interface RestockRow {
  sku: string;
  quantity_restocked: number;
}

export interface RemovalRow {
  sku: string;
  reason: string;
  reason_label: string;
  counts_as_loss: boolean;
  quantity_removed: number;
}

export interface AdjustmentRow {
  sku: string;
  /** Signed — positive is inbound, negative is outbound (design D4/D6 of align-ingestion-with-real-reports). */
  quantity: number;
}

export interface SupplyPeriod {
  store_id: number;
  period: string;
  restocks: RestockRow[];
  removals: RemovalRow[];
  adjustments: AdjustmentRow[];
}

/** Restocks, removals and adjustments summed across a range of months — a single month is a range of one. */
export interface SupplyRangeResult {
  storeId: number;
  range: PeriodRange;
  restocks: RestockRow[];
  /** Per SKU and reason — a removal in month 1 and the same SKU/reason in month 2 sum into one row. */
  removals: RemovalRow[];
  adjustments: AdjustmentRow[];
  monthsWithNoData: string[];
}

export const supplyApi = createApi({
  reducerPath: "supplyApi",
  baseQuery: gatewayBaseQuery,
  endpoints: (builder) => ({
    /**
     * Sums a store's restocks/removals/adjustments across every month in
     * the range. Each month is its own request (supply-service has no
     * range query) — a month with no ingested data 404s and is recorded in
     * `monthsWithNoData` rather than silently contributing a zero. Any
     * *other* failure (403, 500, unreachable) fails the whole query.
     */
    getSupplyRange: builder.query<SupplyRangeResult, { storeId: number; range: PeriodRange }>({
      async queryFn({ storeId, range }, _api, _extra, fetchWithBQ) {
        const months = monthsInRange(range);
        const perMonth = await Promise.all(
          months.map((period) => fetchOr404<SupplyPeriod>(fetchWithBQ, `/supply/${storeId}?period=${encodeURIComponent(period)}`)),
        );
        const error = firstError(perMonth);
        if (error) return { error };

        const restocksBySku = new Map<string, RestockRow>();
        const removalsByKey = new Map<string, RemovalRow>();
        const adjustmentsBySku = new Map<string, AdjustmentRow>();
        const monthsWithNoData: string[] = [];

        perMonth.forEach(({ data: period }, index) => {
          if (!period) {
            monthsWithNoData.push(months[index]);
            return;
          }
          for (const row of period.restocks) {
            const existing = restocksBySku.get(row.sku);
            if (existing) existing.quantity_restocked += row.quantity_restocked;
            else restocksBySku.set(row.sku, { ...row });
          }
          for (const row of period.removals) {
            const key = `${row.sku}:${row.reason}`;
            const existing = removalsByKey.get(key);
            if (existing) existing.quantity_removed += row.quantity_removed;
            else removalsByKey.set(key, { ...row });
          }
          for (const row of period.adjustments) {
            const existing = adjustmentsBySku.get(row.sku);
            if (existing) existing.quantity += row.quantity;
            else adjustmentsBySku.set(row.sku, { ...row });
          }
        });

        return {
          data: {
            storeId,
            range,
            restocks: [...restocksBySku.values()].sort((a, b) => a.sku.localeCompare(b.sku)),
            removals: [...removalsByKey.values()].sort((a, b) => a.sku.localeCompare(b.sku)),
            adjustments: [...adjustmentsBySku.values()]
              .filter((row) => row.quantity !== 0)
              .sort((a, b) => a.sku.localeCompare(b.sku)),
            monthsWithNoData,
          },
        };
      },
    }),
  }),
});

export const { useGetSupplyRangeQuery } = supplyApi;
