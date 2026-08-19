import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";
import type { Store } from "./stores";

export interface UnvaluedSku {
  sku: string;
  reason: string;
  restocked: number;
  sold: number;
  remaining: number;
  loss_quantity: number;
}

export interface LossByReason {
  reason: string;
  quantity: number;
  value_cents: number;
}

export interface LossBySku {
  sku: string;
  quantity: number;
  value_cents: number;
}

export interface AdjustmentFlag {
  sku: string;
  quantity: number;
  value_cents: number;
}

/** A store's month, valued — the four figures the operators reconcile by hand, plus the unclassified adjustment. */
export interface Reconciliation {
  store_id: number;
  period: string;
  restocked_value_cents: number;
  cogs_cents: number;
  remaining_value_cents: number;
  loss_value_cents: number;
  loss_quantity: number;
  unclassified_stock_adjustment_value_cents: number;
  valuation_date: string;
  /** The one trust flag — false when any SKU could not be priced or its stock was inconsistent. */
  complete: boolean;
  inconsistent_stock: string[];
  computed_at: string;
  inputs_changed_at: string | null;
  loss_by_reason: LossByReason[];
  loss_by_sku: LossBySku[];
  unvalued: UnvaluedSku[];
  adjustment_flags: AdjustmentFlag[];
}

export interface Rollup {
  period: string;
  restocked_value_cents: number;
  cogs_cents: number;
  remaining_value_cents: number;
  loss_value_cents: number;
  unclassified_stock_adjustment_value_cents: number;
  store_count: number;
  complete: boolean;
  incomplete_stores: number[];
}

/** One store's reconciliation for the network comparison — `null` when that store simply has no data for the period (a 404, not an error). */
export interface NetworkReconciliationRow {
  store: Store;
  reconciliation: Reconciliation | null;
}

export const financeApi = createApi({
  reducerPath: "financeApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Reconciliation"],
  endpoints: (builder) => ({
    getReconciliation: builder.query<Reconciliation, { storeId: number; period: string }>({
      query: ({ storeId, period }) => `/finance/${storeId}/${period}`,
      providesTags: ["Reconciliation"],
    }),
    /** Every reconciled month for one store, oldest first — the trend line's data source. */
    getReconciliationSeries: builder.query<Reconciliation[], { storeId: number }>({
      query: ({ storeId }) => `/finance/${storeId}`,
      providesTags: ["Reconciliation"],
    }),
    getRollup: builder.query<Rollup, { period: string }>({
      query: ({ period }) => `/finance/rollup?period=${encodeURIComponent(period)}`,
      providesTags: ["Reconciliation"],
    }),
    /**
     * There is no network-wide "every store's reconciliation for a period"
     * endpoint — `/finance/rollup` gives totals only, never a per-store
     * breakdown. This fans out one request per store instead of adding a
     * backend endpoint for what is, for ~24 stores, an acceptable number of
     * parallel calls from an admin tool's own comparison view.
     */
    getNetworkReconciliations: builder.query<NetworkReconciliationRow[], { stores: Store[]; period: string }>({
      async queryFn({ stores, period }, _api, _extra, fetchWithBQ) {
        const rows = await Promise.all(
          stores.map(async (store): Promise<NetworkReconciliationRow> => {
            const result = await fetchWithBQ(`/finance/${store.id}/${period}`);
            return { store, reconciliation: (result.data as Reconciliation | undefined) ?? null };
          }),
        );
        return { data: rows };
      },
      providesTags: ["Reconciliation"],
    }),
    recompute: builder.mutation<Reconciliation, { storeId: number; period: string }>({
      query: ({ storeId, period }) => ({ url: `/finance/${storeId}/${period}/recompute`, method: "POST" }),
      invalidatesTags: ["Reconciliation"],
    }),
  }),
});

export const {
  useGetReconciliationQuery,
  useGetReconciliationSeriesQuery,
  useGetRollupQuery,
  useGetNetworkReconciliationsQuery,
  useRecomputeMutation,
} = financeApi;
