import { describe, it, expect, jest } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { LossDecisionsTable, type DecisionRowData } from "./decisions-table";
import type {
  Confidence,
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
    diagnosticosPorMotivo: [],
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

// 5 synthetic rows: all 3 LossReason values (expired x2, damaged_product x2, other_reason x1)
// and 4 distinct LossAction values (reduzir_abastecimento, investigar x2, suspender_abastecimento, manter).
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
  }),
  productLabel: "Detergente 500ml",
  storeName: "Loja Norte",
  category: "Limpeza",
  diagnosticoResumo: "Avaria concentrada numa loja.",
};

const ALL_ROWS = [ROW_1, ROW_2, ROW_3, ROW_4, ROW_5];
const ALL_PRODUCT_LABELS = ALL_ROWS.map((r) => r.productLabel);

/** Opens a `FilterSelect` (by its aria-label) and clicks the option with the given visible label. */
function selectFilter(filterLabel: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: filterLabel }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
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
  it("renders all 5 synthetic rows by default (no filter applied)", () => {
    render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);
    expectVisibleProducts(ALL_PRODUCT_LABELS);
  });

  it("Motivo filter reduces to exactly the rows with that motivoDiagnosticoPrioritario", () => {
    render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);
    selectFilter("Motivo", "Validade");
    expectVisibleProducts([ROW_1.productLabel, ROW_4.productLabel]);
  });

  it("Ação filter reduces to exactly the rows with that acaoPrioritaria", () => {
    render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);
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
    selectFilter("Loja", "Loja Sul");
    expectVisibleProducts([ROW_3.productLabel, ROW_4.productLabel]);
  });

  it("Categoria filter reduces to exactly the rows for that category", () => {
    render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);
    selectFilter("Categoria", "Snacks");
    expectVisibleProducts([ROW_2.productLabel, ROW_4.productLabel]);
  });

  it("combines Motivo + Loja filters as AND, narrowing to exactly the intersection", () => {
    render(<LossDecisionsTable rows={ALL_ROWS} onSelect={jest.fn()} />);
    selectFilter("Motivo", "Validade"); // alone: ROW_1, ROW_4
    selectFilter("Loja", "Loja Sul"); // alone: ROW_3, ROW_4
    expectVisibleProducts([ROW_4.productLabel]);
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
