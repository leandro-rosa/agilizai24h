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

/**
 * One row per transaction — only present for stores/periods ingested from
 * the network-wide, per-transaction sales format (Aug 2026 onward,
 * add-sales-transaction-detail). A month ingested from the old, pre-
 * aggregated per-SKU export has none of these; `getSalesTransactions`
 * reflects that as `null`, the same "no data" shape `fetchOr404` already
 * uses everywhere else, never an empty array standing in for "not
 * available yet" — a screen reading this must tell the two apart.
 */
export interface SalesTransaction {
  store_id: number;
  period: string;
  occurred_at: string | null;
  sku: string;
  quantity: number;
  amount_paid_cents: number;
  original_amount_cents: number | null;
  discount_cents: number | null;
  /** Amount settled after acquirer/payment fees — a treasury concept, never CMV/margin. */
  net_amount_cents: number | null;
  /** The receipt/basket identifier — groups several rows into one purchase. */
  coupon: string | null;
  /** Verbatim from the source report — not narrowed to an enum. */
  result: string;
  method: string | null;
  acquirer: string | null;
  card_brand: string | null;
  card_last_digits: string | null;
  internal_code: string | null;
  acquirer_code: string | null;
  pos_id: string | null;
  machine_model: string | null;
  buyer_number: string | null;
  ingestion_id: string;
}

export interface StoreSalesTransactions {
  storeId: number;
  period: string;
  transactions: SalesTransaction[];
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
    /**
     * A single period, not a range — transaction detail is queried per
     * month the way the backend actually stores it; range-summing a
     * per-transaction feed client-side across many months would mean
     * shipping the whole range's rows to the browser for no benefit the
     * screens reading this need. `null` (not `[]`) means no transaction
     * detail for this store/period — old-format months, or a period never
     * ingested at all; both read the same way here, matching the backend's
     * own "not found" contract.
     */
    getSalesTransactions: builder.query<SalesTransaction[] | null, { storeId: number; period: string }>({
      async queryFn({ storeId, period }, _api, _extra, fetchWithBQ) {
        const result = await fetchOr404<SalesTransaction[]>(
          fetchWithBQ,
          `/sales/${storeId}/transactions?period=${encodeURIComponent(period)}`,
        );
        if (result.error) return { error: result.error };
        return { data: result.data ?? null };
      },
    }),
    /** Same fan-out shape as `getNetworkSalesRange`, for one period instead of a range. */
    getNetworkSalesTransactions: builder.query<StoreSalesTransactions[], { stores: Store[]; period: string }>({
      async queryFn({ stores, period }, _api, _extra, fetchWithBQ) {
        const perStore = await Promise.all(
          stores.map((store) =>
            fetchOr404<SalesTransaction[]>(fetchWithBQ, `/sales/${store.id}/transactions?period=${encodeURIComponent(period)}`),
          ),
        );
        const error = firstError(perStore);
        if (error) return { error };

        const rows = stores.map((store, index) => ({ storeId: store.id, period, transactions: perStore[index].data ?? [] }));
        return { data: rows };
      },
    }),
  }),
});

export const {
  useGetSalesRangeQuery,
  useGetNetworkSalesRangeQuery,
  useGetSalesTransactionsQuery,
  useGetNetworkSalesTransactionsQuery,
} = salesApi;
