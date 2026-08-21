import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

export const SUPPLIER_CATEGORIES = [
  "frozen",
  "beverages",
  "grocery",
  "wholesale",
  "equipment",
  "services",
  "system",
] as const;

export type SupplierCategory = (typeof SUPPLIER_CATEGORIES)[number];

/** Rótulos PT do vocabulário fechado do `suppliers-service`. */
export const SUPPLIER_CATEGORY_LABELS: Record<SupplierCategory, string> = {
  frozen: "Congelados",
  beverages: "Bebidas",
  grocery: "Mercearia",
  wholesale: "Atacado",
  equipment: "Equipamentos",
  services: "Serviços",
  system: "Sistema",
};

export interface Supplier {
  id: number;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  category: SupplierCategory;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: "active" | "inactive";
  alias_count?: number;
}

export interface SupplierAlias {
  id: number;
  alias: string;
  normalized_alias: string;
}

export type SupplierDetail = Supplier & { aliases: SupplierAlias[] };

export interface SupplierInput {
  name: string;
  legal_name?: string;
  tax_id?: string;
  category: SupplierCategory;
  contact_name?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export const suppliersApi = createApi({
  reducerPath: "suppliersApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Supplier"],
  endpoints: (builder) => ({
    getSuppliers: builder.query<Supplier[], { status?: string; category?: string } | void>({
      // Sem filtro explícito o serviço devolve só ativos; o painel precisa
      // dos dois, porque a coluna de status existe justamente para isso.
      query: (args) => {
        const params = new URLSearchParams({ status: args?.status ?? "active,inactive" });
        if (args?.category) params.set("category", args.category);
        return `/suppliers?${params.toString()}`;
      },
      providesTags: ["Supplier"],
    }),
    getSupplier: builder.query<SupplierDetail, number>({
      query: (id) => `/suppliers/${id}`,
      providesTags: (_result, _error, id) => [{ type: "Supplier", id }],
    }),
    createSupplier: builder.mutation<Supplier, SupplierInput>({
      query: (body) => ({ url: "/suppliers", method: "POST", body }),
      invalidatesTags: ["Supplier"],
    }),
    updateSupplier: builder.mutation<Supplier, { id: number } & Partial<SupplierInput> & { status?: string }>({
      query: ({ id, ...body }) => ({ url: `/suppliers/${id}`, method: "PATCH", body }),
      invalidatesTags: (_r, _e, { id }) => ["Supplier", { type: "Supplier", id }],
    }),
    addAlias: builder.mutation<SupplierAlias, { id: number; alias: string }>({
      query: ({ id, alias }) => ({ url: `/suppliers/${id}/aliases`, method: "POST", body: { alias } }),
      invalidatesTags: (_r, _e, { id }) => ["Supplier", { type: "Supplier", id }],
    }),
    removeAlias: builder.mutation<void, { id: number; aliasId: number }>({
      query: ({ id, aliasId }) => ({ url: `/suppliers/${id}/aliases/${aliasId}`, method: "DELETE" }),
      invalidatesTags: (_r, _e, { id }) => ["Supplier", { type: "Supplier", id }],
    }),
  }),
});

export const {
  useGetSuppliersQuery,
  useGetSupplierQuery,
  useCreateSupplierMutation,
  useUpdateSupplierMutation,
  useAddAliasMutation,
  useRemoveAliasMutation,
} = suppliersApi;
