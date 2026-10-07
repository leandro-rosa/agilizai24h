import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

const recordCost = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const recordPrice = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const addEan = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const updateEan = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));

const cost = (over: Record<string, unknown>) => ({ id: 1, effective_from: "2026-08-01T00:00:00.000Z", cost_cents: 570, valid_to: null, superseded: false, source: "catalogue_sync", actor: null, reason: null, supplier_id: null, purchase_id: null, invoice_number: null, purchase_quantity: null, purchase_total_cents: null, pack_quantity: null, units_per_pack: null, created_at: "2026-10-01T10:00:00.000Z", ...over });
let costs: unknown[] = [];
let prices: unknown[] = [];
let margins: unknown[] = [];
let events: unknown[] = [];

let purchases: unknown[] = [];
let analysisByMonth: Record<string, Record<string, unknown>> = {};
jest.doMock("../../lib/api/purchases", () => ({ useGetPurchasesQuery: () => ({ data: purchases, isLoading: false, isError: false }) }));
jest.doMock("../../lib/api/supplier-analysis", () => ({
  useGetProductAnalysisQuery: ({ fromDate }: { fromDate: string }) => {
    const movement = analysisByMonth[fromDate.slice(0, 7)];
    return movement ? { data: { totals: { current: movement } }, isLoading: false, isError: false } : { isLoading: false, isError: true };
  },
}));
jest.doMock("../../lib/api/products", () => ({
  useGetCategoriesQuery: () => ({ data: [{ id: 1, key: "meal", name: "Refeição", keywords: [], status: "active", products: 1, subcategories: [] }] }),
  useGetProductCostsQuery: () => ({ data: costs, isLoading: false, isError: false }),
  useGetProductPricesQuery: () => ({ data: prices, isLoading: false, isError: false }),
  useGetProductMarginsQuery: () => ({ data: { product_id: 2, history_available_from: "2026-08-01", intervals: margins }, isLoading: false }),
  useGetProductTimelineQuery: () => ({ data: { product_id: 2, history_available_from: "2026-08-01", events }, isLoading: false, isError: false }),
  useRecordCostMutation: () => [recordCost, { isLoading: false }],
  useRecordPriceMutation: () => [recordPrice, { isLoading: false }],
  useAddProductEanMutation: () => [addEan, { isLoading: false }],
  useUpdateProductEanMutation: () => [updateEan, { isLoading: false }],
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ProductDrawer }: { ProductDrawer: ComponentType<Record<string, unknown>> } = require("./product-drawer");

const product = {
  id: 2, sku: "110024", name: "Novo sabor de marmita", category: "meal", subcategory: "Marmitas", supplier_id: 5, status: "active", sale_unit: "un", brand: "Crystal", purchase_unit: "CX", units_per_package: 12, package_type: "caixa", fractionable: false,
  ean: "7891000100103",
  eans: [
    { id: 1, ean: "7891000100103", status: "active", is_primary: true, valid_from: "2026-10-10", valid_to: null, source: "invoice_import", actor: "ana@agiliz.ai", note: null },
    { id: 2, ean: "7891000100222", status: "active", is_primary: false, valid_from: null, valid_to: null, source: "manual", actor: null, note: "embalagem nova" },
    { id: 3, ean: "7890000000001", status: "inactive", is_primary: false, valid_from: null, valid_to: "2026-09-01", source: "manual", actor: null, note: null },
  ],
  origin: { type: "invoice", invoice_number: "13021", supplier_id: 5, purchase_id: 9, on: "2026-10-10", actor: "ana@agiliz.ai" },
};

// Só o relógio (Date) é falso: o "vigente hoje" da tela depende do dia, e o teste não pode depender de quando roda.
beforeAll(() => {
  jest.useFakeTimers({ now: new Date("2026-10-20T12:00:00Z"), doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "nextTick", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
});
afterAll(() => jest.useRealTimers());

const onTabChange = jest.fn();
const draw = (tab: string, over: Record<string, unknown> = {}) =>
  render(<ProductDrawer product={product} supplierName={(id: number | null) => (id === 5 ? "Juntos+" : null)} tab={tab} onTabChange={onTabChange} onClose={jest.fn()} canWrite onEdit={jest.fn()} {...over} />);

describe("ProductDrawer — visão geral", () => {
  beforeEach(() => jest.clearAllMocks());

  it("mostra a identificação, o fornecedor e de onde veio o cadastro", () => {
    draw("overview");

    expect(screen.getByText("Juntos+")).toBeInTheDocument();
    expect(screen.getByText("Marmitas")).toBeInTheDocument();
    expect(screen.getByText("12 un. por caixa")).toBeInTheDocument();
    expect(screen.getByText("Crystal")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir na Precificação" })).toHaveAttribute("href", "/products?view=pricing&sku=110024");
    expect(screen.getByTestId("origin")).toHaveTextContent("Cadastro originado de NF-e 13021 em 10/10/2026 por ana@agiliz.ai");
  });

  it("lista todos os EANs com situação, o principal marcado, e os inativos continuam visíveis", () => {
    draw("overview");

    expect(screen.getByText("7891000100103")).toBeInTheDocument();
    expect(screen.getByText("Principal")).toBeInTheDocument();
    const inactive = screen.getByText("7890000000001").closest("tr") as HTMLElement;
    expect(inactive).toHaveTextContent("Inativo");
    expect(inactive).toHaveTextContent("01/09/2026");
    expect(screen.getByText("embalagem nova")).toBeInTheDocument();
  });

  it("adiciona um EAN com observação e a opção de aposentar o atual", async () => {
    draw("overview");
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar EAN" }));
    fireEvent.change(screen.getByLabelText("Novo EAN"), { target: { value: "7891000100999" } });
    fireEvent.click(screen.getByLabelText(/Inativar o EAN atual/));
    fireEvent.click(screen.getByRole("button", { name: "Vincular EAN" }));

    await waitFor(() => expect(addEan).toHaveBeenCalledTimes(1));
    expect(addEan).toHaveBeenCalledWith({ productId: 2, ean: "7891000100999", note: undefined, make_primary: undefined, retire_current: true });
  });

  it("um EAN com menos de 8 dígitos não pode ser enviado", () => {
    draw("overview");
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar EAN" }));
    fireEvent.change(screen.getByLabelText("Novo EAN"), { target: { value: "123" } });

    expect(screen.getByRole("button", { name: "Vincular EAN" })).toBeDisabled();
  });

  it("torna principal e inativa, sem apagar", () => {
    draw("overview");
    fireEvent.click(screen.getByRole("button", { name: "Tornar principal" }));
    expect(updateEan).toHaveBeenCalledWith({ productId: 2, eanId: 2, primary: true });
    fireEvent.click(screen.getAllByRole("button", { name: "Inativar" })[0]);
    expect(updateEan).toHaveBeenCalledWith({ productId: 2, eanId: 1, status: "inactive" });
    expect(screen.queryByRole("button", { name: /Excluir|Apagar/ })).not.toBeInTheDocument();
  });

  it("sem permissão de escrita não há botões de alterar", () => {
    draw("overview", { canWrite: false });

    expect(screen.queryByRole("button", { name: "+ Adicionar EAN" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("um produto sem EAN diz isso, em vez de uma tabela vazia", () => {
    draw("overview", { product: { ...product, ean: null, eans: [] } });

    expect(screen.getByText("Este produto não tem código de barras cadastrado.")).toBeInTheDocument();
  });

  it("a carga inicial diz que a origem não foi registrada", () => {
    draw("overview", { product: { ...product, origin: { type: "legacy_import", invoice_number: null, supplier_id: null, purchase_id: null, on: null, actor: null } } });

    expect(screen.getByTestId("origin")).toHaveTextContent("Carga inicial — origem não registrada");
  });
});

describe("ProductDrawer — custos", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    costs = [
      cost({ id: 1, effective_from: "2026-08-01T00:00:00.000Z", cost_cents: 570, valid_to: "2026-10-09", source: "catalogue_sync" }),
      cost({ id: 2, effective_from: "2026-10-10T00:00:00.000Z", cost_cents: 620, source: "invoice", supplier_id: 5, purchase_id: 9, invoice_number: "13021", purchase_quantity: 150, purchase_total_cents: 93000, pack_quantity: 10, units_per_pack: 15, actor: null }),
      cost({ id: 3, effective_from: "2026-10-10T00:00:00.000Z", cost_cents: 600, source: "manual", superseded: true, actor: "ana@agiliz.ai", reason: "conferido" }),
    ];
  });

  it("separa o custo vigente, o último de compra, a média das compras e o do CMV, cada um com sua origem", () => {
    draw("costs");

    expect(screen.getByText("Custo vigente (o que a Precificação usa)")).toBeInTheDocument();
    expect(screen.getByText(/desde 10\/10\/2026 · Nota fiscal/)).toBeInTheDocument();
    expect(screen.getByText(/NF 13021 em 10\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/MÉTRICA DERIVADA: total pago ÷ 150 un\. em 1 compra/)).toBeInTheDocument();
    expect(screen.getByText(/o vigente no último dia do mês/)).toBeInTheDocument();
  });

  it("a tabela traz vigência com fim, origem, nota (com link), compra e usuário, e marca o substituído sem apagá-lo", () => {
    draw("costs");

    expect(screen.getByText(/Histórico disponível a partir de 01\/08\/2026/)).toBeInTheDocument();
    expect(screen.getByText("01/08/2026 → 09/10/2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "NF 13021" })).toHaveAttribute("href", "/purchases/invoices?purchase=9");
    expect(screen.getByText("150 un. por R$ 930,00")).toBeInTheDocument();
    expect(screen.getByText("10 emb. de 15 un.")).toBeInTheDocument();
    const superseded = screen.getByText("Substituído").closest("tr") as HTMLElement;
    expect(superseded).toHaveTextContent("R$ 6,00");
    expect(superseded).toHaveTextContent("ana@agiliz.ai");
    expect(superseded).toHaveTextContent("conferido");
  });

  it("um produto sem custo explica de onde ele vem, em vez de mostrar zero", () => {
    costs = [];
    draw("costs");

    expect(screen.getByText(/Este produto ainda não tem custo/)).toBeInTheDocument();
    expect(screen.queryByText("R$ 0,00")).not.toBeInTheDocument();
  });

  it("o novo custo exige valor, data e motivo, e é enviado como manual (sem origem nem usuário vindos daqui)", async () => {
    draw("costs");
    fireEvent.click(screen.getByRole("button", { name: "Novo custo" }));
    const submit = screen.getByRole("button", { name: "Registrar custo" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Novo custo"), { target: { value: "6,50" } });
    fireEvent.change(screen.getByLabelText("Vale a partir de"), { target: { value: "2026-10-15" } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivo da alteração"), { target: { value: "Reajuste do fornecedor" } });
    fireEvent.click(submit);

    await waitFor(() => expect(recordCost).toHaveBeenCalledTimes(1));
    expect(recordCost).toHaveBeenCalledWith({ sku: "110024", effective_from: "2026-10-15", cost_cents: 650, reason: "Reajuste do fornecedor" });
  });
});

describe("ProductDrawer — preços", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prices = [
      { id: 1, effective_from: "2026-01-01T00:00:00.000Z", price_cents: 1190, valid_to: "2026-09-30", superseded: false, source: "legacy_import", actor: null, reason: null, source_ref: null, created_at: "2026-10-01T10:00:00.000Z" },
      { id: 2, effective_from: "2026-10-01T00:00:00.000Z", price_cents: 1290, valid_to: null, superseded: false, source: "pricing_intelligence", actor: "ana@agiliz.ai", reason: "Preço sugerido aceito", source_ref: "d3adb33f-0000", created_at: "2026-10-01T10:00:00.000Z" },
    ];
    margins = [
      { from: "2026-01-01", to: "2026-09-30", price_cents: 1190, cost_cents: 570, margin: 0.521, markup: 2.09, price_source: "legacy_import", cost_source: "catalogue_sync", cost_invoice_number: null, cost_supplier_id: null, price_reason: null },
      { from: "2026-10-01", to: null, price_cents: 1290, cost_cents: 620, margin: 0.519, markup: 2.08, price_source: "pricing_intelligence", cost_source: "invoice", cost_invoice_number: "13021", cost_supplier_id: 5, price_reason: null },
    ];
  });

  it("mostra o preço vigente com a origem, a tabela de versões e a margem de cada período", () => {
    draw("prices");

    expect(screen.getByText(/Preço vigente:/)).toHaveTextContent("R$ 12,90 desde 01/10/2026 · Precificação Inteligente");
    expect(screen.getByText("decisão d3adb33f")).toBeInTheDocument();
    expect(screen.getByText("01/01/2026 → hoje".replace("01/01/2026", "01/10/2026"))).toBeInTheDocument();
    expect(screen.getByText("52,1%")).toBeInTheDocument();
    expect(screen.getByText("2,09×")).toBeInTheDocument();
  });

  it("um período sem custo mostra traço na margem, nunca zero", () => {
    margins = [{ from: "2026-10-01", to: null, price_cents: 1290, cost_cents: null, margin: null, markup: null, price_source: "manual", cost_source: null, cost_invoice_number: null, cost_supplier_id: null, price_reason: null }];
    draw("prices");

    expect(screen.queryByText("0,0%")).not.toBeInTheDocument();
  });

  it("o novo preço exige motivo e vai como manual", async () => {
    draw("prices");
    fireEvent.click(screen.getByRole("button", { name: "Novo preço" }));
    fireEvent.change(screen.getByLabelText("Novo preço"), { target: { value: "13,50" } });
    fireEvent.change(screen.getByLabelText("Motivo da alteração"), { target: { value: "Concorrente a 13,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar preço" }));

    await waitFor(() => expect(recordPrice).toHaveBeenCalledTimes(1));
    expect(recordPrice).toHaveBeenCalledWith(expect.objectContaining({ sku: "110024", price_cents: 1350, reason: "Concorrente a 13,50" }));
  });

  it("um preço de zero é recusado", () => {
    draw("prices");
    fireEvent.click(screen.getByRole("button", { name: "Novo preço" }));
    fireEvent.change(screen.getByLabelText("Novo preço"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Motivo da alteração"), { target: { value: "x" } });

    expect(screen.getByRole("button", { name: "Registrar preço" })).toBeDisabled();
  });
});

describe("ProductDrawer — histórico", () => {
  it("lista as mudanças de custo e de preço, do valor anterior ao novo, com origem, usuário e nota", () => {
    events = [
      { kind: "cost", date: "2026-10-10", value_cents: 620, previous_value_cents: 570, source: "invoice", actor: null, reason: null, superseded: false, recorded_at: "2026-10-10T12:00:00.000Z", supplier_id: 5, purchase_id: 9, invoice_number: "13021" },
      { kind: "price", date: "2026-08-01", value_cents: 1190, previous_value_cents: null, source: "legacy_import", actor: null, reason: null, superseded: false, recorded_at: "2026-10-01T10:00:00.000Z" },
    ];
    draw("history");

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("10/10/2026");
    expect(items[0]).toHaveTextContent("R$ 5,70 → R$ 6,20");
    expect(items[0]).toHaveTextContent("Nota fiscal · NF 13021 · Juntos+");
    expect(items[1]).toHaveTextContent("primeira versão → R$ 11,90");
    expect(screen.getByText(/Histórico disponível a partir de 01\/08\/2026/)).toBeInTheDocument();
  });

  it("sem alterações diz isso", () => {
    events = [];
    draw("history");

    expect(screen.getByText(/Ainda não houve nenhuma alteração/)).toBeInTheDocument();
  });
});

describe("ProductDrawer — abas", () => {
  it("trocar de aba avisa a página (que guarda a aba na URL)", () => {
    draw("overview");
    // O Radix Tabs ativa no pressionar do mouse, não no clique.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Custos" }), { button: 0 });

    expect(onTabChange).toHaveBeenCalledWith("costs");
  });
});

const fig = (value: number, partial = false) => ({ available: true, value, partial });
const gone = (reason: string) => ({ available: false, reason });
const movement = (over: Record<string, unknown> = {}) => ({ sold: fig(100), revenueCents: fig(129000), avgPriceCents: fig(1290), avgCostCents: fig(620), marginShare: fig(0.5194), markup: fig(2.08), ...over });

describe("ProductDrawer — margem", () => {
  beforeEach(() => {
    costs = [
      cost({ id: 1, effective_from: "2026-08-01T00:00:00.000Z", cost_cents: 570, source: "catalogue_sync" }),
      cost({ id: 2, effective_from: "2026-09-10T00:00:00.000Z", cost_cents: 620, source: "invoice" }),
    ];
    analysisByMonth = { "2026-09": movement(), "2026-08": movement({ marginShare: fig(0.559), avgCostCents: fig(570) }), "2026-07": movement({ sold: gone("never_ingested"), revenueCents: gone("never_ingested"), avgPriceCents: gone("never_ingested"), avgCostCents: gone("never_ingested"), marginShare: gone("never_ingested"), markup: gone("never_ingested") }) };
  });

  it("explica a base do CMV e mostra a margem de cada mês, lida da análise existente", () => {
    draw("margin");

    expect(screen.getByText(/Base do CMV: o custo vigente no último dia de cada mês/)).toBeInTheDocument();
    const september = screen.getByText("set/2026").closest("tr") as HTMLElement;
    expect(september).toHaveTextContent("51,9%");
    expect(september).toHaveTextContent("R$ 6,20");
    const august = screen.getByText("ago/2026").closest("tr") as HTMLElement;
    expect(august).toHaveTextContent("55,9%");
    expect(august).toHaveTextContent("R$ 5,70");
  });

  it("sinaliza o mês em que o custo mudou no meio, com o antes e o depois", () => {
    draw("margin");

    const september = screen.getByText("set/2026").closest("tr") as HTMLElement;
    expect(september).toHaveTextContent("Custo mudou em 10/09/2026: R$ 5,70 → R$ 6,20");
    expect(screen.getByText("ago/2026").closest("tr")).not.toHaveTextContent("Custo mudou");
  });

  it("um mês sem venda importada diz isso, nunca zero; um mês que falhou diz que falhou", () => {
    draw("margin");

    expect(screen.getByText("jul/2026").closest("tr")).toHaveTextContent("Dado não importado");
    expect(screen.getByText("jul/2026").closest("tr")).not.toHaveTextContent("0,0%");
    // Outubro/2026 ainda não é mês completo; os meses sem resposta aparecem como falha.
    expect(screen.getAllByText("Não foi possível calcular este mês.").length).toBeGreaterThan(0);
  });
});

describe("ProductDrawer — compras", () => {
  const item = (over: Record<string, unknown> = {}) => ({ id: 11, sku: "110024", description: "Marmita", quantity: 150, received_quantity: 150, unit_cost_cents: 620, condition: "paid", pack_quantity: 10, pack_unit_price_cents: 9300, units_per_pack: 15, purchase_unit: "CX", cost_sync: { state: "synced", previous_cost_cents: 570, alerts: ["large_variation"] }, ...over });
  const purchase = (over: Record<string, unknown> = {}) => ({ id: 9, supplier_id: 5, supplier_name: "Juntos+", ordered_on: "2026-10-05", received_on: "2026-10-10", status: "received", invoice_number: "13021", items: [item()], ...over });

  it("lista as compras do produto com a nota (link), o original da embalagem e o que ela fez no custo", () => {
    purchases = [purchase()];
    draw("purchases");

    expect(screen.getByRole("link", { name: "NF 13021" })).toHaveAttribute("href", "/purchases/invoices?purchase=9");
    const row = screen.getByText("Juntos+").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("10/10/2026");
    expect(row).toHaveTextContent("recebida");
    expect(row).toHaveTextContent("10 CX × R$ 93,00");
    expect(row).toHaveTextContent("15 un. por embalagem");
    expect(row).toHaveTextContent("Custo criado");
    expect(row).toHaveTextContent("antes R$ 5,70");
    expect(row).toHaveTextContent("Variação grande");
  });

  it("compra antiga diz 'original não registrado'; compra não recebida mostra a etapa e que o custo vem no recebimento", () => {
    purchases = [purchase({ id: 10, status: "awaiting_receipt", received_on: null, items: [item({ id: 12, pack_quantity: null, pack_unit_price_cents: null, units_per_pack: null, received_quantity: null, cost_sync: { state: null, alerts: [] } })] })];
    draw("purchases");

    const row = screen.getByText("Juntos+").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("original não registrado");
    expect(row).toHaveTextContent("Aguardando recebimento");
    expect(row).toHaveTextContent("Quando a compra for recebida");
  });

  it("bonificação diz que não cria custo, e sem compra a aba explica", () => {
    purchases = [purchase({ items: [item({ condition: "bonus", cost_sync: { state: "skipped_bonus", alerts: [] } })] })];
    const { unmount } = draw("purchases");
    expect(screen.getByText("Bonificação: não cria custo")).toBeInTheDocument();
    unmount();

    purchases = [];
    draw("purchases");
    expect(screen.getByText("Nenhuma compra registrada para este produto.")).toBeInTheDocument();
  });
});
