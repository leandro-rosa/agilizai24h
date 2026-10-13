import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";

type Preview = Record<string, unknown>;

const LEGACY = {
  id: 1, supplier_id: 75, supplier_name: "Quinoa Indústria de Alimentos", week_start: "2026-09-22", week_end: "2026-09-29", kind: "legacy", period_from: "2026-09-22", period_to: "2026-09-29",
  state: "paid", counts_as_owed: true, owed_cents: 69711, partial: false,
  evidence: { lines: [], soldNotCovered: {}, quality: { salesUnknown: false, monthsWithoutDatedReceipts: [], storesMissing: 0 }, formula: "", source: "planilha", legacy_lines: [{ name: "Pão de mel", sku: "110022", unit_cost_cents: 730, quantity: 30, total_cents: 21900 }] },
  confirmed_at: "2026-09-30T00:00:00.000Z", paid_on: "2026-09-30", payment_note: null,
};

const STATUS: Record<number, unknown> = {
  75: { last: LEGACY, configured_skus: 19, period_days: null, suggested: { from: "2026-09-30", to: "2026-10-12" }, suggestion_reason: "ok" },
  76: { last: null, configured_skus: 0, period_days: null, suggested: null, suggestion_reason: "no_history" },
};

const head = { supplier_id: 75, supplier_name: "Quinoa Indústria de Alimentos", period_from: "2026-09-30", period_to: "2026-10-12", config_missing: [], conflict: null, withdrawals: null };
const READY: Preview = {
  ...head, status: "ready", total_units: 100, total_cents: 74250, configured_skus: 19, skus_without_sales: 16, issues: [], confirmable: true,
  lines: [{ sku: "110022", name: "Pão de mel", sold_units: 50, unit_cost_cents: 730, total_cents: 36500 }, { sku: "100083", name: "Cone trufado", sold_units: 50, unit_cost_cents: 595, total_cents: 29750 }],
};

const previewCalls: Array<{ args: Record<string, string>; resolve: (v: Preview) => void; reject: (e: unknown) => void }> = [];
const preview = jest.fn((args: Record<string, string>) => ({
  unwrap: () => new Promise<Preview>((resolve, reject) => previewCalls.push({ args, resolve, reject })),
}));
const confirmClosing = jest.fn((_arg: unknown) => ({ unwrap: async () => ({ ...LEGACY, id: 2, kind: "closing", state: "confirmed", paid_on: null, owed_cents: 74250, period_from: "2026-09-30", period_to: "2026-10-12", evidence: { ...LEGACY.evidence, legacy_lines: undefined, closing_lines: READY.lines } }) }));
const addCost = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
let settlements: unknown[] = [LEGACY];

jest.doMock("../../lib/api/purchases", () => ({
  useGetOpenTotalQuery: () => ({ data: { confirmed_cents: 0, proposals: 0 } }),
  useGetSettlementsQuery: () => ({ data: settlements }),
  useGetClosingStatusQuery: (arg: { supplierId: number }, opts?: { skip?: boolean }) => ({ data: opts?.skip ? undefined : STATUS[arg.supplierId], isLoading: false }),
  usePreviewClosingMutation: () => [preview, { isLoading: false }],
  useConfirmClosingMutation: () => [confirmClosing, { isLoading: false }],
  useGetConsignmentCostsQuery: () => ({ data: { agreement: null, costs: [] } }),
  useAddConsignmentCostMutation: () => [addCost, { isLoading: false }],
  usePaySettlementMutation: () => [jest.fn(), { isLoading: false }],
}));
jest.doMock("../../lib/api/suppliers", () => ({
  useGetSuppliersQuery: () => ({ data: [{ id: 75, name: "Quinoa Indústria de Alimentos", status: "active" }, { id: 76, name: "Fornecedor novo", status: "active" }] }),
}));
jest.doMock("../ingestion/drive-files-section", () => ({ DriveFilesSection: () => <p>Arquivos do Drive (seção de ingestão)</p> }));
jest.doMock("../../lib/api/products", () => ({
  useGetProductsQuery: () => ({ data: [{ id: 1, sku: "110022", name: "Pão de mel" }] }),
}));
// O Select do Radix não abre no jsdom: um <select> nativo faz o mesmo papel neste spec.
jest.doMock("../../components/ui/select", () => {
  type Props = { children?: unknown; value?: string; onValueChange?: (v: string) => void };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react");
  return {
    Select: ({ value, onValueChange, children }: Props) =>
      R.createElement("select", { "aria-label": ["7", "10", "15", "custom"].includes(value ?? "") ? "Duração do fechamento" : "Fornecedor do fechamento", value, onChange: (e: { target: { value: string } }) => onValueChange?.(e.target.value) }, R.createElement("option", { value: "" }, "Escolha"), children),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: Props) => R.createElement(R.Fragment, null, children),
    SelectItem: ({ value, children }: Props) => R.createElement("option", { value }, children),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ClosingScreen }: { ClosingScreen: ComponentType } = require("./closing-screen");

const pickSupplier = (id: string) => fireEvent.change(screen.getByLabelText("Fornecedor do fechamento"), { target: { value: id } });
const setDate = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const consult = () => fireEvent.click(screen.getByRole("button", { name: /Consultar período|Consultando/ }));
const answer = async (index: number, value: Preview) => act(async () => previewCalls[index].resolve(value));

beforeEach(() => {
  jest.clearAllMocks();
  previewCalls.length = 0;
  settlements = [LEGACY];
});

describe("Fechamentos de fornecedores — novo fechamento", () => {
  it("ao escolher o fornecedor sugere o próximo período e mostra o último fechamento só como resumo, sem a tabela dele", () => {
    render(<ClosingScreen />);
    pickSupplier("75");

    expect(screen.getByLabelText("Primeiro dia do fechamento")).toHaveValue("2026-09-30");
    expect(screen.getByLabelText("Último dia do fechamento")).toHaveValue("2026-10-12");
    expect(screen.getByTestId("last-settlement")).toHaveTextContent("22/09/2026 a 29/09/2026");
    expect(screen.queryByText("Pão de mel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("closing-result")).not.toBeInTheDocument();
  });

  it("consultar mostra carregamento e depois o resultado com o fornecedor e o período efetivamente consultados", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();

    expect(preview).toHaveBeenCalledWith({ supplier_id: 75, period_from: "2026-09-30", period_to: "2026-10-12" });
    expect(screen.getByRole("status")).toHaveTextContent("Consultando Quinoa Indústria de Alimentos de 30/09/2026 a 12/10/2026");

    await answer(0, READY);

    const result = screen.getByTestId("closing-result");
    expect(result).toHaveTextContent("Resultado: Quinoa Indústria de Alimentos · 30/09/2026 a 12/10/2026");
    expect(result).toHaveTextContent("R$ 742,50");
    expect(result).toHaveTextContent("100 un.");
    expect(result).toHaveTextContent("Retiradas por vencimento");
    expect(result).toHaveTextContent("Não disponível");
    expect(screen.getByText("Pão de mel")).toBeInTheDocument();
    expect(confirmClosing).not.toHaveBeenCalled();
  });

  it("alterar as datas invalida o resultado: some a tabela, some a confirmação e avisa que precisa consultar de novo", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await answer(0, READY);
    expect(screen.getByRole("button", { name: "Confirmar fechamento" })).toBeEnabled();

    setDate("Último dia do fechamento", "2026-10-10");

    expect(screen.queryByTestId("closing-result")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar fechamento" })).not.toBeInTheDocument();
    expect(screen.queryByText("R$ 742,50")).not.toBeInTheDocument();
    expect(screen.getByTestId("stale-note")).toHaveTextContent("Período alterado. Clique em Consultar período.");
  });

  it("trocar de fornecedor também invalida o resultado anterior", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await answer(0, READY);

    pickSupplier("76");

    expect(screen.queryByTestId("closing-result")).not.toBeInTheDocument();
  });

  it("uma resposta atrasada de uma seleção anterior não substitui a mais recente", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult(); // consulta A: 30/09 a 12/10 (fica pendente)
    setDate("Último dia do fechamento", "2026-10-10");
    consult(); // consulta B: 30/09 a 10/10

    await answer(1, { ...READY, period_to: "2026-10-10", total_cents: 11100 });
    await answer(0, READY); // A chega depois

    const result = screen.getByTestId("closing-result");
    expect(result).toHaveTextContent("30/09/2026 a 10/10/2026");
    expect(result).toHaveTextContent("R$ 111,00");
    expect(result).not.toHaveTextContent("R$ 742,50");
  });

  it("começar em 29/09, dia que já pertence ao último fechamento, avisa a sobreposição e oferece corrigir sem ajustar sozinho", () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    setDate("Primeiro dia do fechamento", "2026-09-29");

    expect(screen.getByTestId("overlap-warning")).toHaveTextContent("termina em 29/09/2026 e este período começa em 29/09/2026");
    expect(screen.getByLabelText("Primeiro dia do fechamento")).toHaveValue("2026-09-29");

    fireEvent.click(screen.getByRole("button", { name: "Começar em 30/09/2026" }));
    expect(screen.getByLabelText("Primeiro dia do fechamento")).toHaveValue("2026-09-30");
    expect(screen.queryByTestId("overlap-warning")).not.toBeInTheDocument();
  });

  it("período já fechado vem do servidor como conflito, e o botão leva ao dia seguinte só quando a pessoa clica", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    setDate("Primeiro dia do fechamento", "2026-09-29");
    consult();
    await answer(0, { ...head, period_from: "2026-09-29", status: "conflict", conflict: { settlement_id: 1, period_from: "2026-09-22", period_to: "2026-09-29", state: "paid", suggested_from: "2026-09-30" }, lines: [], total_units: 0, total_cents: 0, configured_skus: 19, skus_without_sales: 0, issues: [], confirmable: false });

    const result = screen.getByTestId("closing-result");
    expect(result).toHaveTextContent("Período já fechado");
    expect(result).not.toHaveTextContent("R$");
    expect(screen.queryByRole("button", { name: "Confirmar fechamento" })).not.toBeInTheDocument();

    fireEvent.click(within(result).getByRole("button", { name: "Começar em 30/09/2026" }));
    expect(screen.getByLabelText("Primeiro dia do fechamento")).toHaveValue("2026-09-30");
  });

  it("sem vendas é uma resposta própria e não mostra valores zerados como se fosse um resultado", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await answer(0, { ...head, status: "no_sales", lines: [], total_units: 0, total_cents: 0, configured_skus: 19, skus_without_sales: 19, issues: [], confirmable: false });

    const result = screen.getByTestId("closing-result");
    expect(result).toHaveTextContent("Sem vendas no período");
    expect(result).not.toHaveTextContent("R$ 0,00");
    expect(screen.queryByRole("button", { name: "Confirmar fechamento" })).not.toBeInTheDocument();
  });

  it("dados incompletos mostram o que falta; custo ou data faltando nunca deixa confirmar", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await answer(0, { ...READY, status: "incomplete", confirmable: false, issues: [{ code: "cost_changes_in_period", acceptable: false, sku: "110022", detail: "2026-10-05" }] });

    expect(screen.getByTestId("issues")).toHaveTextContent("O custo de 110022 começa ou muda em 05/10/2026");
    expect(screen.getByRole("button", { name: "Confirmar fechamento" })).toBeDisabled();
    expect(screen.queryByLabelText(/Confirmar mesmo incompleto/)).not.toBeInTheDocument();
  });

  it("loja sem importação pode ser aceita pela pessoa, e só depois confirma", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await answer(0, { ...READY, status: "incomplete", confirmable: false, issues: [{ code: "stores_missing", acceptable: true, detail: "2" }] });

    const confirmButton = screen.getByRole("button", { name: "Confirmar fechamento" });
    expect(confirmButton).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Confirmar mesmo incompleto/));
    expect(confirmButton).toBeEnabled();
  });

  it("erro ao consultar aparece como erro (não como zero) e dá para tentar de novo", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await act(async () => previewCalls[0].reject({ data: { message: "Sales are unavailable right now" } }));

    expect(screen.getByTestId("query-error")).toHaveTextContent("Erro ao consultar");
    expect(screen.getByTestId("query-error")).toHaveTextContent("Sales are unavailable right now");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(previewCalls).toHaveLength(2);
  });

  it("confirmar pede confirmação, envia o período consultado e leva ao histórico", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await answer(0, READY);

    fireEvent.click(screen.getByRole("button", { name: "Confirmar fechamento" }));
    expect(confirmClosing).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar fechamento" }));

    await waitFor(() => expect(confirmClosing).toHaveBeenCalledWith({ supplier_id: 75, period_from: "2026-09-30", period_to: "2026-10-12", accept_incomplete: false }));
  });
});

describe("Fechamentos de fornecedores — sincronizar vendas e abastecimento", () => {
  it("o botão fica sempre na tela e abre a seção do Drive (a mesma da ingestão, onde cada importação é confirmada)", () => {
    render(<ClosingScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Sincronizar vendas e abastecimento" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Nada é importado sozinho");
    expect(screen.getByText("Arquivos do Drive (seção de ingestão)")).toBeInTheDocument();
  });

  it("fechar a sincronização invalida o resultado antigo e pede nova consulta", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await answer(0, READY);
    expect(screen.getByTestId("closing-result")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sincronizar vendas e abastecimento" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByTestId("closing-result")).not.toBeInTheDocument());
    expect(screen.getByTestId("stale-note")).toHaveTextContent("sincronizados? Clique em Consultar período");
  });

  it("vendas sem data no resultado oferecem o atalho Sincronizar vendas", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await answer(0, { ...READY, status: "incomplete", confirmable: false, issues: [{ code: "sales_dates_missing", acceptable: false, detail: "2026-10" }] });

    fireEvent.click(within(screen.getByTestId("closing-result")).getByRole("button", { name: "Sincronizar vendas" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Sincronizar vendas e abastecimento");
  });
});

describe("Fechamentos de fornecedores — configuração pendente", () => {
  it("fornecedor sem produtos configurados mostra os passos com ações, não deixa consultar e não pede compra fictícia", () => {
    render(<ClosingScreen />);
    pickSupplier("76");

    const panel = screen.getByTestId("setup-panel");
    expect(panel).toHaveTextContent("Prepare Fornecedor novo para o primeiro fechamento");
    expect(panel).toHaveTextContent("Não é preciso criar uma compra fictícia");
    expect(screen.getByRole("button", { name: "Configurar produtos" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Informar custos" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Conferir saldo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Consultar período/ })).toBeDisabled();
    expect(screen.queryByText(/Lance uma compra/)).not.toBeInTheDocument();
  });

  it("o botão abre o cadastro de custos e grava o custo de repasse de um produto do cadastro", async () => {
    render(<ClosingScreen />);
    pickSupplier("76");
    fireEvent.click(screen.getByRole("button", { name: "Configurar produtos" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("SKU do produto consignado"), { target: { value: "110022" } });
    fireEvent.change(within(dialog).getByLabelText("Custo de repasse por unidade"), { target: { value: "7,30" } });
    fireEvent.change(within(dialog).getByLabelText("Início da vigência do custo"), { target: { value: "2026-09-22" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));

    await waitFor(() => expect(addCost).toHaveBeenCalledWith({ supplierId: 76, sku: "110022", valid_from: "2026-09-22", unit_cost_cents: 730 }));
  });
});

describe("Fechamentos de fornecedores — histórico", () => {
  it("o acerto antigo pago fica no Histórico, com as linhas da planilha, e não na aba de novo fechamento", () => {
    render(<ClosingScreen />);
    expect(screen.queryByText("Ver detalhes")).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Histórico" }), { button: 0, ctrlKey: false });

    expect(screen.getAllByText("22/09/2026 a 29/09/2026").length).toBeGreaterThan(0);
    expect(screen.getByText("Pago em 30/09/2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver detalhes" }));
    expect(screen.getByText("Pão de mel")).toBeInTheDocument();
  });
});
