import type { CategorySummary, LatestPricingReport, PricingProduct, PricingSummary } from "@/lib/api/pricing";

import { costChanges, topOpportunities, type CostChange, type Opportunity } from "./view";

/**
 * O que Excel e PDF exportam: o relatório em tela (já filtrado), nada recalculado. Um só modelo para os dois,
 * então o exportado nunca discorda do visto. Ausência é `null`, nunca zero.
 */
export interface ExportModel {
  period: string;
  /** "Todas as lojas" ou o nome da loja. */
  scopeLabel: string;
  filtersLabel: string;
  engineVersion: string;
  parameterVersion: number;
  computedAt: string | null;
  summary: PricingSummary;
  products: PricingProduct[];
  /** Os produtos abaixo da meta com recomendação, do maior impacto para o menor. */
  belowTarget: PricingProduct[];
  opportunities: Opportunity[];
  costChanges: CostChange[];
  categories: CategorySummary[];
  /** Observações sobre a qualidade dos dados: o que faltou ou foi suposto. */
  notes: string[];
  impactLabel: "Impacto potencial estimado";
}

export function buildExportModel(input: { latest: LatestPricingReport; products: PricingProduct[]; scopeLabel: string; filtersLabel: string; categories: CategorySummary[] }): ExportModel | null {
  const { latest, products } = input;
  if (!latest.report || !latest.run) return null;
  const report = latest.report;

  const notes = [...report.meta.notes, ...(report.meta.payment?.notes ?? [])];
  if (report.meta.paymentMixMonthsWithoutTransactions.length > 0) notes.push(`Sem detalhe de vendas por meio de pagamento em: ${report.meta.paymentMixMonthsWithoutTransactions.join(", ")}.`);
  if (latest.parametersStale) notes.push("As regras de negócio mudaram depois deste cálculo: os números são das regras anteriores.");
  const withoutCost = products.filter((product) => product.status === "insufficient_data").length;
  if (withoutCost > 0) notes.push(`${withoutCost} produto(s) sem dados suficientes não recebem recomendação.`);

  return {
    period: latest.scope.period,
    scopeLabel: input.scopeLabel,
    filtersLabel: input.filtersLabel,
    engineVersion: latest.run.engineVersion,
    parameterVersion: latest.run.parameterVersion,
    computedAt: latest.run.computedAt,
    summary: report.summary,
    products,
    belowTarget: products
      .filter((product) => product.status === "adjust" && product.recommendedPriceCents !== null)
      .sort((a, b) => (b.impactCentsPerMonth ?? 0) - (a.impactCentsPerMonth ?? 0)),
    opportunities: topOpportunities(products, 8),
    costChanges: costChanges(products, 10),
    categories: input.categories,
    notes: [...new Set(notes)],
    impactLabel: "Impacto potencial estimado",
  };
}
