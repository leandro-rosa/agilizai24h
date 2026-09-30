import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

import type { DriveFile } from "@/lib/api/ingestion";

const scanTrigger = jest.fn(() => ({ unwrap: () => Promise.resolve({ status: "started" }) }));
const importTrigger = jest.fn((args: { id: string }) => ({
  unwrap: () => Promise.resolve({ id: args.id, status: "importing" as const }),
}));
const fetchFilesTrigger = jest.fn(() => ({ unwrap: () => Promise.resolve(FILES) }));

const mockUseScanDriveMutation = jest.fn();
const mockUseImportDriveFileMutation = jest.fn();
const mockUseLazyGetDriveFilesQuery = jest.fn();

function file(overrides: Partial<DriveFile>): DriveFile {
  return {
    id: "f1",
    name: "relatório agosto",
    path: "agosto-26/relatório",
    mime_type: "application/vnd.google-apps.spreadsheet",
    size_bytes: 1000,
    status: "new",
    error: null,
    is_synthetic: false,
    suggested_file_type: "supply",
    suggested_period: "2026-08",
    suggestion_note: null,
    validation_status: "passed",
    validation: null,
    duplicate_of: null,
    would_replace: null,
    imported_ingestion_id: null,
    confirmed_by: null,
    confirmed_at: null,
    ...overrides,
  };
}

const CLEAN_SUPPLY = file({ id: "clean-supply", suggested_file_type: "supply" });
const CLEAN_SALES = file({ id: "clean-sales", suggested_file_type: "sales" });
const NEEDS_VALIDATION = file({ id: "needs-validation", validation_status: "needs_validation" });
const WOULD_REPLACE = file({ id: "would-replace", would_replace: { ingestion_id: "ing-1", ingested_at: "2026-08-01T00:00:00.000Z", status: "completed" } });
const ALREADY_IMPORTED = file({ id: "already-imported", status: "imported", imported_ingestion_id: "ing-2" });

let FILES: DriveFile[] = [CLEAN_SUPPLY, CLEAN_SALES, NEEDS_VALIDATION, WOULD_REPLACE, ALREADY_IMPORTED];

// SWC-based Jest transform hoists `import` above jest.mock()/doMock() — same
// jest.doMock() + dynamic require() pattern already established by
// src/components/treasury/drive-files-section.spec.tsx.
jest.doMock("../../lib/api/ingestion", () => ({
  useScanDriveMutation: mockUseScanDriveMutation,
  useImportDriveFileMutation: mockUseImportDriveFileMutation,
  useLazyGetDriveFilesQuery: mockUseLazyGetDriveFilesQuery,
}));
jest.doMock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DriveSyncButton }: { DriveSyncButton: ComponentType } = require("./drive-sync-button");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { toast }: { toast: { success: jest.Mock; error: jest.Mock } } = require("sonner");

beforeEach(() => {
  FILES = [CLEAN_SUPPLY, CLEAN_SALES, NEEDS_VALIDATION, WOULD_REPLACE, ALREADY_IMPORTED];
  scanTrigger.mockClear();
  importTrigger.mockClear();
  fetchFilesTrigger.mockClear();
  (toast.success as jest.Mock).mockClear();
  (toast.error as jest.Mock).mockClear();

  mockUseScanDriveMutation.mockReturnValue([scanTrigger, { isLoading: false }]);
  mockUseImportDriveFileMutation.mockReturnValue([importTrigger, { isLoading: false }]);
  mockUseLazyGetDriveFilesQuery.mockReturnValue([fetchFilesTrigger, { isLoading: false }]);
});

describe("DriveSyncButton", () => {
  it("renders a button labeled Sincronizar com o Drive", () => {
    render(<DriveSyncButton />);
    expect(screen.getByRole("button", { name: /sincronizar com o drive/i })).toBeInTheDocument();
  });

  it("scans, fetches the fresh file list, and imports only the files that are actually ready", async () => {
    render(<DriveSyncButton />);
    fireEvent.click(screen.getByRole("button", { name: /sincronizar com o drive/i }));

    await waitFor(() => expect(scanTrigger).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchFilesTrigger).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(importTrigger).toHaveBeenCalledTimes(2));

    const importedIds = importTrigger.mock.calls.map((call) => (call[0] as { id: string }).id);
    expect(importedIds.sort()).toEqual(["clean-sales", "clean-supply"]);
  });

  it("never imports a file with a pending validation, a replace conflict, or one already imported", async () => {
    render(<DriveSyncButton />);
    fireEvent.click(screen.getByRole("button", { name: /sincronizar com o drive/i }));

    await waitFor(() => expect(importTrigger).toHaveBeenCalledTimes(2));

    const importedIds = importTrigger.mock.calls.map((call) => (call[0] as { id: string }).id);
    expect(importedIds).not.toContain("needs-validation");
    expect(importedIds).not.toContain("would-replace");
    expect(importedIds).not.toContain("already-imported");
  });

  it("passes the file's own suggested type and period to each import call", async () => {
    FILES = [CLEAN_SUPPLY];
    render(<DriveSyncButton />);
    fireEvent.click(screen.getByRole("button", { name: /sincronizar com o drive/i }));

    await waitFor(() => expect(importTrigger).toHaveBeenCalledTimes(1));
    expect(importTrigger).toHaveBeenCalledWith({ id: "clean-supply", file_type: "supply", period: "2026-08" });
  });

  it("shows a success toast naming how many imported and how many still need manual review", async () => {
    render(<DriveSyncButton />);
    fireEvent.click(screen.getByRole("button", { name: /sincronizar com o drive/i }));

    await waitFor(() => expect(importTrigger).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

    const message = (toast.success as jest.Mock).mock.calls[0][0] as string;
    expect(message).toContain("2");
    expect(message).toMatch(/revis(ã|a)o manual/i);
    expect(message).toContain("/ingestion");
  });

  it("shows a simpler success toast with no mention of /ingestion when nothing needs manual review", async () => {
    FILES = [CLEAN_SUPPLY];
    render(<DriveSyncButton />);
    fireEvent.click(screen.getByRole("button", { name: /sincronizar com o drive/i }));

    await waitFor(() => expect(importTrigger).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

    const message = (toast.success as jest.Mock).mock.calls[0][0] as string;
    expect(message).not.toContain("/ingestion");
  });

  it("counts a file whose import call itself rejects as needing manual review, never silently drops it", async () => {
    FILES = [CLEAN_SUPPLY, CLEAN_SALES];
    importTrigger.mockImplementationOnce(() => ({ unwrap: () => Promise.reject(new Error("boom")) }));

    render(<DriveSyncButton />);
    fireEvent.click(screen.getByRole("button", { name: /sincronizar com o drive/i }));

    await waitFor(() => expect(importTrigger).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

    const message = (toast.success as jest.Mock).mock.calls[0][0] as string;
    expect(message).toContain("1");
  });

  it("shows an error toast and never calls import when the scan itself fails", async () => {
    scanTrigger.mockReturnValueOnce({ unwrap: () => Promise.reject(new Error("scan failed")) });

    render(<DriveSyncButton />);
    fireEvent.click(screen.getByRole("button", { name: /sincronizar com o drive/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(importTrigger).not.toHaveBeenCalled();
  });

  it("disables the button while a sync is in progress", async () => {
    render(<DriveSyncButton />);
    const button = screen.getByRole("button", { name: /sincronizar com o drive/i });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
