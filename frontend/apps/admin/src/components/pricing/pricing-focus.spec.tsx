import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";

import type { PricingProduct } from "../../lib/api/pricing";

const startRun = jest.fn((_arg: unknown) => ({ unwrap: async () => ({ started: true }) }));
let latest: Record<string, unknown> = {};
let lastChange: { latest: string | null } | undefined;
let searchParams = new URLSearchParams();
const excel = jest.fn();

jest.doMock("next/navigation", () => ({ useSearchParams: () => searchParams }));
jest.doMock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
jest.doMock("../../lib/api/pricing", () => ({
  useGetLatestPricingReportQuery: () => ({ data: latest, isLoading: false, isFetching: false, error: undefined, refetch: jest.fn() }),
  useStartPricingRunMutation: () => [startRun, { isLoading: false }],
  useGetPricingDecisionsQuery: () => ({ data: [] }),
  useSimulatePriceMutation: () => [jest.fn(), { isLoading: false }],
  useGetProductHistoryQuery: () => ({ data: undefined, isLoading: true }),
  useGetProductStoresQuery: () => ({ data: undefined, isLoading: true }),
  useApplyPriceMutation: () => [jest.fn(), { isLoading: false }],
}));
jest.doMock("../../lib/api/products", () => ({ useGetCatalogueLastChangeQuery: () => ({ data: lastChange }) }));
jest.doMock("../../lib/api/stores", () => ({ useGetStoresQuery: () => ({ data: [] }) }));
jest.doMock("../../lib/auth/use-permission", () => ({ useHasPermission: () => true }));
jest.doMock("../../lib/pricing/excel", () => ({ downloadWorkbook: excel }));
jest.doMock("./scope-bar", () => ({ ScopeBar: () => <div data-testid="scope" /> }));
jest.doMock("./rules-dialog", () => ({ RulesDialog: () => null }));
jest.doMock("./support-sections", () => ({ CategoriesSection: () => null, CostChangesSection: () => null, OpportunitiesSection: () => null }));
jest.doMock("../../components/request-state", () => ({ RequestState: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const product = (over: Partial<PricingProduct> = {}): PricingProduct =>
  ({
    sku: "COCA", name: "Coca-Cola Lata 350ml", ean: "789490001537", supplierId: 9, supplierName: "FEMSA", category: "beverage", categoryLabel: "Bebidas", subcategory: null, status: "adjust", confidence: "high",
    minimumPriceCents: 560, targetPriceCents: 610, recommendedPriceCents: 650, currentPriceCents: 590, currentMargin: 0.321, currentMarkup: 1.9, targetMargin: 0.35, minimumMargin: 0.3, marginFromCategory: false,
    structure: { productCostCents: 309, lossAdjustedCostCents: 315, taxRate: 0.0707, lossRate: 0.02, lossLevel: "product", paymentRate: 0.02, paymentFixedCents: 0, voucherShare: 0.22, voucherBasis: "sales_weighted", operatingShare: 0.04, statement: "Rateio operacional utilizado exclusivamente para análise de preço. Não representa novo lançamento financeiro." },
    costVariation: null, marginAtPreviousCost: null, marginChangeFromCost: null, monthlyUnits: 325, monthlyRevenueCents: 191750, monthlyMarginCents: 80000, impactCentsPerMonth: 42000, impactLabel: "Impacto potencial estimado",
    recommendedMargin: 0.35, reasons: [], insufficientReasons: [], engineVersion: "pricing-3", costOrigin: { source: "invoice", effectiveFrom: "2026-08-15", invoiceNumber: "13021" }, newerCost: null, ...over,
  }) as PricingProduct;

const report = (products: PricingProduct[], over: Record<string, unknown> = {}) => ({
  meta: { engineVersion: "pricing-3", parameterVersion: 7, months: ["2026-07", "2026-08", "2026-09"], asOf: "2026-09-30", storeId: null, payment: null, paymentMixMonthsWithoutTransactions: [], operating: null, notes: [] },
  summary: { analysed: products.length, averageMargin: 0.321, targetMargin: 0.35, withinTarget: 0, belowTarget: 1, opportunities: 0, insufficientData: 1, review: 0, potentialImpactCentsPerMonth: 42000, impactLabel: "Impacto potencial estimado", coverage: { total: 2, analysable: 1, withoutEnoughData: 1 }, pending: [{ code: "stale_cost", label: "Custo desatualizado (sem compra no período)", skus: ["MARM"] }], shares: { withinTarget: 0, belowTarget: 1, opportunities: 0, insufficientData: 0 } },
  categories: [],
  products,
  ...over,
});

const marmita = () => product({ sku: "MARM", name: "Marmita", status: "insufficient_data", recommendedPriceCents: null, impactCentsPerMonth: null, currentMargin: null, structure: null, insufficientReasons: ["Custo desatualizado (300 dias, sem compra no período)"], costOrigin: { source: "legacy_import", effectiveFrom: "2026-01-01", invoiceNumber: null } });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PricingScreen }: { PricingScreen: ComponentType } = require("./pricing-screen");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ProductsTable }: { ProductsTable: ComponentType<Record<string, unknown>> } = require("./products-table");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PendingProducts }: { PendingProducts: ComponentType<Record<string, unknown>> } = require("./pending-products");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ExportButtons }: { ExportButtons: ComponentType<Record<string, unknown>> } = require("./export-buttons");

beforeEach(() => {
  jest.clearAllMocks();
  searchParams = new URLSearchParams();
  // O cadastro mudou em 09/10, depois do cálculo de 05/10.
  lastChange = { latest: "2026-10-09T00:00:00.000Z" };
  latest = { scope: { period: "2026-09", storeId: null }, state: "ready", run: { id: "r1", period: "2026-09", storeId: null, status: "completed", engineVersion: "pricing-3", parameterVersion: 7, computedAt: "2026-10-05T10:00:00.000Z", createdAt: "2026-10-05T09:59:00.000Z", error: null }, report: report([product(), marmita()]), inProgress: null, lastFailure: null, currentParameterVersion: 7, parametersStale: false };
});

describe("PricingScreen — a tela de análise", () => {
  it("mostra a meta padrão no cabeçalho e não repete a coluna Meta quando todos têm a mesma", () => {
    render(<PricingScreen />);

    expect(screen.getByText(/meta padrão/)).toHaveTextContent("meta padrão 35%");
    expect(screen.queryByRole("columnheader", { name: "Meta" })).not.toBeInTheDocument();
  });

  it("com metas diferentes a coluna Meta volta e o cabeçalho avisa das exceções", () => {
    latest = { ...latest, report: report([product(), product({ sku: "OUTRO", name: "Outro", targetMargin: 0.4 })]) };
    render(<PricingScreen />);

    expect(screen.getByRole("columnheader", { name: "Meta" })).toBeInTheDocument();
    expect(screen.getByText(/há exceções por produto\/categoria/)).toBeInTheDocument();
  });

  it("não coloca o nome do motor nem a versão das regras no texto principal; é uma análise histórica do período", () => {
    const { container } = render(<PricingScreen />);

    expect(container).not.toHaveTextContent("pricing-3");
    expect(container).not.toHaveTextContent("regras v7");
    expect(screen.getByText(/Análise histórica de/)).toHaveTextContent("custo vigente no último dia do período");
  });

  it("avisa quando o cadastro mudou depois do cálculo e diz que o preço vigente continua até a aprovação", () => {
    render(<PricingScreen />);

    expect(screen.getByRole("status")).toHaveTextContent("Há custos, preços ou produtos novos no cadastro desde este cálculo");
    expect(screen.getByRole("status")).toHaveTextContent("O preço vigente continua valendo até alguém aprovar um novo");
  });

  it("sem alteração depois do cálculo, ou sem a leitura do cadastro, não avisa nada", () => {
    latest = { ...(latest as object), run: { ...((latest as { run: object }).run), computedAt: "2026-10-10T00:00:00.000Z" } };
    const { unmount } = render(<PricingScreen />);
    expect(screen.queryByText(/desde este cálculo/)).not.toBeInTheDocument();
    unmount();

    lastChange = undefined;
    render(<PricingScreen />);
    expect(screen.queryByText(/desde este cálculo/)).not.toBeInTheDocument();
  });

  it("tem um só botão Exportar, e a pendência de produtos sem dados está visível e clicável", () => {
    render(<PricingScreen />);

    expect(screen.getByRole("button", { name: /Exportar/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Exportar Excel/ })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Produtos sem dados suficientes" })).toBeInTheDocument();
  });

  it("?sku= abre o detalhe do produto direto, com o caminho de volta ao cadastro", () => {
    searchParams = new URLSearchParams("sku=COCA");
    render(<PricingScreen />);

    expect(screen.getByRole("link", { name: "Editar cadastro" })).toHaveAttribute("href", "/products?sku=COCA&tab=overview");
  });
});

describe("Detalhe do produto — como o número foi calculado", () => {
  const open = (p: PricingProduct) => {
    searchParams = new URLSearchParams(`sku=${p.sku}`);
    latest = { ...latest, report: report([p]) };
    render(<PricingScreen />);
  };

  it("explica o método e a origem do custo, os impostos e taxas, o tipo de margem, a meta e a premissa do impacto", () => {
    open(product());

    const section = screen.getByRole("heading", { name: "Como este número foi calculado" }).closest("section") as HTMLElement;
    expect(section).toHaveTextContent("custo vigente no último dia de");
    expect(section).toHaveTextContent("a mesma regra do CMV do financeiro");
    expect(section).toHaveTextContent("origem: Nota fiscal 13021 · desde 15/08/2026");
    expect(section).toHaveTextContent("Imposto 7,07% · taxas de pagamento 2,00%");
    expect(section).toHaveTextContent("perda 2,0% (do produto)");
    expect(section).toHaveTextContent("Margem econômica: o que sobra do preço");
    expect(section).toHaveTextContent("35% (meta padrão) · margem mínima 30%");
    expect(section).toHaveTextContent("supõe o mesmo volume de vendas");
  });

  it("o motor e a versão das regras só aparecem nos detalhes técnicos, para auditoria", () => {
    open(product());

    const details = screen.getByText("Detalhes técnicos (auditoria)").closest("details") as HTMLElement;
    expect(details).toHaveTextContent("Motor pricing-3 · regras v7");
    expect(details).not.toHaveAttribute("open");
  });

  it("um custo novo depois do período é dito à parte e o período segue histórico", () => {
    open(product({ newerCost: { costCents: 350, effectiveFrom: "2026-10-10", source: "invoice" } }));

    const section = screen.getByRole("heading", { name: "Como este número foi calculado" }).closest("section") as HTMLElement;
    expect(section).toHaveTextContent("O cadastro tem um custo mais novo (R$ 3,50, desde 10/10/2026). Este período é histórico: o custo novo não entra nele.");
  });

  it("uma meta de categoria é dita como tal", () => {
    open(product({ marginFromCategory: true, targetMargin: 0.4 }));

    expect(screen.getByText(/40% \(meta da categoria\)/)).toBeInTheDocument();
  });
});

describe("ProductsTable — colunas enxutas", () => {
  const props = (rows: PricingProduct[], extra: Record<string, unknown> = {}) => ({ rows, total: rows.length, page: 1, pages: 1, pageSize: 10, onPageChange: jest.fn(), onPageSizeChange: jest.fn(), onOpen: jest.fn(), ...extra });

  it("tem produto, custo utilizado, preço vigente, margem, preço sugerido, impacto, situação e Analisar", () => {
    render(<ProductsTable {...props([product()])} />);

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Produto", "Custo utilizado", "Preço vigente", "Margem atual", "Preço sugerido", "Impacto mensal estimado", "Situação", ""]);
  });

  it("o cabeçalho da margem diz o que ela é e o do impacto diz a premissa", () => {
    render(<ProductsTable {...props([product()])} />);

    expect(screen.getByRole("columnheader", { name: "Margem atual" })).toHaveAttribute("title", expect.stringContaining("Margem econômica"));
    expect(screen.getByRole("columnheader", { name: "Impacto mensal estimado" })).toHaveAttribute("title", expect.stringContaining("mesmo volume de vendas"));
  });

  it("o custo vem com a origem; um custo novo depois do período aparece à parte, nunca como o custo do período", () => {
    render(<ProductsTable {...props([product({ newerCost: { costCents: 350, effectiveFrom: "2026-10-10", source: "invoice" } })])} />);

    const row = screen.getByText("Coca-Cola Lata 350ml").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("R$ 3,09");
    expect(row).toHaveTextContent("Nota fiscal 13021 · desde 15/08/2026");
    expect(row).toHaveTextContent("Custo novo depois do período: R$ 3,50");
  });

  it("produto sem dados mostra traço na margem e o motivo, nunca zero", () => {
    render(<ProductsTable {...props([marmita()])} />);

    const row = screen.getByText("Marmita").closest("tr") as HTMLElement;
    expect(row).not.toHaveTextContent("0,0%");
    expect(row).toHaveTextContent("Custo desatualizado");
  });
});

describe("PendingProducts", () => {
  const groups = [
    { code: "stale_cost", label: "Custo desatualizado (sem compra no período)", skus: ["MARM", "OUTRO"] },
    { code: "no_price", label: "Sem preço de venda cadastrado", skus: ["MARM"] },
  ];
  const draw = (onOpen = jest.fn()) => render(<PendingProducts groups={groups} products={[marmita(), product({ sku: "OUTRO", name: "Outro" })]} onOpen={onOpen} />);

  it("mostra os motivos com a contagem e, ao clicar, os produtos com o caminho para corrigir", () => {
    draw();
    expect(screen.getByRole("button", { name: "Custo desatualizado (sem compra no período): 2" })).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Custo desatualizado/ }));
    const list = screen.getByRole("list", { name: "Custo desatualizado (sem compra no período)" });
    expect(list).toHaveTextContent("Marmita");
    expect(screen.getAllByRole("link", { name: "Corrigir custo" })[0]).toHaveAttribute("href", "/products?sku=MARM&tab=costs");
  });

  it("sem preço leva a definir o preço, e Ver análise abre o produto na própria tela", () => {
    const onOpen = jest.fn();
    draw(onOpen);
    fireEvent.click(screen.getByRole("button", { name: /Sem preço de venda/ }));

    expect(screen.getByRole("link", { name: "Definir preço" })).toHaveAttribute("href", "/products?sku=MARM&tab=prices");
    fireEvent.click(screen.getByRole("button", { name: "Ver análise" }));
    expect(onOpen).toHaveBeenCalledWith("MARM");
  });

  it("sem pendências não ocupa lugar", () => {
    const { container } = render(<PendingProducts groups={[]} products={[]} onOpen={jest.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("ExportButtons", () => {
  it("é um botão Exportar só, desligado e explicado enquanto não há relatório", () => {
    render(<ExportButtons model={null} unavailableReason="Aguarde o relatório carregar." />);

    const button = screen.getByRole("button", { name: /Exportar/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Aguarde o relatório carregar.");
  });
});
