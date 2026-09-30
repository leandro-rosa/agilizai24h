import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";

import type { BankAccount, TreasuryDriveFile } from "@/lib/api/treasury";

const scanTrigger = jest.fn(() => ({ unwrap: () => Promise.resolve({ status: "queued" }) }));
const importTrigger = jest.fn(() => ({ unwrap: () => Promise.resolve({ status: "queued" }) }));
const ignoreTrigger = jest.fn(() => ({ unwrap: () => Promise.resolve({ status: "ignored" }) }));

const mockUseGetTreasuryDriveFilesQuery = jest.fn();
const mockUseGetTreasuryDriveStatusQuery = jest.fn();
const mockUseScanTreasuryDriveMutation = jest.fn();
const mockUseImportTreasuryDriveFileMutation = jest.fn();
const mockUseIgnoreTreasuryDriveFileMutation = jest.fn();
const mockUseGetAccountsQuery = jest.fn();
const mockUseHasPermission = jest.fn();

const RECOGNIZED: TreasuryDriveFile = {
  id: "f1",
  month_folder_name: "agosto",
  bank_folder_name: "c6",
  detected_source: "c6_statement",
  name: "extrato c6 agosto",
  modified_time: "2026-08-15T00:00:00.000Z",
  status: "new",
  imported_at: null,
  imported_account_id: null,
  error_detail: null,
};

const UNRECOGNIZED: TreasuryDriveFile = {
  id: "f2",
  month_folder_name: "agosto",
  bank_folder_name: "desconhecido",
  detected_source: null,
  name: "planilha misteriosa",
  modified_time: "2026-08-20T00:00:00.000Z",
  status: "new",
  imported_at: null,
  imported_account_id: null,
  error_detail: null,
};

const ACCOUNTS: BankAccount[] = [
  { id: 1, name: "C6 Conta Corrente", kind: "checking", institution: "c6", last_digits: null, status: "active" },
];

// This SWC-based Jest transform hoists `import` above jest.mock()/doMock() calls
// (unlike babel-jest), so a static import of drive-files-section.tsx would always
// load the real @/lib/api/treasury and @/lib/auth/use-permission before any mock
// registered here got a chance to run. jest.doMock() (never hoisted) plus a
// dynamic require() sidesteps that — same pattern already established by
// src/app/(app)/products/page.spec.tsx.
//
// Deliberately no jest.resetModules(): this file never statically imports
// @/lib/api/treasury or @/lib/auth/use-permission (only `import type`, erased at
// compile time), so doMock() below is registered before either module's first
// real require — resetModules() would otherwise hand the dynamically-required
// component a second, disconnected React copy ("Invalid hook call").
jest.doMock("../../lib/api/treasury", () => ({
  useGetTreasuryDriveFilesQuery: mockUseGetTreasuryDriveFilesQuery,
  useGetTreasuryDriveStatusQuery: mockUseGetTreasuryDriveStatusQuery,
  useScanTreasuryDriveMutation: mockUseScanTreasuryDriveMutation,
  useImportTreasuryDriveFileMutation: mockUseImportTreasuryDriveFileMutation,
  useIgnoreTreasuryDriveFileMutation: mockUseIgnoreTreasuryDriveFileMutation,
  useGetAccountsQuery: mockUseGetAccountsQuery,
  TREASURY_SOURCE_LABELS: {
    pagbank_statement: "Extrato PagBank",
    c6_statement: "Extrato C6",
    c6_invoice: "Fatura do cartão C6",
    pagseguro_invoice: "Fatura PagSeguro",
    nubank_statement: "Extrato Nubank",
    bradesco_statement: "Extrato Bradesco",
    itau_statement: "Extrato Itaú",
  },
  TREASURY_SOURCE_ACCOUNT_HINT: {
    pagbank_statement: { institution: "pagbank", kind: "checking" },
    c6_statement: { institution: "c6", kind: "checking" },
    c6_invoice: { institution: "c6", kind: "credit_card" },
    pagseguro_invoice: { institution: "pagbank", kind: "credit_card" },
    nubank_statement: { institution: "nubank", kind: "checking" },
    bradesco_statement: { institution: "bradesco", kind: "checking" },
    itau_statement: { institution: "itau", kind: "checking" },
  },
}));
jest.doMock("../../lib/auth/use-permission", () => ({
  useHasPermission: mockUseHasPermission,
}));

// Must run after the doMock() calls above, not hoisted like a static import (see comment above).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DriveFilesSection }: { DriveFilesSection: ComponentType } = require("./drive-files-section");

beforeEach(() => {
  scanTrigger.mockClear();
  importTrigger.mockClear();
  ignoreTrigger.mockClear();

  mockUseGetTreasuryDriveStatusQuery.mockReturnValue({ data: { configured: true }, isLoading: false, error: undefined, refetch: jest.fn() });
  mockUseGetTreasuryDriveFilesQuery.mockReturnValue({ data: [RECOGNIZED, UNRECOGNIZED], isLoading: false, error: undefined, refetch: jest.fn() });
  mockUseScanTreasuryDriveMutation.mockReturnValue([scanTrigger, { isLoading: false }]);
  mockUseImportTreasuryDriveFileMutation.mockReturnValue([importTrigger, { isLoading: false }]);
  mockUseIgnoreTreasuryDriveFileMutation.mockReturnValue([ignoreTrigger, { isLoading: false }]);
  mockUseGetAccountsQuery.mockReturnValue({ data: ACCOUNTS });
  mockUseHasPermission.mockReturnValue(true);

  // Radix Select scrolls the highlighted item into view when it opens — jsdom has
  // no layout engine and doesn't implement scrollIntoView at all (same fix as
  // src/app/(app)/products/page.spec.tsx).
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
});

describe("DriveFilesSection", () => {
  it("shows each tracked file with its bank, detected type and status", () => {
    render(<DriveFilesSection />);

    expect(screen.getByText("c6")).toBeInTheDocument();
    expect(screen.getByText("Extrato C6")).toBeInTheDocument();
    // Both fixtures are status "new" → "Novo" appears twice.
    expect(screen.getAllByText("Novo")).toHaveLength(2);
  });

  it("shows 'não reconhecido' for a file with detected_source: null, never a fabricated type", () => {
    render(<DriveFilesSection />);

    expect(screen.getByText("não reconhecido")).toBeInTheDocument();

    const rows = screen.getAllByRole("row");
    const unrecognizedRow = rows.find((row) => row.textContent?.includes("planilha misteriosa"));
    expect(unrecognizedRow).toBeDefined();

    const importButtons = screen.getAllByRole("button", { name: "Importar" });
    // RECOGNIZED (f1) comes first, UNRECOGNIZED (f2) second — its Importar stays disabled.
    expect(importButtons[1]).toBeDisabled();
  });

  it("clicking Sincronizar agora calls the scan mutation", () => {
    render(<DriveFilesSection />);

    fireEvent.click(screen.getByRole("button", { name: /sincronizar agora/i }));

    expect(scanTrigger).toHaveBeenCalledTimes(1);
  });

  it("clicking Importar opens the confirmation dialog, never imports directly", () => {
    render(<DriveFilesSection />);

    const importButtons = screen.getAllByRole("button", { name: "Importar" });
    // First recognized file's row is RECOGNIZED (f1) — its Importar button is enabled.
    fireEvent.click(importButtons[0]);

    expect(screen.getByRole("combobox", { name: "Conta" })).toBeInTheDocument();
    expect(importTrigger).not.toHaveBeenCalled();
  });
});
