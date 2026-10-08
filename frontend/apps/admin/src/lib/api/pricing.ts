import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

/*
 * Espelha o contrato de `intelligence-service` (`modules/pricing`). A tela só formata, ordena e filtra: tudo que
 * decide uma recomendação, uma simulação ou um marcador de histórico vem pronto do backend.
 */
export type PricingStatus = "healthy" | "adjust" | "opportunity" | "review" | "insufficient_data";
export type Confidence = "high" | "medium" | "low" | "insufficient_data";
export type PaymentMethod = "pix" | "debit" | "credit" | "voucher";

export interface CostStructure {
  productCostCents: number;
  /** Custo por unidade vendida depois de carregar as unidades perdidas. */
  lossAdjustedCostCents: number;
  taxRate: number;
  lossRate: number;
  lossLevel: "product" | "category" | "store" | "network";
  paymentRate: number;
  /** Taxas fixas por unidade vendida, em centavos (ex.: Ticket R$ 0,89 por venda). */
  paymentFixedCents: number;
  /** Como a taxa fixa por unidade foi montada: tickets observados ou contados um por linha (aproximação); o total é sempre estimado. Ausente antes do `pricing-4`. */
  paymentFixed?: { basis: string; note: string };
  voucherShare: number;
  voucherBasis: "sales_weighted" | "simple_average" | "none";
  /** Despesas que acompanham o valor da venda (percentual da venda), como fração do preço. Custo fixo e deslocamento não entram aqui. */
  operatingShare: number;
  /** Custo por transação por unidade vendida, em centavos (valor, não percentual). Ausente em relatório guardado antes do `pricing-4`. */
  perTransactionCents?: number;
  /** "Rateio operacional utilizado exclusivamente para análise de preço…" */
  statement: string;
}

export type CostBasis = "received_purchase" | "registry_or_manual";

export interface CostBases {
  historical: { costCents: number; effectiveFrom: string; source: string | null; basis: CostBasis } | null;
  lastPurchase: { costCents: number; effectiveFrom: string; invoiceNumber: string | null } | null;
  registry: { costCents: number; effectiveFrom: string; source: string } | null;
}

export type OperatingClass = "percent_of_sales" | "per_transaction" | "per_visit" | "fixed" | "other_revenue_cost" | "already_component";

export interface OperatingAccount {
  code: string;
  label: string;
  amountCents: number;
}

export interface TravelMonth {
  period: string;
  costCents: number | null;
  visits: number | null;
  perVisitCents: number | null;
  status: "used" | "no_cost" | "no_visits" | "zero_visits";
}

/** O custo médio estimado por abastecimento (gasto de deslocamento ÷ abastecimentos do mesmo mês): média, nunca o custo real de uma rota. */
export interface TravelEstimate {
  scope: string;
  unit: string;
  perVisitCents: number | null;
  usedCostCents: number;
  usedVisits: number;
  months: TravelMonth[];
  excludedMonths: { period: string; reason: string }[];
  /** Rateio estimado por loja (média × abastecimentos da loja); só na rede e só com contagem real por loja. */
  stores: { storeId: number; visits: number; estimatedCents: number }[];
  limitations: string[];
}

export interface OperatingReport {
  scope: string;
  months: string[];
  revenueCents: number;
  complete: boolean;
  unclassified: OperatingAccount[];
  unclassifiedCents: number;
  unclassifiedShare: number;
  classes: Record<OperatingClass, { costCents: number; share: number; accounts: OperatingAccount[] }>;
  percentOfSalesShare: number;
  perTransaction: { perUnitCents: number; assumption: string; basis?: string; approximated?: boolean } | null;
  /** Nulo quando o serviço de abastecimento não pôde ser lido (e nos relatórios antigos). */
  travel?: TravelEstimate | null;
  legacy: { share: number; costCents: number; accounts: OperatingAccount[] };
}

export interface Reason {
  code: string;
  text: string;
}

export interface PricingProduct {
  sku: string;
  name: string | null;
  /** Um custo registrado DEPOIS do fim do período analisado: aparece ao lado, nunca como o custo do período. */
  newerCost?: { costCents: number; effectiveFrom: string; source: string; basis?: CostBasis } | null;
  /** As bases de custo, separadas: o custo histórico do diagnóstico, a última compra recebida (com ou sem NF) e o custo cadastral ou manual em vigor hoje. */
  costBases?: CostBases;
  /** O diagnóstico refeito ao custo da última compra recebida ("sugestão atual"), quando esse custo difere do do período. */
  atLastPurchaseCost?: { basis: CostBasis; costCents: number; effectiveFrom: string; targetPriceCents: number | null; marginAtCurrentPrice: number | null } | null;
  /** Contribuição por unidade, em centavos, ao preço atual. */
  unitContributionCents?: number | null;
  /** Contribuição menos deslocamento e custos fixos rateados: complementar, com o critério à vista; nunca "lucro líquido". */
  estimatedResultAfterAllocation?: { centsPerUnit: number; margin: number; criterion: string } | null;
  /** Falso quando há despesa relevante sem classificação: o número aparece, mas nunca como validado. */
  validated?: boolean;
  validationNotes?: string[];
  /** Por que a margem difere da que o modelo anterior (pricing-3) mostrava, linha a linha. */
  reconciliation?: { oldMargin: number; newMargin: number; lines: { label: string; points: number }[]; unexplainedPoints: number } | null;
  /** De onde vem o custo em vigor, como o cadastro de produtos diz: a origem, o dia em que passou a valer e, se foi uma nota, o número. */
  costOrigin?: { source: string; effectiveFrom: string; invoiceNumber: string | null } | null;
  /** Cadastrado a partir de uma nota dentro da janela analisada ("Produto novo"); `noSalesHistory` quando ainda não vendeu nela. */
  newProduct?: { registeredOn: string; noSalesHistory: boolean } | null;
  ean: string | null;
  supplierId: number | null;
  supplierName: string | null;
  /** Chave do catálogo (`beverage`…) e rótulo em português. */
  category: string | null;
  categoryLabel: string;
  subcategory: string | null;
  status: PricingStatus;
  confidence: Confidence;
  minimumPriceCents: number | null;
  targetPriceCents: number | null;
  recommendedPriceCents: number | null;
  currentPriceCents: number | null;
  currentMargin: number | null;
  currentMarkup: number | null;
  targetMargin: number;
  minimumMargin: number;
  marginFromCategory: boolean;
  structure: CostStructure | null;
  costVariation: number | null;
  marginAtPreviousCost: number | null;
  marginChangeFromCost: number | null;
  monthlyUnits: number;
  monthlyRevenueCents: number | null;
  monthlyMarginCents: number | null;
  impactCentsPerMonth: number | null;
  impactLabel: "Impacto potencial estimado";
  recommendedMargin: number | null;
  reasons: Reason[];
  insufficientReasons: string[];
  engineVersion: string;
}

export interface PendingGroup {
  code: "no_cost" | "stale_cost" | "unreliable_cost" | "no_price" | "no_tax" | "no_payment_or_loss" | "other";
  label: string;
  skus: string[];
}

export interface PricingSummary {
  analysed: number;
  averageMargin: number | null;
  targetMargin: number;
  withinTarget: number;
  belowTarget: number;
  opportunities: number;
  insufficientData: number;
  review: number;
  potentialImpactCentsPerMonth: number;
  impactLabel: "Impacto potencial estimado";
  /** Quantos produtos a análise cobre. Relatórios guardados antes desta versão não trazem. */
  coverage?: { total: number; analysable: number; withoutEnoughData: number };
  /** Por que os outros produtos ficaram sem análise; um produto pode ter mais de um motivo. */
  pending?: PendingGroup[];
  shares: { withinTarget: number; belowTarget: number; opportunities: number; insufficientData: number };
}

export interface CategorySummary {
  /** Rótulo em português; `categoryKey` é a chave do catálogo (vazia = sem categoria). */
  category: string;
  categoryKey: string;
  averageMargin: number | null;
  targetMargin: number;
  difference: number | null;
  revenueCents: number;
  revenueShare: number;
  products: number;
}

export interface PricingReportMeta {
  engineVersion: string;
  parameterVersion: number;
  months: string[];
  asOf: string;
  storeId: number | null;
  payment: {
    rate: number;
    voucherShare: number;
    voucherBasis: string;
    unresolvedShare: number;
    complete: boolean;
    notes: string[];
    components: { method: PaymentMethod; share: number; rateBps: number }[];
  } | null;
  paymentMixMonthsWithoutTransactions: string[];
  /** Relatórios guardados antes do `pricing-4` trazem só `{ share, months, accounts }`. */
  operating: OperatingReport | { share: number; months: string[]; accounts: OperatingAccount[] } | null;
  /** Falso quando há despesa relevante sem classe: nada do relatório está validado. */
  validated?: boolean;
  notes: string[];
}

export interface PricingReport {
  meta: PricingReportMeta;
  summary: PricingSummary;
  categories: CategorySummary[];
  products: PricingProduct[];
}

export interface PricingRunView {
  id: string;
  period: string;
  storeId: number | null;
  status: "queued" | "running" | "completed" | "failed";
  engineVersion: string;
  parameterVersion: number;
  computedAt: string | null;
  createdAt: string;
  error: string | null;
}

export interface LatestPricingReport {
  scope: { period: string; storeId: number | null };
  /** `none` = este escopo nunca terminou uma execução; nunca é um relatório vazio. */
  state: "none" | "ready";
  run: PricingRunView | null;
  report: PricingReport | null;
  inProgress: PricingRunView | null;
  lastFailure: PricingRunView | null;
  currentParameterVersion: number;
  /** Os parâmetros mudaram depois do cálculo: os números são das regras antigas. */
  parametersStale: boolean;
}

export interface HistoryRow {
  month: string;
  costCents: number | null;
  priceCents: number | null;
  /** Margem do produto (preço − custo) / preço — não a margem econômica do motor. */
  margin: number | null;
  markup: number | null;
  costRose: boolean;
  priceChanged: boolean;
  marginFell: boolean;
  marginImproved: boolean;
}

export interface ProductHistory {
  sku: string;
  marginKind: "product_margin";
  rows: HistoryRow[];
}

export interface StoreRow {
  storeId: number;
  storeName: string;
  unitsSold: number;
  revenueCents: number;
  lostUnits: number;
  restockedUnits: number;
  lossRate: number | null;
  estimatedMargin: number | null;
}

export interface ProductStores {
  sku: string;
  period: string;
  note: string;
  stores: StoreRow[];
  missingStores: { storeId: number; storeName: string }[];
}

export type Simulation =
  | {
      simulable: true;
      priceCents: number;
      margin: number;
      markup: number;
      unitProfitCents: number;
      currentPriceCents: number;
      currentMargin: number;
      monthlyImpactCents: number;
      differenceToTarget: number;
      targetMargin: number;
      impactLabel: "Impacto potencial estimado";
      /** Presente quando a simulação usou uma cotação de reposição digitada no lugar do custo do relatório. */
      replacementCostCents?: number;
      reportRunId: string;
    }
  | { simulable: false; reason: string; reportRunId: string };

export interface DecisionView {
  id: string;
  sku: string;
  previousPriceCents: number | null;
  newPriceCents: number;
  effectiveFrom: string;
  actor: string;
  recommendedPriceCents: number | null;
  confidence: string | null;
  runId: string | null;
  parameterVersion: number | null;
  reason: string | null;
  status: "pending" | "applied" | "failed";
  error: string | null;
  createdAt: string;
}

export interface ApplyPriceResult {
  decision: DecisionView;
  applied: boolean;
  alreadyApplied: boolean;
  warning?: string;
}

export interface PricingParameters {
  margin: { targetBps: number; minimumBps: number; categories: Record<string, { targetBps?: number; minimumBps?: number }> };
  /** `null` até o dono confirmar: sem alíquota o motor não recomenda nada. */
  taxRateBps: number | null;
  rounding: { stepCents: number };
  psychological: { enabled: boolean; endingCents: number };
  guards: { maxIncreaseBps: number; opportunityBandBps: number };
  data: {
    lookbackMonths: number;
    minUnitsPerMonth: number;
    voucherMinReceiptLines: number;
    lossMinUnits: number;
    costMaxAgeDays: number;
    stableCostBps: number;
  };
  /** Como cada conta da DRE se comporta frente ao preço de UM produto; conta sem classe fica fora do preço e o cálculo sai incompleto. */
  operating: { accountBehavior: Record<string, OperatingClass>; unclassifiedRelevantBps: number };
  payment: { brandAliases: Record<string, string> };
  minConfidence: "low" | "medium" | "high";
}

export interface PricingParameterVersion {
  id: number;
  createdAt: string;
  note: string | null;
  values: PricingParameters;
}

export interface PricingParameterVersionSummary {
  id: number;
  createdAt: string;
  note: string | null;
}

export interface ScopeArgs {
  period: string;
  /** `null` = a rede inteira. */
  storeId: number | null;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function scopeQuery({ period, storeId }: ScopeArgs): string {
  const params = new URLSearchParams({ period });
  if (storeId !== null) params.set("storeId", String(storeId));

  return params.toString();
}

/** A sugestão de preço de um produto sem preço e sem vendas. Vem pronta do servidor; a tela só mostra. */
export interface NewProductSuggestion {
  sku: string;
  name: string | null;
  /** "Produto novo — sem histórico de vendas". */
  label: string;
  status: "suggested" | "insufficient_data";
  /** Nunca acima de `low`: sem venda não há como confirmar o preço. */
  confidence: "low" | "insufficient_data";
  minimumPriceCents: number | null;
  suggestedPriceCents: number | null;
  suggestedMargin: number | null;
  /** O custo por unidade vendida em que a sugestão se apoia (centavos). */
  unitCostCents?: number | null;
  /** Sugestão inicial: não há vendas por trás dela. */
  initial?: boolean;
  /** A margem no preço que a pessoa digitou, pela mesma estrutura do motor. */
  typedPrice?: { priceCents: number; margin: number } | null;
  targetMargin: number;
  minimumMargin: number;
  dataUsed: { code: string; label: string; value: string; origin: string }[];
  reasons: string[];
  insufficientReasons: string[];
}

export type NewProductChoiceKind = "suggested_accepted" | "changed_by_hand" | "left_without_price";

export const pricingApi = createApi({
  reducerPath: "pricingApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Report", "Parameters", "Decisions"],
  endpoints: (builder) => ({
    getLatestPricingReport: builder.query<LatestPricingReport, ScopeArgs>({
      query: (scope) => `/pricing/runs/latest?${scopeQuery(scope)}`,
      providesTags: ["Report"],
    }),
    startPricingRun: builder.mutation<{ started: boolean; run: PricingRunView }, ScopeArgs>({
      query: ({ period, storeId }) => ({ url: "/pricing/runs", method: "POST", body: { period, storeId } }),
      invalidatesTags: ["Report"],
    }),
    /** Os cálculos concluídos do escopo, do mais novo ao mais antigo, cada um com a versão do motor e das regras. Recalcular nunca apaga um anterior. */
    getPricingRunHistory: builder.query<PricingRunView[], ScopeArgs>({
      query: (scope) => `/pricing/runs?${scopeQuery(scope)}`,
      providesTags: ["Report"],
    }),
    /** Um cálculo anterior, exatamente como foi calculado. */
    getPricingRunReport: builder.query<{ run: PricingRunView; report: PricingReport }, string>({
      query: (id) => `/pricing/runs/${encodeURIComponent(id)}/report`,
    }),
    getProductHistory: builder.query<ProductHistory, { sku: string; period: string }>({
      query: ({ sku, period }) => `/pricing/products/${encodeURIComponent(sku)}/history?period=${period}`,
    }),
    getProductStores: builder.query<ProductStores, { sku: string; period: string }>({
      query: ({ sku, period }) => `/pricing/products/${encodeURIComponent(sku)}/stores?period=${period}`,
    }),
    simulatePrice: builder.mutation<Simulation, ScopeArgs & { sku: string; priceCents: number; /** Cotação de reposição digitada: só para simular, nunca tomada como compra. */ replacementCostCents?: number | null }>({
      query: ({ sku, priceCents, replacementCostCents, period, storeId }) => ({
        url: `/pricing/products/${encodeURIComponent(sku)}/simulate`,
        method: "POST",
        body: { priceCents, ...(replacementCostCents ? { replacementCostCents } : {}), period, storeId },
      }),
    }),
    getPricingDecisions: builder.query<DecisionView[], { sku?: string; limit?: number } | void>({
      query: (args) => {
        const params = new URLSearchParams();
        if (args?.sku) params.set("sku", args.sku);
        if (args?.limit) params.set("limit", String(args.limit));
        const search = params.toString();

        return `/pricing/decisions${search ? `?${search}` : ""}`;
      },
      providesTags: ["Decisions"],
    }),
    applyPrice: builder.mutation<
      ApplyPriceResult,
      { idempotencyKey: string; sku: string; newPriceCents: number; reason?: string; runId?: string; effectiveFrom?: string }
    >({
      query: (body) => ({ url: "/pricing/decisions/apply", method: "POST", body }),
      invalidatesTags: ["Decisions"],
    }),
    getNewProductSuggestion: builder.query<{ meta: { parameterVersion: number; asOf: string }; suggestion: NewProductSuggestion }, { sku: string; costCents?: number; costOrigin?: string; costNotReceived?: boolean }>({
      query: ({ sku, costCents, costOrigin, costNotReceived }) => {
        const params = new URLSearchParams();
        if (costCents) params.set("costCents", String(costCents));
        if (costOrigin) params.set("costOrigin", costOrigin);
        if (costNotReceived) params.set("costNotReceived", "true");
        const search = params.toString();

        return `/pricing/new-product/${encodeURIComponent(sku)}${search ? `?${search}` : ""}`;
      },
      keepUnusedDataFor: 0,
    }),
    /** Sugestão para um produto que ainda não existe (o formulário de produto novo), pelo mesmo motor. Lista o que falta em vez de um preço. */
    draftSuggestion: builder.mutation<{ meta: { parameterVersion: number; asOf: string }; suggestion: NewProductSuggestion }, { category: string | null; unitCostCents: number | null; typedPriceCents?: number | null; name?: string }>({
      query: (body) => ({ url: "/pricing/draft-suggestion", method: "POST", body }),
    }),
    chooseNewProductPrice: builder.mutation<
      unknown,
      { sku: string; idempotencyKey: string; choice: NewProductChoiceKind; chosenPriceCents?: number; reason?: string; costCents?: number; costOrigin?: string; costNotReceived?: boolean; effectiveFrom?: string }
    >({
      query: ({ sku, ...body }) => ({ url: `/pricing/new-product/${encodeURIComponent(sku)}/choice`, method: "POST", body }),
      invalidatesTags: ["Decisions", "Report"],
    }),
    getPricingParameters: builder.query<PricingParameterVersion, void>({
      query: () => "/pricing/parameters/current",
      providesTags: ["Parameters"],
    }),
    getPricingParameterVersions: builder.query<PricingParameterVersionSummary[], void>({
      query: () => "/pricing/parameters/versions",
      providesTags: ["Parameters"],
    }),
    getPricingParameterVersion: builder.query<PricingParameterVersion, number>({
      query: (id) => `/pricing/parameters/versions/${id}`,
    }),
    createPricingParameters: builder.mutation<PricingParameterVersion, { values: DeepPartial<PricingParameters>; note?: string }>({
      query: (body) => ({ url: "/pricing/parameters", method: "POST", body }),
      invalidatesTags: ["Parameters"],
    }),
  }),
});

export const {
  useGetLatestPricingReportQuery,
  useStartPricingRunMutation,
  useGetPricingRunHistoryQuery,
  useGetPricingRunReportQuery,
  useGetProductHistoryQuery,
  useGetProductStoresQuery,
  useSimulatePriceMutation,
  useGetPricingDecisionsQuery,
  useApplyPriceMutation,
  useGetNewProductSuggestionQuery,
  useChooseNewProductPriceMutation,
  useDraftSuggestionMutation,
  useGetPricingParametersQuery,
  useGetPricingParameterVersionsQuery,
  useGetPricingParameterVersionQuery,
  useCreatePricingParametersMutation,
} = pricingApi;
