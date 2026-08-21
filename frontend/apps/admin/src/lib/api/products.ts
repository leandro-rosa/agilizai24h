import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

export interface Product {
  id: number;
  sku: string;
  name: string;
  category: "meal" | "snack" | "beverage" | "essential";
  /** Campos das abas de produto da planilha — todos opcionais no serviço. */
  subcategory?: string | null;
  ean?: string | null;
  supplier_id?: number | null;
  net_weight?: string | null;
  ncm?: string | null;
  cest?: string | null;
  shelf_life_days?: number | null;
  status?: string;
}

export interface ResolvedCost {
  sku: string;
  product_id: number;
  cost_cents: number;
  effective_from: string;
}

export interface UnresolvedCost {
  sku: string;
  reason: string;
}

export interface BulkCostResult {
  as_of: string;
  resolved: ResolvedCost[];
  unresolved: UnresolvedCost[];
  complete: boolean;
}

export const productsApi = createApi({
  reducerPath: "productsApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Product"],
  endpoints: (builder) => ({
    getProducts: builder.query<Product[], void>({
      query: () => "/products",
      providesTags: ["Product"],
    }),
    /**
     * There is deliberately no "current cost" lookup on the backend — every
     * cost is resolved as of a date (products-service's own design). This
     * mirrors that: the caller states the date, defaulting to today for the
     * catalogue listing.
     */
    getCostsAsOf: builder.query<BulkCostResult, { skus: string[]; asOf: string }>({
      query: ({ skus, asOf }) => ({
        url: "/products/costs/bulk",
        method: "POST",
        body: { skus, as_of: asOf },
      }),
    }),
    getPricesAsOf: builder.query<
      { resolved: { sku: string; price_cents: number; effective_from: string }[]; unresolved: { sku: string; reason: string }[]; complete: boolean },
      { skus: string[]; asOf: string }
    >({
      // Particionado como o custo — um mapa convidaria a tratar preço ausente
      // como zero, o que aqui INFLA a margem em vez de deixar o buraco visível.
      query: ({ skus, asOf }) => ({ url: "/products/prices/bulk", method: "POST", body: { skus, as_of: asOf } }),
    }),
    recordPrice: builder.mutation<unknown, { sku: string; effective_from: string; price_cents: number }>({
      query: ({ sku, ...body }) => ({ url: `/products/${sku}/prices`, method: "POST", body }),
      invalidatesTags: ["Product"],
    }),
  }),
});

export const {
  useGetProductsQuery,
  useGetCostsAsOfQuery,
  useGetPricesAsOfQuery,
  useRecordPriceMutation,
} = productsApi;
