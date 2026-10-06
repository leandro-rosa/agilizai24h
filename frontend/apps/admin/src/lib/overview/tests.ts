/**
 * Produtos em teste. NÃO existe cadastro: a evidência é o abastecimento. Um
 * SKU é candidato quando seu PRIMEIRO abastecimento na rede (mês) caiu na
 * janela recente, depois de o histórico importado já existir, e ele está em
 * poucas lojas. Limiares abaixo são PREMISSA inicial a validar com a lista real.
 * O sinal nunca é aprovado/reprovado: é evidência com os fatos ao lado.
 */
import { addMonths } from "../period-range";
import type { SalesCell } from "./types";

export const TESTS = {
  /** Primeiro abastecimento nos últimos N meses (incluindo a competência). */
  WINDOW_MONTHS: 3,
  /** No máximo N lojas já abastecidas com o SKU (acima disso é rollout, não teste). */
  MAX_STORES: 9,
  /** Abaixo disso, sinal = "Mais dados". */
  MIN_MONTHS: 2,
  MIN_UNITS: 20,
  /** Fração das lojas abastecidas que vendeu: ≥ POSITIVE → positivo; < ATTENTION → atenção. */
  SOLD_SHARE_POSITIVE: 0.7,
  SOLD_SHARE_ATTENTION: 0.5,
  /** Perda ÷ receita do SKU a partir da qual pede atenção. */
  LOSS_TO_REVENUE_ATTENTION: 0.1,
} as const;

export type TestSignal = "positivo" | "atencao" | "mais_dados";

export const SIGNAL_LABELS: Record<TestSignal, string> = { positivo: "Sinal positivo", atencao: "Atenção", mais_dados: "Mais dados" };

export interface SupplyCell {
  storeId: number;
  period: string;
  sku: string;
  quantity: number;
}

export interface TestRow {
  sku: string;
  name: string;
  firstPeriod: string;
  /** Meses de teste, contando o do primeiro abastecimento. */
  monthsInTest: number;
  storesRestocked: number;
  storesSold: number;
  unitsSold: number;
  revenueCents: number;
  lossCents: number | null;
  marginPct: number | null;
  signal: TestSignal;
  /** Fatos que explicam o sinal. */
  reasons: string[];
}

export interface TestsSummary {
  rows: TestRow[];
  /** Primeiro mês com abastecimento importado — antes dele não se sabe se um SKU é novo. */
  historyStart: string | null;
}

export interface BuildTestsArgs {
  period: string;
  supply: { cells: SupplyCell[]; ingestedPeriods: string[] };
  sales: SalesCell[];
  costBySku: Record<string, number> | null;
  names: Record<string, string>;
  alias: Record<string, string>;
  /** Perda por SKU e mês (finance), já em SKU original; o alias é aplicado aqui. */
  lossBySkuByPeriod: Record<string, { sku: string; valueCents: number }[] | null>;
}

const monthsBetween = (from: string, to: string) => {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
};

export function buildTests(a: BuildTestsArgs): TestsSummary {
  const canon = (sku: string) => a.alias[sku] ?? sku;
  const historyStart = [...a.supply.ingestedPeriods].sort()[0] ?? null;
  if (!historyStart) return { rows: [], historyStart };

  const windowStart = addMonths(a.period, -(TESTS.WINDOW_MONTHS - 1));
  const info = new Map<string, { first: string; stores: Set<number> }>();
  for (const c of a.supply.cells) {
    if (c.quantity <= 0) continue;
    const sku = canon(c.sku);
    const cur = info.get(sku);
    if (!cur) info.set(sku, { first: c.period, stores: new Set([c.storeId]) });
    else {
      if (c.period < cur.first) cur.first = c.period;
      cur.stores.add(c.storeId);
    }
  }

  const rows: TestRow[] = [];
  for (const [sku, i] of info) {
    // Só é "novo" se apareceu DEPOIS de o histórico existir e dentro da janela.
    if (i.first <= historyStart || i.first < windowStart || i.first > a.period) continue;
    if (i.stores.size > TESTS.MAX_STORES) continue;

    const cells = a.sales.filter((s) => canon(s.sku) === sku && s.period >= i.first && s.period <= a.period);
    const storesSold = new Set(cells.filter((c) => c.quantity > 0).map((c) => c.storeId)).size;
    const units = cells.reduce((s, c) => s + c.quantity, 0);
    const revenue = cells.reduce((s, c) => s + c.revenueCents, 0);
    let mRev = 0;
    let mCost = 0;
    for (const c of cells) {
      const cost = a.costBySku?.[c.sku];
      if (cost !== undefined) {
        mRev += c.revenueCents;
        mCost += cost * c.quantity;
      }
    }

    let loss: number | null = null;
    for (const [per, list] of Object.entries(a.lossBySkuByPeriod)) {
      if (per < i.first || per > a.period || !list) continue;
      loss = (loss ?? 0) + list.filter((l) => canon(l.sku) === sku).reduce((s, l) => s + l.valueCents, 0);
    }

    const monthsInTest = monthsBetween(i.first, a.period) + 1;
    const soldShare = i.stores.size > 0 ? storesSold / i.stores.size : 0;
    const lossRatio = loss !== null && revenue > 0 ? loss / revenue : null;

    const reasons = [`vendeu em ${storesSold} de ${i.stores.size} lojas abastecidas`, `${units} unidades em ${monthsInTest} ${monthsInTest === 1 ? "mês" : "meses"}`];
    if (lossRatio !== null) reasons.push(`perda = ${(lossRatio * 100).toFixed(1).replace(".", ",")}% da receita`);

    let signal: TestSignal;
    if (monthsInTest < TESTS.MIN_MONTHS || units < TESTS.MIN_UNITS) {
      signal = "mais_dados";
      reasons.push("ainda sem histórico suficiente");
    } else if (soldShare < TESTS.SOLD_SHARE_ATTENTION || storesSold <= 1 || (lossRatio !== null && lossRatio >= TESTS.LOSS_TO_REVENUE_ATTENTION)) {
      signal = "atencao";
      if (storesSold <= 1) reasons.push("resultado concentrado em uma loja");
    } else if (soldShare >= TESTS.SOLD_SHARE_POSITIVE) {
      signal = "positivo";
    } else {
      signal = "mais_dados";
    }

    rows.push({
      sku,
      name: a.names[sku] ?? sku,
      firstPeriod: i.first,
      monthsInTest,
      storesRestocked: i.stores.size,
      storesSold,
      unitsSold: units,
      revenueCents: revenue,
      lossCents: loss,
      marginPct: mRev > 0 ? (mRev - mCost) / mRev : null,
      signal,
      reasons,
    });
  }
  rows.sort((x, y) => y.firstPeriod.localeCompare(x.firstPeriod) || y.unitsSold - x.unitsSold);
  return { rows, historyStart };
}
