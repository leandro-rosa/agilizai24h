/**
 * Entrada e saída do motor do Resumo Mensal. A entrada é o dado JÁ buscado
 * (cada seção `null` = indisponível, nunca zero); a saída é o objeto único
 * que a tela e o PDF renderizam — mesmos números nos dois.
 */
import type { Comparison, RateDelta, ValueDelta } from "./compare";
import type { Distribution, ProductBehavior } from "./product-behavior";
import type { SalesCoverage } from "./sales-coverage";
import type { CatalogueItem, LinkDecision, SkuSuggestion } from "./sku-match";
import type { SupplyCell, TestsSummary } from "./tests";

export interface NetworkPnlMonth {
  netRevenueCents: number;
  grossRevenueCents: number;
  contributionMarginCents: number;
  operatingProfitCents: number;
  /** `computed_at` do snapshot — último fechamento, regravado a cada reapuração. */
  computedAt: string | null;
}

export interface CashMonth {
  openingCents: number;
  inflowCents: number;
  outflowCents: number;
  closingCents: number;
}

export interface TreasuryMonth {
  /** Despesa por categoria (rótulo livre do de-para, não vocabulário fechado). */
  byCategory: { category: string; outflowCents: number }[];
  unresolvedCount: number;
  pendingCount: number;
}

export interface FinanceMonth {
  restockedValueCents: number;
  cogsCents: number;
  lossValueCents: number;
  lossByReason: { reason: string; valueCents: number }[];
  /** Perda por SKU, somada na rede. */
  lossBySku: { sku: string; valueCents: number }[];
  /** Algum loja-mês incompleto (SKU sem custo / saldo inconsistente). */
  incompleteStores: number;
}

export interface CapexMonth {
  totalCents: number;
  byCategory: { category: string; cents: number }[];
  unassignedCents: number;
}

export interface InvestorMonth {
  totalCents: number;
  byKind: { kind: string; cents: number }[];
  contributionCount: number;
}

/** Dados de um mês, um bloco por fonte. */
export interface MonthInput {
  period: string;
  pnl: NetworkPnlMonth | null;
  cash: CashMonth | null;
  treasury: TreasuryMonth | null;
  finance: FinanceMonth | null;
  capex: CapexMonth | null;
  investors: InvestorMonth | null;
}

export interface StoreMonthPnl {
  storeId: number;
  name: string;
  netRevenueCents: number;
  contributionMarginCents: number;
  operatingProfitCents: number;
  lossCents: number;
}

export interface SalesCell {
  storeId: number;
  period: string;
  sku: string;
  quantity: number;
  revenueCents: number;
}

export interface OverviewInput {
  /** Competência (YYYY-MM). */
  period: string;
  /** Ordem: [period, period−1, period−2, period−3]. */
  months: MonthInput[];
  stores: { current: StoreMonthPnl[] | null; previous: StoreMonthPnl[] | null; activeCount: number | null };
  /** Vendas por loja × mês × SKU, 6 meses até `period`; `ingestedPeriods` distingue "sem venda" de "não importado". */
  sales: { cells: SalesCell[]; ingestedPeriods: string[]; seriesPeriods: string[] } | null;
  /** SKU → custo unitário em centavos (só resolvidos). */
  costBySku: Record<string, number> | null;
  productNames: Record<string, string>;
  /** Lojas ativas (id + nome) — base para dizer em quais lojas um produto vendeu ou não. */
  storeList: { id: number; name: string }[] | null;
  /** Catálogo (sku + nome) e decisões de troca de código já tomadas pelo operador. */
  catalogue: CatalogueItem[];
  skuLinks: LinkDecision[];
  /** Abastecimento por loja × mês × SKU (9 meses até a competência); base de "produtos em teste". */
  supply: { cells: SupplyCell[]; ingestedPeriods: string[] } | null;
  aging: { referenceDate: string; overdueCents: number; notDueCents: number; openCents: number } | null;
  /** Fechamento do mês na rede. */
  closed: boolean;
  /** O mês anterior (base da comparação) também está fechado no DRE? Se não, a comparação é provisória. */
  previousClosed: boolean;
}

export type Tone = "positive" | "negative" | "neutral";

export interface KpiResult {
  key: "revenue" | "contribution" | "operating" | "operatingMargin" | "loss" | "cash";
  label: string;
  kind: "money" | "rate";
  value: number | null;
  previous: number | null;
  avg3: number | null;
  vsPrevious: ValueDelta | RateDelta;
  vsAvg3: ValueDelta | RateDelta;
  /** true = subir é bom (receita); false = subir é ruim (perdas). */
  goodWhenUp: boolean;
  /** Denominador/definição, sempre visível. */
  note: string;
}

export interface Insight {
  id: string;
  tone: Tone;
  title: string;
  detail: string;
  /** Representatividade (fração da base) usada para ordenar. */
  score: number;
}

export type StoreMovement = "up" | "down" | "stable";

export interface StoreContribution {
  storeId: number;
  name: string;
  deltaCents: number;
  deltaPct: number | null;
}

export interface StoreAttention {
  storeId: number;
  name: string;
  reasons: string[];
  deltaCents: number | null;
  deltaPct: number | null;
}

export interface StoreSummary {
  activeCount: number | null;
  compared: number;
  up: number;
  down: number;
  stable: number;
  /** Base do cresce/recuou: "vendas" (sales-service, o faturamento da loja) ou "dre" (receita líquida por loja, quando falta venda de um dos meses). */
  basis: "vendas" | "dre";
  /** Soma das lojas comparadas, na base acima (mês atual e anterior). */
  storesRevenueCents: number;
  storesRevenuePreviousCents: number;
  topGrowth: StoreContribution[];
  topDecline: StoreContribution[];
  attention: StoreAttention[];
}

export interface ProductStoreRow {
  storeId: number;
  name: string;
  units: number;
  /** null = mês anterior não importado (sem base). */
  unitsPrevious: number | null;
  revenueCents: number;
}

export interface ProductRow {
  sku: string;
  name: string;
  units: number;
  revenueCents: number;
  shareOfRevenue: number | null;
  marginPct: number | null;
  marginDeltaPp: number | null;
  /** SKU com custo não resolvido — margem fica fora, nunca como zero. */
  marginUnresolved: boolean;
  unitsPrevious: number | null;
  deltaUnitsPct: number | null;
  deltaRevenueCents: number | null;
  deltaRevenuePct: number | null;
  series: (number | null)[];
  behavior: ProductBehavior;
  distribution: Distribution | null;
  /** Toda loja ativa, com ou sem venda do SKU no mês — alimenta o detalhe clicável. */
  byStore: ProductStoreRow[];
  material: boolean;
}

export interface ProductsSummary {
  topSold: ProductRow[];
  rising: ProductRow[];
  falling: ProductRow[];
  relevantChange: ProductRow[];
  /** Unidade da série de tendência. */
  seriesPeriods: string[];
  /** Há mês de comparação ingerido? Sem, as abas Em alta/Em queda ficam vazias por falta de base, não por estabilidade. */
  hasComparison: boolean;
}

export interface LossSummary {
  restockedCents: number | null;
  lossCents: number | null;
  /** Perda ÷ receita líquida do mês. */
  lossToRevenue: number | null;
  /** Perda ÷ custo (valor) abastecido do mês. */
  lossToSupplied: number | null;
  byReason: { reason: string; valueCents: number; share: number | null; deltaCents: number | null }[];
  topSkus: { sku: string; name: string; valueCents: number; share: number | null }[];
  /** Fração da perda nos 3 maiores SKUs. */
  top3Share: number | null;
  incompleteStores: number;
}

export interface CashUseLine {
  key: string;
  label: string;
  currentCents: number;
  previousCents: number | null;
  avg3Cents: number | null;
  deltaCents: number | null;
  deltaPct: number | null;
  /** Por que entrou na lista. */
  material: boolean;
}

export interface CashUses {
  stock: CashUseLine | null;
  capex: CashUseLine | null;
  /** Categorias de despesa (tesouraria) que saíram do comportamento normal. */
  expenses: CashUseLine[];
  /** Fato: compras de estoque × receita, sem concluir eficiência. */
  stockVsRevenue: { stockDeltaPct: number | null; revenueDeltaPct: number | null } | null;
}

export interface CashSummary {
  opening: number | null;
  inflow: number | null;
  outflow: number | null;
  closing: number | null;
  overdueCents: number | null;
  notDueCents: number | null;
  agingReference: string | null;
  /** Fato composto: resultado operacional positivo com caixa em queda. */
  operatingPositiveCashFell: boolean;
  cashDeltaCents: number | null;
}

export interface CapexSummary {
  current: CapexMonth | null;
  previousCents: number | null;
  deltaPct: number | null;
  top: { category: string; cents: number }[];
}

export interface InvestorsSummary {
  current: InvestorMonth | null;
  previousCents: number | null;
  deltaPct: number | null;
}

export interface Overview {
  period: string;
  previousPeriod: string;
  avg3Periods: string[];
  closed: boolean;
  previousClosed: boolean;
  /** Último fechamento do mês na rede (não é data de congelamento). */
  closedAt: string | null;
  kpis: KpiResult[];
  insights: Insight[];
  stores: StoreSummary | null;
  products: ProductsSummary | null;
  /** Vendas do mês (e do anterior) que parecem importadas pela metade em alguma loja. */
  salesCoverage: { current: SalesCoverage | null; previous: SalesCoverage | null };
  /** null = abastecimento indisponível; rows vazio = nenhum candidato com as regras atuais. */
  tests: TestsSummary | null;
  /** SKUs sem histórico/em teste com nome parecido a um SKU antigo — aguardam confirmação. */
  skuSuggestions: SkuSuggestion[];
  loss: LossSummary | null;
  cash: CashSummary;
  cashUses: CashUses | null;
  capex: CapexSummary | null;
  investors: InvestorsSummary | null;
  reading: string;
  /** O que a Fase 1 NÃO consegue entregar, sempre listado. */
  limitations: string[];
}

export type { Comparison };
