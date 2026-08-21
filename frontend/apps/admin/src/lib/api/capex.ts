import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

export const ITEM_CATEGORIES = [
  "fridge", "freezer", "wrap", "baskets", "freight", "barcode_reader", "card_terminal",
  "decor", "wobbler", "shelf_strip", "display", "furniture", "led", "sign", "phrase",
  "initial_stock", "shelf_plate", "camera", "tv", "system_activation", "other",
] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/** As 25 linhas de item da aba INVESTIMENTO, em português. */
export const ITEM_CATEGORY_LABELS: Record<ItemCategory, string> = {
  fridge: "Geladeira",
  freezer: "Freezer",
  wrap: "Envelopamento",
  baskets: "Cestos",
  freight: "Frete",
  barcode_reader: "Leitor de código de barras",
  card_terminal: "Maquininha",
  decor: "Decoração",
  wobbler: "Wobbler",
  shelf_strip: "Faixa de gôndola",
  display: "Display",
  furniture: "Móvel",
  led: "LED",
  sign: "Letreiro",
  phrase: "Frase",
  initial_stock: "Estoque inicial",
  shelf_plate: "Placa de gôndola",
  camera: "Câmera",
  tv: "TV",
  system_activation: "Ativação do sistema",
  other: "Outro",
};

export const INVESTMENT_KINDS = ["fixed", "initial", "operating_expense"] as const;
export const INVESTMENT_KIND_LABELS: Record<string, string> = {
  fixed: "Investimento fixo",
  initial: "Investimento inicial",
  operating_expense: "Despesa operacional",
};

export const CONTRIBUTION_KINDS = ["equipment", "furniture", "store_comms", "stock", "system", "loan", "other"] as const;
export const CONTRIBUTION_KIND_LABELS: Record<string, string> = {
  equipment: "Equipamento",
  furniture: "Móvel",
  store_comms: "Comunicação de loja",
  stock: "Estoque",
  system: "Sistema",
  loan: "Empréstimo",
  other: "Outro",
};

export interface StoreInvestment {
  id: number;
  store_id: number;
  total_invested_cents: number;
  monthly_revenue_cents: number;
  monthly_profit_cents: number;
  /** null = indefinido. Nenhum número de meses paga uma loja sem lucro. */
  payback_months: string | number | null;
  _count?: { items: number };
}

export interface InvestmentItem {
  id: number;
  store_investment_id: number | null;
  category: ItemCategory;
  description: string;
  supplier_id: number | null;
  quantity: number;
  cash_amount_cents: number;
  financed_amount_cents: number;
  installments: number;
  installment_amount_cents: number;
  purchased_on: string;
  funding_source: string;
  investment_kind: string;
}

export interface PaybackRow {
  store_id: number;
  total_invested_cents: number;
  monthly_revenue_cents: number;
  monthly_profit_cents: number;
  payback_months: number | null;
}

export interface Investor {
  id: number;
  name: string;
  committed_amount_cents: number;
  _count?: { contributions: number };
}

export interface InvestorContribution {
  id: number;
  investor_id: number;
  contributed_on: string;
  amount_cents: number;
  kind: string;
  note: string | null;
}

export interface InvestorSummaryRow {
  investor_id: number;
  name: string;
  committed_amount_cents: number;
  contributed_amount_cents: number;
  difference_cents: number;
  contribution_count: number;
}

export const capexApi = createApi({
  reducerPath: "capexApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Investment", "Item", "Investor"],
  endpoints: (builder) => ({
    getPayback: builder.query<PaybackRow[], void>({
      query: () => "/capex/investments/payback",
      providesTags: ["Investment"],
    }),
    getInvestment: builder.query<StoreInvestment & { items: InvestmentItem[] }, number>({
      query: (storeId) => `/capex/investments/${storeId}`,
      providesTags: ["Investment", "Item"],
    }),
    putInvestment: builder.mutation<
      StoreInvestment,
      { store_id: number; monthly_revenue_cents?: number; monthly_profit_cents?: number }
    >({
      query: (body) => ({ url: "/capex/investments", method: "PUT", body }),
      invalidatesTags: ["Investment"],
    }),
    getItems: builder.query<InvestmentItem[], { store_id?: number } | void>({
      query: (args) => `/capex/items${args?.store_id !== undefined ? `?store_id=${args.store_id}` : ""}`,
      providesTags: ["Item"],
    }),
    createItem: builder.mutation<InvestmentItem, Partial<InvestmentItem> & { store_id?: number }>({
      query: (body) => ({ url: "/capex/items", method: "POST", body }),
      invalidatesTags: ["Item", "Investment"],
    }),
    updateItem: builder.mutation<InvestmentItem, { id: number } & Partial<InvestmentItem>>({
      query: ({ id, ...body }) => ({ url: `/capex/items/${id}`, method: "PATCH", body }),
      invalidatesTags: ["Item", "Investment"],
    }),
    deleteItem: builder.mutation<void, number>({
      query: (id) => ({ url: `/capex/items/${id}`, method: "DELETE" }),
      invalidatesTags: ["Item", "Investment"],
    }),
    getInvestorSummary: builder.query<InvestorSummaryRow[], void>({
      query: () => "/capex/investors/summary",
      providesTags: ["Investor"],
    }),
    getInvestor: builder.query<Investor & { contributions: InvestorContribution[] }, number>({
      query: (id) => `/capex/investors/${id}`,
      providesTags: ["Investor"],
    }),
    createInvestor: builder.mutation<Investor, { name: string; committed_amount_cents?: number }>({
      query: (body) => ({ url: "/capex/investors", method: "POST", body }),
      invalidatesTags: ["Investor"],
    }),
    updateInvestor: builder.mutation<Investor, { id: number; name?: string; committed_amount_cents?: number }>({
      query: ({ id, ...body }) => ({ url: `/capex/investors/${id}`, method: "PATCH", body }),
      invalidatesTags: ["Investor"],
    }),
    addContribution: builder.mutation<
      InvestorContribution,
      { id: number; contributed_on: string; amount_cents: number; kind: string; note?: string }
    >({
      query: ({ id, ...body }) => ({ url: `/capex/investors/${id}/contributions`, method: "POST", body }),
      invalidatesTags: ["Investor"],
    }),
    deleteContribution: builder.mutation<void, { id: number; contributionId: number }>({
      query: ({ id, contributionId }) => ({
        url: `/capex/investors/${id}/contributions/${contributionId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Investor"],
    }),
  }),
});

export const {
  useGetPaybackQuery,
  useGetInvestmentQuery,
  usePutInvestmentMutation,
  useGetItemsQuery,
  useCreateItemMutation,
  useUpdateItemMutation,
  useDeleteItemMutation,
  useGetInvestorSummaryQuery,
  useGetInvestorQuery,
  useCreateInvestorMutation,
  useUpdateInvestorMutation,
  useAddContributionMutation,
  useDeleteContributionMutation,
} = capexApi;
