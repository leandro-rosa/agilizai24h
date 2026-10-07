import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

const createProduct = jest.fn((_arg: unknown) => ({ unwrap: async () => ({ id: 90, sku: "110024", name: "Monster Energy 269 ml", category: "beverage" }) }));
const addEan = jest.fn((_arg: unknown) => ({ unwrap: async () => [] }));
const recordCost = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const choosePrice = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const suggestClassification = jest.fn((_arg: unknown) => ({ unwrap: async () => classifier }));
const draft = jest.fn((arg: { unitCostCents: number | null; category: string | null; typedPriceCents?: number | null }) => ({ unwrap: async () => ({ meta: { parameterVersion: 7, asOf: "2026-09-30" }, suggestion: answer(arg) }) }));

let classifier: Record<string, unknown> = { confidence: "none", best: null, alternatives: [] };
let missing: string[] = [];
const answer = (arg: { unitCostCents: number | null; typedPriceCents?: number | null }) =>
  missing.length > 0
    ? { status: "insufficient_data", suggestedPriceCents: null, suggestedMargin: null, minimumPriceCents: null, targetMargin: 0.35, minimumMargin: 0.2, dataUsed: [], reasons: [], insufficientReasons: missing, typedPrice: null, initial: true }
    : {
        status: "suggested", initial: true, suggestedPriceCents: Math.round((arg.unitCostCents as number) * 2.5), suggestedMargin: 0.352, minimumPriceCents: 400, targetMargin: 0.35, minimumMargin: 0.2,
        reasons: ["Sem vendas: a sugestão se apoia só na estrutura de custos, não em demanda observada"], insufficientReasons: [], dataUsed: [{ code: "cost", label: "Custo da unidade", value: "x", origin: "Custo informado no cadastro" }],
        typedPrice: arg.typedPriceCents ? { priceCents: arg.typedPriceCents, margin: 0.41 } : null,
      };

const taxonomy = [
  { id: 1, key: "beverage", name: "Bebida", keywords: [], status: "active", products: 0, subcategories: [{ id: 6, category_id: 1, name: "Energéticos", keywords: [], status: "active", products: 0 }] },
  { id: 2, key: "snack", name: "Lanche", keywords: [], status: "active", products: 0, subcategories: [] },
];

jest.doMock("../../lib/api/products", () => ({
  useGetCategoriesQuery: () => ({ data: taxonomy }),
  useGetNextSkuQuery: () => ({ data: { suggested: "110024" }, isSuccess: true }),
  useCreateProductMutation: () => [createProduct, { isLoading: false }],
  useAddProductEanMutation: () => [addEan, { isLoading: false }],
  useRecordCostMutation: () => [recordCost, { isLoading: false }],
  useSuggestClassificationMutation: () => [suggestClassification, { isLoading: false }],
}));
jest.doMock("../../lib/api/pricing", () => ({ useDraftSuggestionMutation: () => [draft, { isLoading: false }], useChooseNewProductPriceMutation: () => [choosePrice, { isLoading: false }] }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NewProductForm }: { NewProductForm: ComponentType<Record<string, unknown>> } = require("./new-product-form");

const onCreated = jest.fn();
const onOpenChange = jest.fn();

function polyfillRadix() {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.setPointerCapture = () => undefined;
  proto.releasePointerCapture = () => undefined;
  proto.scrollIntoView = () => undefined;
}

function pick(label: string, option: string) {
  const trigger = screen.getByRole("combobox", { name: label });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: option }));
}

const open = () => render(<NewProductForm open onOpenChange={onOpenChange} onCreated={onCreated} />);
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const fill = (cost = "6,00") => {
  type("Nome do produto novo", "Monster Energy 269 ml");
  pick("Categoria do produto novo", "Bebida");
  type("Custo de compra", cost);
};

describe("NewProductForm — o preço sugerido enquanto se preenche", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    polyfillRadix();
    classifier = { confidence: "none", best: null, alternatives: [] };
    missing = [];
  });

  it("sem custo não calcula nada e pede o custo, sem inventar preço nem margem", () => {
    open();

    expect(screen.getByTestId("needs-cost")).toHaveTextContent("Informe um custo válido para calcular o preço sugerido.");
    expect(screen.queryByTestId("suggestion")).not.toBeInTheDocument();
    expect(draft).not.toHaveBeenCalled();
    expect(screen.getByText("Sugestão inicial — sem histórico de vendas")).toBeInTheDocument();
  });

  it("com um custo válido mostra o custo por unidade vendida, o preço sugerido, a margem e a meta, pelo motor", async () => {
    open();
    fill("6,00");

    const card = await screen.findByTestId("suggestion");
    expect(screen.getByTestId("unit-cost")).toHaveTextContent("Custo por unidade vendida: R$ 6,00");
    expect(card).toHaveTextContent("R$ 15,00");
    expect(card).toHaveTextContent("35,2%");
    expect(card).toHaveTextContent("Meta utilizada");
    expect(card).toHaveTextContent("35,0%");
    expect(draft).toHaveBeenLastCalledWith(expect.objectContaining({ category: "beverage", unitCostCents: 600 }));
  });

  it("não inventa volume nem impacto mensal: é uma sugestão inicial", async () => {
    const { container } = open();
    fill("6,00");
    await screen.findByTestId("suggestion");

    expect(container.ownerDocument.body).not.toHaveTextContent(/impacto/i);
    expect(container.ownerDocument.body).not.toHaveTextContent(/un\.\/mês|por mês/i);
  });

  it("converte caixa em unidade: R$ 60,00 ÷ 12 = R$ 5,00 por unidade vendida, e é isso que vai ao motor", async () => {
    open();
    type("Fator de conversão", "12");
    fill("60,00");

    await waitFor(() => expect(screen.getByTestId("unit-cost")).toHaveTextContent("Custo da embalagem R$ 60,00 ÷ 12 = R$ 5,00 por unidade vendida"));
    await screen.findByTestId("suggestion");
    expect(draft).toHaveBeenLastCalledWith(expect.objectContaining({ unitCostCents: 500 }));
  });

  it("mudar o custo recalcula a sugestão, e mudar a categoria também", async () => {
    open();
    fill("6,00");
    await screen.findByTestId("suggestion");
    expect(screen.getByTestId("suggestion")).toHaveTextContent("R$ 15,00");

    type("Custo de compra", "8,00");
    await waitFor(() => expect(screen.getByTestId("suggestion")).toHaveTextContent("R$ 20,00"));
    expect(draft).toHaveBeenLastCalledWith(expect.objectContaining({ unitCostCents: 800 }));

    pick("Categoria do produto novo", "Lanche");
    await waitFor(() => expect(draft).toHaveBeenLastCalledWith(expect.objectContaining({ category: "snack", unitCostCents: 800 })));
  });

  it("fator inválido ou custo inválido não calcula e não vira zero", async () => {
    open();
    fill("6,00");
    await screen.findByTestId("suggestion");
    draft.mockClear();

    type("Fator de conversão", "0");
    expect(await screen.findByTestId("needs-cost")).toHaveTextContent("fator de conversão inteiro");
    type("Fator de conversão", "1,5");
    expect(screen.getByTestId("needs-cost")).toBeInTheDocument();
    type("Fator de conversão", "1");
    type("Custo de compra", "abc");
    expect(screen.getByTestId("needs-cost")).toBeInTheDocument();
    expect(screen.queryByText("R$ 0,00")).not.toBeInTheDocument();
    expect(draft).not.toHaveBeenCalled();
  });

  it("quando falta um parâmetro mostra exatamente o que falta e nenhum preço ou margem", async () => {
    missing = ["Alíquota de imposto não configurada", "Sem vendas na rede para calcular o custo de pagamento"];
    open();
    fill("6,00");

    const alert = await screen.findByTestId("missing");
    expect(alert).toHaveTextContent("Não há preço sugerido. Falta:");
    expect(alert).toHaveTextContent("Alíquota de imposto não configurada");
    expect(alert).toHaveTextContent("Sem vendas na rede para calcular o custo de pagamento");
    expect(screen.queryByTestId("suggestion")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("R$ 0,00");
  });

  it("outro preço mostra a margem correspondente, vinda do motor", async () => {
    open();
    fill("6,00");
    await screen.findByTestId("suggestion");
    fireEvent.click(screen.getByLabelText("Informar outro preço"));
    expect(screen.getByTestId("typed-margin")).toHaveTextContent("Digite um preço para ver a margem.");

    type("Outro preço", "13,50");
    await waitFor(() => expect(screen.getByTestId("typed-margin")).toHaveTextContent("Margem estimada neste preço: 41,0%"));
    expect(draft).toHaveBeenLastCalledWith(expect.objectContaining({ typedPriceCents: 1350 }));
  });
});

describe("NewProductForm — a classificação pelo nome", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    polyfillRadix();
    missing = [];
  });

  it("o nome sugere categoria e subcategoria, a tela diz que foi automático, e a escolha manual não é sobrescrita", async () => {
    classifier = { confidence: "clear", best: { categoryKey: "beverage", categoryName: "Bebida", subcategory: "Energéticos", matched: ["monster"], score: 2 }, alternatives: [] };
    open();
    type("Nome do produto novo", "Monster Energy 269 ml");

    expect(await screen.findByText("Sugerida automaticamente")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Categoria do produto novo" })).toHaveTextContent("Bebida");
    expect(screen.getByRole("combobox", { name: "Subcategoria do produto novo" })).toHaveTextContent("Energéticos");

    pick("Categoria do produto novo", "Lanche");
    type("Nome do produto novo", "Monster Energy 473 ml");
    await waitFor(() => expect(suggestClassification).toHaveBeenCalledWith({ name: "Monster Energy 473 ml" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("combobox", { name: "Categoria do produto novo" })).toHaveTextContent("Lanche");
  });
});

describe("NewProductForm — salvar o cadastro e aprovar o preço são ações separadas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    polyfillRadix();
    classifier = { confidence: "none", best: null, alternatives: [] };
    missing = [];
  });

  it("'Salvar com preço pendente' cria o produto, os EANs e o custo por unidade, e NÃO aprova preço nenhum", async () => {
    open();
    type("EAN principal", "7891000100103");
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar outro EAN" }));
    type("EAN adicional 1", "7891000100222");
    type("Fator de conversão", "12");
    type("Data do custo", "2026-10-05");
    fill("60,00");
    fireEvent.click(screen.getByRole("button", { name: "Salvar com preço pendente" }));

    await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
    expect(createProduct.mock.calls[0][0]).toMatchObject({ sku: "110024", name: "Monster Energy 269 ml", category: "beverage", classificationConfirmed: true, ean: "7891000100103", unitsPerPackage: 12 });
    await waitFor(() => expect(addEan).toHaveBeenCalledWith(expect.objectContaining({ productId: 90, ean: "7891000100222" })));
    expect(recordCost).toHaveBeenCalledWith({ sku: "110024", effective_from: "2026-10-05", cost_cents: 500, reason: "Custo informado no cadastro do produto" });
    expect(choosePrice).not.toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ sku: "110024" }));
  });

  it("sem custo o produto é salvo sem custo e com o preço pendente (o custo nasce da primeira compra)", async () => {
    open();
    type("Nome do produto novo", "Produto sem custo ainda");
    pick("Categoria do produto novo", "Lanche");
    fireEvent.click(screen.getByRole("button", { name: "Salvar com preço pendente" }));

    await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
    expect(recordCost).not.toHaveBeenCalled();
    expect(choosePrice).not.toHaveBeenCalled();
  });

  it("'Salvar e aprovar preço' aprova o sugerido com a vigência escolhida, pelo caminho que registra usuário e preço anterior", async () => {
    open();
    fill("6,00");
    await screen.findByTestId("suggestion");
    type("Início da vigência", "2026-10-20");
    fireEvent.click(screen.getByRole("button", { name: "Salvar e aprovar preço" }));

    await waitFor(() => expect(choosePrice).toHaveBeenCalledTimes(1));
    expect(choosePrice.mock.calls[0][0]).toMatchObject({ sku: "110024", choice: "suggested_accepted", chosenPriceCents: 1500, effectiveFrom: "2026-10-20", costCents: 600 });
    expect((choosePrice.mock.calls[0][0] as { reason?: string }).reason).toBeUndefined();
    expect(recordCost).toHaveBeenCalled();
  });

  it("um preço digitado exige motivo e é registrado como digitado à mão", async () => {
    open();
    fill("6,00");
    await screen.findByTestId("suggestion");
    fireEvent.click(screen.getByLabelText("Informar outro preço"));
    type("Outro preço", "13,50");
    fireEvent.click(screen.getByRole("button", { name: "Salvar e aprovar preço" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Informe o motivo do preço digitado.");
    expect(createProduct).not.toHaveBeenCalled();

    type("Motivo do preço digitado", "Concorrente a 13,50");
    fireEvent.click(screen.getByRole("button", { name: "Salvar e aprovar preço" }));
    await waitFor(() => expect(choosePrice).toHaveBeenCalledTimes(1));
    expect(choosePrice.mock.calls[0][0]).toMatchObject({ choice: "changed_by_hand", chosenPriceCents: 1350, reason: "Concorrente a 13,50" });
  });

  it("sem preço para aprovar não cria nada e diz por quê", async () => {
    missing = ["Alíquota de imposto não configurada"];
    open();
    fill("6,00");
    await screen.findByTestId("missing");
    fireEvent.click(screen.getByRole("button", { name: "Salvar e aprovar preço" }));

    expect(await screen.findByText(/Não há preço para aprovar/)).toBeInTheDocument();
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("nome, categoria e códigos de barras inválidos barram o salvamento antes de criar", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Salvar com preço pendente" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe o nome do produto.");

    type("Nome do produto novo", "X");
    fireEvent.click(screen.getByRole("button", { name: "Salvar com preço pendente" }));
    expect(await screen.findByText("Escolha a categoria (ou aceite a sugerida).")).toBeInTheDocument();

    pick("Categoria do produto novo", "Lanche");
    type("EAN principal", "123");
    fireEvent.click(screen.getByRole("button", { name: "Salvar com preço pendente" }));
    expect(await screen.findByText("Cada código de barras deve ter de 8 a 14 dígitos.")).toBeInTheDocument();
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("se a aprovação falha depois do produto criado, diz isso e uma nova tentativa não cria o produto de novo", async () => {
    choosePrice.mockReturnValueOnce({ unwrap: async () => Promise.reject({ data: { message: "intelligence respondeu 503" } }) } as never);
    open();
    fill("6,00");
    await screen.findByTestId("suggestion");
    fireEvent.click(screen.getByRole("button", { name: "Salvar e aprovar preço" }));

    expect(await screen.findByText(/O produto foi cadastrado, mas o preço não foi aprovado: intelligence respondeu 503/)).toBeInTheDocument();
    expect(createProduct).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Aprovar preço" }));
    await waitFor(() => expect(choosePrice).toHaveBeenCalledTimes(2));
    expect(createProduct).toHaveBeenCalledTimes(1);
    // A mesma tentativa repete a mesma chave: o servidor trata como uma decisão só.
    expect((choosePrice.mock.calls[1][0] as { idempotencyKey: string }).idempotencyKey).toBe((choosePrice.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey);
  });

  it("um EAN que já é de outro produto não cria nada e nomeia o dono", async () => {
    createProduct.mockReturnValueOnce({ unwrap: async () => Promise.reject({ data: { message: "O EAN pertence", code: "ean_linked", sku: "110001" } }) } as never);
    open();
    type("EAN principal", "7891000000001");
    fill("6,00");
    fireEvent.click(screen.getByRole("button", { name: "Salvar com preço pendente" }));

    expect(await screen.findByText("Este EAN já está vinculado ao produto 110001. Nenhum produto foi criado.")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("a aprovação diz que registra usuário, data e preço anterior, e que publicar no PDV não faz parte", () => {
    open();

    expect(screen.getByText(/Aprovar registra você, a data e o preço anterior/)).toHaveTextContent("a publicação no PDV não faz parte dela");
  });
});
