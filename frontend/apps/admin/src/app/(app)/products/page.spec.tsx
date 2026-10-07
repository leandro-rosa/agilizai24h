import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";

const replace = jest.fn();
let searchParams = new URLSearchParams();
let canWrite = true;

jest.doMock("next/navigation", () => ({ useRouter: () => ({ replace }), useSearchParams: () => searchParams }));
jest.doMock("../../../lib/auth/use-permission", () => ({ useHasPermission: () => canWrite }));
jest.doMock("../../../components/products/catalogue-view", () => ({ CatalogueView: () => <div data-testid="catalogue" /> }));
jest.doMock("../../../components/products/categories-view", () => ({ CategoriesView: ({ canWrite: w }: { canWrite: boolean }) => <div data-testid="categories">{String(w)}</div> }));
jest.doMock("../../../components/pricing/pricing-screen", () => ({ PricingScreen: ({ embedded }: { embedded?: boolean }) => <div data-testid="pricing">{String(embedded)}</div> }));
jest.doMock("../../../components/products/new-product-dialog", () => ({ NewProductDialog: () => <div data-testid="new-product" /> }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Page: ComponentType = require("./page").default;

beforeEach(() => {
  jest.clearAllMocks();
  searchParams = new URLSearchParams();
  canWrite = true;
});

describe("Produtos e Precificação — uma área só", () => {
  it("abre no Catálogo e tem as três abas", () => {
    render(<Page />);

    expect(screen.getByRole("heading", { name: "Produtos e Precificação" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Catálogo", "Precificação", "Categorias"]);
    expect(screen.getByRole("tab", { name: "Catálogo" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("catalogue")).toBeInTheDocument();
    expect(screen.queryByTestId("pricing")).not.toBeInTheDocument();
  });

  it("?view=pricing mostra a Precificação dentro da área (sem repetir o título) e ?view=categories as Categorias", () => {
    searchParams = new URLSearchParams("view=pricing");
    const first = render(<Page />);
    expect(screen.getByTestId("pricing")).toHaveTextContent("true");
    expect(screen.getByRole("tab", { name: "Precificação" })).toHaveAttribute("aria-selected", "true");
    first.unmount();

    searchParams = new URLSearchParams("view=categories");
    render(<Page />);
    expect(screen.getByTestId("categories")).toHaveTextContent("true");
  });

  it("uma aba desconhecida cai no Catálogo", () => {
    searchParams = new URLSearchParams("view=whatever");
    render(<Page />);

    expect(screen.getByTestId("catalogue")).toBeInTheDocument();
  });

  it("trocar de aba muda a URL: o Catálogo é o endereço limpo, as outras levam ?view=", () => {
    searchParams = new URLSearchParams("view=pricing");
    render(<Page />);

    fireEvent.click(screen.getByRole("tab", { name: "Categorias" }));
    expect(replace).toHaveBeenCalledWith("/products?view=categories", { scroll: false });
    fireEvent.click(screen.getByRole("tab", { name: "Catálogo" }));
    expect(replace).toHaveBeenCalledWith("/products", { scroll: false });
  });

  it("Novo produto está em todas as abas e abre o formulário integrado sem sair da área", () => {
    searchParams = new URLSearchParams("view=categories");
    render(<Page />);

    fireEvent.click(screen.getByRole("button", { name: /Novo produto/ }));
    expect(screen.getByTestId("new-product")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("sem permissão de escrita não há Novo produto", () => {
    canWrite = false;
    render(<Page />);

    expect(screen.queryByRole("button", { name: /Novo produto/ })).not.toBeInTheDocument();
  });
});
