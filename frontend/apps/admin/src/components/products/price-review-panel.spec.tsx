import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";

import type { PricingProduct } from "../../lib/api/pricing";
import type { Product } from "../../lib/api/products";

const simulate = jest.fn((arg: { priceCents: number }) => ({ unwrap: async () => simulation(arg.priceCents) }));
const draft = jest.fn((arg: { unitCostCents: number; typedPriceCents?: number | null }) => ({ unwrap: async () => ({ meta: {}, suggestion: initial(arg) }) }));
const apply = jest.fn((_arg: unknown) => ({ unwrap: async () => ({ applied: true }) }));
const choose = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
let simulateFailure: unknown = null;

const simulation = (priceCents: number) => {
  if (simulateFailure) throw simulateFailure;

  return { simulable: true, priceCents, margin: priceCents === 1730 ? 0.352 : 0.41, markup: 2, unitProfitCents: Math.round(priceCents * (priceCents === 1730 ? 0.352 : 0.41)), currentPriceCents: 1490, currentMargin: 0.266, monthlyImpactCents: 100, differenceToTarget: 0.002, targetMargin: 0.35, impactLabel: "Impacto potencial estimado", reportRunId: "run-1" };
};
const initial = (arg: { unitCostCents: number; typedPriceCents?: number | null }) => ({
  status: "suggested", blocker: null, initial: true, validated: true, validationNotes: [], suggestedPriceCents: Math.round(arg.unitCostCents * 2.5), suggestedMargin: 0.352, targetMargin: 0.35, minimumMargin: 0.3, minimumPriceCents: 0, dataUsed: [], reasons: [], insufficientReasons: [],
  typedPrice: arg.typedPriceCents ? { priceCents: arg.typedPriceCents, margin: 0.41 } : null,
});

jest.doMock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
jest.doMock("../../lib/api/pricing", () => ({
  useSimulateCurrentPriceMutation: () => [simulate, { isLoading: false }],
  useGetCurrentProductStoresQuery: () => ({ data: undefined, isLoading: false, error: undefined, refetch: jest.fn() }),
  useDraftSuggestionMutation: () => [draft, { isLoading: false }],
  useApplyPriceMutation: () => [apply, { isLoading: false }],
  useChooseNewProductPriceMutation: () => [choose, { isLoading: false }],
}));
jest.doMock("../../lib/api/products", () => ({
  useGetCategoriesQuery: () => ({ data: [{ id: 1, key: "snack", name: "Lanche", status: "active", keywords: [], products: 1, subcategories: [] }] }),
  useGetProductTimelineQuery: () => ({ data: { events: [{ kind: "price", date: "2026-09-01", value_cents: 1490, previous_value_cents: 1390, source: "manual", actor: "ana", reason: "Reajuste", superseded: false, recorded_at: "2026-09-01T10:00:00Z" }] }, isLoading: false }),
}));
jest.doMock("../../lib/api/suppliers", () => ({ useGetSuppliersQuery: () => ({ data: [{ id: 5, name: "Seara" }] }) }));
jest.doMock("../pricing/product-drawer", () => ({ CalculationDetails: () => <div data-testid="calculation-details" />, StoresView: () => <div data-testid="stores-table" /> }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PriceReviewPanel }: { PriceReviewPanel: ComponentType<Record<string, unknown>> } = require("./price-review-panel");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildRows }: { buildRows: (input: unknown) => { product: Product }[] } = require("../../lib/products/workspace");

const product: Product = { id: 4, sku: "100109", name: "Quiche Lorraine", category: "snack", subcategory: "Salgados", brand: "Seara", net_weight: "400 g", sale_unit: "un", purchase_unit: "CX", package_type: "caixa", units_per_package: 12, supplier_id: 5, units_per_package_: null } as never;
const stored = (over: Partial<PricingProduct> = {}): PricingProduct => ({ sku: "100109", name: "Quiche", status: "adjust", currentPriceCents: 1490, currentMargin: 0.266, targetMargin: 0.35, recommendedPriceCents: 1730, recommendedMargin: 0.352, insufficientReasons: [], validated: true, structure: { productCostCents: 837 }, estimatedResultAfterAllocation: { centsPerUnit: 95, margin: 0.064, criterion: "Contribuição menos deslocamento e custos fixos" }, engineVersion: "pricing-4", ...over }) as PricingProduct;

const rowFor = (opts: { cost?: number | null; price?: number | null; report?: PricingProduct[] | null } = {}) => {
  const { cost = 837, price = 1490, report = [stored()] } = opts;

  return buildRows({
    products: [product],
    costs: new Map(cost === null ? [] : [["100109", { cents: cost, from: "2026-09-01", source: "invoice", invoiceNumber: "13021" }]]),
    prices: new Map(price === null ? [] : [["100109", { cents: price, from: "2026-09-01" }]]),
    report,
  })[0];
};

const scope = { storeId: null, report: { meta: { engineVersion: "pricing-4", parameterVersion: 2, basis: "current", months: ["2026-07", "2026-08", "2026-09"], asOf: "2026-10-08" } }, computedAt: "2026-10-08T12:00:00Z" };
const onClose = jest.fn();
const onSaved = jest.fn();
const open = (row = rowFor(), canWrite = true) => render(<PriceReviewPanel row={row} scope={scope} canWrite={canWrite} onClose={onClose} onSaved={onSaved} onEdit={jest.fn()} onOpenRecord={jest.fn()} />);

beforeEach(() => {
  jest.clearAllMocks();
  simulateFailure = null;
});

describe("PriceReviewPanel — a decisão de preço de um produto", () => {
  it("mostra o produto, o custo com origem e data, o preço atual, o sugerido e o preço escolhido já na sugestão", async () => {
    open();

    expect(screen.getByRole("heading", { name: "Revisar preço" })).toBeInTheDocument();
    expect(screen.getByText("Quiche Lorraine")).toBeInTheDocument();
    expect(screen.getByText(/SKU 100109 · Lanche \/ Salgados/)).toBeInTheDocument();
    expect(screen.getByText("R$ 8,37")).toBeInTheDocument();
    expect(screen.getByText(/Nota fiscal 13021 · desde 01\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByLabelText("Novo preço de venda")).toHaveValue("17,30");
    await waitFor(() => expect(screen.getByTestId("panel-margin")).toHaveTextContent("35,2%"));
    expect(screen.getByText("R$ 6,09")).toBeInTheDocument();
    expect(screen.getByText("Simulação ilustrativa")).toBeInTheDocument();
    expect(screen.getByText(/Meta 35%/)).toBeInTheDocument();
  });

  it("digitar um preço atualiza a margem pela simulação e nunca é sobrescrito por uma sugestão", async () => {
    open();
    await waitFor(() => expect(screen.getByTestId("panel-margin")).toHaveTextContent("35,2%"));

    fireEvent.change(screen.getByLabelText("Novo preço de venda"), { target: { value: "16,00" } });
    await waitFor(() => expect(screen.getByTestId("panel-margin")).toHaveTextContent("41,0%"));
    expect(simulate).toHaveBeenLastCalledWith(expect.objectContaining({ sku: "100109", priceCents: 1600, storeId: null }));
    expect(screen.getByLabelText("Novo preço de venda")).toHaveValue("16,00");
    expect(screen.getByRole("button", { name: /Usar o sugerido \(R\$\s17,30\)/ })).toBeInTheDocument();
  });

  it("outro preço exige motivo; só então o botão de salvar habilita", async () => {
    open();
    await waitFor(() => expect(screen.getByTestId("panel-margin")).toHaveTextContent("35,2%"));
    fireEvent.change(screen.getByLabelText("Novo preço de venda"), { target: { value: "16,00" } });

    expect(screen.getByRole("button", { name: "Salvar preço" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivo do preço escolhido"), { target: { value: "Concorrente a 16" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar preço" })).toBeEnabled());
  });

  it("salvar mostra o escopo e a vigência antes de confirmar, e só então grava, com a chave e a vigência escolhidas", async () => {
    open();
    await waitFor(() => expect(screen.getByTestId("panel-margin")).toHaveTextContent("35,2%"));
    fireEvent.change(screen.getByLabelText("Vigência a partir de"), { target: { value: "2026-10-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar preço" }));

    const dialog = await screen.findByRole("dialog", { name: "Confirmar novo preço" });
    expect(dialog).toHaveTextContent("Todas as lojas (o preço é único para a rede)");
    expect(dialog).toHaveTextContent("R$ 14,90 → R$ 17,30");
    expect(dialog).toHaveTextContent("a partir de 20/10/2026");
    expect(dialog).toHaveTextContent("Isto não publica o preço no PDV");
    expect(apply).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar e salvar" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls[0][0]).toMatchObject({ sku: "100109", newPriceCents: 1730, effectiveFrom: "2026-10-20", basis: "current", idempotencyKey: expect.any(String) });
    expect((apply.mock.calls[0][0] as { reason?: string }).reason).toBeUndefined();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("uma falha ao salvar fica na tela, com o motivo, e nada fecha", async () => {
    apply.mockReturnValueOnce({ unwrap: async () => Promise.reject({ data: { message: "products-service respondeu 503" } }) } as never);
    open();
    await waitFor(() => expect(screen.getByTestId("panel-margin")).toHaveTextContent("35,2%"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar preço" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar e salvar" }));

    expect((await screen.findAllByText("products-service respondeu 503")).length).toBeGreaterThan(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a margem de outro preço nunca aparece ao lado do digitado, e uma falha da simulação permite tentar de novo", async () => {
    open();
    await waitFor(() => expect(screen.getByTestId("panel-margin")).toHaveTextContent("35,2%"));
    simulateFailure = { status: 502 };
    fireEvent.change(screen.getByLabelText("Novo preço de venda"), { target: { value: "16,00" } });

    expect(await screen.findByTestId("failed")).toHaveTextContent("não respondeu");
    expect(screen.getByTestId("panel-margin")).not.toHaveTextContent("35,2%");
    simulateFailure = null;
    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }));
    await waitFor(() => expect(screen.getByTestId("panel-margin")).toHaveTextContent("41,0%"));
  });
});

describe("PriceReviewPanel — produto sem cálculo em dia", () => {
  it("sem preço atual: 'Não definido', sugestão inicial do motor com o custo de hoje, e salva pela escolha de produto sem histórico", async () => {
    open(rowFor({ price: null, report: null }));

    expect(screen.getByText("Não definido")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Novo preço de venda")).toHaveValue("20,93"));
    expect(draft).toHaveBeenLastCalledWith(expect.objectContaining({ category: "snack", unitCostCents: 837 }));
    expect(screen.getByText("sugestão inicial")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("panel-margin")).toHaveTextContent("35,2%"));

    fireEvent.click(screen.getByRole("button", { name: "Salvar preço" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar e salvar" }));
    await waitFor(() => expect(choose).toHaveBeenCalledTimes(1));
    expect(choose.mock.calls[0][0]).toMatchObject({ sku: "100109", choice: "suggested_accepted", chosenPriceCents: 2093, costCents: 837 });
    expect(apply).not.toHaveBeenCalled();
  });

  it("o preço ou o custo mudou depois do cálculo de hoje: não usa a simulação velha e avisa a pendência", async () => {
    open(rowFor({ price: 1500 }));

    expect(screen.getByTestId("panel-pending")).toHaveTextContent("mudou agora há pouco");
    await waitFor(() => expect(draft).toHaveBeenCalled());
    expect(simulate).not.toHaveBeenCalled();
  });

  it("sem custo não deixa salvar preço e diz por quê; nada é calculado", () => {
    open(rowFor({ cost: null, report: null }));

    expect(screen.getAllByText("Sem custo cadastrado").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("panel-pending")).toHaveTextContent("Sem custo cadastrado");
    expect(screen.getByRole("button", { name: "Salvar preço" })).toBeDisabled();
    expect(draft).not.toHaveBeenCalled();
    expect(screen.getByText("Informe o custo para calcular o preço sugerido.")).toBeInTheDocument();
  });

  it("sem permissão de escrita só mostra: não há botão de salvar", () => {
    open(rowFor(), false);

    expect(screen.queryByRole("button", { name: "Salvar preço" })).not.toBeInTheDocument();
    expect(screen.getByText(/Você pode ver, mas não alterar preços/)).toBeInTheDocument();
  });
});

describe("PriceReviewPanel — seções secundárias", () => {
  it("cadastro, compra e embalagem, resultado após rateio e cálculo ficam em seções que o painel traz", () => {
    open();

    for (const title of ["Composição do cálculo", "Cadastro e códigos de barras", "Compra e embalagem", "Histórico de custos e preços", "Preços por loja", "Resultado estimado após rateio"]) expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(/6,4%/)).toBeInTheDocument();
    expect(screen.getByText(/Não é lucro líquido/)).toBeInTheDocument();
    expect(screen.getByText("Unidades por embalagem").parentElement).toHaveTextContent("12");
    expect(screen.getByText("Marca").parentElement).toHaveTextContent("Seara");
    expect(screen.getByText("Fornecedor").parentElement).toHaveTextContent("Seara");
    expect(screen.getByText("400 g")).toBeInTheDocument();
  });

  it("histórico e lojas só carregam quando a seção é aberta", () => {
    open();

    expect(screen.queryByTestId("stores-table")).not.toBeInTheDocument();
    expect(screen.queryByText("Reajuste")).not.toBeInTheDocument();
    const section = screen.getByText("Preços por loja").closest("details") as HTMLDetailsElement;
    section.open = true;
    fireEvent(section, new Event("toggle"));
    expect(screen.getByTestId("stores-table")).toBeInTheDocument();
    expect(screen.getByText(/O preço é único para a rede/)).toBeInTheDocument();
  });
});
