import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

const createProduct = jest.fn((_arg: unknown) => ({ unwrap: async () => ({ id: 90, sku: "100113", name: "Pizza de frango 400 g", category: "snack" }) }));
const addEan = jest.fn((_arg: unknown) => ({ unwrap: async () => [] }));
const recordCost = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const choosePrice = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const suggestClassification = jest.fn((_arg: unknown) => ({ unwrap: async () => classifier }));

type Arg = { unitCostCents: number | null; category: string | null; typedPriceCents?: number | null };
let classifier: Record<string, unknown> = { confidence: "none", best: null, alternatives: [] };
let missing: string[] = [];
let unreachable = false;
let failure: unknown = null;
let pending: { arg: Arg; resolve: (value: unknown) => void }[] | null = null;

const answer = (arg: Arg) =>
  unreachable
    ? { status: "insufficient_data", blocker: "unreachable", suggestedPriceCents: null, suggestedMargin: null, minimumPriceCents: null, targetMargin: 0.35, minimumMargin: 0.2, dataUsed: [], reasons: [], insufficientReasons: ["A meta de 35,0% não é alcançável pela fórmula"], typedPrice: null, initial: true }
    : missing.length > 0
      ? { status: "insufficient_data", blocker: "missing_data", suggestedPriceCents: null, suggestedMargin: null, minimumPriceCents: null, targetMargin: 0.35, minimumMargin: 0.2, dataUsed: [], reasons: [], insufficientReasons: missing, typedPrice: null, initial: true }
      : {
          status: "suggested", blocker: null, initial: true, validated: true, validationNotes: [], suggestedPriceCents: Math.round((arg.unitCostCents as number) * 2.5), suggestedMargin: 0.352, minimumPriceCents: 400, targetMargin: 0.35, minimumMargin: 0.2,
          reasons: ["Sem vendas: a sugestão se apoia só na estrutura de custos"], insufficientReasons: [], dataUsed: [{ code: "cost", label: "Custo da unidade", value: "x", origin: "Custo informado no cadastro" }],
          typedPrice: arg.typedPriceCents ? { priceCents: arg.typedPriceCents, margin: 0.41 } : null,
        };

const draft = jest.fn((arg: Arg) => ({
  unwrap: () => {
    if (pending) return new Promise((resolve) => pending?.push({ arg, resolve: (value) => resolve({ meta: { parameterVersion: 7, asOf: "2026-09-30" }, suggestion: value }) }));
    if (failure) return Promise.reject(failure);

    return Promise.resolve({ meta: { parameterVersion: 7, asOf: "2026-09-30" }, suggestion: answer(arg) });
  },
}));

const taxonomy = [
  { id: 1, key: "beverage", name: "Bebida", keywords: [], status: "active", products: 0, subcategories: [{ id: 6, category_id: 1, name: "Energéticos", keywords: [], status: "active", products: 0 }] },
  { id: 2, key: "snack", name: "Lanche", keywords: [], status: "active", products: 0, subcategories: [] },
];

jest.doMock("../../lib/api/products", () => ({
  useGetCategoriesQuery: () => ({ data: taxonomy }),
  useGetNextSkuQuery: () => ({ data: { suggested: "100113", forecast: true }, isSuccess: true }),
  useCreateProductMutation: () => [createProduct, { isLoading: false }],
  useAddProductEanMutation: () => [addEan, { isLoading: false }],
  useRecordCostMutation: () => [recordCost, { isLoading: false }],
  useSuggestClassificationMutation: () => [suggestClassification, { isLoading: false }],
}));
jest.doMock("../../lib/api/pricing", () => ({ useDraftSuggestionMutation: () => [draft, { isLoading: false }], useChooseNewProductPriceMutation: () => [choosePrice, { isLoading: false }] }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NewProductPanel }: { NewProductPanel: ComponentType<Record<string, unknown>> } = require("./new-product-panel");

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

const open = () => render(<NewProductPanel open onOpenChange={onOpenChange} onCreated={onCreated} />);
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const identify = () => {
  type("Nome do produto novo", "Pizza de frango 400 g");
  pick("Categoria", "Lanche");
};
const fill = (cost = "6,00") => {
  identify();
  type("Custo por unidade", cost);
};

beforeEach(() => {
  jest.clearAllMocks();
  polyfillRadix();
  classifier = { confidence: "none", best: null, alternatives: [] };
  missing = [];
  unreachable = false;
  failure = null;
  pending = null;
});

describe("NewProductPanel — SKU automático", () => {
  it("mostra a previsão do SKU como previsão, sem pedir para digitar, e não envia SKU ao criar", async () => {
    open();

    expect(screen.getByText(/SKU automático · previsão/)).toHaveTextContent("100113");
    expect(screen.getByText(/o número definitivo é dado ao salvar/)).toBeInTheDocument();
    expect(screen.queryByLabelText("SKU do produto novo")).not.toBeInTheDocument();

    type("Nome do produto novo", "Pizza de frango 400 g");
    pick("Categoria", "Lanche");
    fireEvent.click(screen.getByRole("button", { name: "Salvar sem preço" }));
    await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
    expect(createProduct.mock.calls[0][0]).not.toHaveProperty("sku");
  });

  it("depois de salvar mostra o SKU definitivo que o servidor deu", async () => {
    open();
    type("Nome do produto novo", "Pizza de frango 400 g");
    pick("Categoria", "Lanche");
    choosePrice.mockReturnValueOnce({ unwrap: async () => Promise.reject({ data: { message: "falhou" } }) } as never);
    fill("6,00");
    await waitFor(() => expect(screen.getByTestId("chosen-margin")).toHaveTextContent("35,2%"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto e preço" }));

    expect(await screen.findByText(/O produto foi cadastrado, mas o preço não foi salvo/)).toBeInTheDocument();
    expect(screen.getByText("SKU 100113")).toBeInTheDocument();
  });
});

describe("NewProductPanel — como preencher", () => {
  it("prints, texto ou áudio aparece desativado e diz que nada é simulado", () => {
    open();

    expect(screen.getByRole("button", { name: "Prints, texto ou áudio" })).toBeDisabled();
    expect(screen.getByText(/Nada é simulado: o cadastro é manual/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manual" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("NewProductPanel — custo de compra", () => {
  it("caixa com 12 unidades por R$ 84,00 → R$ 7,00 por unidade, e é o custo da unidade que vai ao motor e ao cadastro", async () => {
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Caixa" }));
    identify();
    type("Unidades na embalagem", "12");
    type("Valor pago pela caixa", "84,00");

    await waitFor(() => expect(screen.getByTestId("unit-cost")).toHaveTextContent("R$ 7,00"));
    expect(screen.getByTestId("unit-cost")).toHaveTextContent("Caixa com 12 unidades por R$ 84,00 → R$ 7,00 por unidade");
    await waitFor(() => expect(draft).toHaveBeenLastCalledWith(expect.objectContaining({ unitCostCents: 700 })));

    fireEvent.click(screen.getByRole("button", { name: "Salvar sem preço" }));
    await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
    expect(createProduct.mock.calls[0][0]).toMatchObject({ unitsPerPackage: 12, packageType: "caixa", purchaseUnit: "CX" });
    await waitFor(() => expect(recordCost).toHaveBeenCalledWith(expect.objectContaining({ cost_cents: 700 })));
  });

  it("em caixa sem a quantidade de unidades não há custo unitário nem cálculo, e a tela diz o que falta", async () => {
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Fardo" }));
    identify();
    type("Valor pago pelo fardo", "84,00");

    expect(await screen.findByText("Informe quantas unidades vêm no fardo.")).toBeInTheDocument();
    expect(screen.queryByTestId("unit-cost")).not.toBeInTheDocument();
    expect(draft).not.toHaveBeenCalled();
  });

  it("a data do custo é visível e editável, e vai no registro do custo", async () => {
    open();
    fill("6,00");
    type("Data do custo", "2026-10-05");
    fireEvent.click(screen.getByRole("button", { name: "Salvar sem preço" }));

    await waitFor(() => expect(recordCost).toHaveBeenCalledWith({ sku: "100113", effective_from: "2026-10-05", cost_cents: 600, reason: "Custo informado no cadastro do produto" }));
    expect(choosePrice).not.toHaveBeenCalled();
  });
});

describe("NewProductPanel — o preço sugerido enquanto se preenche", () => {
  it("sem custo não calcula e não inventa preço nem margem; o botão de salvar preço fica desabilitado", () => {
    open();

    expect(screen.getByText("Informe o custo para calcular o preço sugerido.")).toBeInTheDocument();
    expect(draft).not.toHaveBeenCalled();
    expect(screen.getByTestId("chosen-margin")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "Salvar produto e preço" })).toBeDisabled();
  });

  it("com custo mostra sugerido, preço de venda acompanhando, margem e contribuição por unidade, todos do motor", async () => {
    open();
    fill("6,00");

    await waitFor(() => expect(screen.getByTestId("chosen-margin")).toHaveTextContent("35,2%"));
    expect(screen.getByLabelText("Preço sugerido")).toHaveValue("15,00");
    expect(screen.getByLabelText("Preço de venda")).toHaveValue("15,00");
    expect(screen.getByText("R$ 5,28")).toBeInTheDocument();
    expect(screen.getByText("Simulação ilustrativa")).toBeInTheDocument();
    expect(draft).toHaveBeenLastCalledWith(expect.objectContaining({ category: "snack", unitCostCents: 600 }));
  });

  it("o preço digitado atualiza a margem e NÃO é sobrescrito quando a sugestão muda", async () => {
    open();
    fill("6,00");
    await waitFor(() => expect(screen.getByTestId("chosen-margin")).toHaveTextContent("35,2%"));

    type("Preço de venda", "13,50");
    await waitFor(() => expect(screen.getByTestId("chosen-margin")).toHaveTextContent("41,0%"));
    expect(draft).toHaveBeenLastCalledWith(expect.objectContaining({ typedPriceCents: 1350 }));

    type("Custo por unidade", "8,00");
    await waitFor(() => expect(screen.getByLabelText("Preço sugerido")).toHaveValue("20,00"));
    expect(screen.getByLabelText("Preço de venda")).toHaveValue("13,50");
  });

  it("a margem de outro preço nunca aparece ao lado do que está digitado: enquanto a resposta não chega, calcula", async () => {
    open();
    fill("6,00");
    await waitFor(() => expect(screen.getByTestId("chosen-margin")).toHaveTextContent("35,2%"));
    pending = [];
    type("Preço de venda", "13,50");

    await waitFor(() => expect(pending?.length).toBeGreaterThan(0));
    expect(screen.getByTestId("chosen-margin")).toHaveTextContent("Calculando…");
    expect(screen.getByTestId("chosen-margin")).not.toHaveTextContent("35,2%");
  });

  it("descarta a resposta antiga: se o custo muda, só a última pergunta vale, mesmo que a velha chegue depois", async () => {
    pending = [];
    open();
    fill("6,00");
    await waitFor(() => expect(pending?.length).toBe(1));
    type("Custo por unidade", "8,00");
    await waitFor(() => expect(pending?.length).toBe(2));

    pending[1].resolve(answer({ unitCostCents: 800 })); // a nova
    await waitFor(() => expect(screen.getByLabelText("Preço sugerido")).toHaveValue("20,00"));
    pending[0].resolve(answer({ unitCostCents: 600 })); // a velha chega depois
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByLabelText("Preço sugerido")).toHaveValue("20,00");
  });

  it("enquanto a sugestão da nova entrada não chega, não dá para salvar o preço (o que está na tela é o da entrada anterior)", async () => {
    open();
    fill("6,00");
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar produto e preço" })).toBeEnabled());

    pending = [];
    type("Custo por unidade", "8,00");
    await waitFor(() => expect(pending?.length).toBe(1));
    expect(screen.getByRole("button", { name: "Salvar produto e preço" })).toBeDisabled();
    expect(screen.getByTestId("chosen-margin")).toHaveTextContent("Calculando…");

    pending[0].resolve(answer({ unitCostCents: 800 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar produto e preço" })).toBeEnabled());
    expect(screen.getByLabelText("Preço sugerido")).toHaveValue("20,00");
  });

  it("quando falta um dado mostra exatamente o que falta, sem preço nem margem, e não deixa salvar preço", async () => {
    missing = ["Alíquota de imposto não configurada", "Sem vendas na rede para calcular o custo de pagamento"];
    open();
    fill("6,00");

    const alert = await screen.findByTestId("missing");
    expect(alert).toHaveTextContent("Alíquota de imposto não configurada");
    expect(alert).toHaveTextContent("Sem vendas na rede para calcular o custo de pagamento");
    expect(screen.getByLabelText("Preço sugerido")).toHaveValue("");
    expect(screen.getByTestId("chosen-margin")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "Salvar produto e preço" })).toBeDisabled();
    expect(document.body).not.toHaveTextContent("R$ 0,00");
  });

  it("meta inviável é explicada sem inventar preço", async () => {
    unreachable = true;
    open();
    fill("6,00");

    const notice = await screen.findByTestId("unreachable");
    expect(notice).toHaveTextContent("A meta de margem não fecha com estes custos.");
    expect(notice).toHaveTextContent("Nenhum preço é inventado");
    expect(screen.getByLabelText("Preço sugerido")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Salvar produto e preço" })).toBeDisabled();
  });

  it("falha técnica diz o que houve, preserva o que foi digitado e permite tentar de novo até funcionar", async () => {
    failure = { status: 404 };
    open();
    fill("6,00");

    const notice = await screen.findByTestId("failed");
    expect(notice).toHaveTextContent("desatualizada");
    expect(notice).toHaveTextContent("404");
    expect(screen.getByLabelText("Nome do produto novo")).toHaveValue("Pizza de frango 400 g");
    expect(screen.getByLabelText("Custo por unidade")).toHaveValue("6,00");
    expect(screen.getByRole("button", { name: "Salvar produto e preço" })).toBeDisabled();

    failure = null;
    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }));
    await waitFor(() => expect(screen.getByLabelText("Preço sugerido")).toHaveValue("15,00"));
    expect(screen.queryByTestId("failed")).not.toBeInTheDocument();
  });

  it("uma sugestão inicial diz que é inicial e nunca mostra volume nem impacto mensal", async () => {
    open();
    fill("6,00");
    await waitFor(() => expect(screen.getByTestId("chosen-margin")).toHaveTextContent("35,2%"));

    expect(screen.getByTestId("caveats")).toHaveTextContent("Sugestão inicial");
    expect(document.body).not.toHaveTextContent(/impacto/i);
    expect(document.body).not.toHaveTextContent(/un\.\/mês|por mês/i);
  });
});

describe("NewProductPanel — classificação pelo nome", () => {
  it("o nome sugere categoria e subcategoria, e a escolha manual não é sobrescrita", async () => {
    classifier = { confidence: "clear", best: { categoryKey: "beverage", categoryName: "Bebida", subcategory: "Energéticos", matched: ["monster"], score: 2 }, alternatives: [] };
    open();
    type("Nome do produto novo", "Monster Energy 269 ml");

    expect(await screen.findByText("Sugerida automaticamente")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Categoria" })).toHaveTextContent("Bebida");
    expect(screen.getByRole("combobox", { name: "Subcategoria" })).toHaveTextContent("Energéticos");

    pick("Categoria", "Lanche");
    type("Nome do produto novo", "Monster Energy 473 ml");
    await waitFor(() => expect(suggestClassification).toHaveBeenCalledWith({ name: "Monster Energy 473 ml" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("combobox", { name: "Categoria" })).toHaveTextContent("Lanche");
  });
});

describe("NewProductPanel — salvar o cadastro e salvar o preço são ações separadas", () => {
  it("'Salvar sem preço' cria o produto, os EANs, peso e marca, e o custo por unidade, e NÃO registra preço", async () => {
    open();
    type("EAN principal", "7891000100103");
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar outro EAN" }));
    type("EAN adicional 1", "7891000100222");
    type("Marca do produto novo", "Seara");
    type("Peso ou volume", "400 g");
    fill("6,00");
    fireEvent.click(screen.getByRole("button", { name: "Salvar sem preço" }));

    await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
    expect(createProduct.mock.calls[0][0]).toMatchObject({ name: "Pizza de frango 400 g", category: "snack", classificationConfirmed: true, ean: "7891000100103", brand: "Seara", netWeight: "400 g", purchaseUnit: "UN" });
    await waitFor(() => expect(addEan).toHaveBeenCalledWith(expect.objectContaining({ productId: 90, ean: "7891000100222" })));
    expect(recordCost).toHaveBeenCalledTimes(1);
    expect(choosePrice).not.toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ sku: "100113" }));
  });

  it("'Salvar produto e preço' registra o sugerido com a vigência escolhida, pelo caminho que guarda usuário e preço anterior", async () => {
    open();
    fill("6,00");
    await waitFor(() => expect(screen.getByTestId("chosen-margin")).toHaveTextContent("35,2%"));
    type("Início da vigência", "2026-10-20");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto e preço" }));

    await waitFor(() => expect(choosePrice).toHaveBeenCalledTimes(1));
    expect(choosePrice.mock.calls[0][0]).toMatchObject({ sku: "100113", choice: "suggested_accepted", chosenPriceCents: 1500, effectiveFrom: "2026-10-20", costCents: 600 });
    expect((choosePrice.mock.calls[0][0] as { reason?: string }).reason).toBeUndefined();
  });

  it("um preço diferente do sugerido exige motivo e é registrado como escolhido à mão", async () => {
    open();
    fill("6,00");
    await waitFor(() => expect(screen.getByTestId("chosen-margin")).toHaveTextContent("35,2%"));
    type("Preço de venda", "13,50");
    await waitFor(() => expect(screen.getByTestId("chosen-margin")).toHaveTextContent("41,0%"));

    expect(screen.getByRole("button", { name: "Salvar produto e preço" })).toBeDisabled();
    type("Motivo do preço escolhido", "Concorrente a 13,50");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto e preço" }));
    await waitFor(() => expect(choosePrice).toHaveBeenCalledTimes(1));
    expect(choosePrice.mock.calls[0][0]).toMatchObject({ choice: "changed_by_hand", chosenPriceCents: 1350, reason: "Concorrente a 13,50" });
  });

  it("nome, categoria e códigos de barras inválidos barram o salvamento antes de criar", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Salvar sem preço" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe o nome do produto.");

    type("Nome do produto novo", "X");
    fireEvent.click(screen.getByRole("button", { name: "Salvar sem preço" }));
    expect(await screen.findByText("Escolha a categoria (ou aceite a sugerida).")).toBeInTheDocument();

    pick("Categoria", "Lanche");
    type("EAN principal", "123");
    fireEvent.click(screen.getByRole("button", { name: "Salvar sem preço" }));
    expect(await screen.findByText("Cada código de barras deve ter de 8 a 14 dígitos.")).toBeInTheDocument();
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("se salvar o preço falha depois do produto criado, diz isso e a nova tentativa não cria o produto de novo, com a mesma chave", async () => {
    choosePrice.mockReturnValueOnce({ unwrap: async () => Promise.reject({ data: { message: "intelligence respondeu 503" } }) } as never);
    open();
    fill("6,00");
    await waitFor(() => expect(screen.getByTestId("chosen-margin")).toHaveTextContent("35,2%"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto e preço" }));

    expect(await screen.findByText(/O produto foi cadastrado, mas o preço não foi salvo: intelligence respondeu 503/)).toBeInTheDocument();
    expect(createProduct).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Salvar preço" }));
    await waitFor(() => expect(choosePrice).toHaveBeenCalledTimes(2));
    expect(createProduct).toHaveBeenCalledTimes(1);
    expect((choosePrice.mock.calls[1][0] as { idempotencyKey: string }).idempotencyKey).toBe((choosePrice.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey);
  });

  it("um EAN que já é de outro produto não cria nada e nomeia o dono", async () => {
    createProduct.mockReturnValueOnce({ unwrap: async () => Promise.reject({ data: { message: "O EAN pertence", code: "ean_linked", sku: "110001" } }) } as never);
    open();
    type("EAN principal", "7891000000001");
    fill("6,00");
    fireEvent.click(screen.getByRole("button", { name: "Salvar sem preço" }));

    expect(await screen.findByText("Este EAN já está vinculado ao produto 110001. Nenhum produto foi criado.")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("mostra o escopo (todas as lojas) e diz que publicar no PDV não faz parte", () => {
    open();

    expect(screen.getByText(/Escopo: todas as lojas/)).toHaveTextContent("a publicação no PDV não faz parte");
  });
});
