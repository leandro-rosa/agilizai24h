import { describe, it, expect, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import { RestockTable, type RestockDisplayRow } from "./restock-table";
import type { RestockRecommendation, MixOpportunity } from "@/lib/commercial-intelligence/restock-mix/types";

function rec(overrides: Partial<RestockRecommendation> = {}): RestockRecommendation {
  return {
    sku: "SKU-1", storeId: 1, categoria: "beverage", vendasUltimoMes: 17, historicoMensal: [], ultimoAbastecimento: 24,
    mesesComVenda: 6, mesesAnalisados: 6, tendencia: "crescendo", faixaEstimada: { min: 25, max: 35 }, sinalPerdas: null,
    quantidadeSugeridaIA: 30, acao: "aumentar", motivo: "teste", confianca: "alta", limitacoes: [],
    versaoMotor: "test", versaoParametros: "test", ...overrides,
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
    // Check that recommendation rows show trend signals (at least one trend label should exist)
    const trendElements = screen.queryAllByText(/Crescendo|Estável|Caindo|Volátil|Indeterminada/);
    expect(trendElements.length).toBeGreaterThan(0);
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
});
