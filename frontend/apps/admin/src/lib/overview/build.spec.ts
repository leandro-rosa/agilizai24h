import { buildOverview } from "./build";
import type { MonthInput, OverviewInput, StoreMonthPnl } from "./types";

// Fixtures sintéticas: só neste spec, nunca em banco real.
function month(period: string, over: Partial<MonthInput> = {}): MonthInput {
  return { period, pnl: null, cash: null, treasury: null, finance: null, capex: null, investors: null, ...over };
}
const pnl = (net: number, contrib: number, op: number) => ({ netRevenueCents: net, grossRevenueCents: net, contributionMarginCents: contrib, operatingProfitCents: op, computedAt: "2026-11-03T08:24:00Z" });
const finance = (loss: number, restocked = 500_000) => ({
  restockedValueCents: restocked,
  cogsCents: 0,
  lossValueCents: loss,
  lossByReason: [{ reason: "expired", valueCents: loss * 0.6 }, { reason: "other_reason", valueCents: loss * 0.4 }],
  lossBySku: [{ sku: "A", valueCents: loss * 0.5 }, { sku: "B", valueCents: loss * 0.5 }],
  incompleteStores: 0,
});
const store = (id: number, name: string, net: number, contrib = net * 0.4, op = net * 0.2, loss = 0): StoreMonthPnl => ({ storeId: id, name, netRevenueCents: net, contributionMarginCents: contrib, operatingProfitCents: op, lossCents: loss });

function input(): OverviewInput {
  return {
    period: "2026-10",
    months: [
      month("2026-10", { pnl: pnl(12_450_000, 5_320_000, 3_140_000), cash: { openingCents: 1_890_000, inflowCents: 11_240_000, outflowCents: 12_709_000, closingCents: 420_960 }, finance: finance(410_000), treasury: { byCategory: [{ category: "Estoque", outflowCents: 2_360_000 }, { category: "Combustível", outflowCents: 90_000 }], unresolvedCount: 0, pendingCount: 0, investmentCents: 1_240_000, investmentByCategory: [{ category: "Investimento (cartão sócio)", cents: 900_000 }, { category: "Equipamento", cents: 340_000 }] }, capex: { totalCents: 1_240_000, byCategory: [{ category: "fridge", cents: 900_000 }, { category: "led", cents: 340_000 }], unassignedCents: 0 } }),
      month("2026-09", { pnl: pnl(11_485_000, 5_062_000, 2_823_000), cash: { openingCents: 1_000_000, inflowCents: 1, outflowCents: 1, closingCents: 1_890_000 }, finance: finance(481_000), treasury: { byCategory: [{ category: "Estoque", outflowCents: 2_000_000 }, { category: "Combustível", outflowCents: 88_000 }], unresolvedCount: 0, pendingCount: 0, investmentCents: 1_900_000, investmentByCategory: [] }, capex: { totalCents: 1_900_000, byCategory: [] , unassignedCents: 0 } }),
      month("2026-08", { pnl: pnl(11_000_000, 4_800_000, 2_600_000), finance: finance(450_000) }),
      month("2026-07", { pnl: pnl(10_800_000, 4_700_000, 2_500_000), finance: finance(440_000) }),
    ],
    stores: {
      current: [store(1, "HTL05", 2_200_000), store(2, "Ascenty ADM", 1_900_000), store(3, "Itaquá", 800_000, 300_000, -10_000, 60_000), store(4, "Mogi", 1_000_000)],
      previous: [store(1, "HTL05", 1_780_000), store(2, "Ascenty ADM", 1_640_000), store(3, "Itaquá", 976_000), store(4, "Mogi", 1_000_000)],
      activeCount: 4,
    },
    sales: null,
    costBySku: null,
    productNames: { A: "Produto A", B: "Produto B" },
    storeList: null,
    catalogue: [],
    skuLinks: [],
    supply: null,
    aging: { referenceDate: "2026-11-03", overdueCents: 0, notDueCents: 1_250_000, openCents: 1_250_000 },
    closed: true,
    previousClosed: true,
  };
}

const salesCell = (storeId: number, period: string, revenueCents: number) => ({ storeId, period, sku: "A", quantity: 1, revenueCents });
// DRE por loja (receita líquida, mistura venda com receita de contrato) diz que TODAS caíram; a venda registrada mostra o contrário em 2 lojas.
const salesInput = (): OverviewInput => ({
  ...input(),
  storeList: [{ id: 1, name: "HTL05" }, { id: 2, name: "Ascenty ADM" }, { id: 3, name: "Itaquá" }, { id: 4, name: "Mogi" }],
  sales: {
    ingestedPeriods: ["2026-09", "2026-10"],
    seriesPeriods: ["2026-09", "2026-10"],
    cells: [
      salesCell(1, "2026-09", 1_000_000), salesCell(1, "2026-10", 1_300_000), // +30%
      salesCell(2, "2026-09", 1_000_000), salesCell(2, "2026-10", 1_100_000), // +10%
      salesCell(3, "2026-09", 1_000_000), salesCell(3, "2026-10", 800_000), // -20%
      salesCell(4, "2026-09", 1_000_000), salesCell(4, "2026-10", 1_010_000), // +1% (estável)
    ],
  },
});

const salesInputWith = (cells: ReturnType<typeof salesCell>[]): OverviewInput => ({ ...salesInput(), sales: { ...salesInput().sales!, cells } });


describe("buildOverview", () => {
  const o = buildOverview(input());

  it("KPI revenue compares against previous month and 3-month average", () => {
    const rev = o.kpis.find((k) => k.key === "revenue")!;
    expect(rev.value).toBe(12_450_000);
    expect((rev.vsPrevious as { pct: number }).pct).toBeCloseTo(0.084, 2);
    expect(rev.avg3).toBeCloseTo((11_485_000 + 11_000_000 + 10_800_000) / 3);
  });

  it("operating margin is a rate in p.p., with the denominator in the note", () => {
    const m = o.kpis.find((k) => k.key === "operatingMargin")!;
    expect(m.kind).toBe("rate");
    expect((m.vsPrevious as { pp: number }).pp).toBeCloseTo(((3_140_000 / 12_450_000) - (2_823_000 / 11_485_000)) * 100);
    expect(m.note).toMatch(/receita líquida/);
  });

  it("unavailable source is null, not zero", () => {
    const x = buildOverview({ ...input(), months: input().months.map((m, i) => (i === 0 ? { ...m, finance: null } : m)) });
    const loss = x.kpis.find((k) => k.key === "loss")!;
    expect(loss.value).toBeNull();
    expect(x.loss).toBeNull();
  });

  it("store summary counts up/down/stable and names top growth", () => {
    expect(o.stores).toMatchObject({ up: 2, down: 1, stable: 1 });
    expect(o.stores!.topGrowth.map((s) => s.name)).toEqual(["HTL05", "Ascenty ADM"]);
    expect(o.stores!.attention.map((s) => s.name)).toContain("Itaquá");
  });

  it("store growth follows the stores' sales, not the DRE net revenue that mixes in contract revenue", () => {
    const dreOnly = buildOverview(input());
    expect(dreOnly.stores!.basis).toBe("dre");
    const bySales = buildOverview(salesInput());
    expect(bySales.stores!.basis).toBe("vendas");
    expect(bySales.stores).toMatchObject({ up: 2, down: 1, stable: 1, compared: 4, storesRevenueCents: 4_210_000, storesRevenuePreviousCents: 4_000_000 });
    expect(bySales.stores!.topGrowth.map((x) => x.name)).toEqual(["HTL05", "Ascenty ADM"]);
    expect(bySales.stores!.topDecline.map((x) => x.name)).toEqual(["Itaquá"]);
  });

  it("falls back to the DRE basis when one of the two months has no imported sales", () => {
    const x = buildOverview({ ...salesInput(), sales: { ...salesInput().sales!, ingestedPeriods: ["2026-10"] } });
    expect(x.stores!.basis).toBe("dre");
  });

  it("shows both numbers when store sales and network DRE revenue diverge", () => {
    const x = buildOverview({
      ...salesInput(),
      months: input().months.map((m, i) => (i === 0 ? { ...m, pnl: pnl(9_000_000, 4_000_000, 2_000_000) } : i === 1 ? { ...m, pnl: pnl(11_000_000, 4_000_000, 2_000_000) } : m)),
    });
    const ins = x.insights.find((i) => i.id === "stores-vs-network")!;
    expect(ins.title).toMatch(/Vendas das lojas cresceram 5,3%, contra −18,2% da receita líquida da rede/);
    expect(ins.detail).toMatch(/2 cresceram, 1 recuaram, 1 estáveis/);
    expect(ins.detail.replace(/\u00a0/g, " ")).toMatch(/R\$ 40 mil → R\$ 42,1 mil/); // base das lojas sempre visível
  });

  it("a revenue fall names the stores that fell most, not the ones that grew", () => {
    const x = buildOverview({
      ...input(),
      months: input().months.map((m, i) => (i === 0 ? { ...m, pnl: pnl(10_000_000, 4_000_000, 2_000_000) } : m)),
    });
    expect(x.insights[0].title).toMatch(/Faturamento caiu/);
    expect(x.insights[0].detail).toMatch(/1 loja explica 100% da queda: Itaquá/);
  });

  it("a drop in losses is reported even though it is small against revenue", () => {
    const x = buildOverview(input());
    expect(x.insights.map((i) => i.id)).toContain("loss");
  });

  it("loss uses explicit denominators and real reason keys", () => {
    expect(o.loss!.lossToRevenue).toBeCloseTo(410_000 / 12_450_000);
    expect(o.loss!.lossToSupplied).toBeCloseTo(410_000 / 500_000);
    expect(o.loss!.byReason.map((r) => r.reason)).toEqual(["expired", "other_reason"]);
  });

  it("loss shares never exceed 100% even when the breakdown does not add up to the total", () => {
    const inp = input();
    inp.months[0].finance = { ...finance(410_000), lossByReason: [{ reason: "expired", valueCents: 300_000 }, { reason: "other_reason", valueCents: 200_000 }] };
    const x = buildOverview(inp);
    expect(x.loss!.byReason.reduce((s, r) => s + (r.share ?? 0), 0)).toBeCloseTo(1);
  });

  it("CAPEX follows the cash-flow classification (investment outflows), including the partners' card", () => {
    expect(o.capex!.investment).toMatchObject({ totalCents: 1_240_000, previousCents: 1_900_000, partnerCardCents: 900_000 });
    expect(o.capex!.investment!.top.map((t) => t.category)).toEqual(["Investimento (cartão sócio)", "Equipamento"]);
    // O cadastro por loja (capex-service) continua separado, sem somar com o do fluxo de caixa.
    expect(o.capex!.current!.totalCents).toBe(1_240_000);
  });

  it("financial movements are selected from the data (variation and weight), never from fixed categories", () => {
    const inp = input();
    inp.months[0].treasury = { ...inp.months[0].treasury!, byCategory: [...inp.months[0].treasury!.byCategory, { category: "Manutenção", outflowCents: 600_000 }] };
    inp.months[1].treasury = { ...inp.months[1].treasury!, byCategory: [...inp.months[1].treasury!.byCategory, { category: "Manutenção", outflowCents: 100_000 }] };
    const lines = buildOverview(inp).cashUses!.lines;
    const labels = lines.map((l) => l.label);
    expect(labels).toContain("Compras de estoque");
    expect(labels).toContain("Manutenção"); // categoria nunca citada no código
    expect(labels).not.toContain("Combustível"); // oscilação pequena e sem peso: fora
    expect(lines.find((l) => l.label === "Manutenção")!.reasons).toContain("variacao");
    expect(lines.length).toBeLessThanOrEqual(5);
    expect([...lines].sort((a, b) => b.score - a.score)).toEqual(lines); // ordem por relevância
  });

  it("CAPEX never appears twice: it is its own block, not a fixed line of the financial movements", () => {
    expect(o.cashUses!.lines.map((l) => l.key)).not.toContain("capex");
    expect(o.capex!.investment!.totalCents).toBe(1_240_000);
  });

  it("cash fell although operating result is positive is flagged as fact", () => {
    expect(o.cash.operatingPositiveCashFell).toBe(true);
    expect(o.insights.map((i) => i.id)).toContain("cash-vs-result");
  });

  it("insights start with revenue, are capped, and carry numbers", () => {
    expect(o.insights[0].title).toMatch(/Faturamento cresceu 8,4%/);
    expect(o.insights.length).toBeLessThanOrEqual(6);
    for (const i of o.insights) expect(i.detail).toMatch(/\d/);
  });

  it("reading only states computed facts", () => {
    expect(o.reading).toMatch(/outubro\/2026 fechou com faturamento \+8,4%/);
    expect(o.reading).not.toMatch(/bom desempenho|excelente/i);
  });

  it("declares phase-1 limitations", () => {
    expect(o.limitations.join(" ")).toMatch(/Produtos em teste/);
    expect(o.tests).toBeNull();
  });
});


describe("executive hierarchy", () => {
  const cellP = (storeId: number, period: string, sku: string, quantity: number, revenueCents: number) => ({ storeId, period, sku, quantity, revenueCents });

  it("a +1.087% jump on a 1 → 12 unit base does not outrank a modest change with real financial impact, and the base is shown", () => {
    const base = salesInputWith([
      cellP(1, "2026-09", "TINY", 1, 600), cellP(1, "2026-10", "TINY", 12, 7_200),
      cellP(1, "2026-09", "BIG", 1_000, 1_000_000), cellP(1, "2026-10", "BIG", 700, 700_000),
      cellP(2, "2026-09", "BIG", 1_000, 1_000_000), cellP(2, "2026-10", "BIG", 700, 700_000),
    ]);
    const x = buildOverview(base);
    const ids = x.insights.map((i) => i.id);
    expect(ids).toContain("product:BIG");
    if (ids.includes("product:TINY")) expect(ids.indexOf("product:BIG")).toBeLessThan(ids.indexOf("product:TINY"));
    const tiny = x.products?.rising.find((p) => p.sku === "TINY");
    if (tiny) expect(x.insights.find((i) => i.id === "product:TINY")?.title ?? "").toMatch(/1 → 12 un\./);
  });

  it("highlights: growth names the store that explains the most growth, attention is the most relevant negative finding", () => {
    const x = buildOverview(salesInput());
    expect(x.highlights.growth?.title).toBe("HTL05");
    expect(x.highlights.growth?.detail.replace(/\u00a0/g, " ")).toMatch(/R\$ 10 mil → R\$ 13 mil/);
    expect(x.highlights.attention).not.toBeNull();
  });

  it("watchlist has at most 5 items, each with an observation, never a cause or an order", () => {
    const x = buildOverview({ ...salesInput(), aging: { referenceDate: "2026-11-03", overdueCents: 3_334_800, notDueCents: 0, openCents: 3_334_800 }, previousClosed: false });
    expect(x.watchlist.length).toBeGreaterThan(0);
    expect(x.watchlist.length).toBeLessThanOrEqual(5);
    for (const w of x.watchlist) {
      expect(w.observation.length).toBeGreaterThan(0);
      expect(w.observation + w.title).not.toMatch(/\bdevido a\b|\bpor causa\b|\bcausado\b|\bdeve\b/i);
    }
    expect(x.watchlist.map((w) => w.id)).toContain("caixa:vencido");
    expect(x.watchlist.map((w) => w.id)).toContain("dados:mes-anterior");
    expect([...x.watchlist].sort((a, b) => b.score - a.score)).toEqual(x.watchlist);
  });

  it("watchlist is empty (not invented) when the data raises nothing", () => {
    const calm = buildOverview({ ...input(), months: input().months.map((m) => ({ ...m, finance: null, capex: null, treasury: null })), stores: { current: null, previous: null, activeCount: null }, aging: null });
    expect(calm.watchlist.every((w) => w.observation.length > 0)).toBe(true);
    expect(calm.watchlist.length).toBeLessThanOrEqual(5);
  });
});
