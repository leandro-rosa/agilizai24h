import { describe, expect, it } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";

import type { Figure, Insight, MonthlyPoint, Variation } from "@/lib/api/supplier-analysis";
import { DataQualityNote } from "./data-quality-note";
import { EvolutionTable } from "./evolution-table";
import { InsightList } from "./insight-list";
import { KpiStrip } from "./kpi-strip";
import { MovementBars } from "./movement-bars";

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
