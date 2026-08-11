import { createApi } from "@reduxjs/toolkit/query/react";

import type { Store } from "@/mocks/stores";

import { mockBaseQuery } from "./base-query";

export const storesApi = createApi({
  reducerPath: "storesApi",
  baseQuery: mockBaseQuery,
  endpoints: (builder) => ({
    getStores: builder.query<Store[], void>({
      query: () => ({ collection: "stores" }),
    }),
  }),
});

export const { useGetStoresQuery } = storesApi;
