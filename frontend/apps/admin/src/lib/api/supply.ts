import { createApi } from "@reduxjs/toolkit/query/react";

import type { SupplyRequest } from "@/mocks/supply";

import { mockBaseQuery } from "./base-query";

export const supplyApi = createApi({
  reducerPath: "supplyApi",
  baseQuery: mockBaseQuery,
  endpoints: (builder) => ({
    getSupplyRequests: builder.query<SupplyRequest[], void>({
      query: () => ({ collection: "supply" }),
    }),
  }),
});

export const { useGetSupplyRequestsQuery } = supplyApi;
