import type { PricingProduct, PricingStatus } from "@/lib/api/pricing";
import { money } from "@/lib/format";

import { percent, points, signedMoney } from "./labels";

/*
 * Visão sobre o relatório guardado: filtrar, ordenar e paginar são do navegador; o que decide uma recomendação
 * (preços, situação, confiança, impacto) NUNCA é recalculado aqui — vem pronto do backend.
 */

export type MarginBand = "below_20" | "20_30" | "30_35" | "35_40" | "above_40" | "no_margin";

export const MARGIN_BAND_LABEL: Record<MarginBand, string> = {
  below_20: "Abaixo de 20%",
  "20_30": "20% a 30%",
  "30_35": "30% a 35%",
  "35_40": "35% a 40%",
  above_40: "Acima de 40%",
  no_margin: "Sem margem calculada",
};

export function marginBandOf(margin: number | null): MarginBand {
  if (margin === null) return "no_margin";
  if (margin < 0.2) return "below_20";
  if (margin < 0.3) return "20_30";
  if (margin < 0.35) return "30_35";
  if (margin < 0.4) return "35_40";

  return "above_40";
}

export interface Filters {
  /** Chave de categoria do catálogo. */
  category: string | null;
  supplierId: number | null;
  /** Nome, código (SKU) ou EAN. */
  query: string;
  status: PricingStatus | null;
  marginBand: MarginBand | null;
  belowTarget: boolean;
  costChanged: boolean;
}

export const NO_FILTERS: Filters = { category: null, supplierId: null, query: "", status: null, marginBand: null, belowTarget: false, costChanged: false };

export function activeFilterCount(filters: Filters): number {
  return [filters.category !== null, filters.supplierId !== null, filters.query.trim() !== "", filters.status !== null, filters.marginBand !== null, filters.belowTarget, filters.costChanged].filter(Boolean).length;
}

const fold = (value: string): string => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** O custo mudou: há custo anterior e a variação não é zero. */
export function costChanged(product: PricingProduct): boolean {
  return product.costVariation !== null && Math.abs(product.costVariation) > 0.0005;
}

/** Margem abaixo da meta do próprio produto (a meta pode ser da categoria). */
export function belowTarget(product: PricingProduct): boolean {
  return product.currentMargin !== null && product.currentMargin < product.targetMargin - 1e-9;
}

export function applyFilters(products: PricingProduct[], filters: Filters): PricingProduct[] {
  const query = fold(filters.query.trim());

  return products.filter((product) => {
    if (filters.category !== null && (product.category ?? "") !== filters.category) return false;
    if (filters.supplierId !== null && product.supplierId !== filters.supplierId) return false;
    if (filters.status !== null && product.status !== filters.status) return false;
    if (filters.marginBand !== null && marginBandOf(product.currentMargin) !== filters.marginBand) return false;
    if (filters.belowTarget && !belowTarget(product)) return false;
    if (filters.costChanged && !costChanged(product)) return false;
    if (query) {
      const haystack = fold(`${product.name ?? ""} ${product.sku} ${product.ean ?? ""}`);
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

export type SortKey = "impact" | "lowest_margin" | "most_sold" | "cost_variation" | "opportunity";

export const SORT_LABEL: Record<SortKey, string> = {
  impact: "Maior impacto",
  lowest_margin: "Menor margem",
  most_sold: "Maior venda",
  cost_variation: "Maior variação de custo",
  opportunity: "Maior oportunidade",
};

/** Distância até a meta, em pontos de margem, só para quem tem recomendação: é o que "oportunidade" quer dizer. */
function opportunityGap(product: PricingProduct): number | null {
  if (product.recommendedPriceCents === null || product.currentMargin === null) return null;

  return product.targetMargin - product.currentMargin;
}

const NULLS_LAST = <T,>(a: T | null, b: T | null, compare: (x: T, y: T) => number): number => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  return compare(a, b);
};

/** Ordena sem mutar. Quem não tem o número (sem custo, sem recomendação) vai sempre para o fim, nunca para o topo. */
export function sortProducts(products: PricingProduct[], key: SortKey): PricingProduct[] {
  const byName = (a: PricingProduct, b: PricingProduct) => (a.name ?? a.sku).localeCompare(b.name ?? b.sku, "pt-BR");
  const compare: Record<SortKey, (a: PricingProduct, b: PricingProduct) => number> = {
    impact: (a, b) => NULLS_LAST(a.impactCentsPerMonth, b.impactCentsPerMonth, (x, y) => y - x),
    lowest_margin: (a, b) => NULLS_LAST(a.currentMargin, b.currentMargin, (x, y) => x - y),
    most_sold: (a, b) => b.monthlyUnits - a.monthlyUnits,
    cost_variation: (a, b) => NULLS_LAST(a.costVariation === null ? null : Math.abs(a.costVariation), b.costVariation === null ? null : Math.abs(b.costVariation), (x, y) => y - x),
    opportunity: (a, b) => NULLS_LAST(opportunityGap(a), opportunityGap(b), (x, y) => y - x),
  };

  return [...products].sort((a, b) => compare[key](a, b) || byName(a, b));
}

export function paginate<T>(items: T[], page: number, pageSize: number): { rows: T[]; pages: number; page: number } {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(page, 1), pages);

  return { rows: items.slice((current - 1) * pageSize, current * pageSize), pages, page: current };
}

/** Opções dos filtros, tiradas do próprio relatório: só o que existe nele. */
export function filterOptions(products: PricingProduct[]): { categories: { key: string; label: string }[]; suppliers: { id: number; name: string }[] } {
  const categories = new Map<string, string>();
  const suppliers = new Map<number, string>();

  for (const product of products) {
    categories.set(product.category ?? "", product.categoryLabel);
    if (product.supplierId !== null && product.supplierName) suppliers.set(product.supplierId, product.supplierName);
  }

  return {
    categories: [...categories].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    suppliers: [...suppliers].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };
}

/** O motivo de um produto não ter preço recomendado, em uma linha. */
export function noRecommendationReason(product: PricingProduct): string | null {
  if (product.recommendedPriceCents !== null) return null;
  if (product.insufficientReasons.length > 0) return product.insufficientReasons[0];

  return product.reasons.find((reason) => reason.code === "below_min_confidence")?.text ?? product.reasons[0]?.text ?? "Sem recomendação de preço.";
}

export interface Opportunity {
  product: PricingProduct;
  /** Uma frase, só com número calculado: nunca uma causa que o dado não mostra. */
  text: string;
}

function opportunitySentence(product: PricingProduct): string {
  const parts: string[] = [];
  if (product.currentMargin !== null) {
    parts.push(
      belowTarget(product)
        ? `Margem ${percent(product.currentMargin)}, abaixo da meta de ${percent(product.targetMargin)}.`
        : `Margem ${percent(product.currentMargin)}, perto da meta de ${percent(product.targetMargin)}.`,
    );
  }
  if (product.costVariation !== null && Math.abs(product.costVariation) >= 0.005) {
    parts.push(`Custo ${product.costVariation > 0 ? "subiu" : "caiu"} ${percent(Math.abs(product.costVariation))}.`);
  }
  if (product.recommendedPriceCents !== null && product.currentPriceCents !== null) {
    parts.push(`De ${money(product.currentPriceCents)} para ${money(product.recommendedPriceCents)} há ${signedMoney(product.impactCentsPerMonth)} por mês de impacto potencial estimado.`);
  }

  return parts.join(" ");
}

/** Os produtos com maior impacto potencial estimado — só quem tem recomendação e impacto positivo. */
export function topOpportunities(products: PricingProduct[], limit = 5): Opportunity[] {
  return sortProducts(
    products.filter((product) => product.recommendedPriceCents !== null && (product.impactCentsPerMonth ?? 0) > 0),
    "impact",
  )
    .slice(0, limit)
    .map((product) => ({ product, text: opportunitySentence(product) }));
}

export interface CostChange {
  product: PricingProduct;
  previousCostCents: number;
  currentCostCents: number;
  variation: number;
  /** Variação da margem causada só pelo custo, em pontos; `null` quando o motor não a calculou. */
  marginChange: number | null;
}

/** Quem teve o custo alterado, do que mais mudou (em módulo) para o que menos. */
export function costChanges(products: PricingProduct[], limit = 5): CostChange[] {
  const rows: CostChange[] = [];

  for (const product of products) {
    if (!costChanged(product) || product.costVariation === null) continue;
    const current = product.structure?.productCostCents;
    if (current === undefined) continue;
    // O custo anterior sai da variação do próprio motor: nenhum número é inventado aqui.
    const previous = Math.round(current / (1 + product.costVariation));
    rows.push({ product, previousCostCents: previous, currentCostCents: current, variation: product.costVariation, marginChange: product.marginChangeFromCost });
  }

  return rows.sort((a, b) => Math.abs(b.variation) - Math.abs(a.variation)).slice(0, limit);
}

export { points };
