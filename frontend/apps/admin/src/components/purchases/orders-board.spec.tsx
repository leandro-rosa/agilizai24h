import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

const send = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const transition = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
let preview: Record<string, unknown>;

jest.doMock("../../lib/api/purchases", () => ({
  useGetEmailPreviewQuery: () => ({ data: preview, isLoading: false }),
  useSendOrderEmailMutation: () => [send, { isLoading: false }],
  useTransitionPurchaseMutation: () => [transition, { isLoading: false }],
}));
jest.doMock("../../lib/purchases/order-pdf", () => ({ orderPdfBase64: async () => "UERG" }));

const order = (id: number, status: string, extra: Record<string, unknown> = {}) => ({
  id, supplier_id: 5, supplier_name: "Quinoa", ordered_on: "2026-10-05", status, invoice_number: null, without_invoice: false, created_by: "ana@x.com",
  expected_delivery_on: null, received_on: null, received_by: null, late: false, overdue: false,
  items: [{ id: id * 10, sku: "Q1", description: "Wrap", quantity: 10, unit_cost_cents: 500, total_cents: 5000 }],
  ...extra,
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OrdersBoard }: { OrdersBoard: ComponentType<{ purchases: unknown[] }> } = require("./orders-board");

describe("OrdersBoard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    preview = { to: "vendas@quinoa.com", supplier_name: "Quinoa", subject: "Pedido 1", default_message: "Olá", html: "<p>x</p>", text: "x", attachment: { suggested_filename: "pedido-1.pdf" }, configured: true, already_sent: false, sent: [] };
  });

  it("mostra as cinco colunas, mesmo vazias, com o pedido na sua etapa e os avisos", () => {
    render(<OrdersBoard purchases={[order(1, "requisition"), order(2, "awaiting_receipt", { late: true })]} />);

    for (const name of ["Requisição de compra", "Aguardando faturamento", "Faturado", "Aguardando recebimento", "Recebido"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Faturado" })).toHaveTextContent("Nenhum pedido");
    expect(screen.getByTestId("order-2")).toHaveTextContent("Entrega atrasada");
    expect(screen.getByTestId("order-1")).toHaveTextContent("ana@x.com");
  });

  it("não há botão para avançar um pedido já recebido", () => {
    render(<OrdersBoard purchases={[order(3, "received", { received_on: "2026-10-06", received_by: "bia@x.com" })]} />);
    expect(screen.getByTestId("order-3")).not.toHaveTextContent("Enviar");
    expect(screen.getByTestId("order-3").querySelector("button")).toBeNull();
  });

  it("enviar só sai depois de confirmar na prévia", async () => {
    render(<OrdersBoard purchases={[order(1, "requisition")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao fornecedor" }));
    expect(send).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar envio" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toMatchObject({ id: 1, to: "vendas@quinoa.com", attachment_base64: "UERG", attachment_name: "pedido-1.pdf" });
  });

  it("sem SMTP configurado ou já enviado, o envio fica bloqueado", () => {
    preview = { ...preview, configured: false, already_sent: true, sent: [{ result: "sent" }] };
    render(<OrdersBoard purchases={[order(1, "requisition")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao fornecedor" }));

    expect(screen.getByTestId("not-configured")).toBeInTheDocument();
    expect(screen.getByTestId("already-sent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar envio" })).toBeDisabled();
  });

  it("receber pede as quantidades e destaca o que faltou", async () => {
    render(<OrdersBoard purchases={[order(2, "awaiting_receipt")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Receber" }));
    fireEvent.change(screen.getByLabelText("Recebido de Wrap"), { target: { value: "8" } });
    expect(screen.getByText("faltou 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(1));
    expect(transition.mock.calls[0][0]).toMatchObject({ id: 2, to: "received", received: [{ item_id: 20, quantity: 8 }] });
  });

  it("faturar exige a nota ou 'sem nota'", () => {
    render(<OrdersBoard purchases={[order(4, "awaiting_invoice")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Faturar" }));
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Número da nota"), { target: { value: "123" } });
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeEnabled();
  });
});
