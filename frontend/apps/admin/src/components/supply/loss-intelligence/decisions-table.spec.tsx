import { describe, it, expect, jest } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { LossDecisionsTable, type DecisionRowData } from "./decisions-table";
import type {
  Confidence,
  EscopoProblema,
  LossAction,
  LossIntelligenceRecommendation,
  LossReason,
  NetworkComparison,
  PerReasonMetrics,
  Priority,
} from "@/lib/loss-intelligence/types";

// Radix Select (item-aligned position) scrolls the highlighted item into view when it
// opens — jsdom has no layout engine and doesn't implement scrollIntoView at all.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
});

function reasonMetrics(overrides: Partial<PerReasonMetrics> = {}): PerReasonMetrics {
  return {
    qtyLost: 0,
    valueLostCents: 0,
    lossToSupplyRatio: null,
    lossToRevenueRatio: null,
    lossToMarginRatio: null,
    ...overrides,
  };
}

function byReasonMetrics(primary: LossReason, qtyLost: number): Record<LossReason, PerReasonMetrics> {
  return {
    expired: reasonMetrics(primary === "expired" ? { qtyLost, valueLostCents: qtyLost * 500 } : {}),
    damaged_product: reasonMetrics(primary === "damaged_product" ? { qtyLost, valueLostCents: qtyLost * 500 } : {}),
    other_reason: reasonMetrics(primary === "other_reason" ? { qtyLost, valueLostCents: qtyLost * 500 } : {}),
  };
}

const NO_NETWORK_COMPARISON: Record<LossReason, NetworkComparison> = {
  expired: "dado_insuficiente",
  damaged_product: "dado_insuficiente",
  other_reason: "dado_insuficiente",
};

function buildRecommendation(opts: {
  sku: string;
  storeId: number;
  reason: LossReason;
  action: LossAction;
  priority: Priority | null;
  confidence: Confidence;
  maiorImpacto: LossReason | null;
  qtySold: number;
  qtyRestocked: number;
  qtyLost: number;
  sinais?: string[];
  escopo?: EscopoProblema;
}): LossIntelligenceRecommendation {
  return {
    sku: opts.sku,
    storeId: opts.storeId,
    janelaAnalisada: { primaryMonths: ["2026-08"], recurrenceLookbackMonths: ["2026-08"] },
    metricasObservadas: {
      qtyRestocked: opts.qtyRestocked,
      qtySold: opts.qtySold,
      revenueCents: opts.qtySold * 500,
      grossMarginCents: null,
      netMarginAfterLossCents: null,
      saleToSupplyRatio: opts.qtyRestocked > 0 ? opts.qtySold / opts.qtyRestocked : null,
      monthsWithRestock: 1,
      monthsWithSales: 1,
      monthsAnalyzed: 1,
      firstSeenPeriod: "2026-01",
      monthsSinceFirstSeen: 7,
      byReason: byReasonMetrics(opts.reason, opts.qtyLost),
    },
    diagnosticosPorMotivo: [
      {
        reason: opts.reason,
        metrics: reasonMetrics(),
        sinaisDetectados: opts.sinais ?? [],
        regrasAcionadas: opts.sinais ?? [],
        acao: opts.action,
        potencialIntervencao: null,
        hipoteses: [],
        escopoProblema: opts.escopo ?? "indeterminado",
      },
    ],
    historico: [],
    maiorImpactoFinanceiroMotivo: opts.maiorImpacto,
    maiorImpactoFinanceiroValueCents: opts.maiorImpacto ? opts.qtyLost * 500 : 0,
    motivoDiagnosticoPrioritario: opts.reason,
    motivosSecundarios: [],
    acaoPrioritaria: opts.action,
    acoesSecundarias: [],
    sinaisTransversais: [],
    prioridade: opts.priority,
    confianca: opts.confidence,
    comparacaoRede: NO_NETWORK_COMPARISON,
    limitacoesDosDados: [],
    firstSeenRecently: false,
    versaoMotor: "test-engine",
    versaoParametros: "test-params",
  };
}

// 6 synthetic rows: all 3 LossReason values, and now every view bucket has at least one row
// (Requer decisão: ROW_1/2/3/5 — Monitoramento: ROW_4 — Dados insuficientes: ROW_6).
const ROW_1: DecisionRowData = {
  recommendation: buildRecommendation({
    sku: "SKU-001",
    storeId: 1,
    reason: "expired",
    action: "reduzir_abastecimento",
    priority: "alta",
    confidence: "alta",
    maiorImpacto: "expired", // matches motivoDiagnosticoPrioritario -> no divergence
    qtySold: 40,
    qtyRestocked: 60,
    qtyLost: 15,
    sinais: ["LOW_SALE_RATIO_RECURRING_EXPIRY"],
    escopo: "local",
  }),
  productLabel: "Refrigerante Cola 350ml",
  storeName: "Loja Centro",
  category: "Bebidas",
  diagnosticoResumo: "Perda por validade acima do padrão da rede.",
};

const ROW_2: DecisionRowData = {
  recommendation: buildRecommendation({
    sku: "SKU-002",
    storeId: 1,
    reason: "damaged_product",
    action: "investigar",
    priority: "media",
    confidence: "media",
    maiorImpacto: "other_reason", // diverges from motivoDiagnosticoPrioritario
    qtySold: 20,
    qtyRestocked: 30,
    qtyLost: 8,
    sinais: ["DAMAGE_CONCENTRATED_LOCAL"],
    escopo: "multiplas_lojas",
  }),
  productLabel: "Batata Chips 100g",
  storeName: "Loja Centro",
  category: "Snacks",
  diagnosticoResumo: "Dano recorrente sem causa clara.",
};

const ROW_3: DecisionRowData = {
  recommendation: buildRecommendation({
    sku: "SKU-003",
    storeId: 2,
    reason: "other_reason",
    action: "suspender_abastecimento",
    priority: "critica",
    confidence: "baixa",
    maiorImpacto: "other_reason", // matches -> no divergence
    qtySold: 5,
    qtyRestocked: 50,
    qtyLost: 30,
    sinais: ["OTHER_REASON_SEVERE_RECURRING", "CAPPED_RECENT_HISTORY"],
    escopo: "rede",
  }),
  productLabel: "Água Mineral 500ml",
  storeName: "Loja Sul",
  category: "Bebidas",
  diagnosticoResumo: "Forte suspeita de furto.",
};

const ROW_4: DecisionRowData = {
  recommendation: buildRecommendation({
    sku: "SKU-004",
    storeId: 2,
    reason: "expired",
    action: "manter",
    priority: "baixa",
    confidence: "insuficiente",
    maiorImpacto: null,
    qtySold: 25,
    qtyRestocked: 28,
    qtyLost: 2,
  }),
  productLabel: "Biscoito Recheado",
  storeName: "Loja Sul",
  category: "Snacks",
  diagnosticoResumo: "Sem sinal relevante de perda.",
};

const ROW_5: DecisionRowData = {
  recommendation: buildRecommendation({
    sku: "SKU-005",
    storeId: 3,
    reason: "damaged_product",
    action: "investigar",
    priority: "alta",
    confidence: "alta",
    maiorImpacto: "expired", // diverges from motivoDiagnosticoPrioritario
    qtySold: 10,
    qtyRestocked: 40,
    qtyLost: 12,
    sinais: ["SOME_UNKNOWN_SIGNAL_CODE"], // not in SIGNAL_LABELS -> falls back to the raw code
  }),
  productLabel: "Detergente 500ml",
  storeName: "Loja Norte",
  category: "Limpeza",
  diagnosticoResumo: "Avaria concentrada numa loja.",
};

const ROW_6: DecisionRowData = {
  recommendation: buildRecommendation({
    sku: "SKU-006",
    storeId: 3,
    reason: "damaged_product",
    action: "dados_insuficientes",
    priority: null,
    confidence: "insuficiente",
    maiorImpacto: null,
    qtySold: 8,
    qtyRestocked: 10,
    qtyLost: 1,
  }),
  productLabel: "Leite Integral 1L",
  storeName: "Loja Norte",
  category: "Laticínios",
  diagnosticoResumo: "Poucas lojas para comparar o padrão.",
};

const ALL_ROWS = [ROW_1, ROW_2, ROW_3, ROW_4, ROW_5, ROW_6];
const ALL_PRODUCT_LABELS = ALL_ROWS.map((r) => r.productLabel);

/** Opens a `FilterSelect` (by its aria-label) and clicks the option with the given visible label. */
function selectFilter(filterLabel: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: filterLabel }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

/**
 * Switches the view tabs (Requer decisão/Monitoramento/Dados insuficientes/Todos). Radix's
 * `Tabs.Trigger` calls `onValueChange` from its `onMouseDown` handler, not `onClick` — a plain
 * `fireEvent.click` (which RTL dispatches without a preceding `mousedown`) never switches it.
 */
function selectView(label: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name: label }), { button: 0 });
}

/** Asserts the table shows exactly the rows for `expectedLabels` — every other synthetic product must be absent. */
function expectVisibleProducts(expectedLabels: string[]) {
  for (const label of ALL_PRODUCT_LABELS) {
    if (expectedLabels.includes(label)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    } else {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  }
}

describe("LossDecisionsTable", () => {
  describe("views (adenda 2026-09-23 §23.3)", () => {
    it('opens on "Requer decisão", excluding manter/manter_monitorar/dados_insuficientes', () => {
      render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);
      expectVisibleProducts([ROW_1.productLabel, ROW_2.productLabel, ROW_3.productLabel, ROW_5.productLabel]);
    });

    it('"Monitoramento" shows only manter/manter_monitorar rows', () => {
      render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);
      selectView("Monitoramento");
      expectVisibleProducts([ROW_4.productLabel]);
    });

    it('"Dados insuficientes" shows only dados_insuficientes rows', () => {
      render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);
      selectView("Dados insuficientes");
      expectVisibleProducts([ROW_6.productLabel]);
    });

    it('"Todos" shows every row regardless of acaoPrioritaria', () => {
      render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);
      selectView("Todos");
      expectVisibleProducts(ALL_PRODUCT_LABELS);
    });

    it("shows a discreet counter for dados_insuficientes rows that switches to that view on click, and hides itself once there", () => {
      render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);

      const counter = screen.getByText("1 produto com dados insuficientes");
      fireEvent.click(counter);

      expectVisibleProducts([ROW_6.productLabel]);
      expect(screen.queryByText("1 produto com dados insuficientes")).not.toBeInTheDocument();
    });

    it("hides the counter entirely when there are zero dados_insuficientes rows (the tab label itself still shows)", () => {
      render(<LossDecisionsTable rows={[ROW_1, ROW_2, ROW_3, ROW_4]} onSelect={jest.fn()} />);
      expect(screen.queryByText(/produtos? com dados insuficientes/)).not.toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Dados insuficientes" })).toBeInTheDocument();
    });

    it("uses plural wording for 2+ dados_insuficientes rows", () => {
      const secondInsufficient: DecisionRowData = { ...ROW_6, recommendation: { ...ROW_6.recommendation, sku: "SKU-007" }, productLabel: "Suco de Laranja 1L" };
      render(<LossDecisionsTable rows={[...ALL_ROWS, secondInsufficient]} onSelect={jest.fn()} />);
      expect(screen.getByText("2 produtos com dados insuficientes")).toBeInTheDocument();
    });
  });

  describe("Sinal detectado / Escopo do problema columns (adenda 2026-09-23 §23.3)", () => {
    it("translates sinaisDetectados codes via SIGNAL_LABELS, joining more than one with '+'", () => {
      render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);

      expect(screen.getByText("Vendas baixas recorrentes por validade")).toBeInTheDocument();
      expect(screen.getByText("Perda recorrente e severa em Outro motivo + Histórico recente — ação contida")).toBeInTheDocument();
    });

    it("falls back to the raw code when it isn't in SIGNAL_LABELS", () => {
      render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);
      selectView("Todos");
      expect(screen.getByText("SOME_UNKNOWN_SIGNAL_CODE")).toBeInTheDocument();
    });

    it("shows the escopoProblema label read from diagnosticosPorMotivo[motivoDiagnosticoPrioritario]", () => {
      render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);

      const row1 = screen.getByText(ROW_1.productLabel).closest("tr");
      const row2 = screen.getByText(ROW_2.productLabel).closest("tr");
      const row3 = screen.getByText(ROW_3.productLabel).closest("tr");
      if (!row1 || !row2 || !row3) throw new Error("expected rows to be rendered inside a <tr>");

      expect(within(row1).getByText("Local")).toBeInTheDocument();
      expect(within(row2).getByText("Múltiplas lojas")).toBeInTheDocument();
      expect(within(row3).getByText("Rede")).toBeInTheDocument();
    });
  });

  describe("filters (still available inside a view)", () => {
    it("Motivo filter reduces to exactly the rows with that motivoDiagnosticoPrioritario", () => {
      render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);
      selectView("Todos");
      selectFilter("Motivo", "Validade");
      expectVisibleProducts([ROW_1.productLabel, ROW_4.productLabel]);
    });

    it("Ação filter reduces to exactly the rows with that acaoPrioritaria", () => {
      render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);
      selectView("Todos");
      selectFilter("Ação", "Investigar");
      expectVisibleProducts([ROW_2.productLabel, ROW_5.productLabel]);
    });

    it("Prioridade filter reduces to exactly the rows with that prioridade", () => {
      render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);
      selectFilter("Prioridade", "Alta");
      expectVisibleProducts([ROW_1.productLabel, ROW_5.productLabel]);
    });

    it("Confiança filter reduces to exactly the rows with that confianca", () => {
      render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);
      selectFilter("Confiança", "Baixa");
      expectVisibleProducts([ROW_3.productLabel]);
    });

    it("Loja filter reduces to exactly the rows for that store", () => {
      render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);
      selectView("Todos");
      selectFilter("Loja", "Loja Sul");
      expectVisibleProducts([ROW_3.productLabel, ROW_4.productLabel]);
    });

    it("Categoria filter reduces to exactly the rows for that category", () => {
      render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);
      selectView("Todos");
      selectFilter("Categoria", "Snacks");
      expectVisibleProducts([ROW_2.productLabel, ROW_4.productLabel]);
    });

    it("combines Motivo + Loja filters as AND, narrowing to exactly the intersection", () => {
      render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);
      selectView("Todos");
      selectFilter("Motivo", "Validade"); // alone: ROW_1, ROW_4
      selectFilter("Loja", "Loja Sul"); // alone: ROW_3, ROW_4
      expectVisibleProducts([ROW_4.productLabel]);
    });
  });

  it("calls onSelect exactly once with the exact recommendation object for the clicked row", () => {
    const onSelect = jest.fn();
    render(<LossDecisionsTable rows={ALL_ROWS} onSelect={onSelect} />);

    fireEvent.click(screen.getByText(ROW_3.productLabel));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(ROW_3.recommendation);
  });

  it("shows the divergence indicator only on the row where maiorImpactoFinanceiroMotivo differs from motivoDiagnosticoPrioritario, not on the matching row", () => {
    render(<LossDecisionsTable rows={[ROW_1, ROW_2]} onSelect={jest.fn()} />);

    const matchingRow = screen.getByText(ROW_1.productLabel).closest("tr");
    const divergentRow = screen.getByText(ROW_2.productLabel).closest("tr");
    if (!matchingRow || !divergentRow) throw new Error("expected rows to be rendered inside a <tr>");

    expect(within(matchingRow).queryByText(/diagnóstico prioritário é outro/)).not.toBeInTheDocument();
    expect(within(divergentRow).getByText(/diagnóstico prioritário é outro/)).toBeInTheDocument();
  });
});
