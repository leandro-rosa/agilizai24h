import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

import type { PricingProduct, PricingSummary } from "../../lib/api/pricing";

const apply = jest.fn((_arg: unknown) => ({ unwrap: async () => ({ decision: { id: "d1" }, applied: true, alreadyApplied: false }) }));
jest.doMock("../../lib/api/pricing", () => ({ useApplyPriceMutation: () => [apply, { isLoading: false }] }));

const product = (overrides: Partial<PricingProduct> = {}): PricingProduct => ({
  sku: "COCA", name: "Coca-Cola Lata 350ml", ean: "789490001537", supplierId: 9, supplierName: "FEMSA", category: "beverage", categoryLabel: "Bebidas", subcategory: null,
  status: "adjust", confidence: "high", minimumPriceCents: 560, targetPriceCents: 610, recommendedPriceCents: 650, currentPriceCents: 590, currentMargin: 0.321, currentMarkup: 1.9,
  targetMargin: 0.35, minimumMargin: 0.3, marginFromCategory: false,
  structure: { productCostCents: 309, lossAdjustedCostCents: 315, taxRate: 0.0707, lossRate: 0.02, lossLevel: "product", paymentRate: 0.02, paymentFixedCents: 0, voucherShare: 0.22, voucherBasis: "sales_weighted", operatingShare: 0.04, statement: "x" },
  costVariation: 0.104, marginAtPreviousCost: 0.36, marginChangeFromCost: -0.039, monthlyUnits: 325, monthlyRevenueCents: 191750, monthlyMarginCents: 80000, impactCentsPerMonth: 42000,
  impactLabel: "Impacto potencial estimado", recommendedMargin: 0.35, reasons: [], insufficientReasons: [], engineVersion: "pricing-1", ...overrides,
});

const summary: PricingSummary = { analysed: 382, averageMargin: 0.368, targetMargin: 0.35, withinTarget: 327, belowTarget: 28, opportunities: 31, insufficientData: 8, review: 0, potentialImpactCentsPerMonth: 432000, impactLabel: "Impacto potencial estimado", shares: { withinTarget: 0.86, belowTarget: 0.07, opportunities: 0.08, insufficientData: 0.02 } };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SummaryCards }: { SummaryCards: ComponentType<{ summary: PricingSummary | null }> } = require("./summary-cards");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ProductsTable }: { ProductsTable: ComponentType<Record<string, unknown>> } = require("./products-table");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SetupBanner }: { SetupBanner: ComponentType<{ notes: { text: string; action?: { label: string; href?: string } }[]; onOpenRules: () => void }> } = require("./setup-banner");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ApplyPriceDialog }: { ApplyPriceDialog: ComponentType<Record<string, unknown>> } = require("./apply-price-dialog");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FiltersBar }: { FiltersBar: ComponentType<Record<string, unknown>> } = require("./filters-bar");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NO_FILTERS } = require("../../lib/pricing/view");

describe("SummaryCards", () => {
  it("mostra os seis cartões, o impacto sempre rotulado como estimado e a meta com a diferença", () => {
    render(<SummaryCards summary={summary} />);

    expect(screen.getByText("36,8%")).toBeInTheDocument();
    expect(screen.getByText(/Meta: 35% · \+1,8 p\.p\./)).toBeInTheDocument();
    expect(screen.getByText("327")).toBeInTheDocument();
    expect(screen.getByText("Produtos sem custo confiável")).toBeInTheDocument();
    expect(screen.getByText("Não recebem recomendação automática")).toBeInTheDocument();
    expect(screen.getByText(/Impacto potencial estimado/)).toBeInTheDocument();
  });

  it("sem resposta do backend diz Indisponível nos seis, nunca zero", () => {
    render(<SummaryCards summary={null} />);

    expect(screen.getAllByText("Indisponível")).toHaveLength(6);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("ProductsTable", () => {
  const props = (rows: PricingProduct[], onOpen = jest.fn()) => ({ rows, total: rows.length, page: 1, pages: 1, pageSize: 10, onPageChange: jest.fn(), onPageSizeChange: jest.fn(), onOpen });

  it("mostra produto, margem, preço recomendado e impacto, e abre o drawer pelo Ver", () => {
    const onOpen = jest.fn();
    render(<ProductsTable {...props([product()], onOpen)} />);

    expect(screen.getByText("Coca-Cola Lata 350ml")).toBeInTheDocument();
    expect(screen.getByText("32,1%")).toBeInTheDocument();
    expect(screen.getByText("Ajustar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver Coca-Cola Lata 350ml" }));
    expect(onOpen).toHaveBeenCalledWith("COCA");
  });

  it("produto sem recomendação mostra — e o motivo, sem preço inventado", () => {
    const noCost = product({ sku: "MARM", name: "Marmita", status: "insufficient_data", recommendedPriceCents: null, impactCentsPerMonth: null, currentMargin: null, structure: null, insufficientReasons: ["Sem custo cadastrado"] });
    render(<ProductsTable {...props([noCost])} />);

    expect(screen.getByLabelText("sem recomendação")).toHaveTextContent("—");
    expect(screen.getByText("Sem custo cadastrado")).toBeInTheDocument();
    expect(screen.getByText("Dados insuficientes")).toBeInTheDocument();
  });

  it("um produto cadastrado por uma nota aparece como Produto novo, e sem histórico de vendas quando ainda não vendeu", () => {
    const novo = product({ sku: "110024", name: "Novo sabor", status: "insufficient_data", recommendedPriceCents: null, currentPriceCents: null, structure: null, insufficientReasons: ["Sem preço atual"], newProduct: { registeredOn: "2026-09-12", noSalesHistory: true } });
    const vendeu = product({ sku: "110025", name: "Outro novo", newProduct: { registeredOn: "2026-09-12", noSalesHistory: false } });
    render(<ProductsTable {...props([novo, vendeu, product()])} />);

    expect(screen.getAllByText("Produto novo")).toHaveLength(2);
    expect(screen.getAllByText("Sem histórico de vendas")).toHaveLength(1);
  });
});

describe("FiltersBar", () => {
  const base = { sort: "impact", onSortChange: jest.fn(), categories: [{ key: "beverage", label: "Bebidas" }], suppliers: [{ id: 9, name: "FEMSA" }] };

  it("sem filtro ativo não oferece limpar; com filtro, cada um e o conjunto podem sair", () => {
    const onChange = jest.fn();
    const { rerender } = render(<FiltersBar {...base} filters={NO_FILTERS} onChange={onChange} />);
    expect(screen.queryByRole("button", { name: /Limpar filtros/ })).not.toBeInTheDocument();

    rerender(<FiltersBar {...base} filters={{ ...NO_FILTERS, belowTarget: true, query: "coca" }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Limpar filtros \(2\)/ }));
    expect(onChange).toHaveBeenCalledWith(NO_FILTERS);
  });

  it("os botões de abaixo da meta e de custo alterado alternam e dizem se estão ativos", () => {
    const onChange = jest.fn();
    render(<FiltersBar {...base} filters={NO_FILTERS} onChange={onChange} />);
    const below = screen.getByRole("button", { name: "Abaixo da meta" });

    expect(below).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(below);
    expect(onChange).toHaveBeenCalledWith({ ...NO_FILTERS, belowTarget: true });
  });
});

describe("SetupBanner", () => {
  it("não aparece sem avisos", () => {
    const { container } = render(<SetupBanner notes={[]} onOpenRules={jest.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("mostra o aviso com o caminho para corrigir: taxas levam a Tesouraria, alíquota abre as regras", () => {
    const onOpenRules = jest.fn();
    render(<SetupBanner notes={[{ text: "Nenhuma taxa de pagamento cadastrada.", action: { label: "Cadastrar taxas", href: "/treasury/fees" } }, { text: "A alíquota de imposto não está configurada.", action: { label: "Abrir regras de negócio" } }]} onOpenRules={onOpenRules} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Nenhuma taxa de pagamento cadastrada.");
    expect(screen.getByRole("link", { name: "Cadastrar taxas" })).toHaveAttribute("href", "/treasury/fees");
    fireEvent.click(screen.getByRole("button", { name: "Abrir regras de negócio" }));
    expect(onOpenRules).toHaveBeenCalled();
  });
});

describe("ApplyPriceDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(globalThis, "crypto", { value: { randomUUID: () => "key-1" }, configurable: true });
  });

  const open = (extra: Record<string, unknown> = {}) => {
    const onApplied = jest.fn();
    const onOpenChange = jest.fn();
    render(<ApplyPriceDialog product={product()} initialPriceCents={650} runId="run-1" open onOpenChange={onOpenChange} onApplied={onApplied} {...extra} />);

    return { onApplied, onOpenChange };
  };

  it("aprovar exatamente a recomendação não exige motivo e envia a chave e a corrida vista", async () => {
    const { onApplied } = open();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar novo preço" }));

    await waitFor(() => expect(apply).toHaveBeenCalledWith({ idempotencyKey: "key-1", sku: "COCA", newPriceCents: 650, reason: undefined, runId: "run-1" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
  });

  it("um preço diferente da recomendação exige motivo antes de liberar o botão", () => {
    open();
    fireEvent.change(screen.getByLabelText("Novo preço (R$)"), { target: { value: "6,20" } });

    expect(screen.getByLabelText(/Motivo \(obrigatório\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aplicar novo preço" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "preço da concorrência" } });
    expect(screen.getByRole("button", { name: "Aplicar novo preço" })).toBeEnabled();
  });

  it("recusa o preço atual e um preço inválido", () => {
    open();
    fireEvent.change(screen.getByLabelText("Novo preço (R$)"), { target: { value: "5,90" } });
    expect(screen.getByText(/É o preço atual/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aplicar novo preço" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Novo preço (R$)"), { target: { value: "abc" } });
    expect(screen.getByText(/preço válido/)).toBeInTheDocument();
  });

  it("mostra o motivo da falha e não fecha nem recalcula quando o preço não pôde ser gravado", async () => {
    apply.mockReturnValueOnce({ unwrap: async () => Promise.reject({ data: { message: "products respondeu 404: Unknown SKU COCA" } }) });
    const { onApplied, onOpenChange } = open();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar novo preço" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown SKU COCA");
    expect(onApplied).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
