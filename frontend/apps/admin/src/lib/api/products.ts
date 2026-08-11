import { createApi } from "@reduxjs/toolkit/query/react";

import type { Product } from "@/mocks/products";

import { mockBaseQuery } from "./base-query";

export const productsApi = createApi({
  reducerPath: "productsApi",
  baseQuery: mockBaseQuery,
  endpoints: (builder) => ({
    getProducts: builder.query<Product[], void>({
      query: () => ({ collection: "products" }),
    }),
  }),
});

export const { useGetProductsQuery } = productsApi;
