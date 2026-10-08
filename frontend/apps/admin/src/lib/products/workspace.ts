import type { PricingProduct } from "@/lib/api/pricing";
import type { Product } from "@/lib/api/products";

/** O custo e o preço vigentes hoje de um produto, como o cadastro os devolve. */
export interface Dated {
  cents: number;
  from: string;
  /** De onde vem o valor em vigor (nota, manual, planilha…) e o número da nota, quando foi uma. */
  source?: string;
  invoiceNumber?: string | null;
}

/**
 * Como a lista apresenta um produto na decisão de preço de AGORA:
 * - `no_price`: sem preço de venda vigente (nunca "margem zero");
 * - `pending`: tem preço, mas falta algo para decidir (sem custo, dados insuficientes ou fora do cálculo);
 * - `stale`: há cálculo, mas o preço ou o custo do cadastro mudou depois dele (a lista está se atualizando) — não se mostra margem nem sugestão velhas;
 * - `healthy` / `review` / `opportunity`: o cálculo guardado descreve o preço e o custo de hoje.
 */
export type Situation = "no_price" | "pending" | "stale" | "healthy" | "review" | "opportunity";

export const SITUATION_LABEL: Record<Situation, string> = {
  no_price: "Sem preço",
  pending: "Dados pendentes",
  stale: "Desatualizado",
  healthy: "Dentro da meta",
  review: "Revisar preço",
  opportunity: "Oportunidade",
};

export interface WorkspaceRow {
  product: Product;
  cost: Dated | null;
  /** A origem do custo em vigor no formato que `costOriginText` mostra; nula quando o cadastro não disse. */
  costOrigin: { source: string; effectiveFrom: string; invoiceNumber: string | null } | null;
  price: Dated | null;
  /** A linha do cálculo de hoje, só quando ele ainda descreve o preço e o custo que o cadastro tem. */
  analysis: PricingProduct | null;
  /** Existe linha no cálculo guardado, mas o cadastro mudou depois dela. */
  stale: boolean;
  suggestedCents: number | null;
  /** Margem de contribuição no preço atual; nula quando não há preço, não há cálculo em dia ou faltam dados. */
  margin: number | null;
  targetMargin: number | null;
  situation: Situation;
  /** O que impede decidir, em palavras; vazio quando nada impede. */
  pending: string[];
}

export interface WorkspaceInput {
  products: Product[];
  costs: Map<string, Dated>;
  prices: Map<string, Dated>;
  /** As linhas do último cálculo concluído; `null` quando ainda não há cálculo. */
  report: PricingProduct[] | null;
}

/** O cálculo só vale para a linha se usou o preço e o custo que o cadastro tem hoje. */
function describesToday(row: PricingProduct, cost: Dated | null, price: Dated | null): boolean {
  if (price === null || row.currentPriceCents !== price.cents) return false;
  if (row.structure === null) return true;

  return cost !== null && row.structure.productCostCents === cost.cents;
}

export function buildRows({ products, costs, prices, report }: WorkspaceInput): WorkspaceRow[] {
  const bySku = new Map((report ?? []).map((row) => [row.sku, row]));

  return products.map((product) => {
    const cost = costs.get(product.sku) ?? null;
    const price = prices.get(product.sku) ?? null;
    const stored = bySku.get(product.sku) ?? null;
    const fresh = stored !== null && describesToday(stored, cost, price);
    const analysis = fresh ? stored : null;
    const stale = stored !== null && !fresh && price !== null;
    const pending: string[] = [];
    if (cost === null) pending.push("Sem custo cadastrado");
    if (analysis?.status === "insufficient_data") pending.push(...(analysis.insufficientReasons.length > 0 ? analysis.insufficientReasons : ["Dados insuficientes para o cálculo"]));
    if (analysis && analysis.status !== "insufficient_data" && analysis.validated === false) pending.push("Despesas sem classificação: cálculo não validado");

    let situation: Situation;
    if (price === null) situation = "no_price";
    else if (cost === null || analysis?.status === "insufficient_data") situation = "pending";
    else if (stale) situation = "stale";
    else if (analysis === null) situation = "pending";
    else if (analysis.status === "healthy") situation = "healthy";
    else if (analysis.status === "opportunity") situation = "opportunity";
    else situation = "review";

    if (situation === "pending" && analysis === null && !stale && cost !== null && price !== null) pending.push(report === null ? "Ainda não há cálculo de hoje" : "Fora do cálculo de hoje: atualize a lista");
    if (situation === "stale") pending.push("O preço ou o custo mudou agora há pouco: atualize a lista");

    const usable = analysis !== null && analysis.status !== "insufficient_data";

    return {
      product,
      cost,
      costOrigin: cost?.source ? { source: cost.source, effectiveFrom: cost.from, invoiceNumber: cost.invoiceNumber ?? null } : null,
      price,
      analysis,
      stale,
      suggestedCents: usable ? analysis.recommendedPriceCents : null,
      margin: usable ? analysis.currentMargin : null,
      targetMargin: usable ? analysis.targetMargin : null,
      situation,
      pending,
    };
  });
}

export type QuickFilter = "all" | "no_price" | "below_target" | "pending";

export const QUICK_FILTER_LABEL: Record<QuickFilter, string> = { all: "Todos", no_price: "Sem preço", below_target: "Abaixo da meta", pending: "Dados pendentes" };

/** Abaixo da meta: o cálculo em dia diz que a margem de contribuição está abaixo da meta do próprio produto. */
export const isBelowTarget = (row: WorkspaceRow): boolean => row.margin !== null && row.targetMargin !== null && row.margin < row.targetMargin - 1e-9;

/** Dados pendentes: já tem preço, mas falta algo para decidir (sem custo, dados insuficientes, fora do cálculo ou cálculo velho). Sem preço é outro filtro. */
export const isPending = (row: WorkspaceRow): boolean => row.situation === "pending" || row.situation === "stale";

export function matchesQuick(row: WorkspaceRow, filter: QuickFilter): boolean {
  if (filter === "no_price") return row.situation === "no_price";
  if (filter === "below_target") return isBelowTarget(row);
  if (filter === "pending") return isPending(row);

  return true;
}

export function quickCounts(rows: WorkspaceRow[]): Record<QuickFilter, number> {
  return { all: rows.length, no_price: rows.filter((row) => matchesQuick(row, "no_price")).length, below_target: rows.filter(isBelowTarget).length, pending: rows.filter(isPending).length };
}

const fold = (value: string): string => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca por nome, SKU ou QUALQUER EAN vinculado (ativo ou antigo: uma nota velha ainda traz o código antigo). */
export function matchesSearch(product: Product, term: string): boolean {
  const needle = fold(term.trim());
  if (!needle) return true;

  return fold(product.name).includes(needle) || fold(product.sku).includes(needle) || (product.ean ?? "").includes(needle) || (product.eans ?? []).some((ean) => ean.ean.includes(needle));
}

export interface WorkspaceFilters {
  search: string;
  category: string;
  subcategory: string;
  quick: QuickFilter;
}

export const NO_WORKSPACE_FILTERS: WorkspaceFilters = { search: "", category: "all", subcategory: "all", quick: "all" };

export function filterRows(rows: WorkspaceRow[], filters: WorkspaceFilters): WorkspaceRow[] {
  return rows.filter(
    (row) =>
      (filters.category === "all" || row.product.category === filters.category) &&
      (filters.subcategory === "all" || (row.product.subcategory ?? "") === filters.subcategory) &&
      matchesQuick(row, filters.quick) &&
      matchesSearch(row.product, filters.search),
  );
}

export type SortKey = "name" | "cost" | "price" | "suggested" | "margin" | "situation";

const SITUATION_ORDER: Record<Situation, number> = { review: 0, stale: 1, pending: 2, no_price: 3, opportunity: 4, healthy: 5 };

/** Ordena sem nunca tratar "sem valor" como zero: vazios vão sempre para o fim, qualquer que seja o sentido. */
export function sortRows(rows: WorkspaceRow[], key: SortKey, direction: "asc" | "desc"): WorkspaceRow[] {
  const sign = direction === "asc" ? 1 : -1;
  const value = (row: WorkspaceRow): number | string | null => {
    if (key === "name") return fold(row.product.name);
    if (key === "cost") return row.cost?.cents ?? null;
    if (key === "price") return row.price?.cents ?? null;
    if (key === "suggested") return row.suggestedCents;
    if (key === "margin") return row.margin;

    return SITUATION_ORDER[row.situation];
  };

  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === null && right === null) return fold(a.product.name).localeCompare(fold(b.product.name));
    if (left === null) return 1;
    if (right === null) return -1;
    if (left < right) return -1 * sign;
    if (left > right) return 1 * sign;

    return fold(a.product.name).localeCompare(fold(b.product.name));
  });
}

export interface PendencyGroup {
  code: string;
  label: string;
  /** Qual ação resolve. */
  action: "recalculate" | "register_cost" | "open_rules" | "open_product" | "info";
  actionLabel: string;
  /** Onde corrigir, quando é outra tela (taxas de pagamento, por exemplo). */
  href?: string;
  skus: string[];
}

/** Pendências que afetam a decisão, agrupadas por motivo, com os produtos afetados e a ação. "3 pendências — revisar" sai do tamanho desta lista. */
export function buildPendencyGroups(rows: WorkspaceRow[], global: PendencyGroup[] = []): PendencyGroup[] {
  const groups: PendencyGroup[] = [];
  const add = (group: PendencyGroup) => group.skus.length > 0 && groups.push(group);

  add({ code: "no_cost", label: "Produtos com preço e sem custo", action: "register_cost", actionLabel: "Informar o custo", skus: rows.filter((row) => row.price !== null && row.cost === null).map((row) => row.product.sku) });
  add({ code: "stale", label: "O preço ou o custo mudou depois do cálculo de hoje", action: "recalculate", actionLabel: "Atualizar", skus: rows.filter((row) => row.situation === "stale").map((row) => row.product.sku) });
  add({
    code: "insufficient",
    label: "O cálculo não tem dados suficientes (custo antigo ou sem compra recente)",
    action: "open_product",
    actionLabel: "Abrir o produto",
    skus: rows.filter((row) => row.price !== null && row.cost !== null && row.analysis?.status === "insufficient_data").map((row) => row.product.sku),
  });

  // Avisos que valem para o cálculo inteiro (regra sem valor, despesa sem classificação): não afetam um produto só, então não têm lista de produtos.
  return [...groups, ...global];
}

/** "3 pendências", "1 pendência"; nada quando não há. */
export const pendencySummary = (groups: PendencyGroup[]): string | null => (groups.length === 0 ? null : `${groups.length} ${groups.length === 1 ? "pendência" : "pendências"}`);
