import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";

import type { PricingProduct } from "../../lib/api/pricing";
import type { Product } from "../../lib/api/products";

const apply = jest.fn((_arg: unknown) => ({ unwrap: async () => ({ applied: true }) }));
const choose = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
jest.doMock("../../lib/api/pricing", () => ({ useApplyPriceMutation: () => [apply, { isLoading: false }], useChooseNewProductPriceMutation: () => [choose, { isLoading: false }] }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BatchReviewDialog }: { BatchReviewDialog: ComponentType<Record<string, unknown>> } = require("./batch-review-dialog");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildRows }: { buildRows: (input: unknown) => unknown[] } = require("../../lib/products/workspace");

const product = (sku: string, name: string): Product => ({ id: Number(sku), sku, name, category: "beverage", units_per_package: null, package_type: null, fractionable: null });
const analysis = (sku: string, over: Partial<PricingProduct> = {}): PricingProduct =>
  ({ sku, name: sku, status: "adjust", currentPriceCents: 1490, currentMargin: 0.266, targetMargin: 0.35, recommendedPriceCents: 1730, recommendedMargin: 0.352, insufficientReasons: [], validated: true, structure: { productCostCents: 837 }, engineVersion: "pricing-4", ...over }) as PricingProduct;

const rows = () =>
  buildRows({
    products: [product("1", "Quiche"), product("2", "Milka"), product("3", "Sem custo"), product("4", "Já no sugerido")],
    costs: new Map([["1", { cents: 837, from: "2026-09-01" }], ["2", { cents: 837, from: "2026-09-01" }], ["4", { cents: 837, from: "2026-09-01" }]]),
    prices: new Map([["1", { cents: 1490, from: "2026-09-01" }], ["2", { cents: 1490, from: "2026-09-01" }], ["3", { cents: 900, from: "2026-09-01" }], ["4", { cents: 1730, from: "2026-09-01" }]]),
    report: [analysis("1"), analysis("2", { recommendedPriceCents: 1600, recommendedMargin: 0.3 }), analysis("4", { currentPriceCents: 1730, recommendedPriceCents: 1730 })],
  });

const onClose = jest.fn();
const onSaved = jest.fn();
const open = () => render(<BatchReviewDialog rows={rows()} onClose={onClose} onSaved={onSaved} />);

beforeEach(() => jest.clearAllMocks());

describe("BatchReviewDialog", () => {
  it("mostra produtos, escopo, preço atual e proposto, margem resultante e o motivo de cada bloqueio; nada vem marcado", () => {
    open();
    const dialog = screen.getByRole("dialog");

    expect(dialog).toHaveTextContent("4 produtos selecionados");
    expect(dialog).toHaveTextContent("Escopo: todas as lojas");
    expect(dialog).toHaveTextContent("Nada vem marcado");
    const quiche = screen.getByText("Quiche").closest("tr") as HTMLElement;
    expect(quiche).toHaveTextContent("R$ 14,90");
    expect(quiche).toHaveTextContent("R$ 17,30");
    expect(quiche).toHaveTextContent("35,2%");
    expect(quiche).toHaveTextContent("Pronto para salvar");
    expect(screen.getByText("Sem custo").closest("tr")).toHaveTextContent("Bloqueado: Sem custo cadastrado");
    expect(screen.getByText("Já no sugerido").closest("tr")).toHaveTextContent("Bloqueado: O preço atual já é o recomendado");
    expect(screen.getAllByRole("checkbox").filter((box) => box.getAttribute("data-state") === "checked")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Salvar 0 preços" })).toBeDisabled();
  });

  it("um produto bloqueado não pode ser marcado, nem por 'marcar todos os aptos'", () => {
    open();

    expect(screen.getByRole("checkbox", { name: "Marcar Sem custo" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Marcar todos os aptos (2)" }));
    expect(screen.getByRole("button", { name: "Salvar 2 preços" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Marcar Sem custo" })).toHaveAttribute("data-state", "unchecked");
  });

  it("salva só o que foi marcado, com o preço do cálculo, a vigência escolhida e uma chave por produto", async () => {
    open();
    fireEvent.click(screen.getByRole("checkbox", { name: "Marcar Quiche" }));
    fireEvent.change(screen.getByLabelText("Vigência a partir de"), { target: { value: "2026-10-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar 1 preço" }));

    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls[0][0]).toMatchObject({ sku: "1", newPriceCents: 1730, effectiveFrom: "2026-10-20", basis: "current" });
    expect((apply.mock.calls[0][0] as { reason?: string }).reason).toBeUndefined();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("uma falha de um produto não desfaz os outros e fica à vista com o motivo, sem fechar", async () => {
    apply.mockReturnValueOnce({ unwrap: async () => ({ applied: true }) } as never).mockReturnValueOnce({ unwrap: async () => Promise.reject({ data: { message: "products-service respondeu 503" } }) } as never);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Marcar todos os aptos (2)" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar 2 preços" }));

    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Falhou: products-service respondeu 503/)).toBeInTheDocument();
    expect(within(screen.getByText("Quiche").closest("tr") as HTMLElement).getByText("Salvo")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Fechar" })).toBeInTheDocument();
  });

  it("tentar de novo salva só o que falhou, com a mesma chave (uma decisão só)", async () => {
    apply.mockReturnValueOnce({ unwrap: async () => ({ applied: true }) } as never).mockReturnValueOnce({ unwrap: async () => Promise.reject({ data: { message: "falhou" } }) } as never);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Marcar todos os aptos (2)" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar 2 preços" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    const failedKey = (apply.mock.calls[1][0] as { idempotencyKey: string }).idempotencyKey;

    fireEvent.click(await screen.findByRole("button", { name: "Salvar 1 preço" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(3));
    expect(apply.mock.calls[2][0]).toMatchObject({ sku: "2", idempotencyKey: failedKey });
  });
});
