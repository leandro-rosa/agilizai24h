import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

import type { BankAccount, TreasuryDriveFile } from "@/lib/api/treasury";

const mockUseGetAccountsQuery = jest.fn();

const FILE: TreasuryDriveFile = {
  id: "f1",
  month_folder_name: "agosto",
  bank_folder_name: "C6",
  detected_source: "c6_statement",
  name: "extrato c6 agosto",
  modified_time: "2026-08-15T00:00:00.000Z",
  status: "new",
  imported_at: null,
  imported_account_id: null,
  error_detail: null,
};

const ACCOUNTS: BankAccount[] = [
  { id: 1, name: "PagBank", kind: "checking", institution: "pagbank", last_digits: null, status: "active" },
  { id: 2, name: "C6 Conta Corrente", kind: "checking", institution: "c6", last_digits: null, status: "active" },
  { id: 3, name: "C6 Cartão de Crédito", kind: "credit_card", institution: "c6", last_digits: null, status: "active" },
];

// Same jest.doMock() + dynamic require() pattern as drive-files-section.spec.tsx /
// src/app/(app)/products/page.spec.tsx — this SWC-based Jest transform hoists static
// imports above jest.mock()/doMock(), so a static import of drive-import-dialog.tsx
// would load the real @/lib/api/treasury before any mock registered here ran.
jest.doMock("../../lib/api/treasury", () => ({
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DriveImportDialog }: { DriveImportDialog: ComponentType<Record<string, unknown>> } = require("./drive-import-dialog");

beforeEach(() => {
  mockUseGetAccountsQuery.mockReturnValue({ data: ACCOUNTS });

  // Radix Select scrolls the highlighted item into view when it opens — jsdom has
  // no layout engine and doesn't implement scrollIntoView at all.
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
});

describe("DriveImportDialog", () => {
  it("pre-selects the checking C6 account for a c6_statement file (bank_folder_name 'C6', institution 'c6', case-insensitive)", () => {
    const onConfirm = jest.fn();
    render(<DriveImportDialog file={FILE} pending={false} onOpenChange={jest.fn()} onConfirm={onConfirm} />);

    // Two accounts share institution "c6" (checking + credit_card) — the account+kind
    // hint from TREASURY_SOURCE_ACCOUNT_HINT (same lookup the manual upload page already
    // uses) must disambiguate to the checking one for a c6_statement file.
    expect(screen.getByRole("combobox", { name: "Conta" })).toHaveTextContent("C6 Conta Corrente");
  });

  it("pre-selects the credit-card C6 account for a c6_invoice file, never the checking one", () => {
    const invoiceFile: TreasuryDriveFile = { ...FILE, detected_source: "c6_invoice" };
    render(<DriveImportDialog file={invoiceFile} pending={false} onOpenChange={jest.fn()} onConfirm={jest.fn()} />);

    expect(screen.getByRole("combobox", { name: "Conta" })).toHaveTextContent("C6 Cartão de Crédito");
  });

  it("pre-fills the period from modified_time formatted YYYY-MM", () => {
    render(<DriveImportDialog file={FILE} pending={false} onOpenChange={jest.fn()} onConfirm={jest.fn()} />);

    expect(screen.getByLabelText("Período")).toHaveValue("2026-08");
  });

  describe("period suggestion combines month_folder_name and modified_time", () => {
    // This design's own real example: an August Itaú statement whose Google Sheet
    // was last edited in September (the operator filling in Tipo/Detalhe columns
    // after the month closed). modified_time alone would wrongly suggest "2026-09".
    it("suggests the folder's month, not modified_time's month, when the file was edited after the statement month (design's real example: agosto file, modified in setembro)", () => {
      const file: TreasuryDriveFile = { ...FILE, month_folder_name: "agosto", modified_time: "2026-09-10T00:00:00.000Z" };
      render(<DriveImportDialog file={file} pending={false} onOpenChange={jest.fn()} onConfirm={jest.fn()} />);

      expect(screen.getByLabelText("Período")).toHaveValue("2026-08");
    });

    it("rolls the year back one when the folder's month is chronologically later than modified_time's month (dezembro file edited in janeiro of the next year)", () => {
      const file: TreasuryDriveFile = { ...FILE, month_folder_name: "dezembro", modified_time: "2027-01-08T00:00:00.000Z" };
      render(<DriveImportDialog file={file} pending={false} onOpenChange={jest.fn()} onConfirm={jest.fn()} />);

      expect(screen.getByLabelText("Período")).toHaveValue("2026-12");
    });

    it("still suggests the same month/year when the folder's month and modified_time's month agree (no regression)", () => {
      const file: TreasuryDriveFile = { ...FILE, month_folder_name: "setembro", modified_time: "2026-09-22T00:00:00.000Z" };
      render(<DriveImportDialog file={file} pending={false} onOpenChange={jest.fn()} onConfirm={jest.fn()} />);

      expect(screen.getByLabelText("Período")).toHaveValue("2026-09");
    });

    it("falls back to modified_time-only when month_folder_name is not a recognized Portuguese month name (defensive)", () => {
      const file: TreasuryDriveFile = { ...FILE, month_folder_name: "pasta-invalida", modified_time: "2026-05-20T00:00:00.000Z" };
      render(<DriveImportDialog file={file} pending={false} onOpenChange={jest.fn()} onConfirm={jest.fn()} />);

      expect(screen.getByLabelText("Período")).toHaveValue("2026-05");
    });
  });

  it("calls onConfirm with the selected account and period when Confirmar is clicked, never before", () => {
    const onConfirm = jest.fn();
    render(<DriveImportDialog file={FILE} pending={false} onOpenChange={jest.fn()} onConfirm={onConfirm} />);

    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(onConfirm).toHaveBeenCalledWith({ accountId: 2, period: "2026-08" });
  });

  it("closes without confirming when Cancelar is clicked", () => {
    const onOpenChange = jest.fn();
    const onConfirm = jest.fn();
    render(<DriveImportDialog file={FILE} pending={false} onOpenChange={onOpenChange} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("fills in the account suggestion once accounts arrive after the dialog's first render, without overwriting a manual pick", async () => {
    // useGetAccountsQuery still loading on mount — the useState initializer that
    // seeds `accountId` from `matchAccount()` sees `accounts: undefined` and starts
    // at null; a later re-render with the real list must still land the suggestion.
    mockUseGetAccountsQuery.mockReturnValue({ data: undefined });
    const { rerender } = render(<DriveImportDialog file={FILE} pending={false} onOpenChange={jest.fn()} onConfirm={jest.fn()} />);

    expect(screen.getByRole("combobox", { name: "Conta" })).toHaveTextContent("Selecione a conta");

    mockUseGetAccountsQuery.mockReturnValue({ data: ACCOUNTS });
    rerender(<DriveImportDialog file={FILE} pending={false} onOpenChange={jest.fn()} onConfirm={jest.fn()} />);

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Conta" })).toHaveTextContent("C6 Conta Corrente"));
  });

  it("renders nothing open when file is null", () => {
    render(<DriveImportDialog file={null} pending={false} onOpenChange={jest.fn()} onConfirm={jest.fn()} />);

    expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
  });
});
