import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";

const createFee = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
let canWrite = true;
let inForce: Record<string, unknown>;

jest.doMock("../../lib/api/treasury", () => ({
  useGetFeesQuery: () => ({ data: [{ id: 1, acquirer: "PagBank", payment_method: "debit", rate_bps: 139, fixed_cents: 0, effective_from: "2026-01-01" }], isLoading: false }),
  useGetFeesInForceQuery: () => ({ data: inForce }),
  useCreateFeeMutation: () => [createFee, { isLoading: false }],
}));
jest.doMock("../../lib/auth/use-permission", () => ({ useHasPermission: () => canWrite }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FeesScreen }: { FeesScreen: ComponentType } = require("./fees-screen");

/** O Select do Radix pede estas APIs, que o jsdom não tem. */
function polyfillRadix() {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.setPointerCapture = () => undefined;
  proto.releasePointerCapture = () => undefined;
  proto.scrollIntoView = () => undefined;
}

function pickMethod(label: string) {
  const trigger = screen.getByRole("combobox", { name: "Meio de pagamento" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: label }));
}

function fill() {
  fireEvent.change(screen.getByLabelText("Adquirente ou bandeira"), { target: { value: "Ticket" } });
  pickMethod("VR/VA (voucher)");
  fireEvent.change(screen.getByLabelText("Taxa (%)"), { target: { value: "5,99" } });
  fireEvent.change(screen.getByLabelText("Taxa fixa por venda (R$)"), { target: { value: "0,89" } });
  fireEvent.change(screen.getByLabelText("Vale a partir de"), { target: { value: "2026-01-01" } });
}

describe("FeesScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    polyfillRadix();
    canWrite = true;
    inForce = { on: "2026-10-07", rates: [{ acquirer: "PagBank", payment_method: "debit", rate_bps: 139, fixed_cents: 0, effective_from: "2026-01-01" }], methods_without_rate: ["voucher", "pix", "credit"] };
  });

  it("lista as taxas e mostra os meios sem taxa como ausentes, não como 0%", () => {
    render(<FeesScreen />);

    expect(screen.getByText("PagBank")).toBeInTheDocument();
    expect(screen.getByText("1,39%")).toBeInTheDocument();
    expect(screen.getByText("Em vigor")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Sem taxa cadastrada em vigor: VR/VA (voucher), PIX, Crédito");
  });

  it("revisar com campos vazios mostra todos os problemas e não abre confirmação nem salva", () => {
    render(<FeesScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Revisar e cadastrar" }));

    expect(screen.getAllByRole("alert").some((node) => node.textContent?.includes("Informe o adquirente"))).toBe(true);
    expect(screen.queryByText("Confirmar taxa")).not.toBeInTheDocument();
    expect(createFee).not.toHaveBeenCalled();
  });

  it("só salva depois da confirmação que mostra o que será gravado", async () => {
    render(<FeesScreen />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Revisar e cadastrar" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Ticket")).toBeInTheDocument();
    expect(within(dialog).getByText("5,99%")).toBeInTheDocument();
    expect(within(dialog).getByText("R$ 0,89")) .toBeInTheDocument();
    expect(createFee).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar e salvar" }));
    await waitFor(() => expect(createFee).toHaveBeenCalledWith({ acquirer: "Ticket", payment_method: "voucher", rate_bps: 599, fixed_cents: 89, effective_from: "2026-01-01" }));
  });

  it("um conflito de data aparece como conflito, sem fechar a confirmação", async () => {
    createFee.mockReturnValueOnce({ unwrap: async () => Promise.reject({ status: 409, data: { message: "Já existe" } }) });
    render(<FeesScreen />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Revisar e cadastrar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar e salvar" }));

    expect(await screen.findByText(/Já existe uma taxa para este adquirente/)).toBeInTheDocument();
    expect(screen.getByText("Confirmar taxa")).toBeInTheDocument();
  });

  it("sem permissão de escrita não oferece o cadastro", () => {
    canWrite = false;
    render(<FeesScreen />);

    expect(screen.queryByRole("button", { name: "Revisar e cadastrar" })).not.toBeInTheDocument();
    expect(screen.getByText("PagBank")).toBeInTheDocument();
  });
});
