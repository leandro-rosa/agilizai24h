import { describe, it, expect } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { RestockPanel } from "./restock-panel";
import type { RestockDisplayRow } from "./restock-table";
import type { RestockRecommendation, MixOpportunity } from "@/lib/commercial-intelligence/restock-mix/types";

function recRow(acao: RestockRecommendation["acao"], quantidadeSugeridaIA: number): RestockDisplayRow {
  return {
    kind: "recomendacao",
    productLabel: "Produto",
    storeName: "Loja",
    data: { acao, quantidadeSugeridaIA } as RestockRecommendation,
  };
}

function opportunityRow(quantidadeTeste: number): RestockDisplayRow {
  return { kind: "oportunidade", productLabel: "Produto Novo", storeName: "Loja", data: { quantidadeTeste } as MixOpportunity };
}

describe("RestockPanel", () => {
  it("counts levar (aumentar+manter), reduzir, não levar and testar into separate, non-overlapping buckets", () => {
    const rows: RestockDisplayRow[] = [
      recRow("aumentar", 30), recRow("manter", 10), recRow("reduzir", 5), recRow("reduzir", 5),
      recRow("nao_abastecer", 0), recRow("dados_insuficientes", 0), opportunityRow(4),
    ];
    render(<RestockPanel rows={rows} />);

    // Both levar and reduzir count as 2
    expect(screen.getAllByText("2")).toHaveLength(2);
    expect(screen.getByText("produtos para levar")).toBeInTheDocument();
    expect(screen.getByText("produtos para reduzir")).toBeInTheDocument();
    // Both não abastecer and testar count as 1
    expect(screen.getAllByText("1")).toHaveLength(2);
    expect(screen.getByText("produtos para não abastecer")).toBeInTheDocument();
    expect(screen.getByText("oportunidades de teste")).toBeInTheDocument();
  });

  it("sums quantidadeSugeridaIA/quantidadeTeste of every row into 'unidades sugeridas', never fabricating an impact estimate", () => {
    const rows: RestockDisplayRow[] = [recRow("aumentar", 30), recRow("manter", 10), opportunityRow(4)];
    render(<RestockPanel rows={rows} />);
    expect(screen.getByText("44")).toBeInTheDocument(); // 30+10+4
    expect(screen.queryByText(/impacto/i)).not.toBeInTheDocument();
  });
});
