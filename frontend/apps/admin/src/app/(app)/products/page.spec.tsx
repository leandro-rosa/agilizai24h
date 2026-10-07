import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

import type { Product } from "@/lib/api/products";

const updateProductTrigger = jest.fn(() => ({ unwrap: () => Promise.resolve({}) }));

const mockUseGetProductsQuery = jest.fn();
const mockUseGetCostsAsOfQuery = jest.fn();
const mockUseGetPricesAsOfQuery = jest.fn();
const mockUseUpdateProductMutation = jest.fn();
const mockUseHasPermission = jest.fn();
const replace = jest.fn();
let searchParams = new URLSearchParams();

const PRODUCTS: Product[] = [
  {
    id: 1,
    sku: "SKU-1",
    name: "Água com gás",
    category: "beverage",
    subcategory: null,
    ean: null,
    supplier_id: null,
    net_weight: null,
    ncm: null,
    cest: null,
    shelf_life_days: null,
    status: "active",
    units_per_package: null,
    package_type: null,
    fractionable: null,
    sale_unit: "un",
    eans: [],
    origin: { type: "legacy_import", invoice_number: null, supplier_id: null, purchase_id: null, on: null, actor: null },
  },
  {
    id: 2,
    sku: "110024",
    name: "Novo sabor de marmita",
    category: "meal",
    subcategory: "Marmitas",
    ean: "7891000100103",
    supplier_id: 5,
    status: "active",
    units_per_package: null,
    package_type: null,
    fractionable: null,
    sale_unit: "un",
    eans: [
      { id: 1, ean: "7891000100103", status: "active", is_primary: true, valid_from: "2026-10-10", valid_to: null, source: "invoice_import", actor: "ana@agiliz.ai", note: null },
      { id: 2, ean: "7891000100222", status: "active", is_primary: false, valid_from: null, valid_to: null, source: "manual", actor: null, note: null },
      { id: 3, ean: "7890000000001", status: "inactive", is_primary: false, valid_from: null, valid_to: "2026-09-01", source: "manual", actor: null, note: null },
    ],
    origin: { type: "invoice", invoice_number: "13021", supplier_id: 5, purchase_id: 9, on: "2026-10-10", actor: "ana@agiliz.ai" },
  },
  {
    id: 3,
    sku: "SKU-OFF",
    name: "Produto descontinuado",
    category: "snack",
    supplier_id: null,
    status: "discontinued",
    units_per_package: null,
    package_type: null,
    fractionable: null,
    eans: [],
  },
];

// This SWC-based Jest transform hoists `import` declarations to the true top of
// the file (standard ES-module semantics) but does NOT hoist jest.mock() above
// them the way babel-jest does — a static `import ProductsPage from "./page"`
// would always load the real @/lib/api/products before any jest.mock() call in
// this file got a chance to run (confirmed empirically: the real fetchBaseQuery
// executed regardless of where jest.mock() was written). jest.doMock() (which is
// explicitly never hoisted) plus a dynamic require() sidesteps that: page.tsx's
// own module evaluation, and its transitive import of these modules, only
// happens once the mocks below are already registered.
//
// Deliberately no jest.resetModules(): this file never statically imports
// @/lib/api/products or @/lib/auth/use-permission (only `import type`, erased
// at compile time), so doMock() below is registered before either module's
// first real require — no reset needed. resetModules() would also invalidate
// the cached `react`/`react-dom` module instances that @testing-library/react
// and this file's own JSX already bound to, giving page.tsx's dynamically
// require()'d hooks a second, disconnected React copy ("Invalid hook call").
jest.doMock("../../../lib/api/products", () => ({
  useGetProductsQuery: mockUseGetProductsQuery,
  useGetCostsAsOfQuery: mockUseGetCostsAsOfQuery,
  useGetPricesAsOfQuery: mockUseGetPricesAsOfQuery,
  useUpdateProductMutation: mockUseUpdateProductMutation,
}));
jest.doMock("next/navigation", () => ({ useRouter: () => ({ replace }), useSearchParams: () => searchParams }));
jest.doMock("../../../lib/api/suppliers", () => ({ useGetSuppliersQuery: () => ({ data: [{ id: 5, name: "Juntos+" }] }) }));
jest.doMock("../../../components/products/product-drawer", () => ({
  DRAWER_TABS: ["overview", "costs", "prices", "history"],
  ProductDrawer: ({ product, tab }: { product: { sku: string }; tab: string }) => <div data-testid="drawer">{product.sku}:{tab}</div>,
}));
jest.doMock("../../../lib/auth/use-permission", () => ({
  useHasPermission: mockUseHasPermission,
}));

// Must run after the doMock() calls above, not hoisted like a static import (see comment above).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ProductsPage: ComponentType = require("./page").default;

beforeEach(() => {
  updateProductTrigger.mockClear();
  replace.mockClear();
  searchParams = new URLSearchParams();
  mockUseGetProductsQuery.mockReturnValue({ data: PRODUCTS, isLoading: false });
  mockUseGetCostsAsOfQuery.mockReturnValue({ data: undefined });
  mockUseGetPricesAsOfQuery.mockReturnValue({ data: undefined });
  mockUseUpdateProductMutation.mockReturnValue([updateProductTrigger, { isLoading: false }]);
  mockUseHasPermission.mockReturnValue(true);

  // Radix Select scrolls the highlighted item into view when it opens — jsdom has
  // no layout engine and doesn't implement scrollIntoView at all (same fix as
  // decisions-table.spec.tsx).
  window.HTMLElement.prototype.scrollIntoView = jest.fn();

  // Radix Checkbox measures itself via ResizeObserver, which jsdom doesn't
  // implement either — first use of Checkbox inside ResourceFormDialog.
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe("ProductsPage", () => {
  it("opens an edit dialog for a product and saves packaging fields", async () => {
    render(<ProductsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Editar Água com gás" }));

    fireEvent.change(screen.getByLabelText(/unidades por embalagem/i), { target: { value: "24" } });

    fireEvent.click(screen.getByRole("combobox", { name: /tipo de embalagem/i }));
    fireEvent.click(screen.getByRole("option", { name: "caixa" }));

    fireEvent.click(screen.getByLabelText(/fracionável/i));

    fireEvent.click(screen.getByRole("button", { name: /salvar/i }));

    await waitFor(() =>
      expect(updateProductTrigger).toHaveBeenCalledWith({
        id: 1,
        changes: { name: "Água com gás", subcategory: null, saleUnit: "un", status: "active", unitsPerPackage: 24, packageType: "caixa", fractionable: true },
      }),
    );
  });

  it("mostra fornecedor, EAN principal com os outros ativos contados, e a origem NF-e", () => {
    render(<ProductsPage />);

    const row = screen.getByText("Novo sabor de marmita").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("Juntos+");
    expect(row).toHaveTextContent("7891000100103");
    expect(row).toHaveTextContent("+1");
    expect(row).toHaveTextContent("Cadastrado por NF-e");
    expect(screen.getByText("Produto descontinuado").closest("tr")).toHaveTextContent("Descontinuado");
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

  it("sem custo ou sem preço a margem é traço, nunca zero", () => {
    render(<ProductsPage />);

    expect(screen.getAllByText("Sem custo").length).toBe(3);
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });

  it("o Ver abre o produto pela URL, e a URL com sku abre o painel na aba pedida", () => {
    const { unmount } = render(<ProductsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Ver Novo sabor de marmita" }));
    expect(replace).toHaveBeenCalledWith("/products?sku=110024&tab=overview", { scroll: false });
    unmount();

    searchParams = new URLSearchParams("sku=110024&tab=costs");
    render(<ProductsPage />);
    expect(screen.getByTestId("drawer")).toHaveTextContent("110024:costs");
  });

  it("uma aba desconhecida na URL cai na visão geral, e um SKU que não existe não abre nada", () => {
    searchParams = new URLSearchParams("sku=110024&tab=whatever");
    const { unmount } = render(<ProductsPage />);
    expect(screen.getByTestId("drawer")).toHaveTextContent("110024:overview");
    unmount();

    searchParams = new URLSearchParams("sku=NAO-EXISTE");
    render(<ProductsPage />);
    expect(screen.queryByTestId("drawer")).not.toBeInTheDocument();
  });

  it("sem permissão de escrita não há botão de editar", () => {
    mockUseHasPermission.mockReturnValue(false);
    render(<ProductsPage />);

    expect(screen.queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver Água com gás" })).toBeInTheDocument();
  });
});
