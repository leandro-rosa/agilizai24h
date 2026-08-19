import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

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

export const supplyApi = createApi({
  reducerPath: "supplyApi",
  baseQuery: gatewayBaseQuery,
  endpoints: (builder) => ({
    getSupplyPeriod: builder.query<SupplyPeriod, { storeId: number; period: string }>({
      query: ({ storeId, period }) => `/supply/${storeId}?period=${encodeURIComponent(period)}`,
    }),
  }),
});

export const { useGetSupplyPeriodQuery } = supplyApi;
