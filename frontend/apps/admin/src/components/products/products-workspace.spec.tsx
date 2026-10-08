import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";

import type { PricingProduct } from "../../lib/api/pricing";
import type { Product } from "../../lib/api/products";

const replace = jest.fn();
const push = jest.fn();
const refetchCurrent = jest.fn();
let currentError = false;
let pricesFail = false;
let currentFetching = false;
let search = new URLSearchParams();
let current: Record<string, unknown> | undefined;
let canWrite = true;
let costs: { sku: string; product_id: number; cost_cents: number; effective_from: string; source?: string; invoice_number?: string | null }[] = [];
let prices: { sku: string; price_cents: number; effective_from: string }[] = [];
let productList: Product[] = [];
const refetchPrices = jest.fn();
const refetchCosts = jest.fn();

jest.doMock("next/navigation", () => ({ useRouter: () => ({ replace, push }), useSearchParams: () => search }));
jest.doMock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
jest.doMock("../../lib/api/products", () => ({
  useGetProductsQuery: () => ({ data: productList, isLoading: false, error: undefined, refetch: jest.fn() }),
  useGetCategoriesQuery: () => ({ data: [{ id: 1, key: "beverage", name: "Bebida", status: "active", keywords: [], products: 2, subcategories: [{ id: 5, category_id: 1, name: "Energéticos", status: "active", keywords: [], products: 1 }] }, { id: 2, key: "snack", name: "Lanche", status: "active", keywords: [], products: 1, subcategories: [] }] }),
  useGetCostsAsOfQuery: () => ({ data: { resolved: costs, unresolved: [], complete: true }, isLoading: false, refetch: refetchCosts }),
  useGetPricesAsOfQuery: () => ({ data: pricesFail ? undefined : { resolved: prices, unresolved: [], complete: true }, isLoading: false, isError: pricesFail, refetch: refetchPrices }),
}));
jest.doMock("../../lib/api/pricing", () => ({
  useGetCurrentPricingQuery: () => ({ data: current, isFetching: currentFetching, isError: currentError, refetch: refetchCurrent, fulfilledTimeStamp: 1760000000000 }),
}));
jest.doMock("../../lib/api/stores", () => ({ useGetStoresQuery: () => ({ data: [{ id: 3, name: "Loja Centro" }] }) }));
jest.doMock("../../lib/api/suppliers", () => ({ useGetSuppliersQuery: () => ({ data: [] }) }));
jest.doMock("../../lib/auth/use-permission", () => ({ useHasPermission: () => canWrite }));
jest.doMock("../../components/request-state", () => ({ RequestState: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.doMock("../pricing/rules-dialog", () => ({ RulesDialog: () => <div data-testid="rules-dialog" /> }));
jest.doMock("../pricing/calculation-sheet", () => ({ CalculationSheet: () => <div data-testid="calculation-sheet" /> }));
jest.doMock("./new-product-panel", () => ({ NewProductPanel: () => <div data-testid="new-product-panel" /> }));
jest.doMock("./catalogue-import-dialog", () => ({ CatalogueImportDialog: () => <div data-testid="import-dialog" /> }));
jest.doMock("./edit-product-dialog", () => ({ EditProductDialog: ({ product }: { product: Product }) => <div data-testid="edit-dialog">{product.sku}</div> }));
jest.doMock("./product-drawer", () => ({ DRAWER_TABS: ["overview", "eans", "costs", "prices", "purchases", "margin", "history"], ProductDrawer: ({ product, tab }: { product: Product; tab: string }) => <div data-testid="record-drawer">{product.sku}:{tab}</div> }));
jest.doMock("./price-review-panel", () => ({ SITUATION_TONE: { healthy: "positive", review: "attention", opportunity: "neutral", pending: "neutral", stale: "attention", no_price: "neutral" }, PriceReviewPanel: ({ row }: { row: { product: Product } }) => <div data-testid="price-panel">{row.product.sku}</div> }));
jest.doMock("./batch-review-dialog", () => ({ BatchReviewDialog: ({ rows }: { rows: { product: Product }[] }) => <div data-testid="batch-dialog">{rows.map((r) => r.product.sku).join(",")}</div> }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ProductsWorkspace }: { ProductsWorkspace: ComponentType<Record<string, unknown>> } = require("./products-workspace");

const product = (sku: string, name: string, over: Partial<Product> = {}): Product => ({ id: Number(sku) || 1, sku, name, category: "beverage", units_per_package: null, package_type: null, fractionable: null, ...over });
const analysis = (sku: string, over: Partial<PricingProduct> = {}): PricingProduct =>
  ({ sku, name: sku, status: "healthy", currentPriceCents: 1190, currentMargin: 0.382, targetMargin: 0.35, recommendedPriceCents: 1120, recommendedMargin: 0.351, insufficientReasons: [], validated: true, structure: { productCostCents: 570 }, engineVersion: "pricing-4", ...over }) as PricingProduct;
const report = (products: PricingProduct[]) => ({ meta: { engineVersion: "pricing-4", parameterVersion: 2, basis: "current", months: ["2026-07", "2026-08", "2026-09"], asOf: "2026-10-08", storeId: null, payment: null, operating: null, notes: [] }, summary: {}, categories: [], products });

const open = (props: Record<string, unknown> = {}) => render(<ProductsWorkspace onViewPeriod={jest.fn()} onCategories={jest.fn()} {...props} />);

beforeEach(() => {
  jest.clearAllMocks();
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.setPointerCapture = () => undefined;
  proto.releasePointerCapture = () => undefined;
  proto.scrollIntoView = () => undefined;
  search = new URLSearchParams();
  canWrite = true;
  productList = [product("100103", "Monster Energy 269 ml", { subcategory: "Energéticos", ean: "7891000000001" }), product("100109", "Quiche Lorraine", { category: "snack" }), product("2265", "Milka caramelo"), product("100200", "Pizza nova"), product("100201", "Água sem custo")];
  costs = [
    { sku: "100103", product_id: 1, cost_cents: 570, effective_from: "2026-08-01", source: "invoice", invoice_number: "13021" },
    { sku: "100109", product_id: 2, cost_cents: 837, effective_from: "2026-09-01" },
    { sku: "2265", product_id: 3, cost_cents: 1399, effective_from: "2026-09-01" },
    { sku: "100200", product_id: 4, cost_cents: 500, effective_from: "2026-10-05" },
  ];
  prices = [
    { sku: "100103", price_cents: 1190, effective_from: "2026-08-01" },
    { sku: "100109", price_cents: 1490, effective_from: "2026-09-01" },
    { sku: "2265", price_cents: 3000, effective_from: "2026-09-01" }, // changed after the calculation (it used 2800)
    { sku: "100201", price_cents: 900, effective_from: "2026-09-01" },
  ];
  currentError = false;
  pricesFail = false;
  currentFetching = false;
  current = report([
    analysis("100103"),
    analysis("100109", { currentPriceCents: 1490, currentMargin: 0.266, recommendedPriceCents: 1730, recommendedMargin: 0.352, status: "adjust", structure: { productCostCents: 837 } as never }),
    analysis("2265", { currentPriceCents: 2800, currentMargin: 0.336, status: "adjust", structure: { productCostCents: 1399 } as never }),
  ]);
});

const rowOf = (name: string) => screen.getAllByTestId("product-row").find((row) => row.textContent?.includes(name)) as HTMLElement;

describe("ProductsWorkspace — uma lista só", () => {
  it("mostra título enxuto, as ações pedidas e UMA tabela com as colunas de decisão", () => {
    open();

    expect(screen.getByRole("heading", { name: "Produtos" })).toBeInTheDocument();
    for (const name of ["Analisar período", "Importar", "Novo produto", "Categorias", "Configurações"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.getAllByTestId("products-table")).toHaveLength(1);
    for (const header of ["Produto", "Custo/un.", "Preço atual", "Sugerido", "Margem atual", "Situação"]) expect(screen.getByRole("button", { name: new RegExp(`^${header}`) })).toBeInTheDocument();
    expect(screen.getByText("de contribuição")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/o mesmo produto em Compras, Estoque/i);
  });

  it("cada linha mostra custo e preço de hoje, sugerido e margem só do cálculo que ainda vale", () => {
    open();
    const monster = rowOf("Monster");

    expect(monster).toHaveTextContent("R$ 5,70");
    expect(monster).toHaveTextContent("R$ 11,90");
    expect(monster).toHaveTextContent("R$ 11,20");
    expect(monster).toHaveTextContent("38,2%");
    expect(monster).toHaveTextContent("Dentro da meta");
    expect(monster).toHaveTextContent("SKU 100103 · Bebida / Energéticos");
    expect(rowOf("Quiche")).toHaveTextContent("Revisar preço");
  });

  it("preço mudou depois do cálculo: a linha não mostra margem nem sugestão velhas e diz que está desatualizada", () => {
    open();
    const milka = rowOf("Milka");

    expect(milka).toHaveTextContent("R$ 30,00");
    expect(milka).toHaveTextContent("Desatualizado");
    expect(milka).not.toHaveTextContent("33,6%");
    expect(within(milka).getAllByText("—")).toHaveLength(2);
  });

  it("sem preço mostra 'Não definido' e nenhuma margem; sem custo mostra 'Sem custo'", () => {
    open();

    expect(rowOf("Pizza nova")).toHaveTextContent("Não definido");
    expect(rowOf("Pizza nova")).toHaveTextContent("Sem preço");
    expect(rowOf("Pizza nova")).not.toHaveTextContent("%");
    expect(rowOf("Água sem custo")).toHaveTextContent("Sem custo");
    expect(rowOf("Água sem custo")).toHaveTextContent("Dados pendentes");
  });

  it("os filtros rápidos trazem as contagens e filtram a lista", () => {
    open();
    const group = screen.getByRole("group", { name: "Filtros rápidos" });

    expect(within(group).getByRole("button", { name: /Todos/ })).toHaveTextContent("5");
    expect(within(group).getByRole("button", { name: /Sem preço/ })).toHaveTextContent("1");
    expect(within(group).getByRole("button", { name: /Abaixo da meta/ })).toHaveTextContent("1");
    expect(within(group).getByRole("button", { name: /Dados pendentes/ })).toHaveTextContent("2");

    fireEvent.click(within(group).getByRole("button", { name: /Sem preço/ }));
    expect(screen.getAllByTestId("product-row")).toHaveLength(1);
    fireEvent.click(within(group).getByRole("button", { name: /Abaixo da meta/ }));
    expect(screen.getAllByTestId("product-row")).toHaveLength(1);
    expect(screen.getByTestId("product-row")).toHaveTextContent("Quiche");
  });

  it("busca por nome, SKU ou qualquer EAN, e por categoria", () => {
    open();
    fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "7891000000001" } });
    expect(screen.getAllByTestId("product-row")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "quiche" } });
    expect(screen.getByTestId("product-row")).toHaveTextContent("Quiche");
    fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "zzz" } });
    expect(screen.getByText(/Nenhum produto com esses filtros/)).toBeInTheDocument();
  });

  it("abre já filtrada por categoria e subcategoria quando a URL traz (o link 'produtos vinculados' das Categorias)", () => {
    search = new URLSearchParams("category=beverage&subcategory=Energéticos");
    open();

    expect(screen.getAllByTestId("product-row")).toHaveLength(1);
    expect(screen.getByTestId("product-row")).toHaveTextContent("Monster");
  });

  it("um único resumo de pendências, que abre a lista de pendências", () => {
    open();
    const summary = screen.getByTestId("pendency-summary");

    expect(summary).toHaveTextContent("2 pendências de dados");
    fireEvent.click(within(summary).getByRole("button", { name: "Revisar" }));
    expect(screen.queryByTestId("rules-dialog")).not.toBeInTheDocument();
  });

  it("observações que só explicam o número (aproximações, médias) não contam como pendência, e ficam em 'Detalhes do cálculo'", () => {
    costs = [...costs, { sku: "100201", product_id: 5, cost_cents: 300, effective_from: "2026-09-01" }];
    current = report([analysis("100103"), analysis("100109", { currentPriceCents: 1490, structure: { productCostCents: 837 } as never }), analysis("2265", { currentPriceCents: 3000, structure: { productCostCents: 1399 } as never }), analysis("100201", { currentPriceCents: 900, structure: { productCostCents: 300 } as never })]);
    ((current as { meta: { payment: unknown } }).meta).payment = { notes: ["Taxa de credit pela média simples de 2 planos"], fixed: null };
    open();

    expect(screen.queryByTestId("pendency-summary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Detalhes do cálculo" }));
    expect(screen.getByRole("region", { name: "Como o número foi construído" })).toHaveTextContent("Taxa de credit pela média simples de 2 planos");
  });

  it("sem pendências o resumo não aparece", () => {
    costs = [...costs, { sku: "100201", product_id: 5, cost_cents: 300, effective_from: "2026-09-01" }];
    current = report([analysis("100103"), analysis("100109", { currentPriceCents: 1490, structure: { productCostCents: 837 } as never }), analysis("2265", { currentPriceCents: 3000, structure: { productCostCents: 1399 } as never }), analysis("100201", { currentPriceCents: 900, structure: { productCostCents: 300 } as never })]);
    open();

    expect(screen.queryByTestId("pendency-summary")).not.toBeInTheDocument();
  });
});

describe("ProductsWorkspace — leitura de custo e preço de hoje", () => {
  it("se o preço de hoje não pôde ser lido, não finge que os produtos estão sem preço: avisa, esconde a tabela e deixa tentar de novo", () => {
    pricesFail = true;
    open();

    expect(screen.getByTestId("registry-failed")).toHaveTextContent("Não foi possível ler o preço de hoje");
    expect(screen.getByTestId("products-table").closest("div")).toHaveClass("hidden");
    const group = screen.getByRole("group", { name: "Filtros rápidos" });
    expect(within(group).getByRole("button", { name: /Sem preço/ })).toHaveTextContent("—");
    fireEvent.click(within(screen.getByTestId("registry-failed")).getByRole("button", { name: /Tentar de novo/ }));
    expect(refetchPrices).toHaveBeenCalledTimes(1);
  });
});

describe("ProductsWorkspace — o cálculo de hoje", () => {
  it("a legenda diz que margem e sugestão são de hoje, com o custo e o preço de hoje, e de que meses vêm vendas, perdas e despesas", () => {
    open();
    const caption = screen.getByTestId("calculation-caption");

    expect(caption).toHaveTextContent("Margem de contribuição e sugestão calculadas hoje, com o custo e o preço de hoje");
    expect(caption).toHaveTextContent("vendas, perdas e despesas de jul/2026 a set/2026");
    fireEvent.click(within(caption).getByRole("button", { name: "Detalhes do cálculo" }));
    expect(screen.getByTestId("calculation-sheet")).toBeInTheDocument();
  });

  it("enquanto o cálculo não chega a lista já funciona e diz que está calculando, sem inventar margem", () => {
    current = undefined;
    open();

    expect(screen.getByTestId("calculation-caption")).toHaveTextContent("Calculando a precificação de hoje…");
    expect(screen.getAllByTestId("product-row")).toHaveLength(5);
    expect(rowOf("Monster")).not.toHaveTextContent("38,2%");
    expect(rowOf("Monster")).toHaveTextContent("R$ 11,90");
  });

  it("se o cálculo falha a lista continua, diz o que acontece e deixa tentar de novo", () => {
    current = undefined;
    currentError = true;
    open();

    expect(screen.getByTestId("calculation-caption")).toHaveTextContent("Não foi possível calcular a precificação de hoje");
    expect(screen.getAllByTestId("product-row")).toHaveLength(5);
    expect(rowOf("Monster")).toHaveTextContent("R$ 5,70");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(refetchCurrent).toHaveBeenCalledTimes(1);
    expect(refetchPrices).toHaveBeenCalledTimes(1);
    expect(refetchCosts).toHaveBeenCalledTimes(1);
  });

  it("Atualizar relê custo, preço e o cálculo de hoje", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));

    expect(refetchCurrent).toHaveBeenCalledTimes(1);
    expect(refetchPrices).toHaveBeenCalledTimes(1);
    expect(refetchCosts).toHaveBeenCalledTimes(1);
  });

  it("escolher uma loja diz que o preço de venda continua único para a rede", () => {
    open();
    const trigger = screen.getByRole("combobox", { name: "Loja" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Loja Centro" }));

    expect(screen.getByTestId("calculation-caption")).toHaveTextContent("o preço de venda continua sendo único para a rede");
  });
});

describe("ProductsWorkspace — abrir, selecionar e revisar", () => {
  it("clicar na linha ou em Revisar abre o painel de preço do produto pela URL", () => {
    open();
    fireEvent.click(rowOf("Monster"));
    expect(replace).toHaveBeenCalledWith("/products?sku=100103", { scroll: false });
  });

  it("?sku= abre o painel de preço; ?sku=&tab= abre o cadastro completo (os links antigos continuam valendo)", () => {
    search = new URLSearchParams("sku=100103");
    const first = open();
    expect(screen.getByTestId("price-panel")).toHaveTextContent("100103");
    expect(screen.queryByTestId("record-drawer")).not.toBeInTheDocument();
    first.unmount();

    search = new URLSearchParams("sku=100103&tab=costs");
    open();
    expect(screen.getByTestId("record-drawer")).toHaveTextContent("100103:costs");
    expect(screen.queryByTestId("price-panel")).not.toBeInTheDocument();
  });

  it("selecionar produtos mostra a barra de seleção e abre a revisão em lote só com os escolhidos", () => {
    open();
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar Quiche Lorraine" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar Monster Energy 269 ml" }));

    expect(screen.getByRole("region", { name: "Seleção" })).toHaveTextContent("2 produtos selecionados");
    fireEvent.click(screen.getByRole("button", { name: "Revisar preços em lote" }));
    expect(screen.getByTestId("batch-dialog")).toHaveTextContent("100103,100109");
  });

  it("clicar na caixa de seleção não abre o painel do produto", () => {
    open();
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar Quiche Lorraine" }));

    expect(replace).not.toHaveBeenCalled();
  });

  it("sem permissão de escrita não há Novo produto, Importar nem revisão em lote", () => {
    canWrite = false;
    open();
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar Quiche Lorraine" }));

    expect(screen.queryByRole("button", { name: "Novo produto" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Importar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revisar preços em lote" })).not.toBeInTheDocument();
  });

  it("Novo produto abre o painel de cadastro; Analisar período e Categorias avisam o pai", () => {
    const onViewPeriod = jest.fn();
    const onCategories = jest.fn();
    open({ onViewPeriod, onCategories });
    fireEvent.click(screen.getByRole("button", { name: "Novo produto" }));
    expect(screen.getByTestId("new-product-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Analisar período" }));
    fireEvent.click(screen.getByRole("button", { name: "Categorias" }));

    expect(onViewPeriod).toHaveBeenCalledTimes(1);
    expect(onCategories).toHaveBeenCalledTimes(1);
  });

  it("ordenar por margem põe os vazios no fim em qualquer sentido", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /^Margem atual/ }));
    const ascending = screen.getAllByTestId("product-row").map((row) => row.textContent ?? "");
    expect(ascending[0]).toContain("Quiche");
    fireEvent.click(screen.getByRole("button", { name: /^Margem atual/ }));
    await waitFor(() => expect(screen.getAllByTestId("product-row")[0]).toHaveTextContent("Monster"));
    expect(screen.getAllByTestId("product-row").at(-1)?.textContent).not.toMatch(/\d+,\d%/);
  });
});
