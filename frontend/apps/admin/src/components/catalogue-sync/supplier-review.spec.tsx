import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

const updateProduct = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const createSupplier = jest.fn((_arg: unknown) => ({ unwrap: async () => ({ id: 500, name: "Novo" }) }));
const resolveSuppliers = () => ({ unwrap: async () => ({ matched: [], unmatched: [] }) });
const addAlias = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));

const supplier = (id: number, name: string) => ({ id, name, category: "grocery", status: "active" });
const SUPPLIERS = [supplier(63, "Distribuidora Marsil"), supplier(83, "Urca")];
const PRODUCTS = [
  { id: 1, sku: "1", name: "A", supplier_id: null },
  { id: 2, sku: "2", name: "B", supplier_id: null },
  { id: 3, sku: "3", name: "C", supplier_id: 9 },
];

jest.doMock("../../lib/api/products", () => ({
  useGetProductsQuery: () => ({ data: PRODUCTS }),
  useUpdateProductMutation: () => [updateProduct],
}));
jest.doMock("../../lib/api/suppliers", () => ({
  SUPPLIER_CATEGORIES: ["grocery"],
  SUPPLIER_CATEGORY_LABELS: { grocery: "Mercearia" },
  useGetSuppliersQuery: () => ({ data: SUPPLIERS }),
  useResolveSuppliersMutation: () => [resolveSuppliers],
  useCreateSupplierMutation: () => [createSupplier],
  useAddAliasMutation: () => [addAlias],
}));
jest.doMock("../../lib/hooks", () => ({ useAppDispatch: () => jest.fn() }));

type Row = { row: number; sku: string; name: string; category: null; subcategory: null; ean: null; supplier: string | null; cost_cents: null; cost_error: boolean; price_cents: null; package_type: null };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SupplierReview }: { SupplierReview: ComponentType<{ rows: Row[] }> } = require("./supplier-review");

const row = (sku: string, supplier: string | null): Row => ({ row: 2, sku, name: sku, category: null, subcategory: null, ean: null, supplier, cost_cents: null, cost_error: false, price_cents: null, package_type: null });
const ROWS = [row("1", "Marsil"), row("2", "Marsil"), row("3", "Marsil")];

describe("SupplierReview", () => {
  beforeEach(() => jest.clearAllMocks());

  it("só sugere: nada vem escolhido e nada é gravado sem confirmar", () => {
    render(<SupplierReview rows={ROWS} />);

    expect(screen.getByText(/Sugestão: Distribuidora Marsil/)).toBeInTheDocument();
    expect(screen.getByText(/1 já com fornecedor, não mudam/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Revisar e vincular \(0 produtos\)/ })).toBeDisabled();
    expect(updateProduct).not.toHaveBeenCalled();
  });

  it("aceitar a sugestão e confirmar vincula só os produtos sem fornecedor e grava a grafia como alias", async () => {
    render(<SupplierReview rows={ROWS} />);

    fireEvent.click(screen.getByText(/Sugestão: Distribuidora Marsil/));
    fireEvent.click(screen.getByRole("button", { name: /Revisar e vincular \(2 produtos\)/ }));
    expect(updateProduct).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Vincular" }));

    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(2));
    expect(updateProduct.mock.calls.map((c) => (c[0] as { id: number }).id).sort()).toEqual([1, 2]);
    expect(updateProduct.mock.calls.every((c) => (c[0] as { changes: { supplierId: number } }).changes.supplierId === 63)).toBe(true);
    expect(addAlias).toHaveBeenCalledWith({ id: 63, alias: "Marsil" });
    expect(createSupplier).not.toHaveBeenCalled();
  });
});
