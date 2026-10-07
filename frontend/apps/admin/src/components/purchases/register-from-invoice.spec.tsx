import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

const createFromInvoice = jest.fn((_arg: unknown) => ({ unwrap: async () => ({ id: 77, sku: "110024", name: "Novo sabor de marmita", category: "meal" }) }));
const choose = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
let nextSku: { suggested: string | null } = { suggested: "110024" };
let suggestion: Record<string, unknown> = {
  sku: "110024", name: "Novo sabor de marmita", label: "Produto novo — sem histórico de vendas", status: "suggested", confidence: "low",
  minimumPriceCents: 560, suggestedPriceCents: 1290, suggestedMargin: 0.351, targetMargin: 0.35, minimumMargin: 0.2,
  dataUsed: [{ code: "cost", label: "Custo da unidade", value: "R$ 8,50", origin: "Nota fiscal 13021" }],
  reasons: ["Sem vendas: a sugestão se apoia só na estrutura de custos, não em demanda observada"], insufficientReasons: [],
};

jest.doMock("../../lib/api/products", () => ({
  useGetNextSkuQuery: () => ({ data: nextSku, isSuccess: true }),
  useCreateProductFromInvoiceMutation: () => [createFromInvoice, { isLoading: false }],
}));
jest.doMock("../../lib/api/pricing", () => ({
  useGetNewProductSuggestionQuery: () => ({ data: { meta: { parameterVersion: 3, asOf: "2026-09-30" }, suggestion }, isLoading: false, isError: false }),
  useChooseNewProductPriceMutation: () => [choose, { isLoading: false }],
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RegisterFromInvoiceDialog }: { RegisterFromInvoiceDialog: ComponentType<Record<string, unknown>> } = require("./register-from-invoice-dialog");

const onCreated = jest.fn();
const onOpenChange = jest.fn();
const line = { description: "Novo sabor de marmita", ean: "7891000100103", unitCostCents: 850, unitsPerPack: 1 };
const invoice = { number: "13021", issuedOn: "2026-10-10", supplierId: 5, supplierName: "Juntos+", received: false };

function polyfillRadix() {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.setPointerCapture = () => undefined;
  proto.releasePointerCapture = () => undefined;
  proto.scrollIntoView = () => undefined;
}

function pickCategory(label: string) {
  const trigger = screen.getByRole("combobox", { name: "Categoria do produto novo" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: label }));
}

const open = () => render(<RegisterFromInvoiceDialog open onOpenChange={onOpenChange} line={line} invoice={invoice} onCreated={onCreated} />);

describe("RegisterFromInvoiceDialog — cadastro a partir da nota", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    polyfillRadix();
    nextSku = { suggested: "110024" };
  });

  it("vem preenchido com o que a nota traz e pede só o que falta; o SKU é uma sugestão, não uma regra", () => {
    open();

    expect(screen.getByLabelText("Nome do produto novo")).toHaveValue("Novo sabor de marmita");
    expect(screen.getByLabelText("Código de barras do produto novo")).toHaveValue("7891000100103");
    expect(screen.getByLabelText("SKU do produto novo")).toHaveValue("110024");
    expect(screen.getByText(/Sugestão do sistema/)).toBeInTheDocument();
    expect(screen.getByText(/NF-e/)).toHaveTextContent("13021");
    expect(screen.getByText(/R\$\s8,50/)).toBeInTheDocument();
    expect(screen.getByText(/quando a compra for recebida/)).toBeInTheDocument();
    // Custo não é perguntado: ele vem da nota.
    expect(screen.queryByText(/custo de referência/i)).not.toBeInTheDocument();
  });

  it("sem SKU de seis dígitos para contar, não inventa: pede para digitar", () => {
    nextSku = { suggested: null };
    open();

    expect(screen.getByLabelText("SKU do produto novo")).toHaveValue("");
    expect(screen.getByText(/Não há SKU de 6 dígitos/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cadastrar produto" })).toBeDisabled();
  });

  it("categoria é obrigatória", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar produto" }));

    expect(await screen.findByText(/Informe o código \(SKU\), o nome e a categoria/)).toBeInTheDocument();
    expect(createFromInvoice).not.toHaveBeenCalled();
  });

  it("envia os campos do formulário e a evidência da nota (número, data, fornecedor), nunca origem nem usuário", async () => {
    open();
    pickCategory("Refeição / marmita");
    fireEvent.change(screen.getByLabelText("Subcategoria do produto novo"), { target: { value: "Marmitas" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar produto" }));

    await waitFor(() => expect(createFromInvoice).toHaveBeenCalledTimes(1));
    const sent = createFromInvoice.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).toMatchObject({ sku: "110024", name: "Novo sabor de marmita", category: "meal", subcategory: "Marmitas", saleUnit: "un", ean: "7891000100103", supplierId: 5, invoiceNumber: "13021", originOn: "2026-10-10" });
    expect(sent).not.toHaveProperty("origin");
    expect(sent).not.toHaveProperty("actor");
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ sku: "110024" }));
  });

  it("um EAN que já é de outro produto não cria nada: diz de quem é e oferece ver o produto e corrigir o vínculo", async () => {
    createFromInvoice.mockReturnValueOnce({ unwrap: async () => Promise.reject({ data: { message: "O EAN 789 pertence ao produto 110001", code: "ean_linked", sku: "110001" } }) } as never);
    open();
    pickCategory("Bebida");
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar produto" }));

    expect(await screen.findByText("Este EAN já está vinculado ao produto 110001.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver produto" })).toHaveAttribute("href", "/products?sku=110001");
    expect(screen.getByRole("link", { name: "Corrigir vínculo" })).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("SKU repetido é recusado com a mensagem do servidor e nada é criado", async () => {
    createFromInvoice.mockReturnValueOnce({ unwrap: async () => Promise.reject({ data: { message: "A product with SKU 110024 already exists" } }) } as never);
    open();
    pickCategory("Bebida");
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar produto" }));

    expect(await screen.findByText("A product with SKU 110024 already exists")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe("RegisterFromInvoiceDialog — o preço do produto novo", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    polyfillRadix();
    nextSku = { suggested: "110024" };
    open();
    pickCategory("Refeição / marmita");
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar produto" }));
    await screen.findByText("Produto novo — sem histórico de vendas");
  });

  it("mostra o rótulo de produto novo, o preço sugerido, a confiança baixa e os dados usados", () => {
    expect(screen.getByText("R$ 12,90")).toBeInTheDocument();
    expect(screen.getByText(/confiança/)).toHaveTextContent("baixa");
    expect(screen.getByText(/não em demanda observada/)).toBeInTheDocument();
    expect(screen.getByText("Nota fiscal 13021")).toBeInTheDocument();
  });

  it("usar o preço sugerido registra a escolha com o custo e a origem dele, e diz que a nota não foi recebida", async () => {
    fireEvent.click(screen.getByRole("button", { name: "Usar preço sugerido" }));

    await waitFor(() => expect(choose).toHaveBeenCalledTimes(1));
    expect(choose.mock.calls[0][0]).toMatchObject({ sku: "110024", choice: "suggested_accepted", chosenPriceCents: 1290, costCents: 850, costOrigin: "Nota fiscal 13021", costNotReceived: true });
  });

  it("outro preço exige motivo e é registrado como digitado à mão", async () => {
    fireEvent.click(screen.getByRole("button", { name: "Informar outro preço" }));
    fireEvent.change(screen.getByLabelText("Outro preço"), { target: { value: "13,50" } });
    expect(screen.getByRole("button", { name: "Usar este preço" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Motivo do preço digitado"), { target: { value: "Concorrente vende a 13,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Usar este preço" }));

    await waitFor(() => expect(choose).toHaveBeenCalledTimes(1));
    expect(choose.mock.calls[0][0]).toMatchObject({ choice: "changed_by_hand", chosenPriceCents: 1350, reason: "Concorrente vende a 13,50" });
  });

  it("salvar sem preço registra a escolha e não manda preço", async () => {
    fireEvent.click(screen.getByRole("button", { name: "Salvar sem preço" }));

    await waitFor(() => expect(choose).toHaveBeenCalledTimes(1));
    expect(choose.mock.calls[0][0]).toMatchObject({ choice: "left_without_price", chosenPriceCents: undefined });
  });
});

describe("RegisterFromInvoiceDialog — sem dados para sugerir", () => {
  it("sem preço sugerido diz por quê e não oferece usar a sugestão", async () => {
    polyfillRadix();
    suggestion = { ...suggestion, status: "insufficient_data", suggestedPriceCents: null, suggestedMargin: null, minimumPriceCents: null, dataUsed: [], reasons: [], insufficientReasons: ["Sem vendas na rede para calcular o custo de pagamento"] };
    open();
    pickCategory("Bebida");
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar produto" }));

    expect(await screen.findByText("Sem preço sugerido")).toBeInTheDocument();
    expect(screen.getByText(/Sem vendas na rede para calcular o custo de pagamento/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usar preço sugerido" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar sem preço" })).toBeInTheDocument();
  });
});
