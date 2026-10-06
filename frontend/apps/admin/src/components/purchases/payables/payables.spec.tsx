import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

const pay = jest.fn((_arg: unknown) => ({ unwrap: async () => ({ paid_items: 2, paid_cents: 3000 }) }));
const undo = jest.fn((_arg: unknown) => ({ unwrap: async () => ({ reopened_items: 1 }) }));
jest.doMock("../../../lib/api/purchases", () => ({
  usePayOrdersMutation: () => [pay, { isLoading: false }],
  useUndoPaymentMutation: () => [undo],
}));

const order = (id: number, over: Record<string, unknown> = {}) => ({
  purchase_id: id, supplier_id: id, supplier_name: `Fornecedor ${id}`, invoice_number: `NF${id}`, status: "invoiced", form: "boleto", due_on: "2026-10-15", estimated: false,
  state: "upcoming", open_cents: 1000 * id, paid_cents: 0, paid_on: null, items: [{ item_id: id, sku: `S${id}`, description: `Produto ${id}`, quantity: 5, total_cents: 1000 * id, payment_status: "pending", paid_on: null }], ...over,
});
const ORDERS = [order(1, { state: "overdue", due_on: "2026-10-05" }), order(2), order(3, { form: "on_delivery", state: "on_delivery", estimated: true }), order(4, { state: "paid", paid_on: "2026-10-08", paid_cents: 4000, open_cents: 0 })];

type Filters = { state: string; supplier: string; form: string; search: string; ids: number[] | null; idsLabel: string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OrdersTable, NO_FILTERS, applyFilters }: { OrdersTable: ComponentType<Record<string, unknown>>; NO_FILTERS: Filters; applyFilters: (o: unknown[], f: Filters) => { purchase_id: number }[] } = require("./orders-table");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PayDialog }: { PayDialog: ComponentType<Record<string, unknown>> } = require("./pay-dialog");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Reconciliation }: { Reconciliation: ComponentType<Record<string, unknown>> } = require("./reconciliation");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SummaryCards }: { SummaryCards: ComponentType<Record<string, unknown>> } = require("./summary-cards");

describe("applyFilters", () => {
  it("recorta por status, fornecedor, forma, busca (nome, NF, produto) e pelos pedidos de um alerta", () => {
    const ids = (f: Partial<Filters>) => applyFilters(ORDERS, { ...NO_FILTERS, ...f }).map((o) => o.purchase_id);

    expect(ids({})).toEqual([1, 2, 3, 4]);
    expect(ids({ state: "overdue" })).toEqual([1]);
    expect(ids({ supplier: "2" })).toEqual([2]);
    expect(ids({ form: "on_delivery" })).toEqual([3]);
    expect(ids({ search: "nf4" })).toEqual([4]);
    expect(ids({ search: "produto 2" })).toEqual([2]);
    expect(ids({ ids: [2, 3] })).toEqual([2, 3]);
  });
});

describe("OrdersTable", () => {
  beforeEach(() => jest.clearAllMocks());

  function setup(filters = NO_FILTERS) {
    const onFilters = jest.fn();
    const onPay = jest.fn();
    render(<OrdersTable orders={ORDERS} filters={filters} onFilters={onFilters} onPay={onPay} />);

    return { onFilters, onPay };
  }

  it("mostra a situação de cada conta e marca a entrega prevista como estimativa", () => {
    setup();

    expect(screen.getByTestId("payable-1")).toHaveTextContent("Vencido");
    expect(screen.getByTestId("payable-3")).toHaveTextContent("(previsto)");
    expect(screen.getByTestId("payable-4")).toHaveTextContent("Pago");
  });

  it("dar baixa abre o pagamento do pedido; pago oferece desfazer", async () => {
    const { onPay } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Dar baixa no pedido 2" }));
    expect(onPay).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByRole("button", { name: "Desfazer pagamento do pedido 4" }));
    await waitFor(() => expect(undo).toHaveBeenCalledWith({ purchase_ids: [4] }));
  });

  it("a busca atualiza o filtro e 'Limpar filtros' só aparece com algum filtro ativo", () => {
    const { onFilters } = setup();
    expect(screen.queryByRole("button", { name: /Limpar filtros/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "quinoa" } });
    expect(onFilters).toHaveBeenCalledWith(expect.objectContaining({ search: "quinoa" }));

    render(<OrdersTable orders={ORDERS} filters={{ ...NO_FILTERS, search: "x" }} onFilters={onFilters} onPay={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Limpar filtros/ }));
    expect(onFilters).toHaveBeenLastCalledWith(NO_FILTERS);
  });

  it("filtro sem resultado diz isso", () => {
    setup({ ...NO_FILTERS, search: "nada disso" });
    expect(screen.getByText("Nenhuma conta com esses filtros.")).toBeInTheDocument();
  });
});

describe("PayDialog", () => {
  beforeEach(() => jest.clearAllMocks());

  it("registra o pagamento dos pedidos escolhidos, com a data, e soma o total", async () => {
    render(<PayDialog candidates={ORDERS} preselected={[1, 2]} open onOpenChange={jest.fn()} />);

    expect(screen.getByText(/Total: R\$\s30,00/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Pagar pedido 4")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Registrar pagamento" }));

    await waitFor(() => expect(pay).toHaveBeenCalledTimes(1));
    expect(pay.mock.calls[0][0]).toMatchObject({ purchase_ids: [1, 2] });
  });

  it("sem pedido escolhido o botão fica desabilitado", () => {
    render(<PayDialog candidates={ORDERS} preselected={[]} open onOpenChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Registrar pagamento" })).toBeDisabled();
  });
});

describe("Reconciliation", () => {
  const data = {
    funnel: { orders: 6, invoiced: 5, received: 3, paid: 2 },
    received_without_payment: { count: 2, cents: 5000, purchase_ids: [1, 2] },
    paid_without_invoice: { count: 1, purchase_ids: [4] },
    awaiting_receipt: { count: 3, purchase_ids: [3, 5, 6] },
    awaiting_invoice: { count: 0, purchase_ids: [] },
  };

  it("mostra o funil e os avisos; clicar num aviso recorta a tabela nos pedidos dele", () => {
    const onShow = jest.fn();
    render(<Reconciliation data={data} onShow={onShow} />);

    expect(screen.getByText(/2 notas recebidas ainda não têm pagamento registrado/)).toBeInTheDocument();
    expect(screen.getByText(/1 pagamento registrado sem NF vinculada/)).toBeInTheDocument();
    expect(screen.getByText(/3 pedidos aguardam recebimento/)).toBeInTheDocument();
    expect(screen.queryByText(/aguardam faturamento/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/3 pedidos aguardam recebimento/));
    expect(onShow).toHaveBeenCalledWith([3, 5, 6], expect.stringContaining("aguardam recebimento"));
  });

  it("sem pendência diz que está em dia", () => {
    render(<Reconciliation data={{ ...data, received_without_payment: { count: 0, cents: 0, purchase_ids: [] }, paid_without_invoice: { count: 0, purchase_ids: [] }, awaiting_receipt: { count: 0, purchase_ids: [] } }} onShow={jest.fn()} />);
    expect(screen.getByText(/Tudo em dia/)).toBeInTheDocument();
  });
});

describe("SummaryCards", () => {
  it("mostra os seis números", () => {
    render(<SummaryCards summary={{ open_cents: 444390, open_orders: 15, overdue_cents: 0, overdue_orders: 0, due_7d_cents: 185000, due_7d_orders: 6, on_delivery_cents: 259390, on_delivery_orders: 5, paid_month_cents: 0, paid_month_orders: 0, forecast_month_cents: 444390 }} />);

    expect(screen.getByText("Total em aberto")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 4.443,90")).toHaveLength(2);
    expect(screen.getByText("R$ 1.850,00")).toBeInTheDocument();
    expect(screen.getByText("15 contas")).toBeInTheDocument();
    expect(screen.getByText("Aberto + Pago")).toBeInTheDocument();
  });
});
