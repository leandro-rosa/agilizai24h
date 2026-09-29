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
jest.doMock("../../../lib/auth/use-permission", () => ({
  useHasPermission: mockUseHasPermission,
}));

// Must run after the doMock() calls above, not hoisted like a static import (see comment above).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ProductsPage: ComponentType = require("./page").default;

beforeEach(() => {
  updateProductTrigger.mockClear();
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

    fireEvent.click(screen.getByRole("button", { name: /editar/i }));

    fireEvent.change(screen.getByLabelText(/unidades por embalagem/i), { target: { value: "24" } });

    fireEvent.click(screen.getByRole("combobox", { name: /tipo de embalagem/i }));
    fireEvent.click(screen.getByRole("option", { name: "caixa" }));

    fireEvent.click(screen.getByLabelText(/fracionável/i));

    fireEvent.click(screen.getByRole("button", { name: /salvar/i }));

    await waitFor(() =>
      expect(updateProductTrigger).toHaveBeenCalledWith({
        id: 1,
        changes: { unitsPerPackage: 24, packageType: "caixa", fractionable: true },
      }),
    );
  });
});
