import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

export interface Store {
  id: number;
  name: string;
  address: string;
  city: string;
  status: "active" | "maintenance" | "inactive";
  type: "company" | "condo";
  external_code: string | null;
  /** Atributos da unidade que hospeda a loja — todos opcionais no serviço. */
  tax_id?: string | null;
  /** "HTL05" — o código do SITE do cliente, não o do PDV. */
  client_code?: string | null;
  opened_on?: string | null;
  headcount?: number | null;
  voltage?: string | null;
}

export const storesApi = createApi({
  reducerPath: "storesApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Store"],
  endpoints: (builder) => ({
    getStores: builder.query<Store[], void>({
      // Listings default to active-only (stores-service's DEFAULT_LISTED_STATUSES) —
      // the panel needs every status since that is what the status column/filter is for.
      query: () => "/stores?status=active,maintenance,inactive",
      providesTags: ["Store"],
    }),
    createStore: builder.mutation<Store, Partial<Store>>({
      query: (body) => ({ url: "/stores", method: "POST", body }),
      invalidatesTags: ["Store"],
    }),
    updateStore: builder.mutation<Store, { id: number } & Partial<Store>>({
      query: ({ id, ...body }) => ({ url: `/stores/${id}`, method: "PATCH", body }),
      invalidatesTags: ["Store"],
    }),
  }),
});

export const { useGetStoresQuery, useCreateStoreMutation, useUpdateStoreMutation } = storesApi;
