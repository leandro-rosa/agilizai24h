import { moneyCompact } from "../format";
import { signedPct } from "./compare";
import { BEHAVIOR_LABELS, distributionText } from "./product-behavior";
import { baseText, needsBase, rankScore, recurrenceOf } from "./ranking";
import type { Highlight, Highlights, Insight, ProductRow, ProductsSummary, StoreSummary } from "./types";

const un = (n: number) => new Intl.NumberFormat("pt-BR").format(n);
const fromTo = (a: number, b: number) => `${moneyCompact(a)} → ${moneyCompact(b)}`;

/** Produto destaque = o que mais contribuiu em R$ para a alta do mês (por relevância, não por %). Sem alta material, cai para o mais vendido. */
function productHighlight(products: ProductsSummary | null, revenueBase: number | null): Highlight | null {
  if (!products) return null;
  const score = (p: ProductRow) =>
    rankScore({ impactCents: p.deltaRevenueCents, baseCents: revenueBase, share: p.shareOfRevenue, recurrence: recurrenceOf(p.series), breadth: (p.distribution?.storesAffected ?? 0) / (p.byStore.length || 1) });
  const best = [...products.rising].filter((p) => (p.deltaRevenueCents ?? 0) > 0).sort((a, b) => score(b) - score(a))[0];
  if (best && best.revenuePreviousCents !== null && best.unitsPrevious !== null) {
    const dist = distributionText(best.distribution);
    const withBase = needsBase(best.unitsPrevious, best.units, best.deltaUnitsPct);
    return {
      title: best.name,
      detail: `Maior contribuição em R$ para a alta: ${fromTo(best.revenuePreviousCents, best.revenueCents)} (${signedPct(best.deltaRevenuePct)}); ${baseText(best.unitsPrevious, best.units, un, "un.")}${withBase ? "" : ""}.${dist ? ` ${dist[0].toUpperCase()}${dist.slice(1)}.` : ""} ${BEHAVIOR_LABELS[best.behavior]}.`,
      href: "/commercial-intelligence",
    };
  }
  const top = products.topSold[0];
  if (!top) return null;
  return { title: top.name, detail: `Mais vendido do mês: ${un(top.units)} un., ${moneyCompact(top.revenueCents)}. Sem alta material vs. o mês anterior.`, href: "/commercial-intelligence" };
}

/** Maior crescimento = a loja que mais cresceu em R$ nas vendas, com a parcela do crescimento das lojas que ela explica. */
function growthHighlight(stores: StoreSummary | null): Highlight | null {
  const top = stores?.growthExplainers.stores[0];
  if (!stores || !top) return null;
  return {
    title: top.name,
    detail: `Vendas ${fromTo(top.previousCents, top.currentCents)}${top.deltaPct !== null ? ` (${signedPct(top.deltaPct)})` : ""}; explica ${Math.round(top.share * 100)}% do crescimento das lojas (${stores.growthExplainers.storeCount} lojas cresceram).`,
    href: "/finance/stores",
  };
}

/** Maior ponto de atenção = o achado de tom negativo de maior relevância; sem ele, a loja com mais sinais de atenção. */
function attentionHighlight(insights: Insight[], stores: StoreSummary | null): Highlight | null {
  const neg = [...insights].filter((i) => i.tone === "negative").sort((a, b) => b.score - a.score)[0];
  if (neg) return { title: neg.title, detail: neg.detail, href: neg.href ?? "/finance/stores" };
  const s = stores?.attention[0];
  if (s) return { title: s.name, detail: s.reasons.join("; "), href: "/finance/stores" };
  return null;
}

export function buildHighlights(args: { products: ProductsSummary | null; stores: StoreSummary | null; insights: Insight[]; revenueBase: number | null }): Highlights {
  return {
    product: productHighlight(args.products, args.revenueBase),
    growth: growthHighlight(args.stores),
    attention: attentionHighlight(args.insights, args.stores),
  };
}
