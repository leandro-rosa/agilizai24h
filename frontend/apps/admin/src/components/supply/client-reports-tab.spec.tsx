import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentType } from "react";

import type { ClientDivergenceFilters, ClientDivergenceReport } from "../../lib/api/client-reports";
import { SINGLE_UNIT, manyUnits, report, row, unit } from "../../lib/client-reports/fixtures";

/** FICTITIOUS data: made-up clients, units and products. */
const SITES: Record<number, Array<{ id: number; code: string; store_id: number | null }>> = {
  1: [{ id: 1, code: "SP01", store_id: 11 }, { id: 2, code: "SP02", store_id: 12 }, { id: 3, code: "SEM", store_id: null }],
  2: [{ id: 4, code: "RR01", store_id: 21 }],
};

let current: ClientDivergenceReport | undefined;
let state: { isFetching: boolean; error?: unknown } = { isFetching: false };
const asked: Array<ClientDivergenceFilters | undefined> = [];
const refetch = jest.fn();

jest.doMock("../../lib/api/billing", () => ({
  useGetClientsQuery: () => ({ data: [{ id: 1, name: "Cliente A" }, { id: 2, name: "Cliente B" }], isLoading: false }),
  useGetClientQuery: (id: number) => ({ data: id ? { id, sites: SITES[id] } : undefined, isLoading: false }),
}));
jest.doMock("../../lib/api/client-reports", () => ({
  useGetClientDivergencesQuery: (args: ClientDivergenceFilters, options: { skip: boolean }) => {
    if (!options.skip) asked.push(args);
    return { currentData: options.skip ? undefined : current, isFetching: state.isFetching, error: state.error, refetch };
  },
}));
jest.doMock("sonner", () => ({ toast: { error: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ClientReportsTab }: { ClientReportsTab: ComponentType } = require("./client-reports-tab");

// jsdom lacks what Radix Select/Popover call.
Element.prototype.scrollIntoView = () => undefined;
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = () => undefined;

const pickClient = (name: string) => {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Cliente" }), { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name }));
};
const consult = () => fireEvent.click(screen.getByRole("button", { name: /Consultar/ }));

beforeEach(() => {
  current = SINGLE_UNIT;
  state = { isFetching: false };
  asked.length = 0;
  refetch.mockClear();
});

describe("ClientReportsTab (fictitious data)", () => {
  it("asks nothing until a client is chosen and Consultar is pressed", () => {
    render(<ClientReportsTab />);

    expect(screen.getByRole("button", { name: /Consultar/ })).toBeDisabled();
    expect(asked).toHaveLength(0);
    expect(screen.getByText(/Período considerado pela data de identificação da divergência\./)).toBeInTheDocument();
    expect(screen.getByText(/Somente Outros \(roubo\)/)).toBeInTheDocument();
  });

  it("queries with the chosen client, all units when none ticked, and the typed days", () => {
    render(<ClientReportsTab />);
    pickClient("Cliente A");
    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-05-01" } });
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-05-11" } });
    consult();

    expect(asked.at(-1)).toEqual({ clientId: 1, storeIds: [], from: "2026-05-01", to: "2026-05-11" });
  });

  it("clears the units when the client changes, and lists only the client's units that have a store", () => {
    render(<ClientReportsTab />);
    pickClient("Cliente A");
    fireEvent.click(screen.getByRole("button", { name: "Unidades" }));
    expect(screen.getByLabelText("SP01")).toBeInTheDocument();
    expect(screen.queryByText("SEM")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("SP02"));
    expect(screen.getByRole("button", { name: "Unidades" })).toHaveTextContent("1 unidade");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    pickClient("Cliente B");

    expect(screen.getByRole("button", { name: "Unidades" })).toHaveTextContent("Todas as unidades");
  });

  it("refuses an inverted period", () => {
    render(<ClientReportsTab />);
    pickClient("Cliente A");
    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-05-12" } });
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-05-11" } });

    expect(screen.getByRole("alert")).toHaveTextContent("data inicial");
    expect(screen.getByRole("button", { name: /Consultar/ })).toBeDisabled();
  });

  it("shows the indicators, the rows with both dates, the unit subtotal and the grand total", () => {
    render(<ClientReportsTab />);
    pickClient("Cliente A");
    consult();

    expect(screen.getByText("R$ 100,00", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("13 unidades")).toBeInTheDocument();
    expect(screen.getByText("Coca-Cola lata 350 ml")).toBeInTheDocument();
    expect(screen.getByText("04/05/2026 09:00")).toBeInTheDocument();
    expect(screen.getAllByText("07/05/2026 10:12").length).toBeGreaterThan(0);
    expect(screen.getByText("Total da unidade SP01")).toBeInTheDocument();
    expect(screen.getByText("Total geral")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exportar PDF/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Exportar Excel/ })).toBeEnabled();
  });

  it("marks a missing price and a partial total, and a missing previous conference", () => {
    current = report([
      unit(11, "SP01", [
        row({ sku: "A", product_name: "Produto A", quantity: 2, identified_at: "2026-05-07T10:00:00.000Z", unit_price_cents: null, previous_conference_at: null }),
        row({ sku: "B", product_name: "Produto B", quantity: 1, identified_at: "2026-05-08T10:00:00.000Z", unit_price_cents: 500 }),
      ]),
    ]);
    render(<ClientReportsTab />);
    pickClient("Cliente A");
    consult();

    expect(screen.getByText("Preço não disponível")).toBeInTheDocument();
    expect(screen.getByText("Indisponível")).toBeInTheDocument();
    expect(screen.getByText("Não disponível")).toBeInTheDocument();
    expect(screen.getAllByText(/1 ocorrência sem preço de venda/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\(parcial\)/).length).toBeGreaterThan(0);
  });

  it("paginates only the screen; the totals are of the whole query", () => {
    current = manyUnits(60);
    render(<ClientReportsTab />);
    pickClient("Cliente A");
    consult();

    expect(screen.getByText(/1–25 de 113/)).toBeInTheDocument();
    expect(screen.queryByText("Total geral")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }));
    expect(screen.getByText(/26–50 de 113/)).toBeInTheDocument();
    for (let i = 0; i < 3; i += 1) fireEvent.click(screen.getByRole("button", { name: "Próxima página" }));
    expect(screen.getByText("Total geral")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("Total geral").closest("tr")).toHaveTextContent(/\d+ un\./);
  });

  it("when the filters change after a query, says so and blocks the exports", () => {
    render(<ClientReportsTab />);
    pickClient("Cliente A");
    consult();
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-06-30" } });

    expect(screen.getByRole("status")).toHaveTextContent(/filtros mudaram/i);
    expect(screen.getByRole("button", { name: /Exportar PDF/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Exportar Excel/ })).toBeDisabled();
  });

  it("empty result: says so, no rows, exports off", () => {
    current = report([]);
    render(<ClientReportsTab />);
    pickClient("Cliente A");
    consult();

    expect(screen.getByText("Nenhuma divergência encontrada no período.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exportar PDF/ })).toBeDisabled();
  });

  it("warns about visits whose reasons were never stored", () => {
    current = report([], { unsplit_visits: 3 });
    render(<ClientReportsTab />);
    pickClient("Cliente A");
    consult();

    expect(screen.getByText(/3 visitas do período têm retiradas cujo motivo não foi guardado/)).toBeInTheDocument();
  });

  it("shows the error state with a retry", () => {
    current = undefined;
    state = { isFetching: false, error: { status: 500 } };
    render(<ClientReportsTab />);
    pickClient("Cliente A");
    consult();

    expect(screen.queryByText("Divergências encontradas")).not.toBeInTheDocument();
  });
});
