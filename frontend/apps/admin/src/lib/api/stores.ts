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
  }),
});

export const { useGetStoresQuery } = storesApi;
