import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";

const updateItem = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const confirmSettlement = jest.fn((arg: unknown) => ({ unwrap: async () => ({ ...settlement, state: "confirmed", counts_as_owed: true, partial: false, _arg: arg }) }));
const propose = jest.fn((_arg: unknown) => ({ unwrap: async () => settlement }));

const line = { itemId: 1, sku: "Q1", unitCostCents: 500, delivered: 100, openBefore: 100, sold: 62, expired: 8, returned: 0, unsold: 30, owedUnits: 62, owedCents: 31000, writeOffCapped: false };
let settlement: Record<string, unknown> = {
  id: 7,
  supplier_id: 5,
  supplier_name: "Quinoa",
  week_start: "2026-10-05",
  week_end: "2026-10-11",
  state: "proposal",
  counts_as_owed: false,
  owed_cents: 31000,
  partial: false,
  evidence: { lines: [line], soldNotCovered: {}, quality: { salesUnknown: false, monthsWithoutDatedReceipts: [], storesMissing: 0 }, formula: "devido = unidades vendidas × custo unitário" },
  confirmed_at: null,
  paid_on: null,
  payment_note: null,
};

const PURCHASE = {
  id: 1, supplier_id: 5, supplier_name: "Quinoa", ordered_on: "2026-10-05", origin: "manual", invoice_number: null, invoice_key: null, notes: null, paid_cents: 0, on_sale_cents: 50000, bonus_units: 12,
  items: [
    { id: 11, sku: "Q1", description: "Wrap", quantity: 100, unit_cost_cents: 500, condition: "on_sale", payment_status: "pending", paid_on: null, payment_note: null, total_cents: 50000 },
    { id: 12, sku: "Q2", description: "Barra", quantity: 12, unit_cost_cents: 0, condition: "bonus", payment_status: "pending", paid_on: null, payment_note: null, total_cents: 0 },
    { id: 13, sku: "Q3", description: "Cookie", quantity: 10, unit_cost_cents: 300, condition: "paid", payment_status: "pending", paid_on: null, payment_note: null, total_cents: 3000 },
  ],
};

jest.doMock("../../lib/api/purchases", () => ({
  useUpdatePurchaseItemMutation: () => [updateItem],
  useGetPurchasesQuery: () => ({ data: [{ ...PURCHASE }] }),
  useGetSettlementsQuery: () => ({ data: [settlement] }),
  useGetOpenTotalQuery: () => ({ data: { confirmed_cents: 12000, proposals: 1 } }),
  useProposeSettlementMutation: () => [propose, { isLoading: false }],
  useConfirmSettlementMutation: () => [confirmSettlement, { isLoading: false }],
  usePaySettlementMutation: () => [jest.fn(), { isLoading: false }],
}));
jest.doMock("../../lib/api/products", () => ({ useGetProductsQuery: () => ({ data: [{ sku: "Q1", name: "Wrap de quinoa" }, { sku: "Q2", name: "Barra" }, { sku: "Q3", name: "Cookie" }] }) }));
jest.doMock("../../lib/hooks", () => ({ useAppDispatch: () => jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PurchasesTable }: { PurchasesTable: ComponentType<{ purchases: unknown[] }> } = require("./purchases-table");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SettlementScreen }: { SettlementScreen: ComponentType } = require("./settlement-screen");

describe("PurchasesTable", () => {
  beforeEach(() => jest.clearAllMocks());

  it("separa pago, consignado e bonificação: bonificação não é gasto e o valor dela é só referência", () => {
    render(<PurchasesTable purchases={[PURCHASE]} />);

    expect(screen.getByText("12 un.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver itens" }));
    expect(screen.getByText("Pago no acerto semanal")).toBeInTheDocument();
    expect(screen.getByText("Não deve nada")).toBeInTheDocument();
    expect(screen.getAllByText("Pendente")).toHaveLength(1);
  });

  it("marca um item pago como pago, e só ele (consignado e bonificação não têm esse botão)", () => {
    render(<PurchasesTable purchases={[PURCHASE]} />);
    fireEvent.click(screen.getByRole("button", { name: "Ver itens" }));
    fireEvent.click(screen.getByRole("button", { name: "Marcar como pago" }));

    expect(updateItem).toHaveBeenCalledWith({ itemId: 13, changes: { payment_status: "paid" } });
    expect(screen.getAllByRole("button", { name: "Marcar como pago" })).toHaveLength(1);
  });

  it("não inventa linhas quando não há compra", () => {
    render(<PurchasesTable purchases={[]} />);

    expect(screen.getByText("Nenhuma compra registrada ainda.")).toBeInTheDocument();
  });
});

describe("SettlementScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settlement = { ...settlement, state: "proposal", partial: false, counts_as_owed: false };
  });

  const openFirst = () => fireEvent.click(screen.getAllByRole("button", { name: "Abrir" })[0]);

  it("mostra a proposta com a evidência e deixa claro que ainda não é devido", () => {
    render(<SettlementScreen />);
    openFirst();

    expect(screen.getAllByText(/Proposta \(ainda não é devido\)/).length).toBe(2); // cabeçalho do acerto e histórico
    expect(screen.getAllByText("R$ 310,00").length).toBeGreaterThan(0);
    expect(screen.getByText("Wrap de quinoa")).toBeInTheDocument();
    expect(screen.getByText(/Conta: devido = unidades vendidas × custo unitário/)).toBeInTheDocument();
    expect(screen.getByText("R$ 120,00")).toBeInTheDocument(); // total a pagar (confirmados)
  });

  it("confirma a proposta completa", () => {
    render(<SettlementScreen />);
    openFirst();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar acerto" }));

    expect(confirmSettlement).toHaveBeenCalledWith({ id: 7, accept_partial: false });
  });

  it("uma semana parcial avisa o motivo e só confirma depois de a pessoa assumir o número", () => {
    settlement = {
      ...settlement,
      partial: true,
      owed_cents: 0,
      evidence: { ...(settlement.evidence as object), lines: [{ ...line, sold: 0, owedUnits: 0, owedCents: 0 }], quality: { salesUnknown: true, monthsWithoutDatedReceipts: ["2026-07"], storesMissing: 0 } },
    };
    render(<SettlementScreen />);
    openFirst();

    expect(screen.getByTestId("partial-warning")).toHaveTextContent("Sem recibos com data em 2026-07");
    const confirmButton = screen.getByRole("button", { name: "Confirmar acerto" });
    expect(confirmButton).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Confirmar mesmo parcial/));
    expect(confirmButton).toBeEnabled();
  });

  it("recalcula enviando os vencidos informados pela pessoa", () => {
    render(<SettlementScreen />);
    openFirst();
    fireEvent.change(screen.getByLabelText("Vencido de Wrap de quinoa"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Recalcular proposta" }));

    expect(propose).toHaveBeenCalledWith({ supplier_id: 5, week_start: "2026-10-05", write_offs: [{ item_id: 1, expired: 10, returned: 0 }] });
  });
});
