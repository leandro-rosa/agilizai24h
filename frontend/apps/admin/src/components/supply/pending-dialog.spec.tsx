import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";

import type { MonthItems, StockItem } from "@/lib/api/inventory";

const item = (sku: string, period: string, over: Partial<StockItem> = {}): StockItem => ({
  store_id: 1, sku, period, restocked: 0, sold: 0, removed: 0, adjustment: 0, closing_stock: 0, inconsistent: false, recorded_closing_balance: null, ...over,
});

jest.doMock("../../lib/api/products", () => ({ useGetProductsQuery: () => ({ data: [{ sku: "100114", name: "Sprite zero" }, { sku: "B", name: "Produto B" }, { sku: "S", name: "Produto S" }] }) }));

type Props = { store: { id: number; name: string } | null; endPeriod: string; months: MonthItems[] | undefined; isLoading: boolean; error: undefined; onRetry: () => void; onClose: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PendingDialog }: { PendingDialog: ComponentType<Props> } = require("./pending-dialog");

const base = (months: MonthItems[], endPeriod = "2026-09"): Props => ({ store: { id: 17, name: "Plena Saude - Franco da Rocha" }, endPeriod, months, isLoading: false, error: undefined, onRetry: () => undefined, onClose: () => undefined });

const MONTHS: MonthItems[] = [
  { period: "2026-06", items: [] },
  { period: "2026-07", items: [item("B", "2026-07", { sold: 4, recorded_closing_balance: 0 })] }, // pendente em julho
  { period: "2026-08", items: [item("S", "2026-08", { restocked: 18, sold: 15, recorded_closing_balance: 3 })] },
  { period: "2026-09", items: [item("S", "2026-09", { sold: 3, recorded_closing_balance: 0 }), item("100114", "2026-09", { sold: 15, recorded_closing_balance: 5 })] },
];

describe("PendingDialog (mês a mês)", () => {
  it("setembro: o produto coberto pelo estoque do mês anterior NÃO aparece; o Sprite Zero aparece como entrada não lançada", () => {
    render(<PendingDialog {...base(MONTHS)} />);
    expect(screen.getByText(/Pendências de Plena Saude - Franco da Rocha em setembro/)).toBeInTheDocument();
    expect(screen.getByText("Sprite zero")).toBeInTheDocument();
    expect(screen.queryByText("Produto S")).not.toBeInTheDocument(); // 3 sobraram de agosto e vendeu 3
    expect(screen.getByText(/faltam ~20 un\. de entrada lançada/)).toBeInTheDocument();
    expect(screen.getByText(/1 de 2 produtos/)).toBeInTheDocument();
    expect(screen.getByText(/não diz o motivo e não altera os números/)).toBeInTheDocument();
  });

  it("mostra a tendência jul → ago → set e troca de mês pelas abas", () => {
    render(<PendingDialog {...base(MONTHS)} />);
    expect(screen.getByText(/jul 1 → ago 0 → set 1/)).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "julho" }), { button: 0 });
    expect(screen.getByText("Produto B")).toBeInTheDocument();
    expect(screen.getByText(/Saíram 4 e só havia 0 do mês anterior/)).toBeInTheDocument();
  });

  it("mês sem registro não vira 'sem pendências'", () => {
    render(<PendingDialog {...base([{ period: "2026-06", items: [] }])} />);
    expect(screen.getByText(/Nenhum registro de estoque de setembro/)).toBeInTheDocument();
  });

  it("período que termina antes de julho não é analisado", () => {
    render(<PendingDialog {...base(MONTHS, "2026-05")} />);
    expect(screen.getByText(/termina antes de julho/)).toBeInTheDocument();
  });
});
