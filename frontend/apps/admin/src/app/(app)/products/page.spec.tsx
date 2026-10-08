import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";

const replace = jest.fn();
let searchParams = new URLSearchParams();
let canWrite = true;

jest.doMock("next/navigation", () => ({ useRouter: () => ({ replace }), useSearchParams: () => searchParams }));
jest.doMock("../../../lib/auth/use-permission", () => ({ useHasPermission: () => canWrite }));
jest.doMock("../../../components/products/products-workspace", () => ({
  ProductsWorkspace: ({ onViewPeriod, onCategories }: { onViewPeriod: () => void; onCategories: () => void }) => (
    <div data-testid="workspace">
      <button onClick={onViewPeriod}>Analisar período</button>
      <button onClick={onCategories}>Categorias</button>
    </div>
  ),
}));
jest.doMock("../../../components/products/categories-view", () => ({ CategoriesView: ({ canWrite: w }: { canWrite: boolean }) => <div data-testid="categories">{String(w)}</div> }));
jest.doMock("../../../components/pricing/pricing-screen", () => ({ PricingScreen: ({ embedded }: { embedded?: boolean }) => <div data-testid="pricing">{String(embedded)}</div> }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Page: ComponentType = require("./page").default;

beforeEach(() => {
  jest.clearAllMocks();
  searchParams = new URLSearchParams();
  canWrite = true;
});

describe("Produtos — uma lista só, com duas visões secundárias", () => {
  it("abre na lista de produtos: sem abas de Catálogo e Precificação", () => {
    render(<Page />);

    expect(screen.getByTestId("workspace")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pricing")).not.toBeInTheDocument();
  });

  it("Analisar período e Categorias levam às visões secundárias pela URL", () => {
    render(<Page />);

    fireEvent.click(screen.getByRole("button", { name: "Analisar período" }));
    expect(replace).toHaveBeenCalledWith("/products?view=period", { scroll: false });
    fireEvent.click(screen.getByRole("button", { name: "Categorias" }));
    expect(replace).toHaveBeenCalledWith("/products?view=categories", { scroll: false });
  });

  it("?view=period mostra os relatórios por período, com o caminho de volta para a lista", () => {
    searchParams = new URLSearchParams("view=period");
    render(<Page />);

    expect(screen.getByTestId("pricing")).toHaveTextContent("true");
    expect(screen.getByRole("heading", { name: "Analisar período" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Voltar aos produtos/ }));
    expect(replace).toHaveBeenCalledWith("/products", { scroll: false });
  });

  it("o link antigo ?view=pricing continua valendo: sem produto é o período; com produto abre o produto na lista", () => {
    searchParams = new URLSearchParams("view=pricing");
    const first = render(<Page />);
    expect(screen.getByTestId("pricing")).toBeInTheDocument();
    first.unmount();

    searchParams = new URLSearchParams("view=pricing&sku=100103");
    render(<Page />);
    expect(screen.getByTestId("workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("pricing")).not.toBeInTheDocument();
  });

  it("?view=categories mostra as Categorias com 'Voltar aos produtos'", () => {
    searchParams = new URLSearchParams("view=categories");
    render(<Page />);

    expect(screen.getByTestId("categories")).toHaveTextContent("true");
    fireEvent.click(screen.getByRole("button", { name: /Voltar aos produtos/ }));
    expect(replace).toHaveBeenCalledWith("/products", { scroll: false });
  });

  it("uma visão desconhecida cai na lista", () => {
    searchParams = new URLSearchParams("view=whatever");
    render(<Page />);

    expect(screen.getByTestId("workspace")).toBeInTheDocument();
  });

  it("as Categorias recebem a permissão de escrita", () => {
    canWrite = false;
    searchParams = new URLSearchParams("view=categories");
    render(<Page />);

    expect(screen.getByTestId("categories")).toHaveTextContent("false");
  });
});
