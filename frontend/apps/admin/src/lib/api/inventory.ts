import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";
import { fetchOr404, firstError } from "./fan-out";
import type { PeriodRange } from "@/lib/period-range";
import { monthsInRange } from "@/lib/period-range";
import type { Store } from "./stores";

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

function sumStock(storeId: number, range: PeriodRange, perMonth: (StoreStock | undefined)[]): StockRangeResult {
  const movementBySku = new Map<string, { restocked: number; sold: number; removed: number; adjustment: number }>();
  for (const month of perMonth) {
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

  // The snapshot (closing balance, inconsistency, minimums) as of the end
  // of the range — the last month that actually returned data, since a
  // trailing month with nothing ingested yet is undefined here.
  const lastKnown = [...perMonth].reverse().find((month) => month !== undefined);
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

  return { storeId, range, items, has_inconsistencies: items.some((item) => item.inconsistent) };
}

export interface CentralStockLot {
  id: number;
  sku: string;
  ean: string | null;
  quantity: number;
  expires_on: string | null;
  received_on: string;
  supplier_id: number | null;
  unit_cost_cents: number | null;
  note: string | null;
}

export interface CentralStockSummary {
  lot_count: number;
  total_quantity: number;
  expired_quantity: number;
  expiring_30d_quantity: number;
  valued_amount_cents: number;
  /** Sobre quantos lotes a cifra acima foi somada — nunca passa por completa. */
  valued_lot_count: number;
}

export const inventoryApi = createApi({
  reducerPath: "inventoryApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Minimum", "CentralStock"],
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
        return { data: sumStock(storeId, range, perMonth.map((r) => r.data)) };
      },
      providesTags: ["Minimum"],
    }),
    /** No network-wide inventory endpoint exists — sums+snapshots each store's range client-side, same shape as sales/supply/finance. */
    getNetworkStockRange: builder.query<StockRangeResult[], { stores: Store[]; range: PeriodRange }>({
      async queryFn({ stores, range }, _api, _extra, fetchWithBQ) {
        const months = monthsInRange(range);
        const perStorePerMonth = await Promise.all(
          stores.map((store) =>
            Promise.all(months.map((period) => fetchOr404<StoreStock>(fetchWithBQ, `/inventory/${store.id}?period=${encodeURIComponent(period)}`))),
          ),
        );
        const error = firstError(perStorePerMonth.flat());
        if (error) return { error };
        const rows = stores.map((store, index) => sumStock(store.id, range, perStorePerMonth[index].map((r) => r.data)));
        return { data: rows };
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
    getCentralStock: builder.query<CentralStockLot[], { sku?: string; expiring_within_days?: number } | void>({
      query: (filter) => {
        const params = new URLSearchParams();
        if (filter?.sku) params.set("sku", filter.sku);
        if (filter?.expiring_within_days !== undefined) {
          params.set("expiring_within_days", String(filter.expiring_within_days));
        }
        const search = params.toString();
        return `/inventory/central${search ? `?${search}` : ""}`;
      },
      providesTags: ["CentralStock"],
    }),
    getCentralStockSummary: builder.query<CentralStockSummary, void>({
      query: () => "/inventory/central/summary",
      providesTags: ["CentralStock"],
    }),
    createLot: builder.mutation<CentralStockLot, Partial<CentralStockLot>>({
      query: (body) => ({ url: "/inventory/central", method: "POST", body }),
      invalidatesTags: ["CentralStock"],
    }),
    updateLot: builder.mutation<CentralStockLot, { id: number } & Partial<CentralStockLot>>({
      query: ({ id, ...body }) => ({ url: `/inventory/central/${id}`, method: "PATCH", body }),
      invalidatesTags: ["CentralStock"],
    }),
    deleteLot: builder.mutation<void, number>({
      query: (id) => ({ url: `/inventory/central/${id}`, method: "DELETE" }),
      invalidatesTags: ["CentralStock"],
    }),
  }),
});

export const {
  useGetStockRangeQuery,
  useGetNetworkStockRangeQuery,
  useSetMinimumMutation,
  useGetCentralStockQuery,
  useGetCentralStockSummaryQuery,
  useCreateLotMutation,
  useUpdateLotMutation,
  useDeleteLotMutation,
} = inventoryApi;
