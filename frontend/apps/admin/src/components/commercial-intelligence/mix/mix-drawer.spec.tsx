import { describe, it, expect, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { MixDrawer } from "./mix-drawer";
import type { MixDisplayRow, MixOpportunityRow } from "./mix-table";
import type { MixRecommendation, MixOpportunity } from "@/lib/commercial-intelligence/restock-mix/types";

const RECOMMENDATION_ROW: MixDisplayRow = {
  productLabel: "Coca-Cola Zero",
  storeName: "Ascenty - ADM",
  data: {
    sku: "SKU-1", storeId: 1, categoria: "beverage", classificacao: "explorar", evidencia: "Tendência de crescimento, participação acima da esperada pela rede, margem saudável.",
    tendencia: "crescendo", affinity: 1.4, margemPct: 0.22, sinalPerdas: null, confianca: "alta", limitacoes: [],
    versaoMotor: "test", versaoParametros: "test",
  } satisfies MixRecommendation,
};

const OPPORTUNITY_ROW: MixOpportunityRow = {
  productLabel: "Monster sabor X",
  storeName: "Ascenty - ADM",
  data: {
    sku: "SKU-9", storeId: 1, origem: "rede_inteira", evidencia: "Bom desempenho em 7 lojas da rede.",
    quantidadeTeste: 4, confianca: "media", versaoMotor: "test", versaoParametros: "test",
  } satisfies MixOpportunity,
};

const DEFAULT_PROPS = { open: true, onOpenChange: jest.fn() };

describe("MixDrawer", () => {
  it("renders nothing when row is null", () => {
    const { container } = render(<MixDrawer row={null} {...DEFAULT_PROPS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every section for a MixDisplayRow with the fixture's exact numbers", () => {
    render(<MixDrawer row={{ variant: "recomendacao", ...RECOMMENDATION_ROW }} {...DEFAULT_PROPS} />);

    expect(screen.getByText("Coca-Cola Zero — Ascenty - ADM")).toBeInTheDocument();
    expect(screen.getByText(/Tendência de crescimento/)).toBeInTheDocument();
    expect(screen.getByText("Crescendo")).toBeInTheDocument();
    expect(screen.getByText("1.4x a participação esperada pela rede")).toBeInTheDocument();
    expect(screen.getByText("22% de margem sobre a receita")).toBeInTheDocument();
    expect(screen.getByText("Nenhum sinal ativo da Inteligência de Perdas.")).toBeInTheDocument();
  });

  it("renders a simpler drawer for a MixOpportunityRow — no situação/indicadores, evidência e quantidade de teste", () => {
    render(<MixDrawer row={{ variant: "oportunidade", ...OPPORTUNITY_ROW }} {...DEFAULT_PROPS} />);

    expect(screen.getByText("Monster sabor X — Ascenty - ADM")).toBeInTheDocument();
    expect(screen.getByText("Bom desempenho em 7 lojas da rede.")).toBeInTheDocument();
    expect(screen.getByText("Quantidade de teste: 4 unidades")).toBeInTheDocument();
    expect(screen.queryByText("Situação")).not.toBeInTheDocument();
  });
});
