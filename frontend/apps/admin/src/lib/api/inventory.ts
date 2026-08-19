import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

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

export const inventoryApi = createApi({
  reducerPath: "inventoryApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Minimum"],
  endpoints: (builder) => ({
    getStock: builder.query<StoreStock, { storeId: number; period?: string }>({
      query: ({ storeId, period }) => `/inventory/${storeId}${period ? `?period=${encodeURIComponent(period)}` : ""}`,
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

export const { useGetStockQuery, useSetMinimumMutation } = inventoryApi;
