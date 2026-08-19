import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

/** One row per SKU for a store's period — the real grain, not a per-transaction feed. */
export interface SalesRecord {
  store_id: number;
  period: string;
  sku: string;
  quantity_sold: number;
  revenue_cents: number;
  ingestion_id: string;
}

export interface SalesTotals {
  store_id: number;
  period: string;
  total_quantity_sold: number;
  total_revenue_cents: number;
  sku_count: number;
}

export const salesApi = createApi({
  reducerPath: "salesApi",
  baseQuery: gatewayBaseQuery,
  endpoints: (builder) => ({
    getSalesPeriod: builder.query<SalesRecord[], { storeId: number; period: string }>({
      query: ({ storeId, period }) => `/sales/${storeId}?period=${encodeURIComponent(period)}`,
    }),
    getSalesTotals: builder.query<SalesTotals, { storeId: number; period: string }>({
      query: ({ storeId, period }) => `/sales/${storeId}/totals?period=${encodeURIComponent(period)}`,
    }),
  }),
});

export const { useGetSalesPeriodQuery, useGetSalesTotalsQuery } = salesApi;
