import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

import type { Product } from "@/lib/api/products";

const downloadProductsWorkbook = jest.fn((_items: unknown) => undefined);
const replace = jest.fn();
let searchParams = new URLSearchParams();

const mockUseGetProductsQuery = jest.fn();
const mockUseGetCostsAsOfQuery = jest.fn();
const mockUseGetPricesAsOfQuery = jest.fn();
const CATEGORIES = [
  { id: 1, key: "beverage", name: "Bebida", keywords: [], status: "active", products: 1, subcategories: [] },
  { id: 2, key: "meal", name: "Refeição", keywords: [], status: "active", products: 1, subcategories: [] },
  { id: 3, key: "snack", name: "Lanche", keywords: [], status: "inactive", products: 1, subcategories: [] },
];

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
jest.doMock("../../lib/api/products", () => ({
  useGetProductsQuery: mockUseGetProductsQuery,
  useGetCostsAsOfQuery: mockUseGetCostsAsOfQuery,
  useGetPricesAsOfQuery: mockUseGetPricesAsOfQuery,
  useGetCategoriesQuery: () => ({ data: CATEGORIES }),
}));
jest.doMock("../../lib/products/excel", () => ({ downloadProductsWorkbook }));
jest.doMock("next/navigation", () => ({ useRouter: () => ({ replace }), useSearchParams: () => searchParams }));
jest.doMock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
jest.doMock("../../lib/api/suppliers", () => ({ useGetSuppliersQuery: () => ({ data: [{ id: 5, name: "Juntos+" }] }) }));
jest.doMock("./product-drawer", () => ({
  DRAWER_TABS: ["overview", "costs", "prices", "history", "purchases", "margin"],
  ProductDrawer: ({ product, tab }: { product: { sku: string }; tab: string }) => <div data-testid="drawer">{product.sku}:{tab}</div>,
}));
jest.doMock("./edit-product-dialog", () => ({ EditProductDialog: ({ product }: { product: { sku: string } }) => <div data-testid="edit-dialog">{product.sku}</div> }));
jest.doMock("./catalogue-import-dialog", () => ({ CatalogueImportDialog: () => <div data-testid="import-dialog" /> }));
// O menu do Radix abre por teclado e portal; aqui só importa o que cada item faz.
jest.doMock("../ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, asChild }: { children: React.ReactNode; onSelect?: () => void; asChild?: boolean }) => (asChild ? <>{children}</> : <button type="button" onClick={onSelect}>{children}</button>),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const CatalogueView: ComponentType<{ canWrite: boolean; importing: boolean; onImportingChange: (open: boolean) => void }> = require("./catalogue-view").CatalogueView;
const onImportingChange = jest.fn();
const ProductsPage = ({ canWrite = true, importing = false }: { canWrite?: boolean; importing?: boolean } = {}) => <CatalogueView canWrite={canWrite} importing={importing} onImportingChange={onImportingChange} />;

beforeEach(() => {
  downloadProductsWorkbook.mockClear();
  onImportingChange.mockClear();
  replace.mockClear();
  searchParams = new URLSearchParams();
  mockUseGetProductsQuery.mockReturnValue({ data: PRODUCTS, isLoading: false });
  mockUseGetCostsAsOfQuery.mockReturnValue({ data: { resolved: [{ sku: "110024", product_id: 2, cost_cents: 620, effective_from: "2026-10-10" }], unresolved: [] } });
  mockUseGetPricesAsOfQuery.mockReturnValue({ data: { resolved: [{ sku: "110024", price_cents: 1290, effective_from: "2026-10-12" }], unresolved: [], complete: false } });

  // Radix Select scrolls the highlighted item into view; jsdom has no layout engine.
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
});

describe("CatalogueView — o catálogo", () => {
  it("mostra todos os produtos, inclusive os novos e os sem preço, nas colunas de manutenção", () => {
    render(<ProductsPage />);

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Produto", "Categoria / subcategoria", "EAN", "Unidade de venda", "Último custo unitário", "Preço vigente", "Situação", ""]);
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.getByText("Água com gás")).toBeInTheDocument();
  });

  it("o último custo vem com a data e o preço vigente com a dele; sem preço é 'Preço pendente', nunca zero", () => {
    render(<ProductsPage />);

    const row = screen.getByText("Novo sabor de marmita").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("R$ 6,20");
    expect(row).toHaveTextContent("desde 10/10/2026");
    expect(row).toHaveTextContent("R$ 12,90");
    expect(row).toHaveTextContent("desde 12/10/2026");
    expect(row).toHaveTextContent("Refeição");
    expect(row).toHaveTextContent("Marmitas");
    expect(row).toHaveTextContent("Juntos+");
    expect(row).toHaveTextContent("7891000100103");
    expect(row).toHaveTextContent("+1");
    expect(row).toHaveTextContent("12 un. por caixa");
    expect(row).toHaveTextContent("Cadastrado por NF-e");

    const pending = screen.getByText("Água com gás").closest("tr") as HTMLElement;
    expect(pending).toHaveTextContent("Sem custo");
    expect(pending).toHaveTextContent("Preço pendente");
    expect(screen.queryByText("R$ 0,00")).not.toBeInTheDocument();
  });

  it("a categoria sai do cadastro de categorias: uma chave sem nome conhecido aparece pela chave, nunca como 'Outros'", () => {
    mockUseGetProductsQuery.mockReturnValue({ data: [{ ...PRODUCTS[0], category: "congelados" }], isLoading: false });
    render(<ProductsPage />);

    expect(screen.getByText("congelados")).toBeInTheDocument();
    expect(screen.queryByText("Outros")).not.toBeInTheDocument();
  });

  it("Precificar leva à aba de precificação com o produto aberto, e Abrir leva ao cadastro pela URL", () => {
    render(<ProductsPage />);

    expect(screen.getByRole("link", { name: "Precificar Novo sabor de marmita" })).toHaveAttribute("href", "/products?view=pricing&sku=110024");
    fireEvent.click(screen.getByRole("button", { name: "Abrir Novo sabor de marmita" }));
    expect(replace).toHaveBeenCalledWith("/products?sku=110024&tab=overview", { scroll: false });
  });

  it("a URL com sku abre o painel na aba pedida; aba desconhecida cai na visão geral; SKU que não existe não abre nada", () => {
    searchParams = new URLSearchParams("sku=110024&tab=costs");
    const first = render(<ProductsPage />);
    expect(screen.getByTestId("drawer")).toHaveTextContent("110024:costs");
    first.unmount();

    searchParams = new URLSearchParams("sku=110024&tab=whatever");
    const second = render(<ProductsPage />);
    expect(screen.getByTestId("drawer")).toHaveTextContent("110024:overview");
    second.unmount();

    searchParams = new URLSearchParams("sku=NAO-EXISTE");
    render(<ProductsPage />);
    expect(screen.queryByTestId("drawer")).not.toBeInTheDocument();
  });

  it("a busca acha o produto por qualquer EAN, inclusive um inativo, e por SKU", () => {
    render(<ProductsPage />);

    fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "7890000000001" } });
    expect(screen.getByText("Novo sabor de marmita")).toBeInTheDocument();
    expect(screen.queryByText("Água com gás")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "sku-off" } });
    expect(screen.getByText("Produto descontinuado")).toBeInTheDocument();
    expect(screen.queryByText("Novo sabor de marmita")).not.toBeInTheDocument();
  });

  it("só há filtros de categoria e situação; sem fornecedor", () => {
    render(<ProductsPage />);

    expect(screen.getByRole("combobox", { name: "Categoria" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Situação" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Fornecedor" })).not.toBeInTheDocument();
  });

  it("Importar Excel oferece o catálogo (modelo e mapeamento) e, dentro dele, a planilha de precificação", () => {
    render(<ProductsPage />);

    fireEvent.click(screen.getByRole("button", { name: /Catálogo de produtos/ }));
    expect(onImportingChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("link", { name: /Planilha de precificação/ })).toHaveAttribute("href", "/products/sync");
    expect(screen.queryByText(/Sincronizar com a precificação/)).not.toBeInTheDocument();
  });

  it("o assistente de importação abre quando o pai pede", () => {
    render(<ProductsPage importing />);

    expect(screen.getByTestId("import-dialog")).toBeInTheDocument();
  });

  it("Editar abre a edição do produto; sem permissão de escrita não há editar nem importar, e exportar continua", () => {
    const first = render(<ProductsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Editar Água com gás" }));
    expect(screen.getByTestId("edit-dialog")).toHaveTextContent("SKU-1");
    first.unmount();

    render(<ProductsPage canWrite={false} />);
    expect(screen.queryByRole("button", { name: /^Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Importar Excel/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exportar catálogo/ })).toBeInTheDocument();
  });

  it("a planilha exportada leva só a lista filtrada, com o nome da categoria do cadastro, o último custo e a data; desligada com a lista vazia", async () => {
    render(<ProductsPage />);
    fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "marmita" } });
    fireEvent.click(screen.getByRole("button", { name: /Exportar catálogo/ }));

    await waitFor(() => expect(downloadProductsWorkbook).toHaveBeenCalledTimes(1));
    const items = downloadProductsWorkbook.mock.calls[0][0] as { product: { sku: string }; categoryName: string; costCents: number | null; costDate: string | null }[];
    expect(items).toEqual([expect.objectContaining({ categoryName: "Refeição", costCents: 620, costDate: "2026-10-10" })]);
    expect(items[0].product.sku).toBe("110024");

    fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "nada com esse nome" } });
    expect(screen.getByRole("button", { name: /Exportar catálogo/ })).toBeDisabled();
  });
});
