import { describe, it, expect, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { MixTable } from "./mix-table";
import type { MixDisplayRow, MixOpportunityRow } from "./mix-table";
import type { MixRecommendation, MixOpportunity } from "@/lib/commercial-intelligence/restock-mix/types";

function rec(overrides: Partial<MixRecommendation> = {}): MixRecommendation {
  return {
    sku: "SKU-1", storeId: 1, categoria: "beverage", classificacao: "manter", evidencia: "Presença estável.",
    tendencia: "estavel", affinity: 1, margemPct: 0.2, sinalPerdas: null, confianca: "alta", limitacoes: [],
    versaoMotor: "test", versaoParametros: "test", ...overrides,
  };
}

function row(label: string, overrides: Partial<MixRecommendation> = {}): MixDisplayRow {
  return { productLabel: label, storeName: "Ascenty - ADM", data: rec(overrides) };
}

const ROWS: MixDisplayRow[] = [
  row("Coca-Cola Zero", { sku: "SKU-1", classificacao: "explorar", tendencia: "crescendo" }),
  row("Mentos", { sku: "SKU-2", classificacao: "manter", tendencia: "estavel" }),
  row("Ana Maria", { sku: "SKU-3", classificacao: "reduzir", tendencia: "caindo" }),
  row("Paçoquita", { sku: "SKU-4", classificacao: "avaliar_retirada", tendencia: "indeterminada" }),
];

const OPPORTUNITIES: MixOpportunityRow[] = [
  {
    productLabel: "Monster sabor X", storeName: "Ascenty - ADM",
    data: { sku: "SKU-9", storeId: 1, origem: "rede_inteira", evidencia: "Bom desempenho em 7 lojas da rede.", quantidadeTeste: 4, confianca: "media", versaoMotor: "test", versaoParametros: "test" } as MixOpportunity,
  },
];

describe("MixTable", () => {
  it("shows the resumo with one non-overlapping count per classificacao", () => {
    render(<MixTable rows={ROWS} opportunities={OPPORTUNITIES} onSelect={jest.fn()} onSelectOpportunity={jest.fn()} />);
    // Labels appear in both stats and table rows; verify all appear at least once
    expect(screen.getAllByText("manter").length).toBeGreaterThan(0);
    expect(screen.getAllByText("explorar").length).toBeGreaterThan(0);
    expect(screen.getAllByText("reduzir").length).toBeGreaterThan(0);
    expect(screen.getAllByText("avaliar retirada").length).toBeGreaterThan(0);
    expect(screen.getByText("oportunidades de teste")).toBeInTheDocument();
    // Multiple "1"s appear: 4 from stat tiles + 1 from opportunity count
    const ones = screen.getAllByText("1");
    expect(ones).toHaveLength(5);
  });

  it("renders Situação (tendência) and Recomendação (classificação) as two separate columns", () => {
    render(<MixTable rows={ROWS} opportunities={[]} onSelect={jest.fn()} onSelectOpportunity={jest.fn()} />);
    const rowEl = screen.getByText("Coca-Cola Zero").closest("tr");
    expect(rowEl).not.toBeNull();
    expect(rowEl!.textContent).toContain("Crescendo");
    expect(rowEl!.textContent).toContain("explorar");
  });

  it("calls onSelect with the exact row when a main-table row is clicked", () => {
    const onSelect = jest.fn();
    render(<MixTable rows={ROWS} opportunities={[]} onSelect={onSelect} onSelectOpportunity={jest.fn()} />);
    screen.getByText("Mentos").click();
    expect(onSelect).toHaveBeenCalledWith(ROWS[1]);
  });

  it("renders opportunities in their own section, separate from the main table", () => {
    render(<MixTable rows={ROWS} opportunities={OPPORTUNITIES} onSelect={jest.fn()} onSelectOpportunity={jest.fn()} />);
    expect(screen.getByText("Oportunidades de novo mix")).toBeInTheDocument();
    expect(screen.getByText("Monster sabor X")).toBeInTheDocument();
    expect(screen.getByText("Bom desempenho em 7 lojas da rede.")).toBeInTheDocument();
  });

  it("calls onSelectOpportunity with the exact opportunity when clicked", () => {
    const onSelectOpportunity = jest.fn();
    render(<MixTable rows={[]} opportunities={OPPORTUNITIES} onSelect={jest.fn()} onSelectOpportunity={onSelectOpportunity} />);
    screen.getByText("Monster sabor X").click();
    expect(onSelectOpportunity).toHaveBeenCalledWith(OPPORTUNITIES[0]);
  });

  it('never shows "Oportunidades de novo mix" when there are none', () => {
    render(<MixTable rows={ROWS} opportunities={[]} onSelect={jest.fn()} onSelectOpportunity={jest.fn()} />);
    expect(screen.queryByText("Oportunidades de novo mix")).not.toBeInTheDocument();
  });
});
