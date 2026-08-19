import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

export interface Product {
  id: number;
  sku: string;
  name: string;
  category: "meal" | "snack" | "beverage" | "essential";
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
  }),
});

export const { useGetProductsQuery, useGetCostsAsOfQuery } = productsApi;
