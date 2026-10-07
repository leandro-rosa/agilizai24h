import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

const previewCall = jest.fn((_arg: { rows: unknown[]; clearEmpty: boolean }) => ({ unwrap: async () => preview }));
const applyCall = jest.fn((_arg: unknown) => ({ unwrap: async () => applied }));
const readTable = jest.fn(async () => table);

let table: unknown[][] = [];
let preview: Record<string, unknown> = {};
let applied: Record<string, unknown> = {};

jest.doMock("../../lib/api/products", () => ({
  usePreviewCatalogueImportMutation: () => [previewCall, { isLoading: false }],
  useApplyCatalogueImportMutation: () => [applyCall, { isLoading: false }],
}));
// A leitura do xlsx roda no navegador; aqui a planilha já vem lida.
jest.doMock("xlsx", () => ({
  read: () => ({ SheetNames: ["Produtos"], Sheets: { Produtos: {} } }),
  utils: { sheet_to_json: () => table, book_new: () => ({}), aoa_to_sheet: () => ({}), book_append_sheet: () => undefined },
  writeFile: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CatalogueImportDialog }: { CatalogueImportDialog: ComponentType<{ open: boolean; onOpenChange: (open: boolean) => void }> } = require("./catalogue-import-dialog");
void readTable;

const row = (over: Record<string, unknown>) => ({ row: 2, sku: "110024", action: "create", changes: [], clears: [], addEan: null, problems: [], ...over });

async function upload() {
  render(<CatalogueImportDialog open onOpenChange={jest.fn()} />);
  const file = new File([new Uint8Array([1])], "produtos.xlsx");
  Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(1) });
  fireEvent.change(screen.getByLabelText("Arquivo da planilha"), { target: { files: [file] } });
  await screen.findByText(/Diga qual coluna da planilha é cada campo/);
}

describe("CatalogueImportDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    table = [["SKU", "Nome", "Categoria", "EAN", "Marca"], ["110024", "Água", "Bebida", 7891000100103, "Crystal"], ["110025", "Suco", "Bebida", null, null]];
    preview = { summary: { create: 1, update: 1, unchanged: 0, conflict: 1 }, rows: [row({ row: 2, changes: [{ field: "name", from: null, to: "Água" }] }), row({ row: 3, sku: "110025", action: "update", changes: [{ field: "brand", from: "Velha", to: "Nova" }], addEan: "7891000100222" }), row({ row: 4, sku: "110026", action: "conflict", problems: ["O EAN 7891000000001 já pertence ao produto 110001"] })] };
    applied = { ...preview, results: [{ row: 2, sku: "110024", action: "create", ok: true }, { row: 3, sku: "110025", action: "update", ok: true }, { row: 4, sku: "110026", action: "conflict", ok: false, error: "O EAN 7891000000001 já pertence ao produto 110001" }] };
  });

  it("começa pelo arquivo, oferece o modelo e avisa que custo e preço não entram", () => {
    render(<CatalogueImportDialog open onOpenChange={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Baixar modelo" })).toBeInTheDocument();
    expect(screen.getByText(/Custos e preços não entram nesta importação/)).toBeInTheDocument();
  });

  it("reconhece as colunas pelo cabeçalho e deixa trocar; sem a coluna do SKU não segue", async () => {
    await upload();

    expect(screen.getByLabelText("Coluna de SKU (código interno)")).toHaveValue("0");
    expect(screen.getByLabelText("Coluna de Marca")).toHaveValue("4");
    expect(screen.getByLabelText("Coluna de Subcategoria")).toHaveValue("-1");

    fireEvent.change(screen.getByLabelText("Coluna de SKU (código interno)"), { target: { value: "-1" } });
    expect(screen.getByText(/Escolha a coluna do SKU/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver prévia" })).toBeDisabled();
  });

  it("a prévia manda as linhas mapeadas SEM apagar por célula vazia, mostra novos/atualizações/conflitos, e nada foi aplicado ainda", async () => {
    await upload();
    fireEvent.click(screen.getByRole("button", { name: "Ver prévia" }));

    await waitFor(() => expect(previewCall).toHaveBeenCalledTimes(1));
    const sent = previewCall.mock.calls[0][0];
    expect(sent.clearEmpty).toBe(false);
    expect(sent.rows[0]).toMatchObject({ row: 2, sku: "110024", name: "Água", category: "Bebida", ean: "7891000100103", brand: "Crystal" });
    expect(sent.rows[1]).toMatchObject({ row: 3, sku: "110025", ean: null, brand: null });

    const summary = await screen.findByTestId("summary");
    expect(summary).toHaveTextContent("1 novos");
    expect(summary).toHaveTextContent("1 atualizações");
    expect(summary).toHaveTextContent("1 conflitos (não serão aplicados)");
    expect(screen.getByText("O EAN 7891000000001 já pertence ao produto 110001")).toBeInTheDocument();
    expect(screen.getByText(/marca: Velha →/)).toBeInTheDocument();
    expect(screen.getByText("Vincula o EAN 7891000100222")).toBeInTheDocument();
    expect(applyCall).not.toHaveBeenCalled();
  });

  it("ligar a limpeza refaz a prévia pedindo clearEmpty e mostra o que seria limpo", async () => {
    await upload();
    fireEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
    await screen.findByTestId("summary");
    preview = { ...preview, rows: [row({ row: 3, sku: "110025", action: "update", clears: ["brand", "unitsPerPackage"] })] };

    fireEvent.click(screen.getByLabelText(/Apagar o dado do produto quando a célula estiver vazia/));

    await waitFor(() => expect(previewCall).toHaveBeenCalledTimes(2));
    expect(previewCall.mock.calls[1][0].clearEmpty).toBe(true);
    expect(await screen.findByText("Vai limpar: marca, fator (un. por caixa)")).toBeInTheDocument();
  });

  it("aplica o que a prévia mostrou, com a mesma opção de limpeza, e conta criados, atualizados e não aplicados; a linha em conflito aparece com o erro", async () => {
    await upload();
    fireEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
    await screen.findByTestId("summary");
    fireEvent.click(screen.getByRole("button", { name: "Aplicar 2 alterações" }));

    await waitFor(() => expect(applyCall).toHaveBeenCalledTimes(1));
    expect(applyCall.mock.calls[0][0]).toMatchObject({ clearEmpty: false });
    expect(await screen.findByText(/Importação concluída:/)).toHaveTextContent("1 criados, 1 atualizados");
    expect(screen.getByText(/Linha 4 \(110026\): O EAN 7891000000001 já pertence ao produto 110001/)).toBeInTheDocument();
    expect(screen.getByText(/não duplica nada/)).toBeInTheDocument();
  });

  it("uma prévia sem nada a criar ou atualizar não deixa aplicar", async () => {
    preview = { summary: { create: 0, update: 0, unchanged: 2, conflict: 0 }, rows: [] };
    await upload();
    fireEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
    await screen.findByTestId("summary");

    expect(screen.getByRole("button", { name: "Aplicar 0 alterações" })).toBeDisabled();
  });

  it("uma planilha só com o cabeçalho é recusada", async () => {
    table = [["SKU", "Nome"]];
    render(<CatalogueImportDialog open onOpenChange={jest.fn()} />);
    const file = new File([new Uint8Array([1])], "vazia.xlsx");
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(1) });
    fireEvent.change(screen.getByLabelText("Arquivo da planilha"), { target: { files: [file] } });

    await waitFor(() => expect(screen.queryByText(/Diga qual coluna/)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Baixar modelo" })).toBeInTheDocument();
  });
});
