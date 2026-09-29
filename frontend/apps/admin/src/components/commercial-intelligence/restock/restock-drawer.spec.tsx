import { describe, it, expect, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { RestockDrawer } from "./restock-drawer";
import type { RestockDisplayRow } from "./restock-table";
import type { MixOpportunity, RestockRecommendation } from "@/lib/commercial-intelligence/restock-mix/types";

const RECOMMENDATION_ROW: RestockDisplayRow = {
  kind: "recomendacao",
  productLabel: "Coca-Cola Zero",
  storeName: "Loja Centro",
  data: {
    sku: "SKU-1", storeId: 1, categoria: "beverage", vendasUltimoMes: 17,
    historicoMensal: [
      { period: "2026-07", vendido: 15, abastecido: 20, perdido: 1, receitaCents: 7500 },
      { period: "2026-08", vendido: 17, abastecido: 24, perdido: 0, receitaCents: 8500 },
    ],
    ultimoAbastecimento: 24, mesesComVenda: 6, mesesAnalisados: 6, tendencia: "crescendo",
    faixaEstimada: { min: 25, max: 35 },
    sinalPerdas: { acao: "investigar", prioridade: "media", confianca: "media", escopoProblema: "local", limitacoesDosDados: [] },
    quantidadeSugeridaIA: 30, acao: "aumentar", motivo: "17 vendidos no último mês analisado, tendência crescendo nos últimos 6 meses.",
    confianca: "media", limitacoes: ["Este produto está sob avaliação da Inteligência de Perdas — decisão estrutural pendente."],
    versaoMotor: "test", versaoParametros: "test",
    parametrizacao: null, deltaVsParametrizado: null, aproveitamento: null,
  } satisfies RestockRecommendation,
};

const OPPORTUNITY_ROW: RestockDisplayRow = {
  kind: "oportunidade",
  productLabel: "Monster sabor X",
  storeName: "Ascenty - ADM",
  data: {
    sku: "SKU-9", storeId: 1, origem: "rede_inteira", evidencia: "Bom desempenho em 7 lojas da rede.",
    quantidadeTeste: 4, confianca: "media", versaoMotor: "test", versaoParametros: "test",
  } satisfies MixOpportunity,
};

const DEFAULT_PROPS = { open: true, onOpenChange: jest.fn() };

describe("RestockDrawer", () => {
  it("renders nothing when row is null", () => {
    const { container } = render(<RestockDrawer row={null} {...DEFAULT_PROPS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every section for a recomendacao row with the fixture's exact numbers", () => {
    render(<RestockDrawer row={RECOMMENDATION_ROW} {...DEFAULT_PROPS} />);

    expect(screen.getByText("Coca-Cola Zero — Loja Centro")).toBeInTheDocument();
    expect(screen.getByText("Sugestão: 30 unidades")).toBeInTheDocument();
    expect(screen.getByText(/17 vendidos no último mês analisado/)).toBeInTheDocument();
    expect(screen.getByText("2026-07")).toBeInTheDocument();
    expect(screen.getByText("2026-08")).toBeInTheDocument();
    expect(screen.getByText("Crescendo")).toBeInTheDocument();
    expect(screen.getByText("Necessidade estimada: 25–35 unidades")).toBeInTheDocument();
    expect(screen.getByText("Sugestão operacional: 30 unidades")).toBeInTheDocument();
    expect(screen.getByText("Este produto está sob avaliação da Inteligência de Perdas — decisão estrutural pendente.")).toBeInTheDocument();
  });

  it("shows the Loss Intelligence signal without recomputing it — just reads acao/escopo already decided", () => {
    render(<RestockDrawer row={RECOMMENDATION_ROW} {...DEFAULT_PROPS} />);
    expect(screen.getByText(/Investigar/)).toBeInTheDocument();
    expect(screen.getByText(/Investigar — escopo: Local/)).toBeInTheDocument();
  });

  it('shows "Nenhum sinal ativo" when sinalPerdas is null', () => {
    const row: RestockDisplayRow = { ...RECOMMENDATION_ROW, data: { ...RECOMMENDATION_ROW.data as RestockRecommendation, sinalPerdas: null } };
    render(<RestockDrawer row={row} {...DEFAULT_PROPS} />);
    expect(screen.getByText("Nenhum sinal ativo da Inteligência de Perdas.")).toBeInTheDocument();
  });

  it("renders a simpler drawer for an oportunidade row — no histórico/tendência, evidência instead", () => {
    render(<RestockDrawer row={OPPORTUNITY_ROW} {...DEFAULT_PROPS} />);

    expect(screen.getByText("Monster sabor X — Ascenty - ADM")).toBeInTheDocument();
    expect(screen.getByText("Sugestão: 4 unidades")).toBeInTheDocument();
    expect(screen.getByText("Bom desempenho em 7 lojas da rede.")).toBeInTheDocument();
    expect(screen.getByText(/candidato baseado em bom desempenho na rede/)).toBeInTheDocument();
    expect(screen.queryByText("Histórico")).not.toBeInTheDocument();
  });

  it("shows Parametrização atual with minimo, nível de par and quantidade atual reference", () => {
    const row: RestockDisplayRow = {
      ...RECOMMENDATION_ROW,
      data: { ...(RECOMMENDATION_ROW.data as RestockRecommendation), parametrizacao: { minimo: 3, nivelDePar: 24, quantidadeAtual: 5, quantidadeAtualEm: "2026-09-20T00:00:00.000Z" } },
    };
    render(<RestockDrawer row={row} {...DEFAULT_PROPS} />);
    expect(screen.getByText("Parametrização atual")).toBeInTheDocument();
    expect(screen.getByText(/Nível de par: 24/)).toBeInTheDocument();
    expect(screen.getByText(/Mínimo crítico: 3/)).toBeInTheDocument();
    expect(screen.getByText(/Quantidade atual \(referência, não usada na sugestão\): 5/)).toBeInTheDocument();
    // Regression: a UTC-midnight timestamp must render as the SAME calendar day —
    // new Date(...).toLocaleDateString() in a UTC-3 timezone shifted this back a day.
    expect(screen.getByText(/registrada em 20\/09\/2026/)).toBeInTheDocument();
  });

  it("shows '—' individually for missing pieces of a partially filled parametrização, not the whole section as unregistered", () => {
    const row: RestockDisplayRow = {
      ...RECOMMENDATION_ROW,
      data: { ...(RECOMMENDATION_ROW.data as RestockRecommendation), parametrizacao: { minimo: 5, nivelDePar: null, quantidadeAtual: null, quantidadeAtualEm: null } },
    };
    render(<RestockDrawer row={row} {...DEFAULT_PROPS} />);
    expect(screen.getByText(/Mínimo crítico: 5/)).toBeInTheDocument();
    expect(screen.getByText(/Nível de par: —/)).toBeInTheDocument();
    expect(screen.getByText(/Quantidade atual \(referência, não usada na sugestão\): —/)).toBeInTheDocument();
  });

  it('shows "não registrada" when parametrização is null', () => {
    const row: RestockDisplayRow = { ...RECOMMENDATION_ROW, data: { ...(RECOMMENDATION_ROW.data as RestockRecommendation), parametrizacao: null } };
    render(<RestockDrawer row={row} {...DEFAULT_PROPS} />);
    expect(screen.getByText("Parametrização atual: não registrada")).toBeInTheDocument();
  });

  it("splits Necessidade estimada (the range) from Sugestão operacional (the point) as separate labels", () => {
    const row: RestockDisplayRow = {
      ...RECOMMENDATION_ROW,
      data: { ...(RECOMMENDATION_ROW.data as RestockRecommendation), faixaEstimada: { min: 13, max: 16 }, quantidadeSugeridaIA: 18 },
    };
    render(<RestockDrawer row={row} {...DEFAULT_PROPS} />);
    expect(screen.getByText(/Necessidade estimada: 13–16 unidades/)).toBeInTheDocument();
    expect(screen.getByText(/Sugestão operacional: 18 unidades/)).toBeInTheDocument();
  });
});
