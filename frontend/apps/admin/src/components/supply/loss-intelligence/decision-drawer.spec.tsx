import { describe, it, expect, jest } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { LossDecisionDrawer } from "./decision-drawer";
import type { LossIntelligenceRecommendation, NetworkComparison } from "@/lib/loss-intelligence/types";

// pt-BR's Intl currency formatter inserts a non-breaking (or narrow no-break) space between "R$"
// and the amount, which `getByText`'s default normalizer collapses on the DOM side but not on a
// literal string matcher — so a plain string/exact-match assertion can silently never match. A
// regex with \s (which matches those characters) sidesteps that without hardcoding which one ICU
// picks in this environment.
function money(cents: number): RegExp {
  const amount = (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return new RegExp(`R\\$\\s*${amount.replace(".", "\\.")}`);
}

const HEALTHY_NETWORK_COMPARISON: NetworkComparison = {
  storesCarryingSku: 8,
  storesWithSameSignal: 1,
  affectedShare: 0.125,
  storesHealthy: ["Loja 2", "Loja 3", "Loja 4", "Loja 5", "Loja 6", "Loja 7", "Loja 8"],
};

function buildRecommendation(overrides: Partial<LossIntelligenceRecommendation> = {}): LossIntelligenceRecommendation {
  return {
    sku: "SKU-DRAWER-001",
    storeId: 1,
    janelaAnalisada: { primaryMonths: ["2026-06", "2026-07", "2026-08"], recurrenceLookbackMonths: ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"] },
    metricasObservadas: {
      qtyRestocked: 27,
      qtySold: 15,
      revenueCents: 60000,
      grossMarginCents: 45000,
      netMarginAfterLossCents: 25000,
      saleToSupplyRatio: 15 / 27,
      monthsWithRestock: 3,
      monthsWithSales: 3,
      monthsAnalyzed: 3,
      firstSeenPeriod: "2025-01",
      monthsSinceFirstSeen: 19,
      byReason: {
        expired: { qtyLost: 5, valueLostCents: 20000, lossToSupplyRatio: 5 / 27, lossToRevenueRatio: null, lossToMarginRatio: null },
        damaged_product: { qtyLost: 4, valueLostCents: 40000, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null },
        other_reason: { qtyLost: 1, valueLostCents: 1000, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null },
      },
    },
    diagnosticosPorMotivo: [
      {
        reason: "expired",
        metrics: { qtyLost: 5, valueLostCents: 20000, lossToSupplyRatio: 5 / 27, lossToRevenueRatio: null, lossToMarginRatio: null },
        sinaisDetectados: ["ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS"],
        regrasAcionadas: ["validity.casoA"],
        acao: "suspender_abastecimento",
        potencialIntervencao: "alto",
        hipoteses: [],
        escopoProblema: "local",
      },
      {
        reason: "damaged_product",
        metrics: { qtyLost: 4, valueLostCents: 40000, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null },
        sinaisDetectados: ["DAMAGE_CONCENTRATED_LOCAL"],
        regrasAcionadas: ["damage.localConcentration"],
        acao: "investigar",
        potencialIntervencao: "medio",
        hipoteses: ["possível manuseio inadequado no transporte até a loja"],
        escopoProblema: "local",
      },
      {
        reason: "other_reason",
        metrics: { qtyLost: 1, valueLostCents: 1000, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null },
        sinaisDetectados: [],
        regrasAcionadas: [],
        acao: "manter",
        potencialIntervencao: null,
        hipoteses: [],
        escopoProblema: "indeterminado",
      },
    ],
    historico: [
      { period: "2026-06", qtyRestocked: 10, qtySold: 6, qtyLostByReason: { expired: 2, damaged_product: 1, other_reason: 0 } },
      { period: "2026-07", qtyRestocked: 8, qtySold: 5, qtyLostByReason: { expired: 1, damaged_product: 0, other_reason: 1 } },
      { period: "2026-08", qtyRestocked: 9, qtySold: 4, qtyLostByReason: { expired: 2, damaged_product: 1, other_reason: 0 } },
    ],
    maiorImpactoFinanceiroMotivo: "damaged_product",
    maiorImpactoFinanceiroValueCents: 40000,
    motivoDiagnosticoPrioritario: "expired",
    motivosSecundarios: ["damaged_product", "other_reason"],
    acaoPrioritaria: "suspender_abastecimento",
    acoesSecundarias: ["investigar", "manter"],
    sinaisTransversais: [],
    prioridade: "alta",
    confianca: "alta",
    comparacaoRede: {
      expired: HEALTHY_NETWORK_COMPARISON,
      damaged_product: "dado_insuficiente",
      other_reason: "dado_insuficiente",
    },
    limitacoesDosDados: ["margem_desconhecida"],
    firstSeenRecently: false,
    versaoMotor: "test-engine",
    versaoParametros: "test-params",
    ...overrides,
  };
}

const DEFAULT_PROPS = { productLabel: "Refrigerante Cola 350ml", storeName: "Loja Centro", open: true, onOpenChange: jest.fn() };

describe("LossDecisionDrawer", () => {
  it("renders every section, in order, with the fixture's exact numbers when given a complete recommendation", () => {
    render(<LossDecisionDrawer recommendation={buildRecommendation()} {...DEFAULT_PROPS} />);

    // Header
    expect(screen.getByText("Refrigerante Cola 350ml — Loja Centro")).toBeInTheDocument();

    // Status row: friendly action label (not the raw acaoPrioritaria string), priority, confidence
    expect(screen.getByText("Suspender")).toBeInTheDocument();
    expect(screen.queryByText("suspender_abastecimento")).not.toBeInTheDocument();
    expect(screen.getByText("Prioridade: alta")).toBeInTheDocument();
    expect(screen.getByText(/Confiança alta/i)).toBeInTheDocument();

    // Section order — "Por que está aqui?" promoted to the top (adenda 2026-09-23 §23.4).
    // "Limitações" is deliberately not an <h3> (it's the warning box's own <p class="font-medium">),
    // so it's checked separately below rather than through this heading list.
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Por que está aqui?",
      expect.stringContaining("Evidências — Janela usada na decisão:"),
      expect.stringContaining("Evolução — Histórico ampliado:"),
      "Comparação com a rede",
      "Diagnóstico",
      "Recomendação",
    ]);

    // Por que está aqui? — explainRecommendation's deterministic template, plain-language, at the top
    expect(screen.getByText(/27 abastecidos, 15 vendidos, 5 perdidos por validade/)).toBeInTheDocument();

    // Evidências — window explicitly named, correcting the production inconsistency (jun/2026 – ago/2026).
    // Scoped to the section: the Evolução table below repeats bare digits (e.g. "3") in its own cells.
    expect(screen.getByText("Evidências — Janela usada na decisão: 3 meses (jun/2026 – ago/2026)")).toBeInTheDocument();
    const evidenciasSection = screen.getByText(/Evidências — Janela usada na decisão/).closest("section");
    if (!evidenciasSection) throw new Error("expected the Evidências heading to be inside a <section>");
    expect(within(evidenciasSection).getByText("27")).toBeInTheDocument(); // qtyRestocked
    expect(within(evidenciasSection).getByText("15")).toBeInTheDocument(); // qtySold
    expect(within(evidenciasSection).getByText("3")).toBeInTheDocument(); // monthsWithRestock
    expect(within(evidenciasSection).getByText(money(45000))).toBeInTheDocument(); // grossMarginCents
    expect(within(evidenciasSection).getByText("Perda atribuída (Validade)")).toBeInTheDocument();
    expect(within(evidenciasSection).getByText(money(20000))).toBeInTheDocument(); // prioritario.metrics.valueLostCents
    expect(within(evidenciasSection).getByText("Resultado após perda")).toBeInTheDocument();
    expect(within(evidenciasSection).getByText(money(25000))).toBeInTheDocument(); // netMarginAfterLossCents

    // Evolução — histórico ampliado (6 meses, mar/2026 – ago/2026), now a table, one row per period
    expect(screen.getByText("Evolução — Histórico ampliado: 6 meses (mar/2026 – ago/2026)")).toBeInTheDocument();
    const evolucaoSection = screen.getByText(/Evolução — Histórico ampliado/).closest("section");
    if (!evolucaoSection) throw new Error("expected the Evolução heading to be inside a <section>");
    const dataRows = within(evolucaoSection).getAllByRole("row").slice(1); // drop the header row
    expect(dataRows.map((row) => within(row).getAllByRole("cell").map((c) => c.textContent))).toEqual([
      ["jun/2026", "10", "6", "3"],
      ["jul/2026", "8", "5", "2"],
      ["ago/2026", "9", "4", "3"],
    ]);

    // Comparação com a rede: prioritário reason ("expired") has a real comparison → healthy count shown
    expect(screen.getByText("O SKU tem desempenho saudável em 7 outras lojas.")).toBeInTheDocument();

    // Diagnóstico
    expect(screen.getByText(new RegExp(`Maior impacto financeiro: Danificado \\(${money(40000).source}\\)`))).toBeInTheDocument();
    expect(screen.getByText("Diagnóstico prioritário: Validade")).toBeInTheDocument();
    expect(screen.getByText("Também presente: Danificado, Outro motivo.")).toBeInTheDocument();

    // Recomendação — short, the action alone (the full explanation now lives in "Por que está aqui?")
    const recomendacaoSection = screen.getByText("Recomendação").closest("section");
    if (!recomendacaoSection) throw new Error("expected the Recomendação heading to be inside a <section>");
    expect(within(recomendacaoSection).getByText("Suspender.")).toBeInTheDocument();

    // Regras acionadas toggle is present (collapsed by default) — full behavior of the technical
    // detail panel is its own component's concern, not re-tested exhaustively here.
    expect(screen.getByRole("button", { name: /ver regras acionadas/i })).toBeInTheDocument();

    // Limitações — visible without any extra click
    expect(screen.getByText("Limitações")).toBeInTheDocument();
    expect(screen.getByText("margem_desconhecida")).toBeInTheDocument();

    // Fase 2 (adenda 2026-09-23 §23.4): visual only, disabled, no persistence
    expect(screen.getByRole("button", { name: "Aceitar recomendação" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Monitorar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discordar" })).toBeDisabled();
  });

  it("renders nothing and does not throw when recommendation is null", () => {
    const { container } = render(<LossDecisionDrawer recommendation={null} {...DEFAULT_PROPS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the "dados insuficientes" message, not a healthy-stores count, when comparacaoRede[motivoDiagnosticoPrioritario] is "dado_insuficiente"', () => {
    const recommendation = buildRecommendation({
      comparacaoRede: { expired: "dado_insuficiente", damaged_product: "dado_insuficiente", other_reason: "dado_insuficiente" },
    });
    render(<LossDecisionDrawer recommendation={recommendation} {...DEFAULT_PROPS} />);

    expect(screen.getByText("Lojas comparáveis insuficientes para uma comparação de rede.")).toBeInTheDocument();
    expect(screen.queryByText(/desempenho saudável/)).not.toBeInTheDocument();
  });

  it("renders one Evolução row per period, in the fixture's chronological order, with the janela's month count and range in the heading", () => {
    const recommendation = buildRecommendation({
      janelaAnalisada: { primaryMonths: ["2026-01"], recurrenceLookbackMonths: ["2026-01", "2026-02", "2026-03", "2026-04"] },
      historico: [
        { period: "2026-01", qtyRestocked: 1, qtySold: 0, qtyLostByReason: { expired: 0, damaged_product: 0, other_reason: 0 } },
        { period: "2026-02", qtyRestocked: 2, qtySold: 1, qtyLostByReason: { expired: 1, damaged_product: 0, other_reason: 0 } },
        { period: "2026-03", qtyRestocked: 3, qtySold: 2, qtyLostByReason: { expired: 0, damaged_product: 1, other_reason: 0 } },
        { period: "2026-04", qtyRestocked: 4, qtySold: 3, qtyLostByReason: { expired: 0, damaged_product: 0, other_reason: 1 } },
      ],
    });
    render(<LossDecisionDrawer recommendation={recommendation} {...DEFAULT_PROPS} />);

    expect(screen.getByText("Evidências — Janela usada na decisão: 1 mês (jan/2026)")).toBeInTheDocument();
    expect(screen.getByText("Evolução — Histórico ampliado: 4 meses (jan/2026 – abr/2026)")).toBeInTheDocument();

    const evolucaoSection = screen.getByText(/Evolução — Histórico ampliado/).closest("section");
    if (!evolucaoSection) throw new Error("expected the Evolução heading to be inside a <section>");
    const dataRows = within(evolucaoSection).getAllByRole("row").slice(1);
    expect(dataRows.map((row) => within(row).getAllByRole("cell").map((c) => c.textContent))).toEqual([
      ["jan/2026", "1", "0", "0"],
      ["fev/2026", "2", "1", "1"],
      ["mar/2026", "3", "2", "1"],
      ["abr/2026", "4", "3", "1"],
    ]);
  });

  it("shows Limitações only when limitacoesDosDados is non-empty", () => {
    const withLimitations = buildRecommendation({ limitacoesDosDados: ["margem_desconhecida", "historico_recente"] });
    const { unmount } = render(<LossDecisionDrawer recommendation={withLimitations} {...DEFAULT_PROPS} />);
    expect(screen.getByText("Limitações")).toBeInTheDocument();
    expect(screen.getByText("margem_desconhecida")).toBeInTheDocument();
    expect(screen.getByText("historico_recente")).toBeInTheDocument();
    unmount();

    const withoutLimitations = buildRecommendation({ limitacoesDosDados: [] });
    render(<LossDecisionDrawer recommendation={withoutLimitations} {...DEFAULT_PROPS} />);
    expect(screen.queryByText("Limitações")).not.toBeInTheDocument();
  });

  it("shows margem/resultado após perda as 'desconhecida' and hides Resultado após perda when grossMarginCents is null (mesma condição, nunca mostra 0)", () => {
    const recommendation = buildRecommendation({
      metricasObservadas: {
        qtyRestocked: 27,
        qtySold: 15,
        revenueCents: 60000,
        grossMarginCents: null,
        netMarginAfterLossCents: null,
        saleToSupplyRatio: 15 / 27,
        monthsWithRestock: 3,
        monthsWithSales: 3,
        monthsAnalyzed: 3,
        firstSeenPeriod: "2025-01",
        monthsSinceFirstSeen: 19,
        byReason: {
          expired: { qtyLost: 5, valueLostCents: 20000, lossToSupplyRatio: 5 / 27, lossToRevenueRatio: null, lossToMarginRatio: null },
          damaged_product: { qtyLost: 4, valueLostCents: 40000, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null },
          other_reason: { qtyLost: 1, valueLostCents: 1000, lossToSupplyRatio: null, lossToRevenueRatio: null, lossToMarginRatio: null },
        },
      },
    });
    render(<LossDecisionDrawer recommendation={recommendation} {...DEFAULT_PROPS} />);

    expect(screen.getByText("desconhecida")).toBeInTheDocument();
    expect(screen.queryByText("Resultado após perda")).not.toBeInTheDocument();
    // Perda atribuída is a fact from finance, independent of margin/cost resolution — still shown.
    expect(screen.getByText("Perda atribuída (Validade)")).toBeInTheDocument();
    expect(screen.getByText(money(20000))).toBeInTheDocument();
  });

  it("clicking 'Ver regras acionadas' still expands the existing rules panel unchanged", () => {
    render(<LossDecisionDrawer recommendation={buildRecommendation()} {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /ver regras acionadas/i }));
    expect(screen.getByText("validity.casoA")).toBeInTheDocument();
  });
});
