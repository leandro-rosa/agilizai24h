import { moneyCompact, date, period as fmtPeriod } from "../format";
import { rankScore } from "./ranking";
import type { CashSummary, Insight, LossSummary, ProductsSummary, StoreSummary, WatchItem } from "./types";
import type { SalesCoverage } from "./sales-coverage";
import type { TestsSummary } from "./tests";

export const WATCH_MAX = 5;
/** No máximo N itens do mesmo tipo, para o resumo não virar uma lista de uma coisa só. */
const PER_KIND = 2;

export interface WatchInput {
  period: string;
  previousPeriod: string;
  previousClosed: boolean;
  revenueBase: number | null;
  insights: Insight[];
  products: ProductsSummary | null;
  stores: StoreSummary | null;
  tests: TestsSummary | null;
  loss: LossSummary | null;
  cash: CashSummary;
  coverage: { current: SalesCoverage | null; previous: SalesCoverage | null };
  pendingSkuSuggestions: number;
}

interface Candidate extends WatchItem {
  kind: "achado" | "produto" | "loja" | "teste" | "caixa" | "dados";
}

/**
 * "O que merece atenção no próximo mês": até 5 itens, derivados SÓ dos dados
 * calculados, ordenados pela mesma relevância dos insights (impacto, peso,
 * recorrência, amplitude). Cada item é uma observação com os fatos que a sustentam —
 * nunca uma causa nem uma ordem de ação.
 */
export function buildWatchlist(i: WatchInput): WatchItem[] {
  const c: Candidate[] = [];

  for (const x of i.insights.filter((n) => n.tone === "negative")) {
    c.push({ id: `insight:${x.id}`, kind: "achado", title: x.title, observation: x.detail, href: x.href ?? "/", score: x.score });
  }

  for (const p of i.products?.falling.filter((r) => r.behavior === "queda_consistente").slice(0, 3) ?? []) {
    if (p.unitsPrevious === null) continue;
    c.push({
      id: `produto:${p.sku}`,
      kind: "produto",
      title: `Acompanhar ${p.name}`,
      observation: `Unidades em queda nos últimos meses seguidos (${p.unitsPrevious} → ${p.units} un. vs. o mês anterior); ${p.shareOfRevenue !== null ? `${(p.shareOfRevenue * 100).toFixed(1).replace(".", ",")}% da receita de produtos.` : "participação indisponível."}`,
      href: "/commercial-intelligence",
      score: rankScore({ impactCents: p.deltaRevenueCents, baseCents: i.revenueBase, share: p.shareOfRevenue, recurrence: 1, breadth: (p.distribution?.storesAffected ?? 0) / (p.byStore.length || 1) }),
    });
  }

  for (const s of i.stores?.attention.slice(0, 3) ?? []) {
    c.push({
      id: `loja:${s.storeId}`,
      kind: "loja",
      title: `Acompanhar ${s.name}`,
      observation: s.reasons.join("; ") + ".",
      href: "/finance/stores",
      score: rankScore({ impactCents: s.deltaCents, baseCents: i.revenueBase, share: 0.3 }) + 0.05 * (s.reasons.length - 1),
    });
  }

  for (const t of i.tests?.rows.filter((r) => r.signal === "atencao").slice(0, 2) ?? []) {
    c.push({ id: `teste:${t.sku}`, kind: "teste", title: `Acompanhar o teste de ${t.name}`, observation: `${t.reasons.join("; ")}.`, href: "/supply", score: 0.3 });
  }
  const needMore = i.tests?.rows.filter((r) => r.signal === "mais_dados").length ?? 0;
  if (needMore > 0) {
    c.push({ id: "teste:mais-dados", kind: "teste", title: `${needMore} ${needMore === 1 ? "produto em teste ainda sem" : "produtos em teste ainda sem"} histórico suficiente`, observation: "O sinal só sai com mais meses de venda e unidades; hoje é só observação.", href: "/supply", score: 0.15 });
  }

  if (i.cash.overdueCents !== null && i.cash.overdueCents > 0) {
    c.push({
      id: "caixa:vencido",
      kind: "caixa",
      title: "A receber vencido",
      observation: `${moneyCompact(i.cash.overdueCents)} vencidos${i.cash.agingReference ? ` na posição de ${date(i.cash.agingReference)}` : ""}${i.cash.notDueCents === 0 ? "; nenhuma nota a vencer" : ""}.`,
      href: "/billing/invoices",
      score: rankScore({ impactCents: i.cash.overdueCents, baseCents: i.revenueBase, share: 0.5 }),
    });
  }

  // Qualidade do dado: o que pode estar distorcendo os números do próprio resumo.
  for (const cov of [i.coverage.current, i.coverage.previous]) {
    if (cov && cov.suspects.length > 0) {
      c.push({ id: `dados:vendas:${cov.period}`, kind: "dados", title: `Vendas de ${fmtPeriod(cov.period)} parecem incompletas`, observation: `${cov.suspects.length} de ${cov.checked} lojas com bem menos SKUs vendidos que o normal; faturamento e DRE do mês podem estar abaixo do real.`, href: "/ingestion", score: 0.55 });
    }
  }
  if (!i.previousClosed) {
    c.push({ id: "dados:mes-anterior", kind: "dados", title: `${fmtPeriod(i.previousPeriod)} ainda não está fechado no DRE`, observation: "A comparação com o mês anterior é provisória até o fechamento.", href: "/finance/pnl", score: 0.4 });
  }
  if (i.loss && i.loss.incompleteStores > 0) {
    c.push({ id: "dados:conciliacao", kind: "dados", title: "Conciliação de abastecimento incompleta", observation: `${i.loss.incompleteStores} lojas com SKU sem custo ou saldo inconsistente; as perdas podem estar subestimadas.`, href: "/supply", score: 0.3 });
  }
  if (i.pendingSkuSuggestions > 0) {
    c.push({ id: "dados:troca-codigo", kind: "dados", title: "Troca de código de barras a confirmar", observation: `${i.pendingSkuSuggestions} produto(s) parecem novos mas têm um código antigo de nome parecido que vendia bem e quase parou.`, href: "/products", score: 0.2 });
  }

  const count: Record<string, number> = {};
  return c
    .sort((a, b) => b.score - a.score)
    .filter((x) => {
      count[x.kind] = (count[x.kind] ?? 0) + 1;
      return count[x.kind] <= PER_KIND;
    })
    .slice(0, WATCH_MAX)
    .map(({ kind: _kind, ...item }) => item);
}
