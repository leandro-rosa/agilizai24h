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
  /** Unidades por embalagem de compra (ex.: caixa de 24) — sempre presentes na resposta, null quando não cadastrado. */
  units_per_package: number | null;
  package_type: string | null;
  fractionable: boolean | null;
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

/** Decisão do operador sobre um par de SKUs: o novo é o mesmo produto do antigo com outro código de barras, ou não. */
export interface SkuLink {
  id: number;
  old_sku: string;
  new_sku: string;
  decision: "same" | "different";
  decided_at: string;
}

export const productsApi = createApi({
  reducerPath: "productsApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Product", "SkuLink"],
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
    getSkuLinks: builder.query<SkuLink[], void>({
      query: () => "/sku-links",
      providesTags: ["SkuLink"],
    }),
    decideSkuLink: builder.mutation<SkuLink, { old_sku: string; new_sku: string; decision: "same" | "different" }>({
      query: (body) => ({ url: "/sku-links", method: "PUT", body }),
      invalidatesTags: ["SkuLink"],
    }),
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
    updateProduct: builder.mutation<
      Product,
      { id: number; changes: { name?: string; category?: Product["category"]; unitsPerPackage?: number; packageType?: string; fractionable?: boolean } }
    >({
      query: ({ id, changes }) => ({ url: `/products/${id}`, method: "PATCH", body: changes }),
      invalidatesTags: ["Product"],
    }),
  }),
});

export const {
  useGetProductsQuery,
  useGetSkuLinksQuery,
  useDecideSkuLinkMutation,
  useGetCostsAsOfQuery,
  useGetPricesAsOfQuery,
  useRecordPriceMutation,
  useUpdateProductMutation,
} = productsApi;
