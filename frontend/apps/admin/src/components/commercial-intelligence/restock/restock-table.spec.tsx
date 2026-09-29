import { describe, it, expect, jest } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { RestockTable, type RestockDisplayRow } from "./restock-table";
import type { RestockRecommendation, MixOpportunity } from "@/lib/commercial-intelligence/restock-mix/types";

function rec(overrides: Partial<RestockRecommendation> = {}): RestockRecommendation {
  return {
    sku: "SKU-1", storeId: 1, categoria: "beverage", vendasUltimoMes: 17, historicoMensal: [], ultimoAbastecimento: 24,
    mesesComVenda: 6, mesesAnalisados: 6, tendencia: "crescendo", faixaEstimada: { min: 25, max: 35 }, sinalPerdas: null,
    quantidadeSugeridaIA: 30, acao: "aumentar", motivo: "teste", confianca: "alta", limitacoes: [],
    versaoMotor: "test", versaoParametros: "test",
    parametrizacao: null, deltaVsParametrizado: null, aproveitamento: null,
    ...overrides,
  };
}

function recRow(label: string, overrides: Partial<RestockRecommendation> = {}): RestockDisplayRow {
  return { kind: "recomendacao", productLabel: label, storeName: "Loja Centro", data: rec(overrides) };
}

function opportunityRow(label: string): RestockDisplayRow {
  return {
    kind: "oportunidade", productLabel: label, storeName: "Loja Centro",
    data: { sku: "SKU-9", storeId: 1, origem: "rede_inteira", evidencia: "bom desempenho na rede", quantidadeTeste: 4, confianca: "media", versaoMotor: "test", versaoParametros: "test" } as MixOpportunity,
  };
}

const ROWS: RestockDisplayRow[] = [
  recRow("Coca-Cola Zero", { acao: "aumentar", tendencia: "crescendo" }),
  recRow("Mentos", { sku: "SKU-2", acao: "manter", tendencia: "estavel" }),
  recRow("Ana Maria", { sku: "SKU-3", acao: "reduzir", tendencia: "caindo" }),
  recRow("Paçoquita", { sku: "SKU-4", acao: "nao_abastecer", quantidadeSugeridaIA: 0 }),
  opportunityRow("Produto X"),
];

describe("RestockTable", () => {
  it("shows every row by default (Todos)", () => {
    render(<RestockTable rows={ROWS} onSelect={jest.fn()} />);
    for (const row of ROWS) expect(screen.getByText(row.productLabel)).toBeInTheDocument();
  });

  it("'Levar' shows only aumentar/manter rows", () => {
    render(<RestockTable rows={ROWS} onSelect={jest.fn()} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Levar" }), { button: 0 });
    expect(screen.getByText("Coca-Cola Zero")).toBeInTheDocument();
    expect(screen.getByText("Mentos")).toBeInTheDocument();
    expect(screen.queryByText("Ana Maria")).not.toBeInTheDocument();
    expect(screen.queryByText("Produto X")).not.toBeInTheDocument();
  });

  it("'Testar' shows opportunity rows even though they have no RestockRecommendation behind them", () => {
    render(<RestockTable rows={ROWS} onSelect={jest.fn()} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Testar" }), { button: 0 });
    expect(screen.getByText("Produto X")).toBeInTheDocument();
    expect(screen.queryByText("Coca-Cola Zero")).not.toBeInTheDocument();
  });

  it("shows a 💎 signal for opportunity rows and a trend arrow for recommendation rows", () => {
    render(<RestockTable rows={ROWS} onSelect={jest.fn()} />);
    expect(screen.getByText("💎 Oportunidade de mix")).toBeInTheDocument();
    const cocaColaRow = screen.getByText("Coca-Cola Zero").closest("tr");
    expect(cocaColaRow).not.toBeNull();
    expect(within(cocaColaRow!).getByText("↑ Crescendo")).toBeInTheDocument();
  });

  it("shows a loss-signal warning instead of the trend arrow when sinalPerdas is active", () => {
    const lossRow = recRow("Produto Sob Perda", {
      sku: "SKU-5",
      sinalPerdas: { acao: "suspender_abastecimento", prioridade: "alta", confianca: "media", escopoProblema: "local", limitacoesDosDados: [] },
    });
    render(<RestockTable rows={[...ROWS, lossRow]} onSelect={jest.fn()} />);
    const row = screen.getByText("Produto Sob Perda").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("⚠ Sinal de perdas ativo")).toBeInTheDocument();
  });

  it("calls onSelect with the exact row when a row is clicked", () => {
    const onSelect = jest.fn();
    render(<RestockTable rows={ROWS} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Mentos"));
    expect(onSelect).toHaveBeenCalledWith(ROWS[1]);
  });

  it("edits Quantidade final and reflects the edited value in the generated list, not the original suggestion", () => {
    render(<RestockTable rows={ROWS} onSelect={jest.fn()} />);

    const input = screen.getByLabelText("Quantidade final — Coca-Cola Zero");
    fireEvent.change(input, { target: { value: "36" } });
    expect(input).toHaveValue(36);

    fireEvent.click(screen.getByRole("button", { name: "Gerar lista de abastecimento" }));
    expect(screen.getByText(/Coca-Cola Zero — Loja Centro: 36 un\./)).toBeInTheDocument();
  });

  it("'Gerar lista' separates rows into Abastecer / Não abastecer / Testes", () => {
    render(<RestockTable rows={ROWS} onSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Gerar lista de abastecimento" }));

    expect(screen.getByText("Abastecer (3)")).toBeInTheDocument(); // Coca-Cola Zero, Mentos, Ana Maria (reduzir ainda é abastecer, só que menos)
    expect(screen.getByText("Não abastecer (1)")).toBeInTheDocument(); // Paçoquita
    expect(screen.getByText("Testes (1)")).toBeInTheDocument(); // Produto X
  });

  it("'Gerar lista' puts dados_insuficientes rows under 'Sem dados suficientes', never under 'Não abastecer'", () => {
    const semDadosRow = recRow("Refrigerante Guaraná", { sku: "SKU-6", acao: "dados_insuficientes", quantidadeSugeridaIA: 0 });
    render(<RestockTable rows={[...ROWS, semDadosRow]} onSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Gerar lista de abastecimento" }));

    expect(screen.getByText("Sem dados suficientes (1)")).toBeInTheDocument();
    expect(screen.getByText("Não abastecer (1)")).toBeInTheDocument(); // continua só Paçoquita
    expect(screen.getByText(/Refrigerante Guaraná — Loja Centro: 0 un\./)).toBeInTheDocument();
  });

  it("shows Parametrizado atual and Δ vs. parametrizado when configured", () => {
    const rows = [recRow("Produto Com Par", { parametrizacao: { minimo: 3, nivelDePar: 24, quantidadeAtual: 5, quantidadeAtualEm: "2026-09-24T00:00:00.000Z" }, quantidadeSugeridaIA: 9, deltaVsParametrizado: -15 })];
    render(<RestockTable rows={rows} onSelect={jest.fn()} />);
    const row = screen.getByText("Produto Com Par").closest("tr");
    expect(within(row!).getByText("24")).toBeInTheDocument();
    expect(within(row!).getByText("9 ↓15")).toBeInTheDocument();
  });

  it('shows "—" for Parametrizado atual and Δ when nothing is configured', () => {
    const rows = [recRow("Produto Sem Par", { parametrizacao: null, deltaVsParametrizado: null })];
    render(<RestockTable rows={rows} onSelect={jest.fn()} />);
    const row = screen.getByText("Produto Sem Par").closest("tr");
    const cells = within(row!).getAllByRole("cell");
    expect(cells.some((c) => c.textContent === "—")).toBe(true);
  });

  it('shows Δ with an up arrow when the suggestion exceeds parametrizado, and "= manter" when equal', () => {
    const rows = [
      recRow("Sobe", { parametrizacao: { minimo: 1, nivelDePar: 12, quantidadeAtual: null, quantidadeAtualEm: null }, quantidadeSugeridaIA: 18, deltaVsParametrizado: 6 }),
      recRow("Mantem", { sku: "SKU-MANTEM", parametrizacao: { minimo: 1, nivelDePar: 12, quantidadeAtual: null, quantidadeAtualEm: null }, quantidadeSugeridaIA: 12, deltaVsParametrizado: 0 }),
    ];
    render(<RestockTable rows={rows} onSelect={jest.fn()} />);
    expect(within(screen.getByText("Sobe").closest("tr")!).getByText("18 ↑6")).toBeInTheDocument();
    expect(within(screen.getByText("Mantem").closest("tr")!).getByText("12 = manter")).toBeInTheDocument();
  });

  it("shows Abastecido/Vendido/Perdido totals over the historical window, and Aproveitamento", () => {
    const rows = [recRow("Produto Com Historico", {
      historicoMensal: [
        { period: "2026-06", vendido: 10, abastecido: 20, perdido: 2, receitaCents: 5000 },
        { period: "2026-07", vendido: 15, abastecido: 20, perdido: 1, receitaCents: 7500 },
        { period: "2026-08", vendido: 12, abastecido: 20, perdido: 0, receitaCents: 6000 },
      ],
      aproveitamento: 0.617,
    })];
    render(<RestockTable rows={rows} onSelect={jest.fn()} />);
    const row = screen.getByText("Produto Com Historico").closest("tr");
    expect(within(row!).getByText("60")).toBeInTheDocument();
    expect(within(row!).getByText("37")).toBeInTheDocument();
    expect(within(row!).getByText("3 un.")).toBeInTheDocument();
    expect(within(row!).getByText("62%")).toBeInTheDocument();
  });

  it('shows "—" for Aproveitamento when null (nothing restocked in the window)', () => {
    const rows = [recRow("Sem Abastecimento", { aproveitamento: null })];
    render(<RestockTable rows={rows} onSelect={jest.fn()} />);
    const row = screen.getByText("Sem Abastecimento").closest("tr");
    expect(within(row!).getAllByText("—").length).toBeGreaterThan(0);
  });
});
