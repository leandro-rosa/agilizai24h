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
  /**
   * Omit entirely for file_type "supply" — one restocking workbook covers the whole network. Optional for
   * "sales" too: required only for the old, per-store export, not the network-wide, per-transaction one
   * (Aug 2026) — the backend cannot tell which format a file is before parsing it, so this stays optional and
   * the backend fails loudly if the file turns out to be the old format with none given. Still required for
   * "cost".
   */
  store_id?: number;
  period: string;
}

// ---------------------------------------------------------------------------
// Google Drive source (add-drive-ingestion-source)
// ---------------------------------------------------------------------------

export const DRIVE_IMPORTABLE_FILE_TYPES = ["sales", "supply"] as const;
export type DriveImportableFileType = (typeof DRIVE_IMPORTABLE_FILE_TYPES)[number];

export type DriveFileStatus = "new" | "changed" | "importing" | "imported" | "ignored" | "missing" | "error";
export type DriveValidationStatus = "none" | "validating" | "passed" | "needs_validation" | "blocked" | "failed";

/** One thing a check found. `code` is stable and drives the text; `details` carries the numbers. */
export interface DriveFinding {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface DriveStoreCoverage {
  name: string;
  rows: number;
  normalWeekdays: number[];
  expectedDays: number;
  coveredDays: number;
  /** Null when the store's coverage cannot be established. */
  coverage: number | null;
  verifiable: boolean;
  missingDates: string[];
}

export interface DriveValidationThresholds {
  periodMatchMinShare: number;
  weekdayOpenMinShare: number;
  coverageMinPooled: number;
  coverageMinStore: number;
  edgeToleranceDays: number;
}

/** The stored result of validating a file: aggregates and findings, never content. */
export interface DriveValidationReport {
  version: 1;
  outcome: "passed" | "needs_validation" | "blocked";
  format: "network_sales" | "legacy_store_sales" | "supply" | "unknown";
  fileType: DriveImportableFileType | null;
  period: string | null;
  rowCount: number;
  sizeBytes: number;
  contentSha256: string;
  monthHistogram: Record<string, number>;
  dominantMonth: string | null;
  periodShare: number | null;
  firstDay: string | null;
  lastDay: string | null;
  fileCoverage: number | null;
  stores: DriveStoreCoverage[];
  blocking: DriveFinding[];
  inconsistencies: DriveFinding[];
  thresholds: DriveValidationThresholds;
}

export interface DriveFile {
  id: string;
  name: string;
  /** Folder path from the Drive root, e.g. `agosto-26/Relatório_2026`. */
  path: string;
  mime_type: string;
  size_bytes: number | null;
  status: DriveFileStatus;
  error: string | null;
  is_synthetic: boolean;
  suggested_file_type: DriveImportableFileType | null;
  suggested_period: string | null;
  suggestion_note: string | null;
  validation_status: DriveValidationStatus;
  validation: DriveValidationReport | null;
  duplicate_of: { id: string; path: string; imported_at: string | null } | null;
  /** Set when importing would replace data already ingested for the same type and period. */
  would_replace: { ingestion_id: string; ingested_at: string; status: string } | null;
  imported_ingestion_id: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  validation_confirmed_by: string | null;
  validation_confirmed_at: string | null;
  last_seen_at: string;
}

export interface DriveStatus {
  configured: boolean;
  auto_validate: boolean;
  max_file_bytes: number;
  scan_cron: string;
  thresholds: DriveValidationThresholds;
  last_scan: {
    started_at: string;
    finished_at: string | null;
    trigger: "schedule" | "manual";
    outcome: "ok" | "failed" | "running";
    files_seen: number;
    skipped_by_pattern: number;
    new_count: number;
    changed_count: number;
    error: string | null;
  } | null;
}

export interface ImportDriveFileArgs {
  id: string;
  file_type: DriveImportableFileType;
  /** `YYYY-MM`, as the person confirmed it. */
  period: string;
  /** Sent when the import would replace an already-ingested period. */
  confirm_replace?: boolean;
  /** Sent when validation found inconsistencies; bound to the content that was reviewed. */
  confirm_validation?: { content_sha256: string };
}

/** The body of a refused import, so the UI can react to a `code` instead of parsing a message. */
export interface DriveRefusal {
  code: string;
  message: string;
  would_replace?: { ingestion_id: string; ingested_at: string; status: string };
  inconsistencies?: DriveFinding[];
  blocking?: DriveFinding[];
  content_sha256?: string;
}

export const ingestionApi = createApi({
  reducerPath: "ingestionApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Ingestion", "DriveFile", "DriveStatus"],
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

    // Google Drive source. A scan and a validation only ever read; nothing is imported until a person asks.
    getDriveFiles: builder.query<DriveFile[], void>({
      query: () => "/drive-files",
      providesTags: ["DriveFile"],
    }),
    getDriveStatus: builder.query<DriveStatus, void>({
      query: () => "/drive-files/status",
      providesTags: ["DriveStatus"],
    }),
    /** "Sincronizar agora": queues a scan (and, after it, the validation of new and changed files). */
    scanDrive: builder.mutation<{ status: "queued" | "already_running" }, void>({
      query: () => ({ url: "/drive-files/scan", method: "POST" }),
      invalidatesTags: ["DriveStatus"],
    }),
    /** Validates a file, or re-evaluates it for another type or period. Answers at once when nothing needs downloading. */
    validateDriveFile: builder.mutation<
      { id: string; status: "evaluated" | "queued" },
      { id: string; file_type?: DriveImportableFileType; period?: string }
    >({
      query: ({ id, ...body }) => ({ url: `/drive-files/${encodeURIComponent(id)}/validate`, method: "POST", body }),
      invalidatesTags: ["DriveFile"],
    }),
    importDriveFile: builder.mutation<{ id: string; status: DriveFileStatus }, ImportDriveFileArgs>({
      query: ({ id, ...body }) => ({ url: `/drive-files/${encodeURIComponent(id)}/import`, method: "POST", body }),
      invalidatesTags: ["DriveFile", "Ingestion"],
    }),
    /** `ignored: false` brings an ignored file back. */
    ignoreDriveFile: builder.mutation<{ id: string; status: DriveFileStatus }, { id: string; ignored: boolean }>({
      query: ({ id, ignored }) => ({ url: `/drive-files/${encodeURIComponent(id)}/ignore`, method: "POST", body: { ignored } }),
      invalidatesTags: ["DriveFile"],
    }),
  }),
});

export const {
  useListIngestionsQuery,
  useGetIngestionQuery,
  useUploadIngestionMutation,
  useGetDriveFilesQuery,
  useGetDriveStatusQuery,
  useScanDriveMutation,
  useValidateDriveFileMutation,
  useImportDriveFileMutation,
  useIgnoreDriveFileMutation,
} = ingestionApi;
