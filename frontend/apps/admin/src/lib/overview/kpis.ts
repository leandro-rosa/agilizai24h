import { compareRate, compareValue } from "./compare";
import type { KpiResult, MonthInput } from "./types";

type Pick = (m: MonthInput) => number | null;

const revenue: Pick = (m) => m.pnl?.netRevenueCents ?? null;
const contribution: Pick = (m) => m.pnl?.contributionMarginCents ?? null;
const operating: Pick = (m) => m.pnl?.operatingProfitCents ?? null;
const loss: Pick = (m) => m.finance?.lossValueCents ?? null;
const cash: Pick = (m) => m.cash?.closingCents ?? null;
const operatingMargin: Pick = (m) => {
  const r = m.pnl?.netRevenueCents ?? null;
  const o = m.pnl?.operatingProfitCents ?? null;
  return r !== null && o !== null && r > 0 ? o / r : null;
};

function money(key: KpiResult["key"], label: string, pick: Pick, months: MonthInput[], goodWhenUp: boolean, note: string): KpiResult {
  const [cur, prev] = months;
  const last3 = months.slice(1, 4).map(pick);
  const cmp = compareValue(pick(cur), pick(prev), last3);
  return { key, label, kind: "money", value: pick(cur), previous: pick(prev), avg3: avg(last3), vsPrevious: cmp.vsPrevious, vsAvg3: cmp.vsAvg3, goodWhenUp, note };
}

function avg(values: (number | null)[]): number | null {
  return values.length < 3 || values.some((v) => v === null) ? null : (values as number[]).reduce((s, v) => s + v, 0) / values.length;
}

/** `months`: [competência, mês−1, mês−2, mês−3, mês−4…] — a média 3m usa os 3 meses ANTERIORES à competência. */
export function buildKpis(months: MonthInput[]): KpiResult[] {
  const [cur, prev] = months;
  const last3 = months.slice(1, 4).map(operatingMargin);
  const rate = compareRate(operatingMargin(cur), operatingMargin(prev), last3);
  return [
    money("revenue", "Faturamento", revenue, months, true, "Receita líquida do mês (DRE)"),
    money("contribution", "Margem de contribuição", contribution, months, true, "R$ (DRE)"),
    money("operating", "Resultado operacional", operating, months, true, "R$ (DRE)"),
    {
      key: "operatingMargin",
      label: "Margem operacional",
      kind: "rate",
      value: operatingMargin(cur),
      previous: operatingMargin(prev),
      avg3: avg(last3),
      vsPrevious: rate.vsPrevious,
      vsAvg3: rate.vsAvg3,
      goodWhenUp: true,
      note: "Resultado operacional ÷ receita líquida",
    },
    money("loss", "Perdas", loss, months, false, "Perda real do mês (finance), em R$"),
    money("cash", "Saldo em caixa", cash, months, true, "Saldo final do mês, contas correntes (tesouraria)"),
  ];
}
