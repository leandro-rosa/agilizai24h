import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

/**
 * The "Qualidade do saldo" audit (`add-stock-quality-phase0`).
 *
 * Mirrors what `inventory-service` returns and adds nothing: every band, bin
 * label and cut point arrives in the response (`presentation`), because the
 * slicing of the distributions is decided by the backend and the browser must
 * not own it. There is no verdict, tolerance or pass/fail field in any of
 * these types — the audit only describes.
 */

export interface AuditDistribution {
  /** How many observations this distribution covers — shown next to every figure. */
  lines: number;
  share_zero: number | null;
  absolute_bins: { label: string; lines: number }[];
  relative_bins: { label: string; lines: number }[];
  relative_undefined: number;
  quantiles: { p50: number; p90: number; p95: number; p99: number; max: number } | null;
}

export interface CountCoverageRow {
  store_id: number;
  month: string;
  operations: number;
  operations_with_count: number;
  lines: number;
  counted_lines: number;
  positive_balance_lines: number;
  counted_positive_balance_lines: number;
  share_positive_balance_counted: number | null;
}

export interface StoreMonthComparison {
  store_id: number;
  month: string;
  sku_months: number;
  consumption_units: number;
  sales_units: number;
  ratio: number | null;
}

export interface StoreMonthGap {
  store_id: number;
  month: string;
  consumption_units: number;
  sku_months: number;
}

export interface BalanceAudit {
  range: { from: string; to: string };
  covered: {
    stores: number;
    visits: number;
    lines: number;
    first_visit_end: string | null;
    last_visit_end: string | null;
  };
  presentation: {
    provisional: true;
    note: string;
    turnover: { high_min: number; medium_min: number };
    balance_bands: string[];
    absolute_bins: string[];
    relative_bins: string[];
  };
  count_vs_system: {
    lines_total: number;
    lines_counted: number;
    lines_uncounted: number;
    overall: AuditDistribution;
    by_turnover: Record<string, AuditDistribution>;
    by_balance: Record<string, AuditDistribution>;
  };
  count_coverage: CountCoverageRow[];
  consumption_vs_sales: {
    compared_sku_months: number;
    overall: AuditDistribution;
    by_turnover: Record<string, AuditDistribution>;
    store_months: StoreMonthComparison[];
    median_ratio: number | null;
  };
  gaps: {
    store_months_without_sales: StoreMonthGap[];
    balance_rises_without_event: { pairs: number; units: number; sku_months_excluded: number };
    capacity: { lines: number; lines_with_capacity: number; share_with_capacity: number | null; available: boolean };
    unavailable_stores: { store_id: number; reason: string }[];
  };
}

/** Operations set aside for having no client (the distribution center inventory), per period. */
export interface IngestionGaps {
  from: string;
  to: string;
  periods: { period: string; ingestionId: string; operationsWithoutClient: number; linesWithoutClient: number }[];
  totals: { operationsWithoutClient: number; linesWithoutClient: number };
}

export interface AuditRangeArg {
  from: string;
  to: string;
}

export const balanceAuditApi = createApi({
  reducerPath: "balanceAuditApi",
  baseQuery: gatewayBaseQuery,
  endpoints: (builder) => ({
    getBalanceAudit: builder.query<BalanceAudit, AuditRangeArg>({
      query: ({ from, to }) => `/inventory/audit/balance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    }),
    getIngestionGaps: builder.query<IngestionGaps, AuditRangeArg>({
      query: ({ from, to }) => `/ingestions/gaps?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    }),
  }),
});

export const { useGetBalanceAuditQuery, useGetIngestionGapsQuery } = balanceAuditApi;
