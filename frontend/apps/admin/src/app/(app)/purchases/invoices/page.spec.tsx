import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";

let params = new URLSearchParams();
const listQuery = jest.fn((_arg: unknown, _opts?: unknown) => ({ data: [{ id: 1 }, { id: 2 }], isLoading: false, error: undefined, refetch: jest.fn() }));
const oneQuery = jest.fn((_arg: unknown, _opts?: unknown) => ({ data: { id: 9, invoice_number: "13021" } as unknown, isLoading: false, error: undefined, refetch: jest.fn() }));
const table = jest.fn((_props: unknown) => <div data-testid="table" />);

jest.doMock("next/navigation", () => ({ useSearchParams: () => params }));
jest.doMock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
jest.doMock("../../../../lib/api/purchases", () => ({ useGetPurchasesQuery: listQuery, useGetPurchaseQuery: oneQuery }));
jest.doMock("../../../../components/purchases/invoice-import-dialog", () => ({ InvoiceImportDialog: () => null }));
jest.doMock("../../../../components/purchases/purchases-table", () => ({ PurchasesTable: table }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Page: ComponentType = require("./page").default;

describe("Notas fiscais de compra — link de uma nota", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    params = new URLSearchParams();
  });

  it("sem parâmetro lista todas as notas", () => {
    render(<Page />);

    expect((table.mock.calls[0][0] as { purchases: unknown[] }).purchases).toHaveLength(2);
    expect(listQuery).toHaveBeenCalledWith({ invoicesOnly: true }, { skip: false });
    expect(screen.queryByText(/Mostrando só a compra/)).not.toBeInTheDocument();
  });

  it("?purchase=ID mostra só essa compra, já com os itens abertos, e oferece voltar à lista", () => {
    params = new URLSearchParams("purchase=9");
    render(<Page />);

    const props = table.mock.calls[0][0] as { purchases: { id: number }[]; initialOpen: number };
    expect(props.purchases).toEqual([{ id: 9, invoice_number: "13021" }]);
    expect(props.initialOpen).toBe(9);
    expect(oneQuery).toHaveBeenCalledWith(9, { skip: false });
    expect(listQuery).toHaveBeenCalledWith({ invoicesOnly: true }, { skip: true });
    expect(screen.getByRole("link", { name: "Ver todas as notas" })).toHaveAttribute("href", "/purchases/invoices");
  });

  it("uma compra que não existe diz isso, em vez de uma lista vazia sem explicação", () => {
    params = new URLSearchParams("purchase=777");
    oneQuery.mockReturnValueOnce({ data: undefined, isLoading: false, error: undefined, refetch: jest.fn() });
    render(<Page />);

    expect(screen.getByText("Esta compra não foi encontrada.")).toBeInTheDocument();
  });
});
