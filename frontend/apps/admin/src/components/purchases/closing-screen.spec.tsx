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

const REMOVALS = {
  basis: "month", months: ["2026-09", "2026-10"], months_without_data: [],
  scope: [
    { month: "2026-09", mode: "whole_month", data_until: "2026-09-30", dated_ok: true, counted_since: null },
    { month: "2026-10", mode: "whole_month", data_until: "2026-10-12", dated_ok: true, counted_since: null },
  ],
  lines: [
    { sku: "100083", name: "Cone trufado", month: "2026-09", expired: { units: 109, cents: 64855 }, other_reason: { units: 2, cents: 1190 }, returned: { units: 0, cents: 0 } },
    { sku: "100083", name: "Cone trufado", month: "2026-10", expired: { units: 10, cents: 5950 }, other_reason: { units: 0, cents: 0 }, returned: { units: 0, cents: 0 } },
  ],
  totals: { expired: { units: 119, cents: 70805 }, other_reason: { units: 2, cents: 1190 }, returned: { units: 0, cents: 0 } },
};
const STOCK = [
  { sku: "110022", name: "Pão de mel doce de leite", in_stores: 69, stores: 21, last_visit: "2026-10-12", oldest_store_visit: "2026-08-18", sold_units: 104, per_day: 8, coverage_days: 8.6 },
  { sku: "100083", name: "Cone trufado", in_stores: 1, stores: 21, last_visit: "2026-10-12", oldest_store_visit: "2026-10-12", sold_units: 0, per_day: null, coverage_days: null },
  { sku: "9992", name: "Pizza marguerita", in_stores: null, stores: 0, last_visit: null, oldest_store_visit: null, sold_units: 2, per_day: 0.15, coverage_days: null },
];
const head = { supplier_id: 75, supplier_name: "Quinoa Indústria de Alimentos", period_from: "2026-09-30", period_to: "2026-10-12", config_missing: [], conflict: null, removals: REMOVALS };
const READY: Preview = {
  ...head, status: "ready", stock: STOCK, total_units: 100, total_cents: 74250, configured_skus: 19, skus_without_sales: 16, issues: [], confirmable: true,
  lines: [{ sku: "110022", name: "Pão de mel", sold_units: 50, unit_cost_cents: 730, total_cents: 36500 }, { sku: "100083", name: "Cone trufado", sold_units: 50, unit_cost_cents: 595, total_cents: 29750 }],
};

const previewCalls: Array<{ args: Record<string, string>; resolve: (v: Preview) => void; reject: (e: unknown) => void }> = [];
const preview = jest.fn((args: Record<string, string>) => ({
  unwrap: () => new Promise<Preview>((resolve, reject) => previewCalls.push({ args, resolve, reject })),
}));
const confirmClosing = jest.fn((_arg: unknown) => ({ unwrap: async () => ({ ...LEGACY, id: 2, kind: "closing", state: "confirmed", paid_on: null, owed_cents: 74250, period_from: "2026-09-30", period_to: "2026-10-12", evidence: { ...LEGACY.evidence, legacy_lines: undefined, closing_lines: READY.lines } }) }));
const payMock = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
const cancelMock = jest.fn((_arg: unknown) => ({ unwrap: async () => ({}) }));
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
  usePaySettlementMutation: () => [payMock, { isLoading: false }],
  useCancelSettlementMutation: () => [cancelMock, { isLoading: false }],
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
    expect(result).toHaveTextContent("Vencidas (à parte)");
    expect(result).toHaveTextContent("119 un. · R$ 708,05");
    expect(result).toHaveTextContent("Outro motivo (à parte)");
    expect(result).toHaveTextContent("2 un. · R$ 11,90");
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

    await waitFor(() => expect(confirmClosing).toHaveBeenCalledWith({ supplier_id: 75, period_from: "2026-09-30", period_to: "2026-10-12", accept_incomplete: false, extras: [], home_stock: [] }));
  });
});

describe("Fechamentos de fornecedores — vencidos e outro motivo, à parte", () => {
  it("a aba mostra vencidas e outro motivo por produto e mês, com valores, e deixa claro que não entram no repasse", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await answer(0, READY);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Vencidos e outro motivo" }), { button: 0, ctrlKey: false });

    const table = screen.getByTestId("removals");
    expect(table).toHaveTextContent("Só entram no valor a repassar as que você marcar");
    expect(table).toHaveTextContent("setembro/2026");
    expect(table).toHaveTextContent("109");
    expect(table).toHaveTextContent("R$ 648,55");
    expect(table).toHaveTextContent("outubro/2026");
    expect(table).toHaveTextContent("R$ 59,50");
    expect(table).toHaveTextContent("R$ 11,90");
    expect(screen.getByTestId("closing-result")).toHaveTextContent("R$ 742,50");
  });

  it("marcar os cones vencidos soma só eles ao valor a repassar; o que não foi marcado não entra", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await answer(0, READY);
    expect(screen.getByTestId("closing-result")).toHaveTextContent("Só o vendido");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Vencidos e outro motivo" }), { button: 0, ctrlKey: false });

    fireEvent.click(screen.getByLabelText("Pagar vencidas de Cone trufado em setembro/2026"));
    fireEvent.click(screen.getByLabelText("Pagar vencidas de Cone trufado em outubro/2026"));

    const result = screen.getByTestId("closing-result");
    expect(result).toHaveTextContent("R$ 1.450,55");
    expect(result).toHaveTextContent("Vendido R$ 742,50 + R$ 708,05 escolhidos (119 un.)");
    expect(screen.getByLabelText("Pagar outro motivo de Cone trufado em setembro/2026")).not.toBeChecked();
  });

  it("'Com vencidas' mostra só os produtos com quantidade vencida, só as colunas de vencidas, e o total do que está na tela", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await answer(0, { ...READY, removals: { ...REMOVALS, lines: [...REMOVALS.lines, { sku: "9993", name: "Pizza calabresa", month: "2026-09", expired: { units: 0, cents: 0 }, other_reason: { units: 5, cents: 3960 }, returned: { units: 0, cents: 0 } }], totals: REMOVALS.totals } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Vencidos e outro motivo" }), { button: 0, ctrlKey: false });
    expect(screen.getByText("Pizza calabresa")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Com vencidas" }));

    const table = screen.getByTestId("removals");
    expect(within(table).queryByText("Pizza calabresa")).not.toBeInTheDocument();
    expect(within(table).getAllByText("Cone trufado")).toHaveLength(2);
    expect(within(table).queryByText("Valor outro motivo")).not.toBeInTheDocument();
    expect(within(table).queryByText("Devolvidas")).not.toBeInTheDocument();
    expect(table).toHaveTextContent("Total do que está na tela");
    expect(table).toHaveTextContent("119");
    expect(table).toHaveTextContent("R$ 708,05");

    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(screen.getByText("Pizza calabresa")).toBeInTheDocument();
  });

  it("o filtro acha o produto, 'Marcar vencidas do filtro' marca só os dele e 'Limpar escolha' volta ao só vendido", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await answer(0, READY);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Vencidos e outro motivo" }), { button: 0, ctrlKey: false });

    fireEvent.change(screen.getByLabelText("Filtrar produto das retiradas"), { target: { value: "cone" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar vencidas do filtro" }));
    expect(screen.getByTestId("closing-result")).toHaveTextContent("R$ 1.450,55");

    fireEvent.click(screen.getByRole("button", { name: "Limpar escolha" }));
    expect(screen.getByTestId("closing-result")).toHaveTextContent("Só o vendido");
  });

  it("a escolha vai para o servidor ao confirmar, e uma nova consulta começa sem nada marcado", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await answer(0, READY);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Vencidos e outro motivo" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByLabelText("Pagar vencidas de Cone trufado em setembro/2026"));

    fireEvent.click(screen.getByRole("button", { name: "Confirmar fechamento" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar fechamento" }));
    await waitFor(() => expect(confirmClosing).toHaveBeenCalledWith({ supplier_id: 75, period_from: "2026-09-30", period_to: "2026-10-12", accept_incomplete: false, extras: [{ sku: "100083", month: "2026-09", kind: "expired" }], home_stock: [] }));
  });

  it("sem leitura do abastecimento diz isso, em vez de mostrar zero", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await answer(0, { ...READY, removals: null });

    expect(screen.getByTestId("closing-result")).toHaveTextContent("Abastecimento não pôde ser lido");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Vencidos e outro motivo" }), { button: 0, ctrlKey: false });
    expect(screen.getByText(/Não foi possível ler as retiradas/)).toBeInTheDocument();
  });
});

describe("Fechamentos de fornecedores — estoque que sobrou", () => {
  const openStock = async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await answer(0, READY);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Estoque" }), { button: 0, ctrlKey: false });
  };

  it("mostra o saldo nas lojas, a data da última visita, o ritmo de venda e a cobertura em dias; sem registro não vira zero", async () => {
    await openStock();

    const table = screen.getByTestId("stock");
    expect(table).toHaveTextContent("Pão de mel doce de leite");
    expect(table).toHaveTextContent("12/10/2026");
    expect(table).toHaveTextContent("algumas lojas desde 18/08/2026");
    expect(table).toHaveTextContent("8,6");
    expect(table).toHaveTextContent("sem registro");
  });

  it("o estoque em casa que a pessoa digita soma ao das lojas e refaz a cobertura", async () => {
    await openStock();

    fireEvent.change(screen.getByLabelText("Estoque em casa de Pão de mel doce de leite"), { target: { value: "20" } });

    const row = screen.getByText("Pão de mel doce de leite").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("89");
    expect(row).toHaveTextContent("11,1");
  });

  it("'Só produtos com estoque' esconde quem está sem saldo e sem registro", async () => {
    await openStock();
    expect(screen.getByText("Pizza marguerita")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Só produtos com estoque"));

    expect(screen.queryByText("Pizza marguerita")).not.toBeInTheDocument();
    expect(screen.getByText("Cone trufado")).toBeInTheDocument();
  });

  it("o estoque em casa digitado vai ao servidor junto da confirmação", async () => {
    await openStock();
    fireEvent.change(screen.getByLabelText("Estoque em casa de Cone trufado"), { target: { value: "30" } });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar fechamento" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar fechamento" }));

    await waitFor(() => expect(confirmClosing).toHaveBeenCalledWith(expect.objectContaining({ home_stock: [{ sku: "100083", units: 30 }] })));
  });
});

describe("Fechamentos de fornecedores — vencidos por mês e por fechamento", () => {
  it("diz como cada mês foi contado (inteiro ou só depois do último fechamento)", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await answer(0, { ...READY, removals: { ...REMOVALS, scope: [{ month: "2026-10", mode: "since_last_closing", data_until: "2026-10-31", dated_ok: true, counted_since: "2026-10-12" }] } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Vencidos e outro motivo" }), { button: 0, ctrlKey: false });

    expect(screen.getByTestId("removals-scope")).toHaveTextContent("outubro/2026: só o que veio depois do último fechamento (dados até 12/10/2026)");
  });

  it("mês cujo abastecimento passa do fim do período avisa e não deixa marcar", async () => {
    render(<ClosingScreen />);
    pickSupplier("75");
    consult();
    await answer(0, { ...READY, removals: { ...REMOVALS, scope: [{ month: "2026-09", mode: "whole_month", data_until: "2026-09-30", dated_ok: true, counted_since: null }, { month: "2026-10", mode: "since_last_closing", data_until: "2026-10-31", dated_ok: false, counted_since: "2026-10-12" }] } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Vencidos e outro motivo" }), { button: 0, ctrlKey: false });

    expect(screen.getByTestId("removals-scope")).toHaveTextContent("não pode ser marcado");
    expect(screen.getByLabelText("Pagar vencidas de Cone trufado em outubro/2026")).toBeDisabled();
    expect(screen.getByLabelText("Pagar vencidas de Cone trufado em setembro/2026")).toBeEnabled();
  });
});

describe("Fechamentos de fornecedores — pagar, cancelar e rolar a janela de detalhes", () => {
  const CLOSING = { ...LEGACY, id: 2, kind: "closing", state: "confirmed", paid_on: null, owed_cents: 225355, evidence: { ...LEGACY.evidence, legacy_lines: undefined, closing_lines: READY.lines } };
  const open = (rows: unknown[]) => {
    settlements = rows;
    render(<ClosingScreen />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Histórico" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getAllByRole("button", { name: "Ver detalhes" })[0]);
  };

  it("a janela rola (cabe na tela) e o fechamento confirmado oferece Marcar como pago", async () => {
    open([CLOSING]);
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("overflow-y-auto");
    expect(dialog.className).toContain("max-h-[90vh]");

    fireEvent.change(within(dialog).getByLabelText("Data do pagamento"), { target: { value: "2026-10-14" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Marcar como pago" }));
    await waitFor(() => expect(payMock).toHaveBeenCalledWith({ id: 2, paid_on: "2026-10-14", note: undefined }));
  });

  it("cancelar pede o motivo (mínimo 3 letras), cancela e explica que o período fica livre", async () => {
    open([CLOSING]);
    const dialog = screen.getByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar fechamento" }));
    const confirmButton = within(dialog).getByRole("button", { name: "Confirmar cancelamento" });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Motivo do cancelamento"), { target: { value: "ok" } });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Motivo do cancelamento"), { target: { value: "faltou marcar o outro motivo" } });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith({ id: 2, reason: "faltou marcar o outro motivo" }));
  });

  it("um fechamento já pago não pode ser cancelado, e o histórico de acerto antigo também não", () => {
    open([{ ...CLOSING, state: "paid", paid_on: "2026-10-14" }, LEGACY]);

    expect(screen.queryByRole("button", { name: "Cancelar fechamento" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como pago" })).not.toBeInTheDocument();
  });

  it("um fechamento cancelado mostra quem, quando e por quê, e não oferece pagar nem PDF", () => {
    open([{ ...CLOSING, state: "cancelled", evidence: { ...CLOSING.evidence, cancelled: { at: "2026-10-14T12:00:00.000Z", by: "dono@agiliz", reason: "faltou marcar", original_week_start: "2026-09-30", owed_cents: 225355 } } }]);

    expect(screen.getByTestId("cancelled-note")).toHaveTextContent("Cancelado em 14/10/2026 por dono@agiliz: faltou marcar. Valor que tinha: R$ 2.253,55");
    expect(screen.queryByRole("button", { name: "Marcar como pago" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Baixar PDF para o fornecedor" })).not.toBeInTheDocument();
  });
});

describe("Fechamentos de fornecedores — PDF do fechamento confirmado", () => {
  it("o detalhe de um fechamento do painel oferece o PDF para o fornecedor; o acerto histórico não", () => {
    settlements = [{ ...LEGACY, id: 2, kind: "closing", state: "confirmed", paid_on: null, evidence: { ...LEGACY.evidence, legacy_lines: undefined, closing_lines: READY.lines } }, LEGACY];
    render(<ClosingScreen />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Histórico" }), { button: 0, ctrlKey: false });

    fireEvent.click(screen.getAllByRole("button", { name: "Ver detalhes" })[0]);
    expect(screen.getByRole("button", { name: "Baixar PDF para o fornecedor" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getAllByRole("button", { name: "Ver detalhes" })[1]);
    expect(screen.queryByRole("button", { name: "Baixar PDF para o fornecedor" })).not.toBeInTheDocument();
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
