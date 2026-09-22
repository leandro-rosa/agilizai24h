import { describe, it, expect, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

import { AgentSummaryPanel } from "./agent-summary-panel";
import type { LossAction, LossIntelligenceResult } from "@/lib/loss-intelligence/types";

const ZERO_COUNTS: Record<LossAction, number> = {
  manter: 0,
  manter_monitorar: 0,
  reduzir_abastecimento: 0,
  investigar: 0,
  suspender_abastecimento: 0,
  avaliar_retirada_loja: 0,
  avaliar_retirada_rede: 0,
  avaliar_permanencia_loja: 0,
  avaliar_permanencia_rede: 0,
  dados_insuficientes: 0,
};

function buildResult(
  countsOverrides: Partial<Record<LossAction, number>>,
  impactEstimateCents: LossIntelligenceResult["impactEstimateCents"] = { conservative: 120_000, expected: 180_000, optimistic: 240_000 },
): LossIntelligenceResult {
  return {
    recommendations: [],
    countsByAction: { ...ZERO_COUNTS, ...countsOverrides },
    impactEstimateCents,
  };
}

describe("AgentSummaryPanel", () => {
  it("renders exactly the rows for the 3 actions with non-zero counts, with the right numbers, and no row for any zero-count action (even ones in ACTION_ROWS)", () => {
    const result = buildResult({
      suspender_abastecimento: 5,
      investigar: 3,
      avaliar_retirada_rede: 1,
      // excluded from ACTION_ROWS entirely — must never influence rows or the total
      manter: 40,
      dados_insuficientes: 7,
    });

    render(<AgentSummaryPanel result={result} onSeeAll={jest.fn()} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);

    expect(screen.getByText(/5\s+suspender abastecimento/)).toBeInTheDocument();
    expect(screen.getByText(/3\s+investigar/)).toBeInTheDocument();
    expect(screen.getByText(/1\s+avaliar retirada da rede/)).toBeInTheDocument();

    // Zero-count actions from the fixed ACTION_ROWS list must not render, even though they exist in that list.
    expect(screen.queryByText(/reduzir abastecimento/)).not.toBeInTheDocument();
    expect(screen.queryByText(/avaliar retirada da loja/)).not.toBeInTheDocument();
    expect(screen.queryByText(/avaliar permanência na rede/)).not.toBeInTheDocument();
    expect(screen.queryByText(/avaliar permanência na loja/)).not.toBeInTheDocument();

    // Total only sums the 3 rendered rows (5 + 3 + 1), never manter/dados_insuficientes.
    expect(screen.getByText("9 decisões recomendadas")).toBeInTheDocument();
  });

  it('shows "Nenhuma recomendação de atenção neste período." and renders neither the row list nor the "Ver todas as recomendações" button when totalActionable is 0', () => {
    // Only manter/dados_insuficientes have counts — both intentionally excluded from ACTION_ROWS.
    const result = buildResult({ manter: 12, dados_insuficientes: 4 });
    const onSeeAll = jest.fn();

    render(<AgentSummaryPanel result={result} onSeeAll={onSeeAll} />);

    expect(screen.getByText("Nenhuma recomendação de atenção neste período.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /ver todas as recomendações/i })).not.toBeInTheDocument();
    expect(onSeeAll).not.toHaveBeenCalled();
  });

  it('never renders the resguardo-violating substring "garantid" in the impact estimate text (never "economia garantida")', () => {
    const result = buildResult({ investigar: 2 });

    render(<AgentSummaryPanel result={result} onSeeAll={jest.fn()} />);

    const impactParagraph = screen.getByText(/Impacto potencial estimado/i);
    expect(impactParagraph.textContent).toBeTruthy();
    expect(impactParagraph.textContent?.toLowerCase()).not.toMatch(/garantid/);
    // Belt-and-suspenders: no element anywhere in the rendered panel contains that substring.
    expect(document.body.textContent?.toLowerCase()).not.toMatch(/garantid/);
  });

  it('calls onSeeAll exactly once when "Ver todas as recomendações" is clicked', () => {
    const onSeeAll = jest.fn();
    const result = buildResult({ investigar: 2 });

    render(<AgentSummaryPanel result={result} onSeeAll={onSeeAll} />);

    fireEvent.click(screen.getByRole("button", { name: /ver todas as recomendações/i }));

    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });
});
