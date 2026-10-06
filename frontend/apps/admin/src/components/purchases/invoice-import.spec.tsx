import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

const createPurchase = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const updateProduct = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));

const item = (over: Record<string, unknown> = {}) => ({
  line: 1, code: "118463", description: "Monster Energy LT 473ml 6P F. LISO CP", quantity: 25, unit_cost_cents: 4349, total_cents: 108725, unit: "UN",
  sku: "M1", product_name: "Energético Monster", unresolved_reason: null, pack_size_suggested: 6, pack_source: "description", ...over,
});
let preview: Record<string, unknown> = {
  object_key: "k", number: "4990356", key: null, issued_on: "2026-09-03", issuer: { tax_id: "61186888009220", name: "SPAL" }, supplier: { id: 130, name: "Juntos+" }, matched_by: "alias", duplicate_of: null, items: [item()],
};
const read = jest.fn((_file: unknown) => ({ unwrap: async () => preview }));

jest.doMock("../../lib/api/purchases", () => ({ usePreviewInvoiceMutation: () => [read, { isLoading: false }], useCreatePurchaseMutation: () => [createPurchase, { isLoading: false }] }));
jest.doMock("../../lib/api/products", () => ({
  useGetProductsQuery: () => ({ data: [{ id: 9, sku: "M1", name: "Energético Monster", units_per_package: null }] }),
  useUpdateProductMutation: () => [updateProduct],
}));
jest.doMock("../../lib/api/suppliers", () => ({
  useGetSuppliersQuery: () => ({ data: [{ id: 130, name: "Juntos+", tax_id: null, legal_name: null }] }),
  useAddAliasMutation: () => [jest.fn(), { isLoading: false }],
  useUpdateSupplierMutation: () => [jest.fn()],
}));
jest.doMock("../../lib/hooks", () => ({ useAppDispatch: () => jest.fn() }));

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
    expect(sent).toMatchObject({ origin: "nfe", invoice_number: "4990356" });
    expect(sent.items).toEqual([expect.objectContaining({ sku: "M1", quantity: 150, unit_cost_cents: 725, condition: "paid" })]);
    expect(updateProduct).toHaveBeenCalledWith({ id: 9, changes: { unitsPerPackage: 6 } });
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
