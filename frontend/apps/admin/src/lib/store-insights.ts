import type { StorePnlSummary } from "@/lib/api/accounting";
import type { Store } from "@/lib/api/stores";
import { money } from "@/lib/format";

export const LOSS_THRESHOLD_PCT = 7;
export const COVERAGE_HEALTHY = 1.3;
export const COVERAGE_WATCH = 1.0;

/** Abaixo disso (R$50) uma diferença não abre insight própria — é ruído de arredondamento, não um ponto de atenção real. */
const MATERIALITY_CENTS = 5_000;
/** Queda mínima pra render "piorou vs. mês anterior" quando a loja já era positiva nos dois meses. */
const TREND_DROP_PCT = 15;

/**
 * "Sem rateio" (pre) = resultado da operação da própria loja — conta
 * Deslocamento/Repasse (custo real dela, só que com driver próprio), não
 * conta o pacote administrativo de rede (contador, pró-labore, sistema,
 * ERP, juros, marketing, degustações). "Com rateio" (post) = visão
 * econômica completa, com esse pacote também descontado. Pedido do
 * operador 2026-09-18.
 */
export type View = "pre" | "post";

export function resultOf(row: StorePnlSummary, view: View): number {
  return view === "pre" ? row.operating_profit_excl_admin_cents : row.operating_profit_cents;
}

export function marginOf(row: StorePnlSummary, view: View): number {
  return view === "pre" ? row.contribution_margin_excl_admin_cents : row.contribution_margin_cents;
}

export type InsightSeverity = "critical" | "warning" | "positive";

export interface StoreInsight {
  id: string;
  severity: InsightSeverity;
  title: string;
  /** Uma linha por loja/cliente afetado — a UI decide quantas mostrar antes de resumir "+N". */
  details: string[];
}

export interface ClientTotals {
  gross_revenue_cents: number;
  contribution_margin_cents: number;
  contribution_margin_excl_admin_cents: number;
  admin_allocated_cents: number;
  operating_profit_cents: number;
  operating_profit_excl_admin_cents: number;
  storeCount: number;
}

export function clientResultOf(totals: ClientTotals, view: View): number {
  return view === "pre" ? totals.operating_profit_excl_admin_cents : totals.operating_profit_cents;
}

function plural(n: number, singular: string, pluralForm: string): string {
  return n === 1 ? singular : pluralForm;
}

/**
 * Motor de análise do "Resultado por loja" — pedido do operador 2026-09-18:
 * "Atenção necessária" não pode ser blocos fixos, tem que ser um mecanismo
 * real que olha o dado do período (e, quando disponível, o mês anterior
 * por loja) e decide sozinho o que é relevante. Cada regra só aparece se
 * disparar; nenhum card vazio, nenhuma contagem fixa. Reage à mesma visão
 * Sem rateio/Com rateio do resto da tela.
 */
export function analyzeStores(
  rows: StorePnlSummary[],
  previousRows: StorePnlSummary[] | undefined,
  storeById: Map<number, Store>,
  byClient: [string, ClientTotals][],
  view: View,
): StoreInsight[] {
  const insights: StoreInsight[] = [];
  const name = (id: number) => storeById.get(id)?.name ?? `Loja ${id}`;

  if (view === "pre") {
    // Crítico — operação negativa (visão Sem rateio: só o que é da própria loja)
    const negative = rows
      .filter((r) => resultOf(r, view) < -MATERIALITY_CENTS)
      .sort((a, b) => resultOf(a, view) - resultOf(b, view));
    if (negative.length > 0) {
      insights.push({
        id: "negative-result",
        severity: "critical",
        title: `${negative.length} ${plural(negative.length, "loja com operação negativa", "lojas com operação negativa")}`,
        details: negative.map((r) => `${name(r.store_id)}: ${money(resultOf(r, view))}`),
      });
    }
  } else {
    // Com rateio: separa quem já nasce negativo (operação ruim) de quem só
    // não absorve o pacote administrativo — são problemas diferentes e a
    // ação certa também é diferente (ver o pedido do operador sobre não
    // rotular como "Negativa" uma loja saudável que só não cobre estrutura).
    const trueNegative = rows
      .filter((r) => r.operating_profit_cents < -MATERIALITY_CENTS && r.operating_profit_excl_admin_cents < -MATERIALITY_CENTS)
      .sort((a, b) => a.operating_profit_cents - b.operating_profit_cents);
    if (trueNegative.length > 0) {
      insights.push({
        id: "negative-result",
        severity: "critical",
        title: `${trueNegative.length} ${plural(trueNegative.length, "loja com operação negativa", "lojas com operação negativa")}`,
        details: trueNegative.map((r) => `${name(r.store_id)}: ${money(r.operating_profit_cents)}`),
      });
    }

    const notAbsorbing = rows
      .filter((r) => r.operating_profit_cents < -MATERIALITY_CENTS && r.operating_profit_excl_admin_cents >= -MATERIALITY_CENTS)
      .sort((a, b) => a.operating_profit_cents - b.operating_profit_cents);
    if (notAbsorbing.length > 0) {
      insights.push({
        id: "not-absorbing",
        severity: "warning",
        title: `${notAbsorbing.length} ${plural(notAbsorbing.length, "loja não absorve a estrutura", "lojas não absorvem a estrutura")}`,
        details: notAbsorbing.map(
          (r) => `${name(r.store_id)}: operação em ${money(r.operating_profit_excl_admin_cents)}, mas ${money(r.operating_profit_cents)} depois do rateio administrativo`,
        ),
      });
    }
  }

  // Crítico — cliente com resultado consolidado negativo (a relação inteira, não uma loja isolada)
  const negativeClients = byClient.filter(([, totals]) => clientResultOf(totals, view) < -MATERIALITY_CENTS);
  if (negativeClients.length > 0) {
    insights.push({
      id: "negative-client",
      severity: "critical",
      title: `${negativeClients.length} ${plural(negativeClients.length, "cliente no vermelho", "clientes no vermelho")}`,
      details: negativeClients.map(
        ([client, totals]) =>
          `${client}: ${money(clientResultOf(totals, view))} somando as ${totals.storeCount} ${plural(totals.storeCount, "loja", "lojas")}`,
      ),
    });
  }

  // Atenção — perdas acima da meta (real, não muda com a visão)
  const highLoss = rows
    .map((r) => ({ row: r, pct: r.gross_revenue_cents > 0 ? (r.perdas_cents / r.gross_revenue_cents) * 100 : 0 }))
    .filter((x) => x.pct > LOSS_THRESHOLD_PCT)
    .sort((a, b) => b.pct - a.pct);
  if (highLoss.length > 0) {
    insights.push({
      id: "high-loss",
      severity: "warning",
      title: `${highLoss.length} ${plural(highLoss.length, "loja com perdas acima da meta", "lojas com perdas acima da meta")}`,
      details: highLoss.map((x) => `${name(x.row.store_id)}: ${x.pct.toFixed(1)}% (meta ${LOSS_THRESHOLD_PCT}%)`),
    });
  }

  // Atenção — não cobre a estrutura administrativa (só existe na visão Com rateio)
  if (view === "post") {
    const notCovering = rows
      .filter((r) => r.admin_allocated_cents > MATERIALITY_CENTS)
      .map((r) => ({ row: r, coverage: r.contribution_margin_excl_admin_cents / r.admin_allocated_cents }))
      .filter((x) => x.coverage < COVERAGE_WATCH)
      .sort((a, b) => a.coverage - b.coverage);
    if (notCovering.length > 0) {
      insights.push({
        id: "low-coverage",
        severity: "warning",
        title: `${notCovering.length} ${plural(notCovering.length, "loja não cobre a estrutura administrativa", "lojas não cobrem a estrutura administrativa")}`,
        details: notCovering.map((x) => `${name(x.row.store_id)}: ${x.coverage.toFixed(1)}× (margem de contribuição ÷ rateio)`),
      });
    }
  }

  // Atenção — queda de resultado vs. mês anterior (por loja, não o total de rede)
  if (previousRows) {
    const prevByStore = new Map(previousRows.map((r) => [r.store_id, r]));
    const dropped = rows
      .map((r) => {
        const prev = prevByStore.get(r.store_id);
        if (!prev) return null;
        const curr = resultOf(r, view);
        const prevResult = resultOf(prev, view);
        const material = Math.abs(prevResult) > MATERIALITY_CENTS || Math.abs(curr) > MATERIALITY_CENTS;
        if (!material) return null;
        const droppedToNegative = prevResult >= 0 && curr < 0;
        const deltaPct = prevResult > 0 ? ((curr - prevResult) / prevResult) * 100 : null;
        const bigDrop = deltaPct !== null && deltaPct <= -TREND_DROP_PCT;
        if (!droppedToNegative && !bigDrop) return null;
        return { row: r, prevResult, curr, deltaPct, delta: curr - prevResult };
      })
      .filter((x): x is { row: StorePnlSummary; prevResult: number; curr: number; deltaPct: number | null; delta: number } => x !== null)
      .sort((a, b) => a.delta - b.delta);
    if (dropped.length > 0) {
      insights.push({
        id: "result-drop",
        severity: "warning",
        title: `${dropped.length} ${plural(dropped.length, "loja com queda de resultado", "lojas com queda de resultado")}`,
        details: dropped.map(
          (x) => `${name(x.row.store_id)}: ${money(x.prevResult)} → ${money(x.curr)}` + (x.deltaPct !== null ? ` (${x.deltaPct.toFixed(0)}%)` : ""),
        ),
      });
    }
  }

  // Positivo — destaque do período
  if (rows.length > 0) {
    const topContributor = [...rows].sort((a, b) => marginOf(b, view) - marginOf(a, view))[0];
    insights.push({
      id: "top-contributor",
      severity: "positive",
      title: "Maior contribuição do período",
      details: [`${name(topContributor.store_id)}: ${money(marginOf(topContributor, view))} de margem de contribuição`],
    });

    if (previousRows) {
      const prevByStore = new Map(previousRows.map((r) => [r.store_id, r]));
      const growth = rows
        .map((r) => {
          const prev = prevByStore.get(r.store_id);
          const prevResult = prev ? resultOf(prev, view) : null;
          if (!prev || prevResult === null || prevResult <= 0) return null;
          const curr = resultOf(r, view);
          const deltaPct = ((curr - prevResult) / prevResult) * 100;
          return deltaPct >= TREND_DROP_PCT ? { row: r, prevResult, curr, deltaPct } : null;
        })
        .filter((x): x is { row: StorePnlSummary; prevResult: number; curr: number; deltaPct: number } => x !== null)
        .sort((a, b) => b.deltaPct - a.deltaPct)[0];
      if (growth) {
        insights.push({
          id: "top-growth",
          severity: "positive",
          title: "Maior crescimento vs. mês anterior",
          details: [`${name(growth.row.store_id)}: ${money(growth.prevResult)} → ${money(growth.curr)} (+${growth.deltaPct.toFixed(0)}%)`],
        });
      }
    }
  }

  const order: Record<InsightSeverity, number> = { critical: 0, warning: 1, positive: 2 };
  return insights.sort((a, b) => order[a.severity] - order[b.severity]);
}
