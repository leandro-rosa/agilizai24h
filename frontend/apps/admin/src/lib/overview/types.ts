/**
 * Entrada e saída do motor do Resumo Mensal. A entrada é o dado JÁ buscado
 * (cada seção `null` = indisponível, nunca zero); a saída é o objeto único
 * que a tela e o PDF renderizam — mesmos números nos dois.
 */
import type { Comparison, RateDelta, ValueDelta } from "./compare";
import type { Distribution, ProductBehavior } from "./product-behavior";
import type { SalesCoverage } from "./sales-coverage";
import type { CatalogueItem, LinkDecision, SkuSuggestion } from "./sku-match";
import type { OpenInvoice, OverdueDetail } from "./overdue";
import type { PriceChanges } from "./price-volume";
import type { TicketMonth } from "./ticket";
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
  /** Saídas de natureza "investimento" — o CAPEX como o Fluxo de caixa classifica (inclui o cartão de sócios). */
  investmentCents: number;
  investmentByCategory: { category: string; cents: number }[];
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
  /** Compras (ticket médio) do mês e do anterior, das transações; null = não carregadas. */
  tickets?: { current: TicketMonth; previous: TicketMonth } | null;
  /** Catálogo (sku + nome) e decisões de troca de código já tomadas pelo operador. */
  catalogue: CatalogueItem[];
  skuLinks: LinkDecision[];
  /** Abastecimento por loja × mês × SKU (9 meses até a competência); base de "produtos em teste". */
  supply: { cells: SupplyCell[]; ingestedPeriods: string[] } | null;
  aging: { referenceDate: string; overdueCents: number; notDueCents: number; openCents: number; openInvoices?: OpenInvoice[] } | null;
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
  /** Tela especializada onde o leitor aprofunda. */
  href?: string;
  /** Relevância 0..1 (impacto financeiro, representatividade, recorrência, lojas afetadas) — NÃO é o tamanho do %. */
  score: number;
}

export type StoreMovement = "up" | "down" | "stable";

export interface StoreContribution {
  storeId: number;
  name: string;
  deltaCents: number;
  deltaPct: number | null;
  /** Base: mês anterior → mês atual, na base do resumo (vendas). */
  previousCents: number;
  currentCents: number;
}

/** Quais lojas explicam a maior parte do movimento (crescimento ou queda) da rede. */
export interface StoreExplainers {
  /** Soma dos movimentos de todas as lojas nessa direção (centavos, positivo). */
  totalCents: number;
  /** Lojas que juntas passam de ~60% do total (no máximo 5), da maior para a menor. */
  stores: (StoreContribution & { share: number })[];
  /** Parcela do total explicada pelas lojas listadas (0..1). */
  coveredShare: number;
  /** Quantas lojas se moveram nessa direção. */
  storeCount: number;
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
  growthExplainers: StoreExplainers;
  declineExplainers: StoreExplainers;
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
  revenuePreviousCents: number | null;
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
  /** O que de fato mudou nas perdas vs. o mês anterior (fatos, com base). */
  changes: LossChanges | null;
}

export interface LossChange {
  label: string;
  previousCents: number;
  currentCents: number;
  deltaCents: number;
}

export interface LossChanges {
  totalPreviousCents: number;
  totalCurrentCents: number;
  /** Motivos que mais mudaram (por |Δ R$|). */
  byReason: LossChange[];
  /** SKUs que mais mudaram (por |Δ R$|). */
  bySku: LossChange[];
  /** SKUs diferentes que explicam a queda/alta (≥ 1) — concentração da variação. */
  skusExplainingShare: { count: number; share: number } | null;
}

export interface CashUseLine {
  key: string;
  label: string;
  currentCents: number;
  previousCents: number | null;
  avg3Cents: number | null;
  deltaCents: number | null;
  deltaPct: number | null;
  /** Variação material vs. o mês anterior (e vs. a média 3m, quando existe). */
  material: boolean;
  /** Fatia desta saída no total de despesas do mês (0..1). */
  shareOfOutflow: number | null;
  /** Por que foi selecionada: variação relevante e/ou maior saída do mês. */
  reasons: ("variacao" | "peso")[];
  /** Relevância 0..1 (impacto, peso, recorrência) — define a seleção e a ordem. */
  score: number;
}

export interface CashUses {
  /** Até 5 movimentos materialmente relevantes do mês, escolhidos pelos dados (não por categoria fixa). */
  lines: CashUseLine[];
  /** Total de despesas classificadas do mês (base das fatias). */
  totalOutflowCents: number;
  /** Fato: compras de estoque × receita, só quando compras de estoque foram selecionadas. Observação, não causa. */
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
  /** Notas vencidas por cliente e dias de atraso; null = nenhuma vencida (ou sem notas em aberto para detalhar). */
  overdueDetail: OverdueDetail | null;
  /** Fato composto: resultado operacional positivo com caixa em queda. */
  operatingPositiveCashFell: boolean;
  cashDeltaCents: number | null;
}

export interface InvestmentOutflow {
  totalCents: number;
  previousCents: number | null;
  deltaPct: number | null;
  top: { category: string; cents: number }[];
  /** Parte paga no cartão de sócios (categoria "Investimento (cartão sócio)"). */
  partnerCardCents: number;
}

export interface CapexSummary {
  /** CAPEX pela classificação do Fluxo de caixa (tesouraria, natureza investimento) — a leitura principal. */
  investment: InvestmentOutflow | null;
  /** Itens de CAPEX com loja atribuída (capex-service) — informação complementar. */
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

export interface Highlight {
  title: string;
  detail: string;
  /** Para onde levar o leitor ("Ver análise completa"). */
  href: string;
}

/** "Destaques do mês": produto destaque, maior crescimento e maior ponto de atenção. */
export interface Highlights {
  product: Highlight | null;
  growth: Highlight | null;
  attention: Highlight | null;
}

export interface WatchItem {
  id: string;
  title: string;
  /** Observação com os fatos que a sustentam — nunca uma causa. */
  observation: string;
  href: string;
  score: number;
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
  highlights: Highlights;
  /** No máximo 5, derivados só dos dados. */
  watchlist: WatchItem[];
  stores: StoreSummary | null;
  products: ProductsSummary | null;
  /** Reajustes de preço do mês (produto a produto); null = sem reajuste relevante ou sem vendas dos dois meses. */
  priceChanges: PriceChanges | null;
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
