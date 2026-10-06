import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

/*
 * Espelha o contrato de `intelligence-service` (`modules/analysis/analysis.types.ts`).
 * Uma cifra nunca é um número solto: ou está disponível, ou diz POR QUE não está
 * — assim nada que falta é desenhado como 0.
 */
export type UnavailableReason = "no_purchase_history" | "never_ingested" | "no_cost" | "no_base";

export type Figure =
  | { available: true; value: number; partial?: boolean }
  | { available: false; reason: UnavailableReason };

export type CompareTo = "prev_month" | "avg_3m";
export type SituationLabel = "good" | "attention" | "critical";
export type InsightLabel = "FATO" | "MÉTRICA DERIVADA" | "ESTIMATIVA";

export interface Movement {
  purchasedUnits: Figure;
  purchasedCents: Figure;
  restocked: Figure;
  sold: Figure;
  lost: Figure;
  revenueCents: Figure;
  lossCents: Figure;
  marginShare: Figure;
  avgCostCents: Figure;
}

export interface Variation {
  reference: Figure;
  change: Figure;
}

export type Comparison = Record<keyof Movement, Variation>;

export interface MovementWithComparison {
  current: Movement;
  comparison: Comparison;
}

export interface Insight {
  kind: string;
  label: InsightLabel;
  tone: "positive" | "attention" | "critical" | "info";
  text: string;
  evidence: { figures: Record<string, number>; formula?: string; reference?: string };
}

export interface StoreRow {
  storeId: number;
  storeName: string | null;
  restocked: number;
  sold: number;
  lost: number;
  sellThrough: number | null;
  situation: SituationLabel | null;
  situationReason?: "below_min_restocked";
}

export interface MonthlyPoint {
  month: string;
  purchasedUnits: Figure;
  restocked: Figure;
  sold: Figure;
  lost: Figure;
}

export interface AnalysisMeta {
  period: string;
  compareTo: CompareTo;
  parameterVersion: number;
  dataQuality: {
    monthsWithGaps: { month: string; storesMissingSupply: number; storesMissingSales: number }[];
    purchaseBaseFrom: string | null;
  };
}

export interface ProductLine {
  sku: string;
  name: string;
  supplierId: number | null;
  movement: Movement;
  comparison: Comparison;
}

export interface SupplierAnalysis {
  meta: AnalysisMeta;
  supplierId: number;
  totals: MovementWithComparison;
  products: ProductLine[];
  evolution: MonthlyPoint[];
  insights: Insight[];
}

export interface ProductAnalysis {
  meta: AnalysisMeta;
  product: { sku: string; name: string; supplierId: number | null };
  totals: MovementWithComparison;
  stores: StoreRow[];
  evolution: MonthlyPoint[];
  insights: Insight[];
}

export interface CrossAnalysis {
  meta: AnalysisMeta;
  supplierId: number;
  product: { sku: string; name: string; declaredSupplierId: number | null };
  linked: boolean;
  totals: MovementWithComparison | null;
  suppliers: { supplierId: number; movement: Movement }[];
  suppliersUnavailableReason: UnavailableReason | null;
}

export interface AnalysisArgs {
  period: string;
  compareTo: CompareTo;
  /** Restringe os números a uma loja. Compras são da rede e ficam como "—" quando há loja. */
  storeId?: number;
}

export const supplierAnalysisApi = createApi({
  reducerPath: "supplierAnalysisApi",
  baseQuery: gatewayBaseQuery,
  // Vincular um produto a um fornecedor muda a atribuição: o painel invalida estas tags.
  tagTypes: ["Analysis"],
  endpoints: (builder) => ({
    getSupplierAnalysis: builder.query<SupplierAnalysis, AnalysisArgs & { supplierId: number }>({
      query: ({ supplierId, period, compareTo, storeId }) =>
        `/analysis/suppliers/${supplierId}?period=${period}&compareTo=${compareTo}${storeId ? `&storeId=${storeId}` : ""}`,
      providesTags: ["Analysis"],
    }),
    getProductAnalysis: builder.query<ProductAnalysis, AnalysisArgs & { sku: string }>({
      query: ({ sku, period, compareTo, storeId }) =>
        `/analysis/products/${encodeURIComponent(sku)}?period=${period}&compareTo=${compareTo}${storeId ? `&storeId=${storeId}` : ""}`,
      providesTags: ["Analysis"],
    }),
    getCrossAnalysis: builder.query<CrossAnalysis, AnalysisArgs & { supplierId: number; sku: string }>({
      query: ({ supplierId, sku, period, compareTo }) =>
        `/analysis/cross?supplierId=${supplierId}&sku=${encodeURIComponent(sku)}&period=${period}&compareTo=${compareTo}`,
      providesTags: ["Analysis"],
    }),
  }),
});

export const { useGetSupplierAnalysisQuery, useGetProductAnalysisQuery, useGetCrossAnalysisQuery } = supplierAnalysisApi;
