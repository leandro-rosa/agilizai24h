import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";

const figure = (value: number) => ({ available: true, value });
jest.doMock("../../lib/api/supplier-analysis", () => ({
  useGetSupplierAnalysisQuery: (args: { supplierId: number }, options: { skip?: boolean }) =>
    options.skip ? { data: undefined } : { data: { totals: { current: { purchasedCents: figure(args.supplierId * 1000), restocked: figure(50), sold: figure(40), lossCents: figure(300) } } } },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SuppliersOverview }: { SuppliersOverview: ComponentType<{ suppliers: { id: number; label: string }[]; base: unknown; onSelect: (id: number) => void }> } = require("./suppliers-overview");

describe("SuppliersOverview", () => {
  it("lista cada fornecedor com os números do período e abre o escolhido", () => {
    const onSelect = jest.fn();
    render(<SuppliersOverview suppliers={[{ id: 5, label: "Quinoa" }, { id: 6, label: "Ollie" }]} base={{ fromDate: "2026-09-01", toDate: "2026-09-30", compareTo: "prev_month" }} onSelect={onSelect} />);

    expect(screen.getByText("Quinoa")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Quinoa" }));
    expect(onSelect).toHaveBeenCalledWith(5);
  });

  it("sem fornecedores na categoria, diz isso em vez de ficar em branco", () => {
    render(<SuppliersOverview suppliers={[]} base={{ fromDate: "2026-09-01", toDate: "2026-09-30", compareTo: "prev_month" }} onSelect={jest.fn()} />);
    expect(screen.getByText(/Nenhum fornecedor com produtos vinculados/)).toBeInTheDocument();
  });
});
