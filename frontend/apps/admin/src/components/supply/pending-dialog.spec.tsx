import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";

import type { StockItem } from "@/lib/api/inventory";

const item = (sku: string, over: Partial<StockItem> = {}): StockItem => ({
  store_id: 1, sku, period: "2026-09", restocked: 0, sold: 0, removed: 0, adjustment: 0, closing_stock: 0, inconsistent: false, recorded_closing_balance: null, ...over,
});

let MOVEMENTS: StockItem[] = [];
let OPENING: StockItem[] = [];
const mockStock = jest.fn();

jest.doMock("../../lib/api/inventory", () => ({ useGetStockRangeQuery: mockStock }));
jest.doMock("../../lib/api/products", () => ({ useGetProductsQuery: () => ({ data: [{ sku: "B", name: "Produto B" }, { sku: "C", name: "Produto C" }] }) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PendingDialog }: { PendingDialog: ComponentType<{ store: { id: number; name: string } | null; endPeriod: string; onClose: () => void }> } = require("./pending-dialog");

beforeEach(() => {
  MOVEMENTS = [item("A", { restocked: 10, sold: 8 }), item("B", { restocked: 4, sold: 9, removed: 1 }), item("C", { sold: 3 })];
  OPENING = [item("B", { period: "2026-06", recorded_closing_balance: 0 })];
  // 1ª chamada = movimentos de julho em diante; 2ª = contagem de junho.
  mockStock.mockImplementation((args: unknown) => {
    const a = args as { range: { start: string; end: string } };
    const items = a.range.start === "2026-06" ? OPENING : MOVEMENTS;
    return { data: { items }, isLoading: false, error: undefined, refetch: jest.fn() };
  });
});

describe("PendingDialog", () => {
  it("lista os produtos com saldo negativo desde julho, com o que olhar e sem afirmar causa", () => {
    render(<PendingDialog store={{ id: 1, name: "Ascenty ADM" }} endPeriod="2026-09" onClose={() => undefined} />);
    expect(screen.getByText(/Pendências de Ascenty ADM desde julho/)).toBeInTheDocument();
    expect(screen.getByText(/2 produtos/)).toBeInTheDocument();
    expect(screen.getByText(/9 unidades/)).toBeInTheDocument(); // B falta 6, C falta 3
    expect(screen.getByText("Produto B")).toBeInTheDocument();
    expect(screen.getByText("Vendeu sem nenhum abastecimento lançado")).toBeInTheDocument(); // C
    expect(screen.getByText(/Faltam 6 un\./)).toBeInTheDocument();
    expect(screen.getByText(/não diz o motivo e não altera os números/)).toBeInTheDocument();
  });

  it("sem pendências diz isso, em verde", () => {
    MOVEMENTS = [item("A", { restocked: 10, sold: 8 })];
    render(<PendingDialog store={{ id: 1, name: "Loja X" }} endPeriod="2026-09" onClose={() => undefined} />);
    expect(screen.getByText(/Nenhuma pendência desde julho/)).toBeInTheDocument();
  });

  it("período que termina antes de julho não é analisado", () => {
    render(<PendingDialog store={{ id: 1, name: "Loja X" }} endPeriod="2026-05" onClose={() => undefined} />);
    expect(screen.getByText(/termina antes de julho/)).toBeInTheDocument();
  });
});
