import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";
import type { Store } from "./stores";
import type { PeriodRange } from "@/lib/period-range";
import { sumReconciliations, type ReconciliationTotals } from "@/lib/reconciliation-aggregate";

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

/** One store's totals for the network comparison over a range — see `ReconciliationTotals`. */
export interface NetworkReconciliationRangeRow {
  store: Store;
  totals: ReconciliationTotals;
}

export const financeApi = createApi({
  reducerPath: "financeApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Reconciliation"],
  endpoints: (builder) => ({
    /** Every reconciled month for one store, oldest first — the range views filter/sum this client-side rather than querying per period. */
    getReconciliationSeries: builder.query<Reconciliation[], { storeId: number }>({
      query: ({ storeId }) => `/finance/${storeId}`,
      providesTags: ["Reconciliation"],
    }),
    /**
     * The range version of `getNetworkReconciliations`: fetches each
     * store's *entire* series once (finance-service's series endpoint has
     * no period filter) and sums it down to the range client-side —
     * one request per store regardless of how many months the range
     * spans, rather than one request per store per month.
     */
    getNetworkReconciliationRange: builder.query<NetworkReconciliationRangeRow[], { stores: Store[]; range: PeriodRange }>({
      async queryFn({ stores, range }, _api, _extra, fetchWithBQ) {
        const rows = await Promise.all(
          stores.map(async (store): Promise<NetworkReconciliationRangeRow> => {
            const result = await fetchWithBQ(`/finance/${store.id}`);
            const series = (result.data as Reconciliation[] | undefined) ?? [];
            return { store, totals: sumReconciliations(series, range) };
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
  useGetReconciliationSeriesQuery,
  useGetNetworkReconciliationRangeQuery,
  useRecomputeMutation,
} = financeApi;
