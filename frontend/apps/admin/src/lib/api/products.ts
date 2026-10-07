import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

export interface Product {
  id: number;
  sku: string;
  name: string;
  /** A chave de uma categoria do cadastro de categorias (as quatro iniciais e as que forem criadas). */
  category: string;
  /** Verdadeiro quando uma pessoa salvou a classificação por um formulário: importação e nota não a mudam. */
  classification_confirmed?: boolean;
  /** Campos das abas de produto da planilha — todos opcionais no serviço. */
  subcategory?: string | null;
  ean?: string | null;
  supplier_id?: number | null;
  net_weight?: string | null;
  ncm?: string | null;
  cest?: string | null;
  shelf_life_days?: number | null;
  status?: string;
  /** Unidades por embalagem de compra (ex.: caixa de 24) — sempre presentes na resposta, null quando não cadastrado. */
  units_per_package: number | null;
  package_type: string | null;
  fractionable: boolean | null;
  sale_unit?: string;
  brand?: string | null;
  /** A unidade em que o fornecedor vende ("CX", "FD", "UN"). O fator caixa → unidade é `units_per_package`; o custo é sempre por unidade vendida. */
  purchase_unit?: string | null;
  /** Todos os EAN que o produto já teve (nunca apagados), com situação e validade. */
  eans?: ProductEan[];
  /** Como nasceu o cadastro; para `invoice`, a evidência (nota, fornecedor, dia, usuário). */
  origin?: { type: "manual" | "invoice" | "excel" | "legacy_import"; invoice_number: string | null; supplier_id: number | null; purchase_id: number | null; on: string | null; actor: string | null };
}

export interface ProductEan {
  id: number;
  ean: string;
  status: "active" | "inactive";
  is_primary: boolean;
  valid_from: string | null;
  valid_to: string | null;
  source: string;
  actor: string | null;
  note: string | null;
}

/** O que a tela manda ao cadastrar um produto a partir de uma linha de NF-e. Origem e usuário são do servidor, nunca daqui. */
export interface NewProductFromInvoice {
  sku: string;
  name: string;
  category: string;
  subcategory?: string;
  classificationConfirmed?: boolean;
  saleUnit?: string;
  brand?: string;
  purchaseUnit?: string;
  packageType?: string;
  unitsPerPackage?: number;
  fractionable?: boolean;
  ean?: string;
  supplierId: number;
  invoiceNumber: string;
  originOn: string;
}

/** Uma versão de custo, como o histórico a devolve: nunca apagada, com a origem e o fim da vigência derivados da próxima versão. */
export interface CostVersionView {
  id: number;
  effective_from: string;
  cost_cents: number;
  /** Último dia em que vale; nulo quando é a vigente ou quando foi substituída por outra da mesma data. */
  valid_to: string | null;
  /** Outra versão da mesma data prevaleceu: esta nunca valeu, mas fica no histórico. */
  superseded: boolean;
  source: VersionSource;
  actor: string | null;
  reason: string | null;
  supplier_id: number | null;
  purchase_id: number | null;
  invoice_number: string | null;
  purchase_quantity: number | null;
  purchase_total_cents: number | null;
  pack_quantity: number | null;
  units_per_pack: number | null;
  created_at: string;
}

export interface PriceVersionView {
  id: number;
  effective_from: string;
  price_cents: number;
  valid_to: string | null;
  superseded: boolean;
  source: VersionSource;
  actor: string | null;
  reason: string | null;
  /** Para um preço vindo da Precificação Inteligente, o id da decisão. */
  source_ref: string | null;
  created_at: string;
}

export type VersionSource = "manual" | "invoice" | "pricing_intelligence" | "catalogue_sync" | "legacy_import" | "other";

export interface TimelineEvent {
  kind: "cost" | "price";
  date: string;
  value_cents: number;
  /** O que valia na véspera; nulo na primeira versão (nada é afirmado antes dela). */
  previous_value_cents: number | null;
  source: VersionSource;
  actor: string | null;
  reason: string | null;
  superseded: boolean;
  recorded_at: string;
  supplier_id?: number | null;
  purchase_id?: number | null;
  invoice_number?: string | null;
  purchase_quantity?: number | null;
  purchase_total_cents?: number | null;
  source_ref?: string | null;
}

export interface MarginInterval {
  from: string;
  to: string | null;
  price_cents: number | null;
  cost_cents: number | null;
  /** `(preço − custo) / preço`; nulo quando falta um dos lados, nunca zero. */
  margin: number | null;
  markup: number | null;
  price_source: VersionSource | null;
  cost_source: VersionSource | null;
  cost_invoice_number: string | null;
  cost_supplier_id: number | null;
  price_reason: string | null;
}

/** Categorias e subcategorias gerenciadas: a lista única de todos os formulários, filtros e importações. */
export interface SubcategoryRow {
  id: number;
  category_id: number;
  name: string;
  keywords: string[];
  status: "active" | "inactive";
  /** Produtos que usam esta subcategoria. */
  products: number;
}

export interface CategoryRow {
  id: number;
  key: string;
  name: string;
  keywords: string[];
  status: "active" | "inactive";
  products: number;
  subcategories: SubcategoryRow[];
}

export interface ClassificationCandidate {
  categoryKey: string;
  categoryName: string;
  subcategory: string | null;
  matched: string[];
  score: number;
}

/** `clear` = um vencedor; `ambiguous` = empate (nenhum é escolhido); `none` = nada casou. */
export interface ClassificationResult {
  confidence: "clear" | "ambiguous" | "none";
  best: ClassificationCandidate | null;
  alternatives: ClassificationCandidate[];
}

export interface ClassificationReviewItem {
  sku: string;
  name: string;
  current: { category: string; subcategory: string | null; confirmed: boolean };
  proposed: { category: string; categoryName: string; subcategory: string | null };
  matched: string[];
}

/** Uma linha da planilha já mapeada pelo operador. Célula vazia = não informado. */
export interface ImportRow {
  row: number;
  sku?: string | null;
  name?: string | null;
  category?: string | null;
  subcategory?: string | null;
  brand?: string | null;
  ean?: string | null;
  saleUnit?: string | null;
  purchaseUnit?: string | null;
  packageType?: string | null;
  unitsPerPackage?: string | number | null;
}

export interface ImportRowResult {
  row: number;
  sku: string | null;
  action: "create" | "update" | "unchanged" | "conflict";
  changes: { field: string; from: string | number | null; to: string | number | null }[];
  /** Campos que o produto existente perderia porque a célula está vazia e a limpeza foi pedida. */
  clears: string[];
  addEan: string | null;
  problems: string[];
  /** O que a importação NÃO fez e por quê (ex.: manteve uma classificação confirmada); não é conflito. */
  notes?: string[];
  /** De onde veio a categoria: dada pela linha ou sugerida pelo nome. */
  classification?: "given" | "suggested" | null;
}

export interface ImportPreview {
  summary: { create: number; update: number; unchanged: number; conflict: number };
  rows: ImportRowResult[];
}

export interface ImportApplied extends ImportPreview {
  results: { row: number; sku: string | null; action: string; ok: boolean; error?: string }[];
}

export interface NextSku {
  /** O número depois do maior SKU de seis dígitos; uma SUGESTÃO (nada é reservado). Nulo quando não há de onde contar. */
  suggested: string | null;
  highest: string | null;
  suggestion: true;
}

export interface ResolvedCost {
  sku: string;
  product_id: number;
  cost_cents: number;
  effective_from: string;
}

export interface UnresolvedCost {
  sku: string;
  reason: string;
}

export interface BulkCostResult {
  as_of: string;
  resolved: ResolvedCost[];
  unresolved: UnresolvedCost[];
  complete: boolean;
}

/** Decisão do operador sobre um par de SKUs: o novo é o mesmo produto do antigo com outro código de barras, ou não. */
export interface SkuLink {
  id: number;
  old_sku: string;
  new_sku: string;
  decision: "same" | "different";
  decided_at: string;
}

export interface SyncIssue {
  severity: "blocked" | "warning";
  code: string;
  sku: string | null;
  row: number;
  message: string;
}
export interface SyncCreate {
  sku: string;
  name: string;
  category: string;
  subcategory: string | null;
  ean: string | null;
  supplier: string | null;
  package_type: string | null;
  cost_cents: number | null;
  price_cents: number | null;
  row: number;
}
export interface SyncChange {
  sku: string;
  name: string;
  current_cents: number | null;
  new_cents: number;
  row: number;
}
export interface SyncPlan {
  create: SyncCreate[];
  costs: SyncChange[];
  prices: SyncChange[];
  issues: SyncIssue[];
  unchanged: number;
}
export interface SyncApplyResult {
  sku: string;
  action: "create" | "cost" | "price";
  ok: boolean;
  error?: string;
}

export const productsApi = createApi({
  reducerPath: "productsApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Product", "SkuLink", "ProductHistory", "Taxonomy"],
  endpoints: (builder) => ({
    getProducts: builder.query<Product[], void>({
      query: () => "/products",
      providesTags: ["Product"],
    }),
    /**
     * There is deliberately no "current cost" lookup on the backend — every
     * cost is resolved as of a date (products-service's own design). This
     * mirrors that: the caller states the date, defaulting to today for the
     * catalogue listing.
     */
    previewCatalogueSync: builder.mutation<SyncPlan, { rows: unknown[] }>({
      query: (body) => ({ url: "/catalogue-sync/preview", method: "POST", body }),
    }),
    applyCatalogueSync: builder.mutation<
      SyncApplyResult[],
      { rows: unknown[]; selection: { create: string[]; costs: string[]; prices: string[] }; new_products_from: string; changes_from: string }
    >({
      query: (body) => ({ url: "/catalogue-sync/apply", method: "POST", body }),
      invalidatesTags: ["Product"],
    }),
    getSkuLinks: builder.query<SkuLink[], void>({
      query: () => "/sku-links",
      providesTags: ["SkuLink"],
    }),
    decideSkuLink: builder.mutation<SkuLink, { old_sku: string; new_sku: string; decision: "same" | "different" }>({
      query: (body) => ({ url: "/sku-links", method: "PUT", body }),
      invalidatesTags: ["SkuLink"],
    }),
    deleteSkuLink: builder.mutation<void, number>({
      query: (id) => ({ url: `/sku-links/${id}`, method: "DELETE" }),
      invalidatesTags: ["SkuLink"],
    }),
    getCostsAsOf: builder.query<BulkCostResult, { skus: string[]; asOf: string }>({
      query: ({ skus, asOf }) => ({
        url: "/products/costs/bulk",
        method: "POST",
        body: { skus, as_of: asOf },
      }),
    }),
    getPricesAsOf: builder.query<
      { resolved: { sku: string; price_cents: number; effective_from: string }[]; unresolved: { sku: string; reason: string }[]; complete: boolean },
      { skus: string[]; asOf: string }
    >({
      // Particionado como o custo — um mapa convidaria a tratar preço ausente
      // como zero, o que aqui INFLA a margem em vez de deixar o buraco visível.
      query: ({ skus, asOf }) => ({ url: "/products/prices/bulk", method: "POST", body: { skus, as_of: asOf } }),
    }),
    /** Preço digitado à mão: o gateway força origem "manual" e o usuário da sessão, e exige o motivo. */
    recordPrice: builder.mutation<unknown, { sku: string; effective_from: string; price_cents: number; reason: string }>({
      query: ({ sku, ...body }) => ({ url: `/products/${encodeURIComponent(sku)}/prices`, method: "POST", body }),
      invalidatesTags: ["Product", "ProductHistory"],
    }),
    createProduct: builder.mutation<
      Product,
      { sku: string; name: string; category: string; ean?: string; supplierId?: number; subcategory?: string; classificationConfirmed?: boolean; brand?: string; saleUnit?: string; purchaseUnit?: string; packageType?: string; unitsPerPackage?: number; fractionable?: boolean }
    >({
      query: (body) => ({ url: "/products", method: "POST", body }),
      invalidatesTags: ["Product"],
    }),
    /** Custo digitado à mão (não existe "custo atual": todo custo vale a partir de uma data). Origem "manual", usuário da sessão e motivo obrigatório. */
    recordCost: builder.mutation<unknown, { sku: string; effective_from: string; cost_cents: number; reason: string }>({
      query: ({ sku, ...body }) => ({ url: `/products/${encodeURIComponent(sku)}/costs`, method: "POST", body }),
      invalidatesTags: ["Product", "ProductHistory"],
    }),
    getProductCosts: builder.query<CostVersionView[], number>({
      query: (id) => `/products/${id}/costs`,
      providesTags: ["ProductHistory"],
    }),
    getProductPrices: builder.query<PriceVersionView[], number>({
      query: (id) => `/products/${id}/prices`,
      providesTags: ["ProductHistory"],
    }),
    getProductTimeline: builder.query<{ product_id: number; history_available_from: string | null; events: TimelineEvent[] }, number>({
      query: (id) => `/products/${id}/timeline`,
      providesTags: ["ProductHistory"],
    }),
    getProductMargins: builder.query<{ product_id: number; history_available_from: string | null; intervals: MarginInterval[] }, number>({
      query: (id) => `/products/${id}/price-margins`,
      providesTags: ["ProductHistory"],
    }),
    /** Inativar ou tornar principal um EAN. Nunca apaga: o histórico de compras e vendas dele continua. */
    updateProductEan: builder.mutation<ProductEan[], { productId: number; eanId: number; status?: "active" | "inactive"; primary?: boolean; valid_to?: string; note?: string }>({
      query: ({ productId, eanId, ...body }) => ({ url: `/products/${productId}/eans/${eanId}`, method: "PATCH", body }),
      invalidatesTags: ["Product"],
    }),
    previewCatalogueImport: builder.mutation<ImportPreview, { rows: ImportRow[]; clearEmpty: boolean }>({
      query: (body) => ({ url: "/catalogue-import/preview", method: "POST", body }),
    }),
    applyCatalogueImport: builder.mutation<ImportApplied, { rows: ImportRow[]; clearEmpty: boolean }>({
      query: (body) => ({ url: "/catalogue-import/apply", method: "POST", body }),
      invalidatesTags: ["Product", "ProductHistory"],
    }),
    getCatalogueLastChange: builder.query<{ product_changed_at: string | null; cost_changed_at: string | null; price_changed_at: string | null; latest: string | null }, void>({
      query: () => "/catalogue/last-change",
      providesTags: ["Product", "ProductHistory"],
    }),
    getCategories: builder.query<CategoryRow[], void>({
      query: () => "/categories",
      providesTags: ["Taxonomy"],
    }),
    createCategory: builder.mutation<CategoryRow, { name: string; keywords?: string[] }>({
      query: (body) => ({ url: "/categories", method: "POST", body }),
      invalidatesTags: ["Taxonomy"],
    }),
    updateCategory: builder.mutation<CategoryRow, { id: number; changes: { name?: string; keywords?: string[]; status?: "active" | "inactive" } }>({
      query: ({ id, changes }) => ({ url: `/categories/${id}`, method: "PATCH", body: changes }),
      invalidatesTags: ["Taxonomy", "Product"],
    }),
    createSubcategory: builder.mutation<CategoryRow, { categoryId: number; name: string; keywords?: string[] }>({
      query: ({ categoryId, ...body }) => ({ url: `/categories/${categoryId}/subcategories`, method: "POST", body }),
      invalidatesTags: ["Taxonomy"],
    }),
    updateSubcategory: builder.mutation<CategoryRow, { id: number; changes: { name?: string; keywords?: string[]; status?: "active" | "inactive" } }>({
      query: ({ id, changes }) => ({ url: `/subcategories/${id}`, method: "PATCH", body: changes }),
      // Renomear uma subcategoria renomeia nos produtos.
      invalidatesTags: ["Taxonomy", "Product"],
    }),
    /** Sugere categoria e subcategoria pelo nome; não aplica nada. */
    suggestClassification: builder.mutation<ClassificationResult, { name: string }>({
      query: (body) => ({ url: "/classification/suggest", method: "POST", body }),
    }),
    getClassificationReview: builder.query<ClassificationReviewItem[], void>({
      query: () => "/classification/review",
      providesTags: ["Taxonomy", "Product"],
    }),
    applyClassification: builder.mutation<{ applied: number; results: { sku: string; ok: boolean; error?: string }[] }, { items: { sku: string; category: string; subcategory: string | null }[] }>({
      query: (body) => ({ url: "/classification/apply", method: "POST", body }),
      invalidatesTags: ["Taxonomy", "Product"],
    }),
    getNextSku: builder.query<NextSku, void>({
      query: () => "/products/next-sku",
      // Cada abertura do formulário pergunta de novo: outro cadastro pode ter usado o número.
      keepUnusedDataFor: 0,
    }),
    createProductFromInvoice: builder.mutation<Product, NewProductFromInvoice>({
      query: (body) => ({ url: "/products/from-invoice", method: "POST", body }),
      invalidatesTags: ["Product"],
    }),
    /** Vincula um código de barras a um produto que já existe (nunca cria produto). */
    addProductEan: builder.mutation<ProductEan[], { productId: number; ean: string; note?: string; valid_from?: string; make_primary?: boolean; retire_current?: boolean }>({
      query: ({ productId, ...body }) => ({ url: `/products/${productId}/eans`, method: "POST", body }),
      invalidatesTags: ["Product"],
    }),
    updateProduct: builder.mutation<
      Product,
      { id: number; changes: { name?: string; category?: Product["category"]; unitsPerPackage?: number | null; packageType?: string | null; fractionable?: boolean; supplierId?: number | null; subcategory?: string | null; classificationConfirmed?: boolean; status?: "active" | "discontinued"; saleUnit?: string; brand?: string | null; purchaseUnit?: string | null } }
    >({
      query: ({ id, changes }) => ({ url: `/products/${id}`, method: "PATCH", body: changes }),
      invalidatesTags: ["Product"],
    }),
  }),
});

export const {
  useGetProductsQuery,
  useGetSkuLinksQuery,
  usePreviewCatalogueSyncMutation,
  useApplyCatalogueSyncMutation,
  useDecideSkuLinkMutation,
  useDeleteSkuLinkMutation,
  useGetCostsAsOfQuery,
  useGetPricesAsOfQuery,
  useRecordPriceMutation,
  useUpdateProductMutation,
  useCreateProductMutation,
  useGetNextSkuQuery,
  useGetCategoriesQuery,
  useCreateCategoryMutation,
  useUpdateCategoryMutation,
  useCreateSubcategoryMutation,
  useUpdateSubcategoryMutation,
  useSuggestClassificationMutation,
  useGetClassificationReviewQuery,
  useApplyClassificationMutation,
  usePreviewCatalogueImportMutation,
  useApplyCatalogueImportMutation,
  useGetCatalogueLastChangeQuery,
  useCreateProductFromInvoiceMutation,
  useAddProductEanMutation,
  useRecordCostMutation,
  useGetProductCostsQuery,
  useGetProductPricesQuery,
  useGetProductTimelineQuery,
  useGetProductMarginsQuery,
  useUpdateProductEanMutation,
} = productsApi;
