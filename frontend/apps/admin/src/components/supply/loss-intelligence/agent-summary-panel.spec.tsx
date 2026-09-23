import { describe, it, expect, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

import { AgentSummaryPanel, type AgentSummaryScope } from "./agent-summary-panel";
import type { LossAction, LossIntelligenceRecommendation, LossIntelligenceResult, Priority } from "@/lib/loss-intelligence/types";

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

const NETWORK_SCOPE: AgentSummaryScope = { kind: "network" };
const STORE_SCOPE: AgentSummaryScope = { kind: "store", storeName: "Ascenty - SUM01" };

function buildRecommendation(storeId: number, acaoPrioritaria: LossAction, prioridade: Priority | null = null): LossIntelligenceRecommendation {
  return { storeId, acaoPrioritaria, prioridade } as LossIntelligenceRecommendation;
}

function buildResult(
  recommendations: LossIntelligenceRecommendation[],
  overrides: Partial<Pick<LossIntelligenceResult, "valueLostInPrioritizedCasesCents" | "impactEstimateCents">> = {},
): LossIntelligenceResult {
  return {
    recommendations,
    countsByAction: ZERO_COUNTS,
    valueLostInPrioritizedCasesCents: 90_000,
    impactEstimateCents: { conservative: 120_000, expected: 180_000, optimistic: 240_000 },
    ...overrides,
  };
}

describe("AgentSummaryPanel", () => {
  it("agrupa por prioridade primeiro (Crítica/Alta/Média, nessa ordem), ação como detalhe secundário dentro de cada uma (adenda 2026-09-23 §23.2)", () => {
    const result = buildResult([
      buildRecommendation(1, "suspender_abastecimento", "critica"),
      buildRecommendation(2, "investigar", "media"),
      buildRecommendation(3, "reduzir_abastecimento", "alta"),
      buildRecommendation(4, "avaliar_retirada_loja", "alta"),
      buildRecommendation(5, "manter", "baixa"), // nunca acionável, nunca aparece
    ]);

    render(<AgentSummaryPanel result={result} scope={STORE_SCOPE} onSeeAll={jest.fn()} />);

    const headings = screen.getAllByText(/^(Crítica|Alta|Média) — \d+ caso/);
    expect(headings.map((h) => h.textContent)).toEqual(["Crítica — 1 caso", "Alta — 2 casos", "Média — 1 caso"]);

    expect(screen.getByText(/1\s+suspender abastecimento/)).toBeInTheDocument();
    expect(screen.getByText(/1\s+investigar/)).toBeInTheDocument();
    expect(screen.getByText(/1\s+reduzir abastecimento/)).toBeInTheDocument();
    expect(screen.getByText(/1\s+avaliar retirada da loja/)).toBeInTheDocument();
    expect(screen.queryByText(/manter\b/)).not.toBeInTheDocument();
  });

  it('mostra "Nenhum caso requer decisão neste período." e não renderiza nem a lista nem o botão quando não há caso acionável', () => {
    const result = buildResult([buildRecommendation(1, "manter", "baixa"), buildRecommendation(1, "dados_insuficientes", null)]);
    const onSeeAll = jest.fn();

    render(<AgentSummaryPanel result={result} scope={STORE_SCOPE} onSeeAll={onSeeAll} />);

    expect(screen.getByText("Nenhum caso requer decisão neste período.")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /ver todos os casos/i })).not.toBeInTheDocument();
    expect(onSeeAll).not.toHaveBeenCalled();
  });

  it('"Impacto potencial estimado" nunca aparece — cenário não calibrado, escondido por completo (adenda 2026-09-23 §23.2)', () => {
    const result = buildResult([buildRecommendation(1, "investigar", "media")]);

    render(<AgentSummaryPanel result={result} scope={STORE_SCOPE} onSeeAll={jest.fn()} />);

    expect(screen.queryByText(/impacto potencial estimado/i)).not.toBeInTheDocument();
    expect(document.body.textContent?.toLowerCase()).not.toMatch(/garantid/);
  });

  it('chama onSeeAll uma vez ao clicar em "Ver todos os casos"', () => {
    const onSeeAll = jest.fn();
    const result = buildResult([buildRecommendation(1, "investigar", "media")]);

    render(<AgentSummaryPanel result={result} scope={STORE_SCOPE} onSeeAll={onSeeAll} />);

    fireEvent.click(screen.getByRole("button", { name: /ver todos os casos/i }));

    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('mostra "R$ em perdas associadas aos casos priorizados" como fato — nova redação (adenda 2026-09-23 §23.2, era "nos casos priorizados")', () => {
    const result = buildResult([buildRecommendation(1, "investigar", "media")], { valueLostInPrioritizedCasesCents: 45_000 });

    render(<AgentSummaryPanel result={result} scope={STORE_SCOPE} onSeeAll={jest.fn()} />);

    expect(screen.getByText("R$ 450,00 em perdas associadas aos casos priorizados.")).toBeInTheDocument();
  });

  it("escopo Rede: subtítulo mostra a contagem de casos e de lojas distintas afetadas, contando só linhas com ação acionável (§15.1.1)", () => {
    const result = buildResult([
      buildRecommendation(1, "suspender_abastecimento", "critica"),
      buildRecommendation(1, "investigar", "media"), // mesma loja da linha acima — não deve contar duas vezes
      buildRecommendation(2, "suspender_abastecimento", "critica"),
      buildRecommendation(3, "manter", "baixa"), // ação não-acionável — nunca conta como loja afetada
    ]);

    render(<AgentSummaryPanel result={result} scope={NETWORK_SCOPE} onSeeAll={jest.fn()} />);

    expect(screen.getByText("3 casos requerem decisão na operação · 2 lojas afetadas")).toBeInTheDocument();
  });

  it("escopo Rede com 1 loja afetada usa singular (§15.1.1)", () => {
    const result = buildResult([buildRecommendation(5, "investigar", "media")]);

    render(<AgentSummaryPanel result={result} scope={NETWORK_SCOPE} onSeeAll={jest.fn()} />);

    expect(screen.getByText("1 casos requerem decisão na operação · 1 loja afetada")).toBeInTheDocument();
  });

  it("escopo Loja: subtítulo nunca mostra contagem de lojas afetadas (§15.1.1)", () => {
    const result = buildResult([
      buildRecommendation(1, "investigar", "media"),
      buildRecommendation(1, "investigar", "media"),
      buildRecommendation(1, "investigar", "media"),
      buildRecommendation(1, "investigar", "media"),
    ]);

    render(<AgentSummaryPanel result={result} scope={STORE_SCOPE} onSeeAll={jest.fn()} />);

    expect(screen.getByText("4 casos requerem decisão nesta loja")).toBeInTheDocument();
    expect(screen.queryByText(/lojas? afetada/)).not.toBeInTheDocument();
  });
});
