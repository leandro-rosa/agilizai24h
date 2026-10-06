import { describe, expect, it } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";

import type { Figure, Insight, MonthlyPoint, Variation } from "@/lib/api/supplier-analysis";
import { DataQualityNote } from "./data-quality-note";
import { EvolutionTable } from "./evolution-table";
import { InsightList } from "./insight-list";
import { KpiStrip } from "./kpi-strip";
import { MarginBar } from "./margin-bar";
import { MovementBars } from "./movement-bars";
import { ProfitabilityStrip } from "./profitability-strip";
import { SupplierProductsTable } from "./supplier-products-table";

const ok = (value: number, partial?: boolean): Figure => (partial ? { available: true, value, partial } : { available: true, value });
const noPurchases: Figure = { available: false, reason: "no_purchase_history" };
const noBase: Variation = { reference: { available: false, reason: "no_base" }, change: { available: false, reason: "no_base" } };

describe("EvolutionTable", () => {
  const points: MonthlyPoint[] = ["2026-09", "2026-10"].map((month, i) => ({
    month,
    purchasedUnits: i === 1 ? ok(300) : noPurchases,
    restocked: ok(250 + i * 20),
    sold: ok(230 + i * 15),
    lost: ok(i === 1 ? 12 : 0),
  }));

  it("diz 'Sem histórico de compras' nos meses sem compra, e não zero", () => {
    render(<EvolutionTable points={points} />);
    const purchased = screen.getByText("Comprado").closest("tr") as HTMLElement;

    expect(within(purchased).getByText("Sem histórico de compras")).toBeInTheDocument();
    expect(within(purchased).getByText("300")).toBeInTheDocument();
    expect(within(purchased).queryByText("0")).not.toBeInTheDocument();
  });

  it("mostra zero real quando o dado existe e é zero (perdido em setembro)", () => {
    render(<EvolutionTable points={points} />);
    const lost = screen.getByText("Perdido").closest("tr") as HTMLElement;

    expect(within(lost).getByText("0")).toBeInTheDocument();
  });
});

describe("KpiStrip", () => {
  it("mostra o motivo no lugar do valor e 'Sem comparação' quando não há variação", () => {
    render(
      <KpiStrip
        compareTo="prev_month"
        items={[{ label: "Valor comprado", figure: noPurchases, kind: "cents", variation: { reference: noPurchases, change: noPurchases }, higherIsBetter: null }]}
      />,
    );

    expect(screen.getByText("Sem histórico de compras")).toBeInTheDocument();
    expect(screen.getByText("Sem comparação")).toBeInTheDocument();
    expect(screen.queryByText(/R\$\s?0,00/)).not.toBeInTheDocument();
  });

  it("mostra variação, referência e marca ~ na cifra parcial", () => {
    render(
      <KpiStrip
        compareTo="avg_3m"
        items={[
          {
            label: "Unidades vendidas",
            figure: ok(245, true),
            kind: "units",
            variation: { reference: ok(218), change: ok(0.126) },
            higherIsBetter: true,
          },
        ]}
      />,
    );

    expect(screen.getByText("~245 un.")).toBeInTheDocument();
    expect(screen.getByText(/\+13%/)).toBeInTheDocument();
    expect(screen.getByText(/média de 3 meses: 218 un\./)).toBeInTheDocument();
  });

  it("não cria variação para o que não tem base (produtos vinculados)", () => {
    render(<KpiStrip compareTo="prev_month" items={[{ label: "Produtos vinculados", figure: ok(6), kind: "skus", variation: noBase, higherIsBetter: null }]} />);

    expect(screen.getByText("6 SKUs")).toBeInTheDocument();
  });
});

describe("MovementBars", () => {
  const movement = {
    purchasedUnits: noPurchases,
    purchasedCents: noPurchases,
    restocked: ok(270),
    sold: ok(135),
    lost: ok(27),
    revenueCents: ok(0),
    lossCents: ok(0),
    marginShare: ok(0.4),
    avgCostCents: ok(800),
    avgPriceCents: ok(1300),
    grossProfitCents: ok(5000),
    markup: ok(1.6),
    costCoverage: ok(1),
  };

  it("sem compras, usa o abastecido como base e avisa", () => {
    render(<MovementBars movement={movement} />);

    expect(screen.queryByText("Comprado")).not.toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText(/percentuais sobre o abastecido/)).toBeInTheDocument();
  });
});

describe("InsightList", () => {
  const insights: Insight[] = [
    {
      kind: "store_below_network",
      label: "MÉTRICA DERIVADA",
      tone: "critical",
      text: "Taipas recebeu 30 un., mas vendeu 5 un. e perdeu 8 un.",
      evidence: { figures: { restocked: 30, sold: 5 }, formula: "vendido ÷ abastecido da loja" },
    },
  ];

  it("mostra o rótulo e a evidência de cada insight", () => {
    render(<InsightList title="Insights" insights={insights} />);

    expect(screen.getByText("MÉTRICA DERIVADA")).toBeInTheDocument();
    expect(screen.getByText(/Taipas recebeu 30 un\./)).toBeInTheDocument();
    expect(screen.getByText("Ver evidência")).toBeInTheDocument();
    expect(screen.getByText(/Conta: vendido ÷ abastecido da loja/)).toBeInTheDocument();
  });

  it("diz que não há insights em vez de inventar um", () => {
    render(<InsightList title="Insights" insights={[]} />);

    expect(screen.getByText(/Sem insights para este período/)).toBeInTheDocument();
  });
});

describe("KpiStrip comparison label", () => {
  it("usa o rótulo da API: um intervalo se compara com o período anterior", () => {
    render(
      <KpiStrip
        compareTo="prev_month"
        comparisonLabel="período anterior"
        items={[{ label: "Unidades vendidas", figure: ok(100), kind: "units", variation: { reference: ok(80), change: ok(0.25) }, higherIsBetter: true }]}
      />,
    );

    expect(screen.getByText(/\+25%/)).toBeInTheDocument();
    expect(screen.getByText(/período anterior: 80 un\./)).toBeInTheDocument();
    expect(screen.queryByText(/mês anterior/)).not.toBeInTheDocument();
  });

  it("marca com ≈ a perda rateada de um intervalo de dias", () => {
    render(<KpiStrip compareTo="prev_month" items={[{ label: "Perdas", figure: { available: true, value: 4, estimated: true }, kind: "units", variation: noBase, higherIsBetter: false }]} />);

    expect(screen.getByText("≈4 un.")).toBeInTheDocument();
  });
});

describe("DataQualityNote", () => {
  it("lista os meses incompletos e a base de compras ausente", () => {
    render(
      <DataQualityNote
        meta={{
          period: "2026-10",
          compareTo: "prev_month",
          parameterVersion: 1,
          dataQuality: { monthsWithGaps: [{ month: "2026-08", storesMissingSupply: 0, storesMissingSales: 7 }], purchaseBaseFrom: null },
        }}
      />,
    );

    expect(screen.getByText(/ainda não registrada/)).toBeInTheDocument();
    expect(screen.getByText(/ago\/2026 \(lojas 7 sem vendas\)/)).toBeInTheDocument();
  });
});

describe("SupplierProductsTable", () => {
  const base = { purchasedUnits: noPurchases, purchasedCents: noPurchases, revenueCents: ok(0), lossCents: ok(0), marginShare: noBase.change, avgCostCents: noBase.change, avgPriceCents: noBase.change, grossProfitCents: noBase.change, markup: noBase.change, costCoverage: noBase.change };
  const line = (sku: string, name: string, restocked: number, sold: number, lost: number) => ({
    sku,
    name,
    supplierId: 1,
    movement: { ...base, restocked: ok(restocked), sold: ok(sold), lost: ok(lost) },
    comparison: { sold: noBase } as never,
  });
  const lines = [line("1", "Chocolate vendido", 10, 8, 1), line("2", "Wafer parado", 0, 0, 0), line("3", "Café parado", 0, 0, 0)];

  it("esconde por padrão os produtos sem movimento e diz quantos ficaram de fora", () => {
    render(<SupplierProductsTable lines={lines as never} />);

    expect(screen.getByText("Chocolate vendido")).toBeInTheDocument();
    expect(screen.queryByText("Wafer parado")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mostrar 2 produtos sem movimento no mês" })).toBeInTheDocument();
  });

  it("mostra os parados sob pedido e permite ocultar de novo", () => {
    render(<SupplierProductsTable lines={lines as never} />);

    fireEvent.click(screen.getByRole("button", { name: /Mostrar 2 produtos/ }));
    expect(screen.getByText("Wafer parado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ocultar produtos sem movimento" }));
    expect(screen.queryByText("Wafer parado")).not.toBeInTheDocument();
  });

  it("avisa quando nenhum produto do fornecedor teve movimento", () => {
    render(<SupplierProductsTable lines={lines.slice(1) as never} />);

    expect(screen.getByText(/Nenhum produto deste fornecedor teve compra, abastecimento, venda ou perda/)).toBeInTheDocument();
  });
});

describe("MarginBar", () => {
  it("destaca a margem abaixo do corte de atenção e não desenha barra para margem ausente", () => {
    const { rerender } = render(<MarginBar margin={ok(0.15)} threshold={0.2} />);
    expect(screen.getByText("15,0%").className).toMatch(/text-warning/);

    rerender(<MarginBar margin={ok(0.55)} threshold={0.2} />);
    expect(screen.getByText("55,0%").className).not.toMatch(/text-warning/);

    rerender(<MarginBar margin={{ available: false, reason: "no_cost" }} threshold={0.2} />);
    expect(screen.getByText("Sem custo cadastrado")).toBeInTheDocument();
  });
});

describe("ProfitabilityStrip", () => {
  const totals = {
    current: {
      purchasedUnits: noPurchases, purchasedCents: noPurchases, restocked: ok(100), sold: ok(80), lost: ok(2), revenueCents: ok(100000), lossCents: ok(0),
      marginShare: ok(0.575), avgCostCents: ok(300), avgPriceCents: ok(790), grossProfitCents: ok(5794279), markup: ok(2.23), costCoverage: ok(0.998),
    },
    comparison: Object.fromEntries(
      ["purchasedUnits", "purchasedCents", "restocked", "sold", "lost", "revenueCents", "lossCents", "marginShare", "avgCostCents", "avgPriceCents", "grossProfitCents", "markup", "costCoverage"].map((key) => [key, noBase]),
    ),
  } as never;

  it("mostra lucro bruto, margem, markup, produtos com atenção e a cobertura do custo", () => {
    render(<ProfitabilityStrip totals={totals} compareTo="prev_month" attention={{ threshold: 0.2, count: 3, rated: 40 }} />);

    expect(screen.getByText("Lucro bruto")).toBeInTheDocument();
    expect(screen.getByText("57,5%")).toBeInTheDocument();
    expect(screen.getByText("2,23")).toBeInTheDocument();
    expect(screen.getByText("3 SKUs")).toBeInTheDocument();
    expect(screen.getByText(/7,5% dos 40 avaliados · margem < 20%/)).toBeInTheDocument();
    expect(screen.getByText("Cobertura do custo: 99,8%")).toBeInTheDocument();
  });

  it("sem o bloco de atenção (produto), não inventa 'produtos com atenção'", () => {
    render(<ProfitabilityStrip totals={totals} compareTo="prev_month" />);

    expect(screen.queryByText("Produtos com atenção")).not.toBeInTheDocument();
  });
});

describe("DataQualityNote — intervalo de dias", () => {
  const meta = (daily: { salesDetailMissingMonths: string[]; lossEstimated: boolean } | null) =>
    ({
      period: "2026-10",
      from: "2026-10",
      months: 1,
      granularity: "day",
      fromDate: "2026-10-01",
      toDate: "2026-10-10",
      days: 10,
      comparisonLabel: "período anterior",
      daily,
      previous: { from: "2026-09-21", to: "2026-09-30" },
      compareTo: "prev_month",
      parameterVersion: 1,
      dataQuality: { monthsWithGaps: [], purchaseBaseFrom: null },
    }) as never;

  it("explica o que o número do dia é: perda estimada e meses sem recibo com data", () => {
    render(<DataQualityNote meta={meta({ salesDetailMissingMonths: ["2026-07"], lossEstimated: true })} />);

    const note = screen.getByTestId("daily-note");
    expect(note).toHaveTextContent("A perda do dia é uma estimativa (≈)");
    expect(note).toHaveTextContent("Sem recibos com data em jul/2026");
    expect(note).toHaveTextContent("não como zero");
  });

  it("não mostra a nota num intervalo de meses inteiros", () => {
    render(<DataQualityNote meta={meta(null)} />);

    expect(screen.queryByTestId("daily-note")).not.toBeInTheDocument();
  });
});
