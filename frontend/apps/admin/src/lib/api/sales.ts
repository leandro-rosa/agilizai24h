import { createApi } from "@reduxjs/toolkit/query/react";

import type { Sale } from "@/mocks/sales";

import { mockBaseQuery } from "./base-query";

export const salesApi = createApi({
  reducerPath: "salesApi",
  baseQuery: mockBaseQuery,
  endpoints: (builder) => ({
    getSales: builder.query<Sale[], void>({
      query: () => ({ collection: "sales" }),
    }),
  }),
});

export const { useGetSalesQuery } = salesApi;
