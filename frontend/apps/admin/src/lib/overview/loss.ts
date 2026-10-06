import { reasonLabel } from "../removal-reasons";
import type { LossChange, LossChanges, LossSummary, MonthInput } from "./types";

const COVER = 0.6;

function diffs(cur: { key: string; cents: number }[], prev: { key: string; cents: number }[], labelOf: (key: string) => string): LossChange[] {
  const c = new Map(cur.map((x) => [x.key, x.cents]));
  const p = new Map(prev.map((x) => [x.key, x.cents]));
  return [...new Set([...c.keys(), ...p.keys()])].map((key) => ({
    label: labelOf(key),
    previousCents: p.get(key) ?? 0,
    currentCents: c.get(key) ?? 0,
    deltaCents: (c.get(key) ?? 0) - (p.get(key) ?? 0),
  }));
}

/** O que mudou nas perdas vs. o mês anterior — só fatos, sempre com a base (anterior → atual). */
export function lossChanges(cur: MonthInput, prev: MonthInput, names: Record<string, string>): LossChanges | null {
  const f = cur.finance;
  const pf = prev.finance;
  if (!f || !pf) return null;
  const reasons = diffs(
    f.lossByReason.map((r) => ({ key: r.reason, cents: r.valueCents })),
    pf.lossByReason.map((r) => ({ key: r.reason, cents: r.valueCents })),
    reasonLabel,
  );
  const skus = diffs(
    f.lossBySku.map((r) => ({ key: r.sku, cents: r.valueCents })),
    pf.lossBySku.map((r) => ({ key: r.sku, cents: r.valueCents })),
    (sku) => names[sku] ?? sku,
  );
  const byAbs = (a: LossChange, b: LossChange) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents);
  const total = f.lossValueCents - pf.lossValueCents;
  // Concentração: quantos SKUs, no sentido da variação total, explicam ≥ 60% dela.
  const same = skus.filter((x) => Math.sign(x.deltaCents) === Math.sign(total) && x.deltaCents !== 0).sort(byAbs);
  const movement = same.reduce((acc, x) => acc + Math.abs(x.deltaCents), 0);
  let acc = 0;
  let count = 0;
  for (const x of same) {
    if (acc / (movement || 1) >= COVER) break;
    acc += Math.abs(x.deltaCents);
    count += 1;
  }
  return {
    totalPreviousCents: pf.lossValueCents,
    totalCurrentCents: f.lossValueCents,
    byReason: reasons.filter((x) => x.deltaCents !== 0).sort(byAbs).slice(0, 2),
    bySku: skus.filter((x) => x.deltaCents !== 0).sort(byAbs).slice(0, 3),
    skusExplainingShare: total !== 0 && movement > 0 ? { count, share: acc / movement } : null,
  };
}

/** Denominador sempre explícito: receita líquida do mês E custo abastecido do mês. Motivos = chaves reais da base, "outro" nunca reinterpretado. */
export function buildLoss(cur: MonthInput, prev: MonthInput, names: Record<string, string>): LossSummary | null {
  const f = cur.finance;
  if (!f) return null;
  const revenue = cur.pnl?.netRevenueCents ?? null;
  const prevByReason = new Map((prev.finance?.lossByReason ?? []).map((r) => [r.reason, r.valueCents]));
  const prevHas = prev.finance !== null;
  const total = f.lossValueCents;
  // Participações usam a soma do próprio detalhamento como denominador: se motivos/SKUs não fecharem com o total
  // (ajuste não classificado, SKU sem custo), a fração nunca passa de 100%.
  const reasonsTotal = f.lossByReason.reduce((s, r) => s + Math.max(r.valueCents, 0), 0);
  const skusTotal = f.lossBySku.reduce((s, r) => s + Math.max(r.valueCents, 0), 0);

  const byReason = f.lossByReason
    .filter((r) => r.valueCents > 0)
    .sort((a, b) => b.valueCents - a.valueCents)
    .map((r) => ({
      reason: r.reason,
      valueCents: r.valueCents,
      share: reasonsTotal > 0 ? r.valueCents / reasonsTotal : null,
      deltaCents: prevHas ? r.valueCents - (prevByReason.get(r.reason) ?? 0) : null,
    }));

  const skus = [...f.lossBySku].filter((s) => s.valueCents > 0).sort((a, b) => b.valueCents - a.valueCents);
  const top = skus.slice(0, 5).map((s) => ({ sku: s.sku, name: names[s.sku] ?? s.sku, valueCents: s.valueCents, share: skusTotal > 0 ? s.valueCents / skusTotal : null }));

  return {
    restockedCents: f.restockedValueCents,
    lossCents: total,
    lossToRevenue: revenue !== null && revenue > 0 ? total / revenue : null,
    lossToSupplied: f.restockedValueCents > 0 ? total / f.restockedValueCents : null,
    byReason,
    topSkus: top,
    top3Share: skusTotal > 0 ? skus.slice(0, 3).reduce((s, x) => s + x.valueCents, 0) / skusTotal : null,
    incompleteStores: f.incompleteStores,
    changes: lossChanges(cur, prev, names),
  };
}

export { reasonLabel };
