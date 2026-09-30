import { describe, it, expect } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";

import { auditFixture, gapsFixture } from "./fixtures";
import { BalanceQualityView } from "./balance-quality-view";

const storeName = (id: number) => `Loja ${id}`;

function renderView(over: Parameters<typeof auditFixture>[0] = {}, gaps: typeof gapsFixture | undefined = gapsFixture, gapsError = false) {
  return render(<BalanceQualityView audit={auditFixture(over)} gaps={gaps} gapsError={gapsError} storeName={storeName} />);
}

describe("BalanceQualityView", () => {
  it("states that consumption and sales share one point-of-sale source and that agreement is not physical truth", () => {
    renderView();

    const notice = screen.getByRole("note");
    expect(within(notice).getByText(/mesmo ponto de venda/i)).toBeInTheDocument();
    expect(notice).toHaveTextContent(/não prova quanto existe fisicamente/i);
  });

  it("labels every figure with its line count and the period it covers", () => {
    renderView();

    expect(screen.getByText(/Período auditado: mar\/2026 a ago\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/Visitas de 02\/03\/2026 a 30\/08\/2026/)).toBeInTheDocument();
    // counted lines and the uncounted ones, apart
    expect(screen.getByText(/730 sem contagem, fora da comparação/)).toBeInTheDocument();
    // each table row names how many lines it covers
    const table = screen.getByRole("table", { name: "Contagem contra sistema por faixa de giro" });
    expect(within(within(table).getByText("Giro alto").closest("tr")!).getByText("100")).toBeInTheDocument();
    expect(within(within(table).getByText("Giro baixo").closest("tr")!).getByText("60")).toBeInTheDocument();
  });

  it("names the turnover band whose sales were never imported, instead of calling it 'no sales'", () => {
    renderView();

    const table = screen.getByRole("table", { name: "Contagem contra sistema por faixa de giro" });
    expect(within(table).getByText("Venda não importada")).toBeInTheDocument();
    expect(within(table).getByText("Sem venda no período")).toBeInTheDocument();
  });

  it("shows the provisional band cut points that came from the backend", () => {
    renderView();

    expect(screen.getByText(/Faixas provisórias/)).toHaveTextContent("a partir de 20 un/mês, médio a partir de 5");
  });

  it("reports count coverage per store and month, with the share of positive-balance lines counted", () => {
    renderView();

    const table = screen.getByRole("table", { name: "Cobertura da contagem por loja e mês" });
    expect(within(table).getByText("Loja 1")).toBeInTheDocument();
    expect(within(table).getByText(/33% \(50 de 150\)/)).toBeInTheDocument();
  });

  it("lists a store-month with consumption and no sales as a gap, and says it is left out of the distributions", () => {
    renderView();

    expect(screen.getByText(/Loja 2, abr\/2026/)).toHaveTextContent("40 loja × SKU");
    expect(screen.getByText(/fora das distribuições de consumo × venda/)).toBeInTheDocument();
  });

  it("reports a balance rise without an event apart, not as negative consumption", () => {
    renderView();

    expect(screen.getByText(/12 pares de visitas \(30 un\. no total\)/)).toBeInTheDocument();
    expect(screen.getByText(/Não são tratados como consumo negativo/)).toBeInTheDocument();
  });

  it("says capacity is not available when no line reports one — never a capacity of zero", () => {
    renderView();

    expect(screen.getByText(/Não disponível: nenhuma das 1\.000 linhas informa capacidade/)).toBeInTheDocument();
  });

  it("shows the capacity share when some lines report it", () => {
    renderView({
      gaps: {
        ...auditFixture().gaps,
        capacity: { lines: 1000, lines_with_capacity: 250, share_with_capacity: 0.25, available: true },
      },
    });

    expect(screen.getByText(/25,0% das linhas \(250 de 1\.000\) informam capacidade/)).toBeInTheDocument();
  });

  it("shows the operations set aside for having no client, from the ingestion gaps", () => {
    renderView();

    expect(screen.getByText(/33 operações e 7\.000 linhas ficaram de fora/)).toBeInTheDocument();
    expect(screen.getByText(/jun\/2026: 33 operações, 7\.000 linhas/)).toBeInTheDocument();
  });

  it("keeps the audit visible when only the gaps request failed", () => {
    renderView({}, undefined, true);

    expect(screen.getByText(/Não foi possível carregar esta contagem agora/)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Contagem contra sistema por faixa de giro" })).toBeInTheDocument();
  });

  it("lists stores that could not be read and says they are not counted as zero", () => {
    renderView({ gaps: { ...auditFixture().gaps, unavailable_stores: [{ store_id: 7, reason: "timeout" }] } });

    expect(screen.getByText("Loja 7")).toBeInTheDocument();
    expect(screen.getByText(/não entraram como zero/)).toBeInTheDocument();
  });

  it("uses no verdict wording anywhere — nothing is acceptable, unacceptable, passing or failing", () => {
    const { container } = renderView();

    expect(container.textContent).not.toMatch(/aceit|inaceit|aprov|reprov|passou|falhou|conforme|não conforme|tolerânc|dentro do limite|fora do limite|\bbom\b|\bruim\b|\bok\b/i);
  });
});
