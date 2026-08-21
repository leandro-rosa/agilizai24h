import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

export const PNL_SECTIONS = [
  "gross_revenue",
  "deductions",
  "cogs",
  "variable_expenses",
  "fixed_expenses",
  "financial_expenses",
] as const;

export type PnlSection = (typeof PNL_SECTIONS)[number];

export const SECTION_LABELS: Record<string, string> = {
  gross_revenue: "Receita operacional bruta",
  deductions: "(−) Deduções da receita",
  cogs: "(−) CMV",
  variable_expenses: "(−) Despesas variáveis",
  fixed_expenses: "(−) Despesas fixas",
  financial_expenses: "(−) Despesas financeiras",
  receipts: "(+) Receitas recebidas",
  opex: "(−) OPEX",
  loans: "(−) Empréstimos",
  capex: "(−) CAPEX",
};

/**
 * Rótulo da origem de um lançamento. É o que distingue FATO (veio de um
 * serviço) de PREMISSA (alguém digitou) — regra da raiz do repo.
 */
export const ORIGIN_LABELS: Record<string, string> = {
  manual: "Manual",
  treasury: "Tesouraria",
  sales: "Vendas",
  finance: "Financeiro",
  billing: "Faturamento",
};

export interface AccountNode {
  id: number;
  code: string;
  label: string;
  section: string;
  sign: number;
  per_store: boolean;
  sort_order: number;
  amount_cents: number;
  origin: string | null;
  children: AccountNode[];
}

export interface PnlTotals {
  gross_revenue_cents: number;
  net_revenue_cents: number;
  gross_profit_cents: number;
  contribution_margin_cents: number;
  ebitda_cents: number;
  operating_profit_cents: number;
  /** -1 = indefinido. Nenhum volume de venda cobre o fixo. */
  break_even_cents: number;
  safety_margin_bps: number;
  store_count: number;
}

export interface PnlView {
  period: string;
  store_id: number | null;
  status: string;
  totals: PnlTotals;
  sections: { section: string; amount_cents: number; accounts: AccountNode[] }[];
}

export interface PnlSnapshot {
  period: string;
  store_id: number | null;
  status: string;
  store_count: number;
  gross_revenue_cents: number;
  net_revenue_cents: number;
  cogs_cents: number;
  gross_profit_cents: number;
  contribution_margin_cents: number;
  ebitda_cents: number;
  operating_profit_cents: number;
  break_even_cents: number;
  safety_margin_bps: number;
}

export interface CashFlowSnapshot {
  period: string;
  opening_balance_cents: number;
  receipts_cents: number;
  opex_cents: number;
  loan_payments_cents: number;
  capex_cents: number;
  closing_balance_cents: number;
}

export interface Account {
  id: number;
  code: string;
  label: string;
  statement: "pnl" | "cashflow";
  section: string;
  sign: number;
  per_store: boolean;
  sort_order: number;
}

export const accountingApi = createApi({
  reducerPath: "accountingApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Ledger", "Account", "CashFlow"],
  endpoints: (builder) => ({
    getChart: builder.query<Account[], "pnl" | "cashflow" | void>({
      query: (statement) => `/accounting/accounts${statement ? `?statement=${statement}` : ""}`,
      providesTags: ["Account"],
    }),
    getPnl: builder.query<PnlView, { period: string; storeId?: number }>({
      query: ({ period, storeId }) =>
        `/accounting/pnl/${period}${storeId !== undefined ? `?store_id=${storeId}` : ""}`,
      providesTags: ["Ledger"],
    }),
    getPnlSeries: builder.query<PnlSnapshot[], { from?: string; to?: string; storeId?: number }>({
      query: ({ from, to, storeId }) => {
        const params = new URLSearchParams();
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        if (storeId !== undefined) params.set("store_id", String(storeId));
        return `/accounting/pnl/series?${params.toString()}`;
      },
      providesTags: ["Ledger"],
    }),
    putEntry: builder.mutation<
      unknown,
      { account_id: number; period: string; store_id?: number; amount_cents: number; origin?: string }
    >({
      query: (body) => ({ url: "/accounting/entries", method: "PUT", body }),
      invalidatesTags: ["Ledger"],
    }),
    computePnl: builder.mutation<PnlSnapshot, { period: string; storeId?: number; storeCount: number; close?: boolean }>({
      query: ({ period, storeId, storeCount, close }) => {
        const params = new URLSearchParams({ store_count: String(storeCount) });
        if (storeId !== undefined) params.set("store_id", String(storeId));
        if (close) params.set("close", "true");
        return { url: `/accounting/pnl/${period}/compute?${params.toString()}`, method: "POST" };
      },
      invalidatesTags: ["Ledger"],
    }),
    getCashFlow: builder.query<CashFlowSnapshot[], { from?: string; to?: string } | void>({
      query: (range) => {
        const params = new URLSearchParams();
        if (range?.from) params.set("from", range.from);
        if (range?.to) params.set("to", range.to);
        const search = params.toString();
        return `/accounting/cash-flow${search ? `?${search}` : ""}`;
      },
      providesTags: ["CashFlow"],
    }),
    putCashFlow: builder.mutation<CashFlowSnapshot, Omit<CashFlowSnapshot, "closing_balance_cents">>({
      query: (body) => ({ url: "/accounting/cash-flow", method: "PUT", body }),
      invalidatesTags: ["CashFlow"],
    }),
  }),
});

export const {
  useGetChartQuery,
  useGetPnlQuery,
  useGetPnlSeriesQuery,
  usePutEntryMutation,
  useComputePnlMutation,
  useGetCashFlowQuery,
  usePutCashFlowMutation,
} = accountingApi;
