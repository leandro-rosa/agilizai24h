import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

export const NATURES = ["cogs", "operating", "administrative", "investment"] as const;
export type Nature = (typeof NATURES)[number];

/** O eixo "Natureza" da planilha, que é o que liga tesouraria a DRE. */
export const NATURE_LABELS: Record<Nature, string> = {
  cogs: "Estoque (CMV)",
  operating: "Operacional",
  administrative: "Administrativo",
  investment: "Investimento",
};

export const PAYMENT_METHODS = ["debit", "credit", "pix", "voucher"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  debit: "Débito",
  credit: "Crédito",
  pix: "PIX",
  voucher: "Voucher",
};

export const ACCOUNT_KINDS = ["checking", "credit_card"] as const;
export const ACCOUNT_KIND_LABELS: Record<string, string> = {
  checking: "Conta corrente",
  credit_card: "Cartão de crédito",
};

export interface BankAccount {
  id: number;
  name: string;
  kind: "checking" | "credit_card";
  institution: string;
  last_digits: string | null;
  status: string;
}

export interface BankTransaction {
  id: number;
  account_id: number;
  occurred_on: string;
  period: string;
  direction: "inflow" | "outflow";
  amount_cents: number;
  counterparty_raw: string;
  supplier_id: number | null;
  entry_type: string;
  category: string;
  nature: Nature;
  store_id: number | null;
  installment_index: number | null;
  installment_total: number | null;
}

export interface TransactionSummary {
  period_from: string;
  period_to: string;
  transaction_count: number;
  inflow_cents: number;
  outflow_cents: number;
  net_cents: number;
  by_nature: { nature: string; inflow_cents: number; outflow_cents: number; net_cents: number }[];
  by_category: { category: string; outflow_cents: number }[];
  unresolved_count: number;
}

export interface CounterpartyMapping {
  id: number;
  match_text: string;
  display_name: string;
  supplier_id: number | null;
  entry_type: string;
  category: string;
  nature: Nature;
}

export interface AcquirerFee {
  id: number;
  acquirer: string;
  payment_method: PaymentMethod;
  rate_bps: number;
  effective_from: string;
}

export interface TransactionFilter {
  period?: string;
  from?: string;
  to?: string;
  account_id?: number;
  nature?: Nature;
  direction?: "inflow" | "outflow";
  unresolved?: boolean;
}

function toQuery(filter: TransactionFilter = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `?${search}` : "";
}

export const treasuryApi = createApi({
  reducerPath: "treasuryApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Transaction", "Account", "Mapping", "Fee"],
  endpoints: (builder) => ({
    getAccounts: builder.query<BankAccount[], void>({
      query: () => "/treasury/accounts",
      providesTags: ["Account"],
    }),
    createAccount: builder.mutation<BankAccount, Partial<BankAccount>>({
      query: (body) => ({ url: "/treasury/accounts", method: "POST", body }),
      invalidatesTags: ["Account"],
    }),
    getTransactions: builder.query<BankTransaction[], TransactionFilter | void>({
      query: (filter) => `/treasury/transactions${toQuery(filter ?? undefined)}`,
      providesTags: ["Transaction"],
    }),
    getTransactionSummary: builder.query<TransactionSummary, TransactionFilter | void>({
      query: (filter) => `/treasury/transactions/summary${toQuery(filter ?? undefined)}`,
      providesTags: ["Transaction"],
    }),
    createTransaction: builder.mutation<BankTransaction, Partial<BankTransaction>>({
      query: (body) => ({ url: "/treasury/transactions", method: "POST", body }),
      invalidatesTags: ["Transaction"],
    }),
    updateTransaction: builder.mutation<BankTransaction, { id: number } & Partial<BankTransaction>>({
      query: ({ id, ...body }) => ({ url: `/treasury/transactions/${id}`, method: "PATCH", body }),
      invalidatesTags: ["Transaction"],
    }),
    deleteTransaction: builder.mutation<void, number>({
      query: (id) => ({ url: `/treasury/transactions/${id}`, method: "DELETE" }),
      invalidatesTags: ["Transaction"],
    }),
    getMappings: builder.query<CounterpartyMapping[], void>({
      query: () => "/treasury/mappings",
      providesTags: ["Mapping"],
    }),
    createMapping: builder.mutation<CounterpartyMapping, Partial<CounterpartyMapping>>({
      query: (body) => ({ url: "/treasury/mappings", method: "POST", body }),
      invalidatesTags: ["Mapping"],
    }),
    updateMapping: builder.mutation<CounterpartyMapping, { id: number } & Partial<CounterpartyMapping>>({
      query: ({ id, ...body }) => ({ url: `/treasury/mappings/${id}`, method: "PATCH", body }),
      invalidatesTags: ["Mapping"],
    }),
    deleteMapping: builder.mutation<void, number>({
      query: (id) => ({ url: `/treasury/mappings/${id}`, method: "DELETE" }),
      invalidatesTags: ["Mapping"],
    }),
    applyMappings: builder.mutation<{ examined: number; classified: number }, string>({
      query: (period) => ({ url: `/treasury/mappings/apply/${period}`, method: "POST" }),
      invalidatesTags: ["Transaction"],
    }),
    getFees: builder.query<AcquirerFee[], void>({
      query: () => "/treasury/fees",
      providesTags: ["Fee"],
    }),
    createFee: builder.mutation<AcquirerFee, Partial<AcquirerFee>>({
      query: (body) => ({ url: "/treasury/fees", method: "POST", body }),
      invalidatesTags: ["Fee"],
    }),
  }),
});

export const {
  useGetAccountsQuery,
  useCreateAccountMutation,
  useGetTransactionsQuery,
  useGetTransactionSummaryQuery,
  useCreateTransactionMutation,
  useUpdateTransactionMutation,
  useDeleteTransactionMutation,
  useGetMappingsQuery,
  useCreateMappingMutation,
  useUpdateMappingMutation,
  useDeleteMappingMutation,
  useApplyMappingsMutation,
  useGetFeesQuery,
  useCreateFeeMutation,
} = treasuryApi;
