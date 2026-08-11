import { createApi } from "@reduxjs/toolkit/query/react";

import type { FinancialTransaction } from "@/mocks/finance";

import { mockBaseQuery } from "./base-query";

export const financeApi = createApi({
  reducerPath: "financeApi",
  baseQuery: mockBaseQuery,
  endpoints: (builder) => ({
    getTransactions: builder.query<FinancialTransaction[], void>({
      query: () => ({ collection: "finance" }),
    }),
  }),
});

export const { useGetTransactionsQuery } = financeApi;
