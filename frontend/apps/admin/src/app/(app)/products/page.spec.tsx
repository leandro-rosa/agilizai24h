import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

import type { Product } from "@/lib/api/products";

const updateProductTrigger = jest.fn((_arg: unknown) => ({ unwrap: () => Promise.resolve({}) }));
const downloadProductsWorkbook = jest.fn((_items: unknown) => undefined);
const replace = jest.fn();
let searchParams = new URLSearchParams();

const mockUseGetProductsQuery = jest.fn();
const mockUseGetCostsAsOfQuery = jest.fn();
const mockUseUpdateProductMutation = jest.fn();
const mockUseHasPermission = jest.fn();

const PRODUCTS: Product[] = [
  { id: 1, sku: "SKU-1", name: "Água com gás", category: "beverage", subcategory: null, ean: null, status: "active", units_per_package: null, package_type: null, fractionable: null, sale_unit: "un", brand: null, purchase_unit: null, eans: [], origin: { type: "legacy_import", invoice_number: null, supplier_id: null, purchase_id: null, on: null, actor: null } },
  {
    id: 2, sku: "110024", name: "Novo sabor de marmita", category: "meal", subcategory: "Marmitas", brand: "Casa", purchase_unit: "CX", ean: "7891000100103", supplier_id: 5, status: "active", units_per_package: 12, package_type: "caixa", fractionable: null, sale_unit: "un",
    eans: [
      { id: 1, ean: "7891000100103", status: "active", is_primary: true, valid_from: "2026-10-10", valid_to: null, source: "invoice_import", actor: "ana@agiliz.ai", note: null },
      { id: 2, ean: "7891000100222", status: "active", is_primary: false, valid_from: null, valid_to: null, source: "manual", actor: null, note: null },
      { id: 3, ean: "7890000000001", status: "inactive", is_primary: false, valid_from: null, valid_to: "2026-09-01", source: "manual", actor: null, note: null },
    ],
    origin: { type: "invoice", invoice_number: "13021", supplier_id: 5, purchase_id: 9, on: "2026-10-10", actor: "ana@agiliz.ai" },
  },
  { id: 3, sku: "SKU-OFF", name: "Produto descontinuado", category: "snack", status: "discontinued", units_per_package: null, package_type: null, fractionable: null, eans: [] },
];

// jest.doMock (never hoisted) + a dynamic require: the page and its imports load only after the mocks exist (see the notes of the other specs).
jest.doMock("../../../lib/api/products", () => ({
  useGetProductsQuery: mockUseGetProductsQuery,
  useGetCostsAsOfQuery: mockUseGetCostsAsOfQuery,
  useUpdateProductMutation: mockUseUpdateProductMutation,
}));
jest.doMock("../../../lib/products/excel", () => ({ downloadProductsWorkbook }));
jest.doMock("next/navigation", () => ({ useRouter: () => ({ replace }), useSearchParams: () => searchParams }));
jest.doMock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
jest.doMock("../../../lib/api/suppliers", () => ({ useGetSuppliersQuery: () => ({ data: [{ id: 5, name: "Juntos+" }] }) }));
jest.doMock("../../../components/products/product-drawer", () => ({
  DRAWER_TABS: ["overview", "costs", "prices", "history", "purchases", "margin"],
  ProductDrawer: ({ product, tab }: { product: { sku: string }; tab: string }) => <div data-testid="drawer">{product.sku}:{tab}</div>,
}));
jest.doMock("../../../components/products/new-product-dialog", () => ({ NewProductDialog: () => <div data-testid="new-product" /> }));
jest.doMock("../../../components/products/catalogue-import-dialog", () => ({ CatalogueImportDialog: () => <div data-testid="import-dialog" /> }));
// O menu do Radix abre por teclado e portal; aqui só importa o que cada item faz.
jest.doMock("../../../components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, asChild }: { children: React.ReactNode; onSelect?: () => void; asChild?: boolean }) => (asChild ? <>{children}</> : <button type="button" onClick={onSelect}>{children}</button>),
}));
jest.doMock("../../../lib/auth/use-permission", () => ({ useHasPermission: mockUseHasPermission }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ProductsPage: ComponentType = require("./page").default;

beforeEach(() => {
  updateProductTrigger.mockClear();
  downloadProductsWorkbook.mockClear();
  replace.mockClear();
  searchParams = new URLSearchParams();
  mockUseGetProductsQuery.mockReturnValue({ data: PRODUCTS, isLoading: false });
  mockUseGetCostsAsOfQuery.mockReturnValue({ data: { resolved: [{ sku: "110024", product_id: 2, cost_cents: 620, effective_from: "2026-10-10" }], unresolved: [] } });
  mockUseUpdateProductMutation.mockReturnValue([updateProductTrigger, { isLoading: false }]);
  mockUseHasPermission.mockReturnValue(true);

  // Radix Select scrolls the highlighted item into view and Checkbox measures itself; jsdom has neither.
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe("ProductsPage — manutenção do catálogo", () => {
  it("a tabela é enxuta: sem preço de venda e sem margem, com o último custo unitário e a data", () => {
    render(<ProductsPage />);

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["SKU", "Nome", "Categoria", "EAN", "Unidade de venda", "Último custo unitário", "Situação", ""]);
    expect(headers.join(" ")).not.toMatch(/Preço|Margem|Fornecedor/);

    const row = screen.getByText("Novo sabor de marmita").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("R$ 6,20");
    expect(row).toHaveTextContent("desde 10/10/2026");
    expect(row).toHaveTextContent("7891000100103");
    expect(row).toHaveTextContent("+1");
    expect(row).toHaveTextContent("12 un. por caixa");
    expect(row).toHaveTextContent("Casa");
    expect(row).toHaveTextContent("Cadastrado por NF-e");
  });

  it("sem custo diz 'Sem custo', nunca R$ 0,00", () => {
    render(<ProductsPage />);

    expect(screen.getByText("Água com gás").closest("tr")).toHaveTextContent("Sem custo");
    expect(screen.queryByText("R$ 0,00")).not.toBeInTheDocument();
  });

  it("tem as três ações principais: Novo produto, Importar Excel e Exportar catálogo; sem o botão de sincronizar", () => {
    render(<ProductsPage />);

    expect(screen.getByRole("button", { name: /Novo produto/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Importar Excel/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exportar catálogo/ })).toBeInTheDocument();
    expect(screen.queryByText(/Sincronizar com a precificação/)).not.toBeInTheDocument();
  });

  it("Importar Excel oferece o catálogo (modelo e mapeamento) e, dentro dele, a planilha de precificação que já existia", () => {
    render(<ProductsPage />);

    fireEvent.click(screen.getByRole("button", { name: /Catálogo de produtos/ }));
    expect(screen.getByTestId("import-dialog")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Planilha de precificação/ })).toHaveAttribute("href", "/products/sync");
  });

  it("Novo produto abre o cadastro único e o produto criado abre pela URL", () => {
    render(<ProductsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Novo produto/ }));

    expect(screen.getByTestId("new-product")).toBeInTheDocument();
  });

  it("a busca acha o produto por qualquer EAN, inclusive um inativo, e por SKU; só há filtros de categoria e situação", () => {
    render(<ProductsPage />);

    expect(screen.queryByRole("combobox", { name: "Fornecedor" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Categoria" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Situação" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "7890000000001" } });
    expect(screen.getByText("Novo sabor de marmita")).toBeInTheDocument();
    expect(screen.queryByText("Água com gás")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "sku-off" } });
    expect(screen.getByText("Produto descontinuado")).toBeInTheDocument();
    expect(screen.queryByText("Novo sabor de marmita")).not.toBeInTheDocument();
  });

  it("abrir o cadastro vai para a URL do produto, e a URL com sku abre o painel na aba pedida", () => {
    const { unmount } = render(<ProductsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir Novo sabor de marmita" }));
    expect(replace).toHaveBeenCalledWith("/products?sku=110024&tab=overview", { scroll: false });
    unmount();

    searchParams = new URLSearchParams("sku=110024&tab=costs");
    render(<ProductsPage />);
    expect(screen.getByTestId("drawer")).toHaveTextContent("110024:costs");
  });

  it("uma aba desconhecida cai na visão geral, e um SKU que não existe não abre nada", () => {
    searchParams = new URLSearchParams("sku=110024&tab=whatever");
    const { unmount } = render(<ProductsPage />);
    expect(screen.getByTestId("drawer")).toHaveTextContent("110024:overview");
    unmount();

    searchParams = new URLSearchParams("sku=NAO-EXISTE");
    render(<ProductsPage />);
    expect(screen.queryByTestId("drawer")).not.toBeInTheDocument();
  });

  it("a planilha exportada leva só a lista filtrada, com o último custo e a data, e fica desligada com a lista vazia", async () => {
    render(<ProductsPage />);
    fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "marmita" } });
    fireEvent.click(screen.getByRole("button", { name: /Exportar catálogo/ }));

    await waitFor(() => expect(downloadProductsWorkbook).toHaveBeenCalledTimes(1));
    const items = downloadProductsWorkbook.mock.calls[0][0] as { product: { sku: string }; costCents: number | null; costDate: string | null }[];
    expect(items).toEqual([expect.objectContaining({ costCents: 620, costDate: "2026-10-10" })]);
    expect(items[0].product.sku).toBe("110024");

    fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "nada com esse nome" } });
    expect(screen.getByRole("button", { name: /Exportar catálogo/ })).toBeDisabled();
  });

  it("sem permissão de escrita não há Novo produto, Importar nem editar; exportar continua", () => {
    mockUseHasPermission.mockReturnValue(false);
    render(<ProductsPage />);

    expect(screen.queryByRole("button", { name: /Novo produto/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Importar Excel/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Editar/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exportar catálogo/ })).toBeInTheDocument();
  });

  it("edita identificação, marca, unidades e fator, e limpa o que ficou em branco com null", async () => {
    render(<ProductsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Editar Água com gás" }));

    fireEvent.change(screen.getByLabelText(/Marca/), { target: { value: "Crystal" } });
    fireEvent.change(screen.getByLabelText(/Unidade de compra/), { target: { value: "CX" } });
    fireEvent.change(screen.getByLabelText(/Fator: unidades por caixa\/fardo/), { target: { value: "24" } });
    fireEvent.click(screen.getByRole("combobox", { name: /tipo de embalagem/i }));
    fireEvent.click(screen.getByRole("option", { name: "caixa" }));
    fireEvent.click(screen.getByRole("button", { name: /salvar/i }));

    await waitFor(() => expect(updateProductTrigger).toHaveBeenCalledTimes(1));
    expect(updateProductTrigger).toHaveBeenCalledWith({
      id: 1,
      changes: { name: "Água com gás", subcategory: null, brand: "Crystal", saleUnit: "un", purchaseUnit: "CX", status: "active", unitsPerPackage: 24, packageType: "caixa", fractionable: false },
    });
  });
});
