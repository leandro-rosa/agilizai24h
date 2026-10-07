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
  voucherShare: number;
  voucherBasis: "sales_weighted" | "simple_average" | "none";
  operatingShare: number;
  /** "Rateio operacional utilizado exclusivamente para análise de preço…" */
  statement: string;
}

export interface Reason {
  code: string;
  text: string;
}

export interface PricingProduct {
  sku: string;
  name: string | null;
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
  operating: { share: number; months: string[]; accounts: { code: string; label: string; amountCents: number }[] } | null;
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
    getProductHistory: builder.query<ProductHistory, { sku: string; period: string }>({
      query: ({ sku, period }) => `/pricing/products/${encodeURIComponent(sku)}/history?period=${period}`,
    }),
    getProductStores: builder.query<ProductStores, { sku: string; period: string }>({
      query: ({ sku, period }) => `/pricing/products/${encodeURIComponent(sku)}/stores?period=${period}`,
    }),
    simulatePrice: builder.mutation<Simulation, ScopeArgs & { sku: string; priceCents: number }>({
      query: ({ sku, priceCents, period, storeId }) => ({
        url: `/pricing/products/${encodeURIComponent(sku)}/simulate`,
        method: "POST",
        body: { priceCents, period, storeId },
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
    chooseNewProductPrice: builder.mutation<
      unknown,
      { sku: string; idempotencyKey: string; choice: NewProductChoiceKind; chosenPriceCents?: number; reason?: string; costCents?: number; costOrigin?: string; costNotReceived?: boolean }
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
  useGetProductHistoryQuery,
  useGetProductStoresQuery,
  useSimulatePriceMutation,
  useGetPricingDecisionsQuery,
  useApplyPriceMutation,
  useGetNewProductSuggestionQuery,
  useChooseNewProductPriceMutation,
  useGetPricingParametersQuery,
  useGetPricingParameterVersionsQuery,
  useGetPricingParameterVersionQuery,
  useCreatePricingParametersMutation,
} = pricingApi;
