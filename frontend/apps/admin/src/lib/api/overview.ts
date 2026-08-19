import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";
import type { Product } from "./products";
import type { Store } from "./stores";

type Section<T> =
  | { available: true; data: T }
  | { available: false; upstream: string; reason: "unreachable" | "error" };

/** Combines stores + products; each section reports its own availability rather than a partial result looking complete. */
export interface Overview {
  stores: Section<Store[]>;
  products: Section<Product[]>;
  complete: boolean;
}

export const overviewApi = createApi({
  reducerPath: "overviewApi",
  baseQuery: gatewayBaseQuery,
  endpoints: (builder) => ({
    getOverview: builder.query<Overview, void>({
      query: () => "/overview",
    }),
  }),
});

export const { useGetOverviewQuery } = overviewApi;
