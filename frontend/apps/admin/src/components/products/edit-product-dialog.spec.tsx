import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

const update = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const taxonomy = [
  { id: 1, key: "beverage", name: "Bebida", keywords: [], status: "active", products: 0, subcategories: [{ id: 6, category_id: 1, name: "Energéticos", keywords: [], status: "active", products: 0 }] },
  { id: 2, key: "snack", name: "Lanche", keywords: [], status: "active", products: 0, subcategories: [{ id: 5, category_id: 2, name: "Chocolates", keywords: [], status: "active", products: 0 }] },
];
jest.doMock("../../lib/api/products", () => ({ useGetCategoriesQuery: () => ({ data: taxonomy }), useUpdateProductMutation: () => [update, { isLoading: false }], useSuggestClassificationMutation: () => [jest.fn(), { isLoading: false }] }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { EditProductDialog }: { EditProductDialog: ComponentType<{ product: unknown; onClose: () => void }> } = require("./edit-product-dialog");

const product = { id: 1, sku: "SKU-1", name: "Água com gás", category: "beverage", subcategory: null, brand: null, sale_unit: "un", purchase_unit: null, package_type: null, units_per_package: null, fractionable: null, status: "active" };
const onClose = jest.fn();

function pick(label: string, option: string) {
  const trigger = screen.getByRole("combobox", { name: label });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: option }));
}

describe("EditProductDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
    proto.hasPointerCapture = () => false;
    proto.setPointerCapture = () => undefined;
    proto.releasePointerCapture = () => undefined;
    proto.scrollIntoView = () => undefined;
  });

  it("salvar sem mexer na classificação não a manda (não confirma o que ninguém escolheu), e limpa com null o que ficou em branco", async () => {
    render(<EditProductDialog product={product} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Marca"), { target: { value: "Crystal" } });
    fireEvent.change(screen.getByLabelText("Unidade de compra"), { target: { value: "CX" } });
    fireEvent.change(screen.getByLabelText("Fator de conversão"), { target: { value: "24" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const changes = (update.mock.calls[0][0] as { id: number; changes: Record<string, unknown> }).changes;
    expect(changes).toMatchObject({ name: "Água com gás", brand: "Crystal", saleUnit: "un", purchaseUnit: "CX", packageType: null, unitsPerPackage: 24, status: "active" });
    expect(changes).not.toHaveProperty("category");
    expect(changes).not.toHaveProperty("subcategory");
  });

  it("trocar a categoria manda categoria e subcategoria, e a subcategoria só oferece as da categoria escolhida", async () => {
    render(<EditProductDialog product={product} onClose={onClose} />);
    pick("Categoria", "Lanche");
    const sub = screen.getByRole("combobox", { name: "Subcategoria" });
    sub.focus();
    fireEvent.keyDown(sub, { key: "Enter" });
    expect(screen.queryByRole("option", { name: "Energéticos" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Chocolates" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect((update.mock.calls[0][0] as { changes: Record<string, unknown> }).changes).toMatchObject({ category: "snack", subcategory: "Chocolates" });
  });

  it("um fator inválido barra o salvamento", () => {
    render(<EditProductDialog product={product} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Fator de conversão"), { target: { value: "0" } });

    expect(screen.getByText("O fator deve ser um número inteiro de 1 em diante.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  it("um produto de categoria inativa continua mostrando a que tem, sem oferecê-la aos outros", () => {
    render(<EditProductDialog product={{ ...product, category: "congelados" }} onClose={onClose} />);

    expect(screen.getByRole("combobox", { name: "Categoria" })).toHaveTextContent("congelados");
  });
});
