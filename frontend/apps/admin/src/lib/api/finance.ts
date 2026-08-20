import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";
import type { Store } from "./stores";
import { monthsInRange, type PeriodRange } from "@/lib/period-range";
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

export interface LossByReasonSku {
  reason: string;
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
  loss_by_reason_sku: LossByReasonSku[];
  unvalued: UnvaluedSku[];
  adjustment_flags: AdjustmentFlag[];
}

/** One store's totals for the network comparison over a range — see `ReconciliationTotals`. */
export interface NetworkReconciliationRangeRow {
  store: Store;
  totals: ReconciliationTotals;
}

/** One month's network-wide totals — from `getNetworkReconciliationRange`'s already-fetched per-store series, no extra request. */
export interface NetworkMonthlyTotal {
  period: string;
  restocked_value_cents: number;
  cogs_cents: number;
  loss_value_cents: number;
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
     * spans, rather than one request per store per month. `monthlyTotals`
     * is a second reduction over the same already-fetched data — no extra
     * network calls — for the network-wide monthly trend chart.
     */
    getNetworkReconciliationRange: builder.query<
      { rows: NetworkReconciliationRangeRow[]; monthlyTotals: NetworkMonthlyTotal[] },
      { stores: Store[]; range: PeriodRange }
    >({
      async queryFn({ stores, range }, _api, _extra, fetchWithBQ) {
        const seriesByStore = await Promise.all(
          stores.map(async (store) => {
            const result = await fetchWithBQ(`/finance/${store.id}`);
            const series = (result.data as Reconciliation[] | undefined) ?? [];
            return { store, series };
          }),
        );

        const rows: NetworkReconciliationRangeRow[] = seriesByStore.map(({ store, series }) => ({
          store,
          totals: sumReconciliations(series, range),
        }));

        const months = monthsInRange(range);
        const monthlyTotals: NetworkMonthlyTotal[] = months.map((period) => {
          let restocked = 0;
          let cogs = 0;
          let loss = 0;
          for (const { series } of seriesByStore) {
            const match = series.find((r) => r.period === period);
            if (!match) continue;
            restocked += match.restocked_value_cents;
            cogs += match.cogs_cents;
            loss += match.loss_value_cents;
          }
          return { period, restocked_value_cents: restocked, cogs_cents: cogs, loss_value_cents: loss };
        });

        return { data: { rows, monthlyTotals } };
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
