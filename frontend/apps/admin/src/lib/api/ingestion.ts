import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

export const INGESTION_FILE_TYPES = ["sales", "supply", "cost"] as const;
export type IngestionFileType = (typeof INGESTION_FILE_TYPES)[number];

export const INGESTION_STATUSES = ["accepted", "processing", "completed", "partially_completed", "failed"] as const;
export type IngestionStatus = (typeof INGESTION_STATUSES)[number];

export interface Ingestion {
  id: string;
  file_type: IngestionFileType;
  object_key: string;
  original_name: string;
  store_id: number | null;
  period: string;
  status: IngestionStatus;
  error: string | null;
  expected_chunks: number;
  processed_chunks: number;
  accepted_rows: number;
  rejected_rows: number;
  correlation_id: string | null;
  uploaded_at: string;
  updated_at: string;
}

export interface IngestionRejection {
  id: number;
  ingestion_id: string;
  row_reference: string;
  reason: string;
  detail: string;
  created_at: string;
}

export interface IngestionDetail extends Ingestion {
  rejections: IngestionRejection[];
}

export interface UploadIngestionArgs {
  file: File;
  file_type: IngestionFileType;
  /** Omit entirely for file_type "supply" — one restocking workbook covers the whole network. */
  store_id?: number;
  period: string;
}

export const ingestionApi = createApi({
  reducerPath: "ingestionApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Ingestion"],
  endpoints: (builder) => ({
    listIngestions: builder.query<Ingestion[], { limit?: number } | void>({
      query: (args) => `/ingestions${args?.limit ? `?limit=${args.limit}` : ""}`,
      providesTags: ["Ingestion"],
    }),
    getIngestion: builder.query<IngestionDetail, string>({
      query: (id) => `/ingestions/${encodeURIComponent(id)}`,
      providesTags: ["Ingestion"],
    }),
    uploadIngestion: builder.mutation<Ingestion, UploadIngestionArgs>({
      query: ({ file, file_type, store_id, period }) => {
        // Field order matters: the gateway reads request.file()'s fields
        // synchronously before consuming the file stream (@fastify/
        // multipart parses serially off the wire), so value fields must be
        // appended before the file part or they read as undefined there.
        const body = new FormData();
        body.append("file_type", file_type);
        if (store_id != null) body.append("store_id", String(store_id));
        body.append("period", period);
        body.append("file", file);
        return { url: "/ingestions", method: "POST", body };
      },
      invalidatesTags: ["Ingestion"],
    }),
  }),
});

export const { useListIngestionsQuery, useGetIngestionQuery, useUploadIngestionMutation } = ingestionApi;
