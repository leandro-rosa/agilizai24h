import { insufficientData } from "./confidence";
import type { MarginBreakdown } from "./kpis";
import type { LossIndex } from "./loss-index";
import type { CommercialParameters } from "./parameters";
import type { Dataset, DatasetLine } from "./types";

const pct = (share: number, digits = 1): string => `${(share * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

/* ------------------------------------------------------------------------ */
/* Coupon coverage: measurement, then the gate the parameters define         */
/* ------------------------------------------------------------------------ */

export interface StoreCouponCoverage {
  storeId: number;
  okLines: number;
  couponLines: number;
  /** Lines with a coupon ÷ all completed lines of the store. Null with no lines. */
  coverage: number | null;
  /** The same over the amount paid. Shown for information; it controls nothing. */
  revenueCoverage: number | null;
  couponBaskets: number;
  multiItemBaskets: number;
  multiItemShare: number | null;
  reusedBaskets: number;
  oversizedBaskets: number;
  /** Coverage at or above the exclusion threshold. */
  eligible: boolean;
}

export type GateState = "open" | "partial" | "blocked";

export interface CouponGate {
  state: GateState;
  /** Σ coupon lines ÷ Σ completed lines over the stores with detail: pooled, so a large store weighs more. */
  networkCoverage: number | null;
  networkRevenueCoverage: number | null;
  /** Among the coupon baskets of the eligible stores. */
  multiItemShare: number | null;
  eligibleStoreIds: number[];
  excluded: { storeId: number; coverage: number }[];
  eligibleBaskets: number;
  orphanLines: number;
  stores: StoreCouponCoverage[];
  /** Why the state is not `open`, in the reader's words. */
  reasons: string[];
  /** What would unblock the analyses, when they are blocked. */
  unblock: string[];
}

/**
 * Measures coupon coverage per store and for the network, and derives the
 * state the parameters define (design D2, D17):
 *  - a store below `exclusionCoverage` leaves the basket analyses and is listed;
 *  - `blocked`: no eligible store, too few eligible baskets, or coupons that
 *    rarely group more than one product;
 *  - `partial`: any store excluded, or the network below `fullCoverage`;
 *  - `open` otherwise.
 * The coverage figures are measurements; only the state applies a threshold.
 */
export function assessCouponGate(dataset: Dataset, p: CommercialParameters): CouponGate {
  const stores: StoreCouponCoverage[] = [...dataset.stores.values()]
    .filter((store) => store.okLines > 0)
    .map((store) => {
      const coverage = store.couponLines / store.okLines;
      return {
        storeId: store.storeId,
        okLines: store.okLines,
        couponLines: store.couponLines,
        coverage,
        revenueCoverage: store.revenueCents > 0 ? store.couponRevenueCents / store.revenueCents : null,
        couponBaskets: store.couponBaskets,
        multiItemBaskets: store.multiItemBaskets,
        multiItemShare: store.couponBaskets > 0 ? store.multiItemBaskets / store.couponBaskets : null,
        reusedBaskets: store.reusedBaskets,
        oversizedBaskets: store.oversizedBaskets,
        eligible: coverage >= p.coupon.exclusionCoverage,
      };
    })
    .sort((a, b) => a.storeId - b.storeId);

  const okLines = stores.reduce((sum, store) => sum + store.okLines, 0);
  const couponLines = stores.reduce((sum, store) => sum + store.couponLines, 0);
  const revenue = [...dataset.stores.values()].reduce((sum, store) => sum + store.revenueCents, 0);
  const couponRevenue = [...dataset.stores.values()].reduce((sum, store) => sum + store.couponRevenueCents, 0);
  const orphanLines = stores.reduce((sum, store) => sum + (store.okLines - store.couponLines), 0);

  const eligible = stores.filter((store) => store.eligible);
  const excluded = stores.filter((store) => !store.eligible).map((store) => ({ storeId: store.storeId, coverage: store.coverage ?? 0 }));
  const eligibleBaskets = eligible.reduce((sum, store) => sum + store.couponBaskets, 0);
  const eligibleMulti = eligible.reduce((sum, store) => sum + store.multiItemBaskets, 0);

  const networkCoverage = okLines > 0 ? couponLines / okLines : null;
  const multiItemShare = eligibleBaskets > 0 ? eligibleMulti / eligibleBaskets : null;

  const reasons: string[] = [];
  const unblock: string[] = [];
  let state: GateState;

  if (networkCoverage === null) {
    state = "blocked";
    reasons.push("Não há linhas concluídas com detalhe de transação neste período.");
  } else if (eligible.length === 0) {
    state = "blocked";
    reasons.push(`Nenhuma loja tem cobertura de cupom de pelo menos ${pct(p.coupon.exclusionCoverage, 0)}.`);
    unblock.push(`Ao menos uma loja com ${pct(p.coupon.exclusionCoverage, 0)} das linhas com cupom.`);
  } else if (eligibleBaskets < p.coupon.eligibleBasketsMinNetwork) {
    state = "blocked";
    reasons.push(`Só ${eligibleBaskets} compras com cupom nas lojas elegíveis (mínimo ${p.coupon.eligibleBasketsMinNetwork}).`);
    unblock.push(`Mais ${p.coupon.eligibleBasketsMinNetwork - eligibleBaskets} compras com cupom em lojas com cobertura de ${pct(p.coupon.exclusionCoverage, 0)} ou mais.`);
  } else if (multiItemShare !== null && multiItemShare < p.coupon.multiItemShareMin) {
    state = "blocked";
    reasons.push(`Só ${pct(multiItemShare)} das compras com cupom têm 2 ou mais produtos (mínimo ${pct(p.coupon.multiItemShareMin, 0)}): o cupom parece um identificador por linha, não uma cesta.`);
    unblock.push("Cupons que agrupem os itens de uma mesma compra.");
  } else if (excluded.length > 0 || networkCoverage < p.coupon.fullCoverage) {
    state = "partial";
    if (excluded.length > 0) reasons.push(`${excluded.length} ${excluded.length === 1 ? "loja abaixo" : "lojas abaixo"} de ${pct(p.coupon.exclusionCoverage, 0)} de cobertura ficam fora das análises de cesta.`);
    if (networkCoverage < p.coupon.fullCoverage) {
      reasons.push(`Cobertura da rede de ${pct(networkCoverage)}, abaixo de ${pct(p.coupon.fullCoverage, 0)}: as recomendações de cesta ficam limitadas a confiança Média.`);
    }
  } else {
    state = "open";
  }

  return {
    state,
    networkCoverage,
    networkRevenueCoverage: revenue > 0 ? couponRevenue / revenue : null,
    multiItemShare,
    eligibleStoreIds: eligible.map((store) => store.storeId),
    excluded,
    eligibleBaskets,
    orphanLines,
    stores,
    reasons,
    unblock,
  };
}

/**
 * Why a store cannot get its own basket recommendations, in the fixed
 * "Dados insuficientes…" shape; null when it can. The state of the network says
 * nothing about a single store: a store can be eligible in a `partial` network
 * and still have too few purchases.
 */
export function storeCouponInsufficiency(gate: CouponGate, storeId: number, p: CommercialParameters): string | null {
  const store = gate.stores.find((row) => row.storeId === storeId);
  const target = "combos nesta loja";

  if (!store) {
    return insufficientData({ target, condition: "a loja não tem detalhe de transação neste período", missing: "É preciso o relatório de vendas por rede do período." });
  }
  if (!store.eligible) {
    return insufficientData({
      target,
      condition: `só ${pct(store.coverage ?? 0)} das linhas da loja têm cupom`,
      missing: `A cobertura precisa ser de pelo menos ${pct(p.coupon.exclusionCoverage, 0)}.`,
    });
  }
  if (store.couponBaskets < p.coupon.eligibleBasketsMinStore) {
    return insufficientData({ target, condition: `só ${store.couponBaskets} compras com cupom`, minimum: p.coupon.eligibleBasketsMinStore });
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Bias diagnostic: do lines with a coupon look like lines without one?      */
/* ------------------------------------------------------------------------ */

export interface DistributionRow {
  key: string;
  label: string;
  /** Share of the coupon lines that fall in this bucket. */
  coupon: number;
  /** Share of the coupon-less lines that fall in it. */
  noCoupon: number;
}

export interface DistributionComparison {
  rows: DistributionRow[];
  /** Total variation distance between the two distributions: 0 identical, 1 disjoint. Null when either side is empty. */
  distance: number | null;
}

export interface BiasDiagnostic {
  couponLines: number;
  noCouponLines: number;
  avgLineCents: { coupon: number | null; noCoupon: number | null };
  category: DistributionComparison;
  /** Hour of the store's local clock; lines with no readable time are left out. */
  hour: DistributionComparison;
  machineModel: DistributionComparison;
  pos: DistributionComparison;
}

function compare(couponKeys: string[], noCouponKeys: string[], labelOf: (key: string) => string, order: (a: string, b: string) => number): DistributionComparison {
  const count = (keys: string[]) => {
    const map = new Map<string, number>();
    for (const key of keys) map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  };
  const coupon = count(couponKeys);
  const noCoupon = count(noCouponKeys);
  const all = [...new Set([...coupon.keys(), ...noCoupon.keys()])].sort(order);

  const rows: DistributionRow[] = all.map((key) => ({
    key,
    label: labelOf(key),
    coupon: couponKeys.length > 0 ? (coupon.get(key) ?? 0) / couponKeys.length : 0,
    noCoupon: noCouponKeys.length > 0 ? (noCoupon.get(key) ?? 0) / noCouponKeys.length : 0,
  }));

  const distance = couponKeys.length > 0 && noCouponKeys.length > 0 ? rows.reduce((sum, row) => sum + Math.abs(row.coupon - row.noCoupon), 0) / 2 : null;
  return { rows, distance };
}

/**
 * Compares the lines that carry a coupon with the lines that do not, on the
 * dimensions where missing coupons could bias a basket analysis: what is bought,
 * how much a line is worth, when, and on which machine. If coupon-less lines
 * look different (a machine model that never prints one, an hour that loses
 * them), the missingness is informative and coverage alone is not enough. It
 * measures and recommends nothing; it feeds the calibration of tasks group 5.
 */
export function couponBiasDiagnostic(lines: DatasetLine[], categoryOf: (sku: string) => string, options: { topPos?: number } = {}): BiasDiagnostic {
  const withCoupon = lines.filter((line) => line.coupon !== null);
  const without = lines.filter((line) => line.coupon === null);
  const average = (group: DatasetLine[]) => (group.length > 0 ? group.reduce((sum, line) => sum + line.paidCents, 0) / group.length : null);

  const hourKeys = (group: DatasetLine[]) => group.flatMap((line) => (line.wall ? [String(line.wall.hour).padStart(2, "0")] : []));
  const NO_MODEL = "(sem modelo)";
  const NO_POS = "(sem PDV)";

  // Many POS ids would make an unreadable table: keep the busiest, fold the rest.
  const topPos = options.topPos ?? 12;
  const posVolume = new Map<string, number>();
  for (const line of lines) posVolume.set(line.posId ?? NO_POS, (posVolume.get(line.posId ?? NO_POS) ?? 0) + 1);
  const keptPos = new Set([...posVolume.entries()].sort((a, b) => b[1] - a[1]).slice(0, topPos).map(([key]) => key));
  const posKey = (line: DatasetLine) => {
    const key = line.posId ?? NO_POS;
    return keptPos.has(key) ? key : "(outros)";
  };

  const alphabetical = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true });

  return {
    couponLines: withCoupon.length,
    noCouponLines: without.length,
    avgLineCents: { coupon: average(withCoupon), noCoupon: average(without) },
    category: compare(withCoupon.map((l) => categoryOf(l.sku)), without.map((l) => categoryOf(l.sku)), (key) => key, alphabetical),
    hour: compare(hourKeys(withCoupon), hourKeys(without), (key) => `${key}h`, alphabetical),
    machineModel: compare(withCoupon.map((l) => l.machineModel ?? NO_MODEL), without.map((l) => l.machineModel ?? NO_MODEL), (key) => key, alphabetical),
    pos: compare(withCoupon.map(posKey), without.map(posKey), (key) => key, alphabetical),
  };
}

/* ------------------------------------------------------------------------ */
/* Catalog vocabulary                                                        */
/* ------------------------------------------------------------------------ */

export interface CatalogVocabulary {
  soldSkuCount: number;
  byCategory: { category: string; skuCount: number; share: number }[];
  /** The catalog's own categories used by fewer than the threshold share of the sold products (zero counts). */
  sparseCategories: string[];
}

const CATALOG_CATEGORIES = ["meal", "snack", "beverage", "essential"];

/**
 * How the catalog's own four categories are actually used by what sold. It
 * counts what the catalog says and nothing more: there is no guess from product
 * names, so a meal catalogued as a snack is a snack here, and the banner says
 * that meal-based analyses are limited by the catalog.
 */
export function catalogVocabulary(soldSkus: string[], categoryOf: (sku: string) => string, p: CommercialParameters): CatalogVocabulary {
  const distinct = [...new Set(soldSkus)];
  const counts = new Map<string, number>();
  for (const sku of distinct) {
    const category = categoryOf(sku);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  const total = distinct.length;
  const byCategory = [...counts.entries()]
    .map(([category, skuCount]) => ({ category, skuCount, share: total > 0 ? skuCount / total : 0 }))
    .sort((a, b) => b.skuCount - a.skuCount);

  const sparseCategories = total === 0 ? [] : CATALOG_CATEGORIES.filter((category) => (counts.get(category) ?? 0) / total < p.quality.catalogSparseCategoryShare);
  return { soldSkuCount: total, byCategory, sparseCategories };
}

/* ------------------------------------------------------------------------ */
/* The data-quality banner                                                   */
/* ------------------------------------------------------------------------ */

export type QualitySeverity = "critical" | "attention" | "info";

export interface QualityItem {
  id: string;
  severity: QualitySeverity;
  title: string;
  /** What this problem does to the numbers and recommendations on the page. */
  effect: string;
  /** Names or figures behind the item, one per line. */
  details: string[];
}

/** A secondary data source's state; `loading` is not a problem, it is not shown yet. */
export type SourceStatus = "ok" | "loading" | "no_permission" | "error";

export interface QualityInput {
  gate: CouponGate | null;
  margin: MarginBreakdown;
  costs: SourceStatus;
  reconciliation: SourceStatus;
  supply: SourceStatus;
  lossIndex: LossIndex;
  /** Stores of the scope that have transaction detail. */
  scopeStoreIds: number[];
  /** Names of the network's stores with no completed line in the period. */
  storesWithoutDetail: string[];
  storeName: (storeId: number) => string;
  vocabulary: CatalogVocabulary | null;
  periodInProgress: boolean;
  /** The comparison period had no data: deltas read "Sem comparação". */
  comparisonMissing: boolean;
  synthetic: { excludedStores: string[]; excludedProducts: string[]; allowed: boolean };
  parameterWarnings: string[];
}

const SEVERITY_ORDER: Record<QualitySeverity, number> = { critical: 0, attention: 1, info: 2 };

const SOURCE_NAMES: Record<"costs" | "reconciliation" | "supply", { what: string; effect: string }> = {
  costs: { what: "Custos dos produtos", effect: "margens e retorno dos produtos ficam como “—”." },
  reconciliation: { what: "Reconciliação de perdas", effect: "perdas e a margem após perdas ficam como “—”; recomendações que dependem de perda não são feitas." },
  supply: { what: "Abastecimento", effect: "o giro (vendido ÷ abastecido) fica como “—”." },
};

/**
 * Every data problem that changes how far the page can be trusted, each with
 * its effect, ordered critical > attention > info. Nothing here is hidden
 * behind a threshold of its own except where a parameter says so.
 */
export function buildQualityItems(input: QualityInput, p: CommercialParameters): QualityItem[] {
  const items: QualityItem[] = [];

  const gate = input.gate;
  if (gate && gate.state !== "open") {
    const excluded = gate.excluded.map((row) => `${input.storeName(row.storeId)}: ${pct(row.coverage)}`);
    items.push({
      id: "coupon-coverage",
      severity: gate.state === "blocked" ? "critical" : "attention",
      title: gate.state === "blocked" ? "Análises de combos bloqueadas: cobertura de cupom insuficiente" : "Cobertura de cupom incompleta",
      effect:
        gate.state === "blocked"
          ? "Não há pares de produtos nem “o que falta no carrinho” até que o cupom cubra o suficiente. Receita, ticket e margem seguem valendo."
          : "Combos e “o que falta no carrinho” rodam só nas lojas elegíveis, e as recomendações de cesta ficam limitadas a confiança Média.",
      details: [...gate.reasons, ...gate.unblock.map((text) => `Para destravar: ${text}`), ...excluded.map((text) => `Fora das análises — ${text}`)],
    });
  }

  if (input.margin.unresolvedSkuCount > 0) {
    const share = input.margin.unresolvedRevenueShare;
    items.push({
      id: "unresolved-cost",
      severity: share !== null && share >= p.quality.unresolvedCostRevenueShareAttention ? "attention" : "info",
      title: `${input.margin.unresolvedSkuCount} ${input.margin.unresolvedSkuCount === 1 ? "produto sem custo resolvido" : "produtos sem custo resolvido"}${share !== null ? ` (${pct(share)} da receita)` : ""}`,
      effect: "As margens excluem a receita e o custo desses produtos; nenhuma margem é calculada como se o custo fosse zero.",
      details: input.margin.unresolvedSkus.slice(0, 12).map((sku) => `SKU ${sku}`),
    });
  }

  if (input.storesWithoutDetail.length > 0) {
    items.push({
      id: "stores-without-detail",
      severity: "attention",
      title: `${input.storesWithoutDetail.length} ${input.storesWithoutDetail.length === 1 ? "loja sem detalhe de transação" : "lojas sem detalhe de transação"} neste período`,
      effect: "Essas lojas não entram em nenhum número da página; a rede é a soma das demais.",
      details: input.storesWithoutDetail,
    });
  }

  if (input.reconciliation === "ok" && input.scopeStoreIds.length > 0) {
    const covered = input.scopeStoreIds.filter((id) => input.lossIndex.has(id));
    const incomplete = covered.filter((id) => input.lossIndex.get(id)?.complete === false);
    const missing = input.scopeStoreIds.filter((id) => !input.lossIndex.has(id));

    if (incomplete.length > 0) {
      items.push({
        id: "reconciliation-incomplete",
        severity: "attention",
        title: `Reconciliação incompleta em ${incomplete.length} de ${covered.length} ${covered.length === 1 ? "loja" : "lojas"}`,
        effect: "Estoque inconsistente ou produto sem custo nessas lojas reduz a confiança das recomendações que usam perda; a margem após perdas é apresentada com essa ressalva.",
        details: incomplete.slice(0, 12).map((id) => {
          const store = input.lossIndex.get(id);
          const flagged = (store?.inconsistentSkus.size ?? 0) + (store?.unvaluedSkus.size ?? 0);
          return `${input.storeName(id)} — ${flagged} ${flagged === 1 ? "produto sinalizado" : "produtos sinalizados"}`;
        }),
      });
    }
    if (missing.length > 0) {
      items.push({
        id: "reconciliation-missing",
        severity: "attention",
        title: `Sem reconciliação do período em ${missing.length} ${missing.length === 1 ? "loja" : "lojas"}`,
        effect: "A perda dessas lojas é desconhecida (não é zero): elas ficam fora da margem após perdas.",
        details: missing.slice(0, 12).map((id) => input.storeName(id)),
      });
    }
  }

  for (const source of ["costs", "reconciliation", "supply"] as const) {
    const status = input[source];
    if (status !== "no_permission" && status !== "error") continue;
    const { what, effect } = SOURCE_NAMES[source];
    items.push({
      id: `source-${source}`,
      severity: "attention",
      title: `${what}: ${status === "no_permission" ? "sem permissão" : "indisponível"}`,
      effect: `Os dados não foram carregados; ${effect}`,
      details: [],
    });
  }

  if (input.vocabulary && input.vocabulary.sparseCategories.length > 0) {
    const labels: Record<string, string> = { meal: "Refeição", snack: "Snack", beverage: "Bebida", essential: "Essencial" };
    const counts = input.vocabulary.byCategory.map((row) => `${labels[row.category] ?? row.category}: ${row.skuCount} ${row.skuCount === 1 ? "produto" : "produtos"}`);
    items.push({
      id: "catalog-vocabulary",
      severity: "info",
      title: "O catálogo usa pouco algumas categorias",
      effect: `Análises por categoria seguem o cadastro do catálogo, com só quatro categorias (refeição, snack, bebida, essencial). Pouco usadas entre o que vendeu: ${input.vocabulary.sparseCategories.map((c) => labels[c] ?? c).join(", ")}. O que estiver cadastrado em outra categoria é lido como ela — nenhuma categoria é deduzida do nome do produto.`,
      details: counts,
    });
  }

  if (input.periodInProgress) {
    items.push({
      id: "period-in-progress",
      severity: "info",
      title: "Mês em andamento",
      effect: "Os números cobrem só os dias já ocorridos; comparar com um mês fechado pode mostrar queda que é só calendário.",
      details: [],
    });
  }

  if (input.comparisonMissing) {
    items.push({
      id: "comparison-missing",
      severity: "info",
      title: "Período de comparação sem dados",
      effect: "As variações aparecem como “Sem comparação”; os números do período atual seguem normais.",
      details: [],
    });
  }

  const syntheticCount = input.synthetic.excludedStores.length + input.synthetic.excludedProducts.length;
  if (syntheticCount > 0) {
    items.push({
      id: "synthetic-excluded",
      severity: "attention",
      title: "Dados sintéticos detectados e excluídos",
      effect: "Lojas ou produtos marcados como sintéticos não entram em nenhum número, par, classe ou oportunidade desta página.",
      details: [...input.synthetic.excludedStores.map((name) => `Loja: ${name}`), ...input.synthetic.excludedProducts.slice(0, 8).map((name) => `Produto: ${name}`)],
    });
  } else if (input.synthetic.allowed) {
    items.push({
      id: "synthetic-allowed",
      severity: "info",
      title: "Fonte de dados simulada",
      effect: "Esta execução aceita entidades sintéticas (verificação contra um gateway simulado). Cada uma aparece rotulada; nada disto é dado real.",
      details: [],
    });
  }

  if (input.parameterWarnings.length > 0) {
    items.push({
      id: "parameter-warnings",
      severity: "attention",
      title: "Parâmetros do ambiente ignorados",
      effect: "Um valor inválido nas variáveis NEXT_PUBLIC_CI_* foi descartado e vale o padrão provisório.",
      details: input.parameterWarnings,
    });
  }

  return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
