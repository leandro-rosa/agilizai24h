import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

const createPurchase = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const updateProduct = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const addEan = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));

const item = (over: Record<string, unknown> = {}) => ({
  line: 1, code: "118463", description: "Monster Energy LT 473ml 6P F. LISO CP", quantity: 25, unit_cost_cents: 4349, total_cents: 108725, unit: "UN",
  sku: "M1", product_name: "Energético Monster", unresolved_reason: null, ean: "7891000000001", ean_candidates: [], matched_by: "ean", suggestions: [], pack_size_suggested: 6, pack_source: "description", ...over,
});
let preview: Record<string, unknown> = {
  object_key: "k", number: "4990356", key: null, issued_on: "2026-09-03", issuer: { tax_id: "61186888009220", name: "SPAL" }, supplier: { id: 130, name: "Juntos+" }, matched_by: "alias", duplicate_of: null, items: [item()],
};
const read = jest.fn((_file: unknown) => ({ unwrap: async () => preview }));

jest.doMock("../../lib/api/purchases", () => ({ usePreviewInvoiceMutation: () => [read, { isLoading: false }], useCreatePurchaseMutation: () => [createPurchase, { isLoading: false }] }));
jest.doMock("../../lib/api/products", () => ({
  useGetProductsQuery: () => ({ data: [{ id: 9, sku: "M1", name: "Energético Monster", units_per_package: null }] }),
  useUpdateProductMutation: () => [updateProduct],
  useAddProductEanMutation: () => [addEan, { isLoading: false }],
  useGetNextSkuQuery: () => ({ data: { suggested: "110024" }, isSuccess: true }),
  useCreateProductFromInvoiceMutation: () => [jest.fn(), { isLoading: false }],
}));
jest.doMock("../../lib/api/pricing", () => ({ useGetNewProductSuggestionQuery: () => ({ isLoading: true }), useChooseNewProductPriceMutation: () => [jest.fn(), { isLoading: false }] }));
jest.doMock("../../lib/api/suppliers", () => ({
  useGetSuppliersQuery: () => ({ data: [{ id: 130, name: "Juntos+", tax_id: null, legal_name: null }] }),
  useAddAliasMutation: () => [jest.fn(), { isLoading: false }],
  useUpdateSupplierMutation: () => [jest.fn()],
}));
jest.doMock("../../lib/hooks", () => ({ useAppDispatch: () => jest.fn() }));
jest.doMock("../../lib/auth/use-permission", () => ({ useHasPermission: () => true }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { InvoiceImportDialog }: { InvoiceImportDialog: ComponentType } = require("./invoice-import-dialog");

async function openWithFile() {
  render(<InvoiceImportDialog />);
  fireEvent.click(screen.getByRole("button", { name: "Importar nota fiscal" }));
  fireEvent.change(screen.getByLabelText("Arquivo XML da NF-e"), { target: { files: [new File(["<x/>"], "nfe.xml", { type: "text/xml" })] } });
  await screen.findByText(/Nota 4990356/);
}

describe("InvoiceImportDialog — o preço da nota é do fardo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    preview = { ...preview, items: [item()], supplier: { id: 130, name: "Juntos+" }, duplicate_of: null };
  });

  it("converte o fardo em unidades e mostra o custo de UMA unidade, com a embalagem sugerida pela descrição", async () => {
    await openWithFile();

    expect(screen.getByLabelText("Unidades por embalagem do item 1")).toHaveValue("6");
    expect(screen.getByText("sugerido (descrição)")).toBeInTheDocument();
    expect(screen.getByText("150 un.")).toBeInTheDocument();
    expect(screen.getByText("R$ 7,25 cada")).toBeInTheDocument();
  });

  it("a pessoa corrige a embalagem e o resultado muda na hora", async () => {
    await openWithFile();
    fireEvent.change(screen.getByLabelText("Unidades por embalagem do item 1"), { target: { value: "12" } });

    expect(screen.getByText("300 un.")).toBeInTheDocument();
    expect(screen.getByText("R$ 3,62 cada")).toBeInTheDocument();
  });

  it("registra unidades e custo unitário (não o do fardo) e lembra a embalagem no produto que ainda não tinha", async () => {
    await openWithFile();
    fireEvent.click(screen.getByRole("button", { name: "Registrar 1 item" }));

    await waitFor(() => expect(createPurchase).toHaveBeenCalledTimes(1));
    const sent = createPurchase.mock.calls[0][0] as { items: { sku: string; quantity: number; unit_cost_cents: number; condition: string }[]; origin: string; invoice_number: string };
    expect(sent).toMatchObject({ origin: "nfe", invoice_number: "4990356", stage: "invoiced" });
    expect(sent.items).toEqual([expect.objectContaining({ sku: "M1", quantity: 150, unit_cost_cents: 725, condition: "paid" })]);
    expect(updateProduct).toHaveBeenCalledWith({ id: 9, changes: { unitsPerPackage: 6 } });
  });

  it("guarda o original da nota junto: embalagens, preço da embalagem, unidades por embalagem, unidade e a data de emissão", async () => {
    await openWithFile();
    fireEvent.click(screen.getByRole("button", { name: "Registrar 1 item" }));

    await waitFor(() => expect(createPurchase).toHaveBeenCalledTimes(1));
    const sent = createPurchase.mock.calls[0][0] as { invoice_issued_on: string; items: Record<string, unknown>[] };
    expect(sent.invoice_issued_on).toBe("2026-09-03");
    // 25 fardos de R$ 43,49 com 6 unidades: 150 unidades a R$ 7,25 (o original fica ao lado do custo unitário).
    expect(sent.items[0]).toMatchObject({ quantity: 150, unit_cost_cents: 725, pack_quantity: 25, pack_unit_price_cents: 4349, units_per_pack: 6, purchase_unit: "UN" });
  });

  it("pode entrar já recebido, com a data do recebimento, e leva o prazo e o boleto", async () => {
    await openWithFile();
    fireEvent.click(screen.getByLabelText("Já recebi a mercadoria"));
    fireEvent.change(screen.getByLabelText("Data do recebimento"), { target: { value: "2026-09-04" } });
    fireEvent.change(screen.getByLabelText("Prazo de entrega"), { target: { value: "2026-09-03" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar 1 item" }));

    await waitFor(() => expect(createPurchase).toHaveBeenCalledTimes(1));
    expect(createPurchase.mock.calls[0][0]).toMatchObject({ stage: "received", received_on: "2026-09-04", expected_delivery_on: "2026-09-03" });
  });

  it("embalagem inválida bloqueia o registro em vez de adivinhar", async () => {
    await openWithFile();
    fireEvent.change(screen.getByLabelText("Unidades por embalagem do item 1"), { target: { value: "abc" } });

    expect(screen.getByText("embalagem inválida")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Registrar/ })).toBeDisabled();
  });

  it("emitente desconhecido pede o de-para antes de registrar", async () => {
    preview = { ...preview, supplier: null, matched_by: null };
    await openWithFile();

    expect(screen.getByText(/Este emitente ainda não é um fornecedor cadastrado/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vincular emitente" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Registrar/ })).toBeDisabled();
  });
});

describe("InvoiceImportDialog — sugestões por nome", () => {
  const unmatched = () => item({ sku: null, product_name: null, unresolved_reason: "no_match", matched_by: null, suggestions: [{ sku: "M1", name: "Energético Monster", score: 0.8, measure_differs: false }, { sku: "M2", name: "Monster 269ml", score: 0.6, measure_differs: true }] });

  beforeEach(() => {
    jest.clearAllMocks();
    preview = { ...preview, items: [unmatched()], supplier: { id: 130, name: "Juntos+" }, duplicate_of: null };
  });

  it("já vem com o melhor parecido escolhido no seletor, marcado como sugestão; o de medida diferente não é escolhido", async () => {
    await openWithFile();

    expect(screen.getByText(/Sugerido pelo nome/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar 1 item" })).toBeEnabled();
  });

  it("sem parecido de mesma medida, a linha fica de fora até a pessoa escolher", async () => {
    preview = { ...preview, items: [{ ...unmatched(), suggestions: [{ sku: "M2", name: "Monster 269ml", score: 0.6, measure_differs: true }] }] };
    await openWithFile();

    expect(screen.queryByText(/Sugerido pelo nome/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar 0 itens" })).toBeDisabled();
  });

  it("registrar a sugestão envia o código do fornecedor para o vínculo", async () => {
    await openWithFile();
    fireEvent.click(screen.getByRole("button", { name: "Registrar 1 item" }));

    await waitFor(() => expect(createPurchase).toHaveBeenCalledTimes(1));
    const sent = createPurchase.mock.calls[0][0] as { items: { sku: string; supplier_code?: string }[] };
    expect(sent.items[0]).toMatchObject({ sku: "M1", supplier_code: "118463" });
  });

  it("linha que já casou por código de barras não manda vínculo", async () => {
    preview = { ...preview, items: [item()] };
    await openWithFile();
    fireEvent.click(screen.getByRole("button", { name: "Registrar 1 item" }));

    await waitFor(() => expect(createPurchase).toHaveBeenCalledTimes(1));
    expect((createPurchase.mock.calls[0][0] as { items: { supplier_code?: string }[] }).items[0].supplier_code).toBeUndefined();
  });
});

describe("InvoiceImportDialog — vários EANs por produto", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    preview = { ...preview, supplier: { id: 130, name: "Juntos+" }, duplicate_of: null };
  });

  it("um EAN antigo do produto resolve para o mesmo produto e a tela diz que é o EAN histórico", async () => {
    preview = { ...preview, items: [item({ matched_by: "ean_historical", ean: "7891000000001" })] };
    await openWithFile();

    expect(screen.getByText("Energético Monster")).toBeInTheDocument();
    expect(screen.getByText(/pelo EAN 7891000000001, que este produto não usa mais \(histórico\); é o mesmo produto/)).toBeInTheDocument();
  });

  it("um EAN que nenhum produto tem aparece como EAN não identificado e a linha fica de fora até a pessoa escolher", async () => {
    preview = { ...preview, items: [item({ sku: null, product_name: null, matched_by: null, unresolved_reason: "ean_not_identified", ean: "7891000009999" })] };
    await openWithFile();

    expect(screen.getByText(/EAN 7891000009999 não identificado; fica de fora se não escolher/)).toBeInTheDocument();
    expect(createPurchase).not.toHaveBeenCalled();
  });

  it("um EAN que já foi de mais de um produto pede para escolher qual e não oferece cadastrar produto novo", async () => {
    preview = { ...preview, items: [item({ sku: null, product_name: null, matched_by: null, unresolved_reason: "ean_ambiguous", ean: "7891000000007", ean_candidates: ["Q1", "B2"] })] };
    await openWithFile();

    expect(screen.getByText(/já foi de mais de um produto \(Q1, B2\); escolha qual/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cadastrar produto novo" })).not.toBeInTheDocument();
  });
});

describe("InvoiceImportDialog — produto que ainda não existe", () => {
  const unknown = (over: Record<string, unknown> = {}) => item({ line: 1, sku: null, product_name: null, matched_by: null, unresolved_reason: "ean_not_identified", ean: "7891000100103", description: "Novo sabor de marmita", code: "FORN-77", quantity: 20, unit_cost_cents: 850, pack_size_suggested: null, pack_source: null, suggestions: [], ...over });

  beforeEach(() => {
    jest.clearAllMocks();
    preview = { ...preview, supplier: { id: 130, name: "Juntos+" }, duplicate_of: null, items: [unknown()] };
  });

  it("oferece cadastrar, e também deixar para depois, sem escolher produto nenhum", async () => {
    await openWithFile();

    expect(screen.getByRole("button", { name: "Cadastrar produto novo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deixar para depois" })).toBeInTheDocument();
  });

  it("deixar para depois guarda a linha inteira na compra, sem produto: nada é criado e nada se perde", async () => {
    await openWithFile();
    fireEvent.click(screen.getByRole("button", { name: "Deixar para depois" }));

    expect(screen.getByText(/Aguardando cadastro de produto: a linha fica na compra/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Registrar 0 itens (+1 aguardando cadastro)" }));

    await waitFor(() => expect(createPurchase).toHaveBeenCalledTimes(1));
    const sent = createPurchase.mock.calls[0][0] as { items: unknown[]; pending_lines: Record<string, unknown>[] };
    expect(sent.items).toEqual([]);
    expect(sent.pending_lines).toEqual([expect.objectContaining({ description: "Novo sabor de marmita", ean: "7891000100103", supplier_code: "FORN-77", quantity: 20, unit_cost_cents: 850, condition: "paid", pack_quantity: 20, pack_unit_price_cents: 850, units_per_pack: 1 })]);
  });

  it("dá para desfazer o 'deixar para depois' e a linha volta a ficar de fora", async () => {
    await openWithFile();
    fireEvent.click(screen.getByRole("button", { name: "Deixar para depois" }));
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));

    expect(screen.getByRole("button", { name: "Registrar 0 itens" })).toBeDisabled();
  });

  it("uma nota só com linhas pendentes e outra resolvida manda os dois lados", async () => {
    preview = { ...preview, items: [item(), unknown({ line: 2 })] };
    await openWithFile();
    fireEvent.click(screen.getByRole("button", { name: "Deixar para depois" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar 1 item (+1 aguardando cadastro)" }));

    await waitFor(() => expect(createPurchase).toHaveBeenCalledTimes(1));
    const sent = createPurchase.mock.calls[0][0] as { items: unknown[]; pending_lines: unknown[] };
    expect(sent.items).toHaveLength(1);
    expect(sent.pending_lines).toHaveLength(1);
  });

  it("produto que pode já existir: avisa, e vincular o EAN a ele não cria produto", async () => {
    preview = { ...preview, items: [unknown({ suggestions: [{ sku: "M1", name: "Energético Monster", score: 0.8, measure_differs: false }] })] };
    await openWithFile();

    expect(screen.getByText(/Este produto pode já existir no cadastro \(mais parecido: Energético Monster\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vincular EAN 7891000100103 a Energético Monster" }));

    await waitFor(() => expect(addEan).toHaveBeenCalledTimes(1));
    expect(addEan.mock.calls[0][0]).toMatchObject({ productId: 9, ean: "7891000100103" });
    expect(await screen.findByText(/EAN 7891000100103 vinculado ao produto escolhido/)).toBeInTheDocument();
  });

  it("EAN ambíguo não oferece cadastrar nem vincular", async () => {
    preview = { ...preview, items: [unknown({ unresolved_reason: "ean_ambiguous", ean_candidates: ["Q1", "B2"] })] };
    await openWithFile();

    expect(screen.queryByRole("button", { name: "Cadastrar produto novo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Vincular EAN/ })).not.toBeInTheDocument();
  });
});
