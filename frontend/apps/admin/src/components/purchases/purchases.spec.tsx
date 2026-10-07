import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

const updateItem = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const confirmSettlement = jest.fn((arg: unknown) => ({ unwrap: async () => ({ ...settlement, state: "confirmed", counts_as_owed: true, partial: false, _arg: arg }) }));
const retryCostSync = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const resolveLine = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const addEan = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
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

const PRODUCTS = [{ id: 1, sku: "Q1", name: "Wrap de quinoa" }, { id: 2, sku: "Q2", name: "Barra" }, { id: 3, sku: "Q3", name: "Cookie" }];

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
  useRetryCostSyncMutation: () => [retryCostSync, { isLoading: false }],
  useResolvePendingLineMutation: () => [resolveLine, { isLoading: false }],
  useGetPurchasesQuery: () => ({ data: [{ ...PURCHASE }] }),
  useGetSettlementsQuery: () => ({ data: [settlement] }),
  useGetOpenTotalQuery: () => ({ data: { confirmed_cents: 12000, proposals: 1 } }),
  useProposeSettlementMutation: () => [propose, { isLoading: false }],
  useConfirmSettlementMutation: () => [confirmSettlement, { isLoading: false }],
  usePaySettlementMutation: () => [jest.fn(), { isLoading: false }],
}));
jest.doMock("../../lib/api/products", () => ({
  useGetProductsQuery: () => ({ data: PRODUCTS }),
  useAddProductEanMutation: () => [addEan, { isLoading: false }],
  useGetNextSkuQuery: () => ({ data: { suggested: "110024" }, isSuccess: true }),
  useCreateProductFromInvoiceMutation: () => [jest.fn(), { isLoading: false }],
}));
jest.doMock("../../lib/api/pricing", () => ({ useGetNewProductSuggestionQuery: () => ({ isLoading: true }), useChooseNewProductPriceMutation: () => [jest.fn(), { isLoading: false }] }));
jest.doMock("../../lib/auth/use-permission", () => ({ useHasPermission: () => true }));
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

const sync = (over: Record<string, unknown> = {}) => ({ state: "synced", attempts: 1, synced_at: "2026-10-10T12:00:00Z", error: null, version_id: 5, previous_cost_cents: 570, variation_bps: 877, alerts: [], ...over });
const withSync = (...syncs: Record<string, unknown>[]) => ({ ...PURCHASE, items: PURCHASE.items.map((item, index) => ({ ...item, cost_sync: syncs[index] })) });

describe("PurchasesTable — o custo da nota no produto", () => {
  beforeEach(() => jest.clearAllMocks());
  const expand = () => fireEvent.click(screen.getByRole("button", { name: "Ver itens" }));

  it("compra ainda não recebida diz que o custo vai quando for recebida; brinde nunca cria custo", () => {
    render(<PurchasesTable purchases={[withSync(sync({ state: null }), sync({ state: "skipped_bonus" }), sync({ state: null }))]} />);
    expand();

    expect(screen.getAllByText("Quando a compra for recebida")).toHaveLength(2);
    expect(screen.getByText("Bonificação: não cria custo")).toBeInTheDocument();
  });

  it("mostra o custo criado com o valor anterior e a variação, e o aviso de mês fechado", () => {
    render(<PurchasesTable purchases={[withSync(sync({ alerts: ["large_variation", "closed_month"] }), sync({ state: "skipped_bonus" }), sync({ state: "unchanged", previous_cost_cents: 300, variation_bps: 0 }))]} />);
    expand();

    expect(screen.getByText("Custo criado")).toBeInTheDocument();
    expect(screen.getByText("antes R$ 5,70 (+8,8%)")).toBeInTheDocument();
    expect(screen.getByText("Variação grande")).toBeInTheDocument();
    expect(screen.getByText(/Mês já fechado: o CMV dele não é recalculado sozinho/)).toBeInTheDocument();
    expect(screen.getByText("Igual ao custo vigente")).toBeInTheDocument();
  });

  it("uma falha fica visível com o erro e dá para reenviar", () => {
    render(<PurchasesTable purchases={[withSync(sync({ state: "failed", error: "products respondeu 503" }), sync({ state: "skipped_bonus" }), sync())]} />);
    expand();

    expect(screen.getByText("Falhou")).toBeInTheDocument();
    expect(screen.getByText("products respondeu 503")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reenviar" }));
    expect(retryCostSync).toHaveBeenCalledWith(1);
  });
});

/** cmdk (o seletor de produto) e o Radix pedem APIs que o jsdom não tem. */
function polyfillCombobox() {
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.setPointerCapture = () => undefined;
  proto.releasePointerCapture = () => undefined;
  proto.scrollIntoView = () => undefined;
}

describe("PurchasesTable — aguardando cadastro de produto", () => {
  const pending = (over: Record<string, unknown> = {}) => ({ id: 41, description: "Novo sabor de marmita", ean: "7891000100103", supplier_code: "FORN-77", quantity: 20, unit_cost_cents: 850, condition: "paid", pack_quantity: null, pack_unit_price_cents: null, units_per_pack: null, purchase_unit: null, status: "pending", sku: null, item_id: null, resolved_at: null, resolved_by: null, total_cents: 17000, ...over });
  const purchase = (lines: unknown[]) => ({ ...PURCHASE, invoice_number: "13021", status: "received", pending_lines: lines, awaiting_product_registration: (lines as { status: string }[]).filter((l) => l.status === "pending").length });

  beforeEach(() => {
    jest.clearAllMocks();
    polyfillCombobox();
  });

  it("mostra a etiqueta com quantas linhas faltam e abre a lista com a linha inteira", () => {
    render(<PurchasesTable purchases={[purchase([pending()])]} />);
    fireEvent.click(screen.getByRole("button", { name: "Resolver linhas pendentes do pedido 1" }));

    expect(screen.getByRole("heading", { name: "Aguardando cadastro de produto" })).toBeInTheDocument();
    expect(screen.getByText("Novo sabor de marmita")).toBeInTheDocument();
    expect(screen.getByText(/20 un\. × R\$\s8,50 = R\$\s170,00 · EAN 7891000100103 · cód\. do fornecedor FORN-77/)).toBeInTheDocument();
  });

  it("sem linha pendente não há etiqueta", () => {
    render(<PurchasesTable purchases={[purchase([pending({ status: "resolved", sku: "Q1" })])]} />);

    expect(screen.queryByRole("button", { name: /Resolver linhas pendentes/ })).not.toBeInTheDocument();
  });

  it("escolher um produto e usá-lo resolve a linha só com o SKU, sem vincular EAN", async () => {
    render(<PurchasesTable purchases={[purchase([pending()])]} />);
    fireEvent.click(screen.getByRole("button", { name: "Resolver linhas pendentes do pedido 1" }));
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("Wrap de quinoa (Q1)"));
    fireEvent.click(screen.getByRole("button", { name: "Usar este produto" }));

    await waitFor(() => expect(resolveLine).toHaveBeenCalledTimes(1));
    expect(resolveLine).toHaveBeenCalledWith({ id: 1, lineId: 41, sku: "Q1" });
    expect(addEan).not.toHaveBeenCalled();
  });

  it("'Vincular EAN e usar' vincula o EAN da linha ao produto escolhido e depois resolve", async () => {
    render(<PurchasesTable purchases={[purchase([pending()])]} />);
    fireEvent.click(screen.getByRole("button", { name: "Resolver linhas pendentes do pedido 1" }));
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("Wrap de quinoa (Q1)"));
    fireEvent.click(screen.getByRole("button", { name: "Vincular EAN e usar" }));

    await waitFor(() => expect(resolveLine).toHaveBeenCalledTimes(1));
    expect(addEan).toHaveBeenCalledWith(expect.objectContaining({ productId: 1, ean: "7891000100103" }));
  });

  it("uma linha resolvida mostra o produto em que virou e não oferece nova escolha", () => {
    render(<PurchasesTable purchases={[purchase([pending({ status: "resolved", sku: "Q1", item_id: 50 }), pending({ id: 42, description: "Outra" })])]} />);
    fireEvent.click(screen.getByRole("button", { name: "Resolver linhas pendentes do pedido 1" }));

    expect(screen.getByText("Virou o produto Q1.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Usar este produto" })).toHaveLength(1);
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
