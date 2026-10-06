import { reasonLabel } from "../removal-reasons";
import type { LossSummary, MonthInput } from "./types";

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
  };
}

export { reasonLabel };
