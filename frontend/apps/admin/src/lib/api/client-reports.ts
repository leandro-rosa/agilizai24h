import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

/** Where a date came from — internal tracing to the report sheet, never printed in a client document. */
export interface DivergenceSource {
  visit_id: number;
  sheet: string;
  kind: string;
}

export interface ClientDivergenceRow {
  sku: string;
  product_name: string;
  quantity: number;
  /** Report instant (wall-clock in UTC fields) of the earlier count; null = none available. */
  previous_conference_at: string | null;
  identified_at: string;
  /** Sale price in force on the identification day; null = none registered (never zero, never today's). */
  unit_price_cents: number | null;
  /** quantity × unit price in centavos; null when the price is unknown. */
  loss_cents: number | null;
  source: { identified: DivergenceSource; previous: DivergenceSource | null };
}

export interface ClientDivergenceUnit {
  store_id: number;
  code: string;
  rows: ClientDivergenceRow[];
  total_quantity: number;
  total_loss_cents: number;
  unpriced_rows: number;
  partial: boolean;
}

export interface ClientDivergenceReport {
  client: { id: number; name: string };
  from: string;
  to: string;
  units: ClientDivergenceUnit[];
  totals: { quantity: number; loss_cents: number; distinct_products: number; rows: number; unpriced_rows: number; partial: boolean };
  /** Visits with removals whose reasons were never stored (reports imported before the split was kept). */
  unsplit_visits: number;
}

export interface ClientDivergenceFilters {
  clientId: number;
  /** Every unit of the client when empty. */
  storeIds: number[];
  from: string;
  to: string;
}

export const clientReportsApi = createApi({
  reducerPath: "clientReportsApi",
  baseQuery: gatewayBaseQuery,
  endpoints: (builder) => ({
    getClientDivergences: builder.query<ClientDivergenceReport, ClientDivergenceFilters>({
      query: ({ clientId, storeIds, from, to }) => {
        const params = new URLSearchParams({ client_id: String(clientId), from, to });
        if (storeIds.length > 0) params.set("store_ids", storeIds.join(","));
        return `/client-reports/divergences?${params}`;
      },
    }),
  }),
});

export const { useGetClientDivergencesQuery } = clientReportsApi;
