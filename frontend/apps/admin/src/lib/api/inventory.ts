import { createApi } from "@reduxjs/toolkit/query/react";

import type { InventoryItem } from "@/mocks/inventory";

import { mockBaseQuery } from "./base-query";

export const inventoryApi = createApi({
  reducerPath: "inventoryApi",
  baseQuery: mockBaseQuery,
  endpoints: (builder) => ({
    getInventory: builder.query<InventoryItem[], void>({
      query: () => ({ collection: "inventory" }),
    }),
  }),
});

export const { useGetInventoryQuery } = inventoryApi;
