import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";

const ok = (value: unknown = {}) => jest.fn((_arg: unknown) => ({ unwrap: async () => value }));
const createCategory = ok();
const updateCategory = ok();
const createSubcategory = ok();
const updateSubcategory = ok();
const applyClassification = jest.fn((_arg: unknown) => ({ unwrap: async () => ({ applied: 1, results: [{ sku: "110031", ok: true }] }) }));
let review: unknown[] = [];

const sub = (id: number, category_id: number, name: string, keywords: string[], status = "active", products = 0) => ({ id, category_id, name, keywords, status, products });
const categories = [
  { id: 1, key: "beverage", name: "Bebida", keywords: ["suco", "bebida"], status: "active", products: 57, subcategories: [sub(6, 1, "Energéticos", ["monster", "energy"], "active", 2), sub(7, 1, "Chás", ["cha"], "inactive", 1)] },
  { id: 2, key: "snack", name: "Lanche", keywords: [], status: "active", products: 174, subcategories: [sub(5, 2, "Chocolates", ["chocolate"], "active", 5)] },
  { id: 3, key: "congelados", name: "Congelados", keywords: [], status: "inactive", products: 0, subcategories: [] },
];

jest.doMock("../../lib/api/products", () => ({
  useGetCategoriesQuery: () => ({ data: categories, isLoading: false, isError: false }),
  useCreateCategoryMutation: () => [createCategory, { isLoading: false }],
  useUpdateCategoryMutation: () => [updateCategory, { isLoading: false }],
  useCreateSubcategoryMutation: () => [createSubcategory, { isLoading: false }],
  useUpdateSubcategoryMutation: () => [updateSubcategory, { isLoading: false }],
  useGetClassificationReviewQuery: () => ({ data: review, isLoading: false }),
  useApplyClassificationMutation: () => [applyClassification, { isLoading: false }],
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CategoriesView }: { CategoriesView: ComponentType<{ canWrite: boolean }> } = require("./categories-view");

beforeEach(() => {
  jest.clearAllMocks();
  review = [];
});

describe("CategoriesView — manutenção de categorias e subcategorias", () => {
  it("lista as categorias com a quantidade de produtos vinculados e marca as inativas; só mostra as subcategorias da selecionada", () => {
    render(<CategoriesView canWrite />);

    const list = screen.getByRole("list", { name: "Categorias" });
    expect(within(list).getByText("Bebida").closest("li")).toHaveTextContent("57 produtos · 2 subcategorias");
    expect(within(list).getByText("Congelados").closest("li")).toHaveTextContent("Inativa");
    const detail = screen.getByRole("region", { name: "Categoria Bebida" });
    expect(detail).toHaveTextContent("57 produtos vinculados");
    expect(within(detail).getByText("Energéticos")).toBeInTheDocument();
    expect(within(detail).queryByText("Chocolates")).not.toBeInTheDocument();

    fireEvent.click(within(list).getByText("Lanche"));
    const snack = screen.getByRole("region", { name: "Categoria Lanche" });
    expect(within(snack).getByText("Chocolates")).toBeInTheDocument();
    expect(within(snack).queryByText("Energéticos")).not.toBeInTheDocument();
  });

  it("mostra palavras-chave, produtos e situação de cada subcategoria", () => {
    render(<CategoriesView canWrite />);

    const energy = screen.getByText("Energéticos").closest("tr") as HTMLElement;
    expect(energy).toHaveTextContent("monster, energy");
    expect(energy).toHaveTextContent("Ativa");
    expect(screen.getByText("Chás").closest("tr")).toHaveTextContent("Inativa");
  });

  it("não há como excluir: só inativar", () => {
    render(<CategoriesView canWrite />);

    expect(screen.queryByRole("button", { name: /Excluir|Apagar|Remover/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Categoria não se exclui/)).toBeInTheDocument();
  });

  it("cria uma categoria com palavras-chave (separadas por vírgula, sem repetir) e diz o erro do servidor se o nome já existe", async () => {
    render(<CategoriesView canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "+ Nova categoria" }));
    fireEvent.change(screen.getByLabelText("Nome da categoria"), { target: { value: "Frios" } });
    fireEvent.change(screen.getByLabelText("Palavras-chave da categoria"), { target: { value: "queijo, presunto, Queijo" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(createCategory).toHaveBeenCalledWith({ name: "Frios", keywords: ["queijo", "presunto"] }));
  });

  it("cria uma subcategoria na categoria selecionada, e a edita (palavras-chave) sem mexer na categoria", async () => {
    render(<CategoriesView canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "+ Subcategoria" }));
    fireEvent.change(screen.getByLabelText("Nome da subcategoria"), { target: { value: "Refrigerantes" } });
    fireEvent.change(screen.getByLabelText("Palavras-chave da subcategoria"), { target: { value: "guarana, coca" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(createSubcategory).toHaveBeenCalledWith({ categoryId: 1, name: "Refrigerantes", keywords: ["guarana", "coca"] }));

    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[1]);
    expect(screen.getByLabelText("Nome da subcategoria")).toHaveValue("Energéticos");
    fireEvent.change(screen.getByLabelText("Palavras-chave da subcategoria"), { target: { value: "monster, energy, red bull" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(updateSubcategory).toHaveBeenCalledWith({ id: 6, changes: { name: "Energéticos", keywords: ["monster", "energy", "red bull"] } }));
  });

  it("inativa e reativa, avisando que os produtos continuam com a categoria", async () => {
    render(<CategoriesView canWrite />);
    // O primeiro "Inativar" é o da categoria; os seguintes são os das subcategorias.
    fireEvent.click(screen.getAllByRole("button", { name: "Inativar" })[0]);

    await waitFor(() => expect(updateCategory).toHaveBeenCalledWith({ id: 1, changes: { status: "inactive" } }));
    fireEvent.click(screen.getByText("Congelados"));
    expect(screen.getByRole("button", { name: "Reativar" })).toBeInTheDocument();
    // Uma categoria inativa não aceita subcategoria nova.
    expect(screen.queryByRole("button", { name: "+ Subcategoria" })).not.toBeInTheDocument();
  });

  it("sem permissão de escrita só consulta: nenhum botão de alterar", () => {
    render(<CategoriesView canWrite={false} />);

    expect(screen.queryByRole("button", { name: "+ Nova categoria" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inativar" })).not.toBeInTheDocument();
  });
});

describe("CategoriesView — sugestões para revisar (nada muda sozinho)", () => {
  const item = (sku: string, name: string) => ({ sku, name, current: { category: "beverage", subcategory: null, confirmed: false }, proposed: { category: "beverage", categoryName: "Bebida", subcategory: "Energéticos" }, matched: ["monster"] });

  it("só mostra depois de pedir, com a proposta de cada produto, e nada vem marcado", () => {
    review = [item("110031", "Monster Mango"), item("110032", "Monster Ultra")];
    render(<CategoriesView canWrite />);
    expect(screen.queryByText("Monster Mango")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ver sugestões" }));
    expect(screen.getByText("Monster Mango")).toBeInTheDocument();
    expect(screen.getAllByText("Bebida > Energéticos")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Aplicar 0 selecionadas" })).toBeDisabled();
    expect((screen.getByLabelText("Aplicar a sugestão para Monster Mango") as HTMLInputElement).checked).toBe(false);
  });

  it("aplica SÓ os marcados, com a categoria e a subcategoria propostas", async () => {
    review = [item("110031", "Monster Mango"), item("110032", "Monster Ultra")];
    render(<CategoriesView canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "Ver sugestões" }));
    fireEvent.click(screen.getByLabelText("Aplicar a sugestão para Monster Mango"));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar 1 selecionada" }));

    await waitFor(() => expect(applyClassification).toHaveBeenCalledTimes(1));
    expect(applyClassification).toHaveBeenCalledWith({ items: [{ sku: "110031", category: "beverage", subcategory: "Energéticos" }] });
  });

  it("sem sugestões diz isso em vez de mostrar uma tabela vazia", () => {
    render(<CategoriesView canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "Ver sugestões" }));

    expect(screen.getByText(/Nenhuma sugestão/)).toBeInTheDocument();
  });
});
