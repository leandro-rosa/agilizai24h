import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

export const NATURES = ["cogs", "operating", "administrative", "investment"] as const;
export type Nature = (typeof NATURES)[number];

/** O eixo "Natureza" da planilha, que é o que liga tesouraria a DRE. */
export const NATURE_LABELS: Record<Nature, string> = {
  cogs: "Estoque (CMV)",
  operating: "Operacional",
  administrative: "Administrativo",
  investment: "Investimento",
};

export const KINDS = ["revenue", "expense", "movement", "pending"] as const;
export type Kind = (typeof KINDS)[number];

/** O eixo novo, independente de `nature` — o que liga tesouraria ao dashboard reorganizado. */
export const KIND_LABELS: Record<Kind, string> = {
  revenue: "Receita",
  expense: "Despesa",
  movement: "Movimentação",
  pending: "Pendente",
};

/** Toda `CounterpartyMapping` resolve para um desses três — nunca "pending". */
export const MAPPING_KINDS = ["revenue", "expense", "movement"] as const;
export type MappingKind = (typeof MAPPING_KINDS)[number];

export const MATCH_TYPES = ["exact", "contains"] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  exact: "Exato",
  contains: "Contém",
};

export const PAYMENT_METHODS = ["debit", "credit", "pix", "voucher"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  debit: "Débito",
  credit: "Crédito",
  pix: "PIX",
  voucher: "Voucher",
};

export const ACCOUNT_KINDS = ["checking", "credit_card"] as const;
export const ACCOUNT_KIND_LABELS: Record<string, string> = {
  checking: "Conta corrente",
  credit_card: "Cartão de crédito",
};

export const TREASURY_SOURCES = [
  "pagbank_statement",
  "c6_statement",
  "c6_invoice",
  "pagseguro_invoice",
  "nubank_statement",
  "bradesco_statement",
  "itau_statement",
] as const;
export type TreasurySource = (typeof TREASURY_SOURCES)[number];

export const TREASURY_SOURCE_LABELS: Record<TreasurySource, string> = {
  pagbank_statement: "Extrato PagBank",
  c6_statement: "Extrato C6",
  c6_invoice: "Fatura do cartão C6",
  pagseguro_invoice: "Fatura PagSeguro",
  nubank_statement: "Extrato Nubank",
  bradesco_statement: "Extrato Bradesco",
  itau_statement: "Extrato Itaú",
};

/**
 * Palpite de institution/kind por fonte, só para pré-selecionar a conta
 * certa no formulário de upload (`bank_account.institution`/`kind`, seeds
 * `20260826020000_seed_bank_accounts` e `20260826030000_seed_pagseguro_
 * invoice_account`) — o operador sempre pode trocar.
 */
export const TREASURY_SOURCE_ACCOUNT_HINT: Record<TreasurySource, { institution: string; kind: "checking" | "credit_card" }> = {
  pagbank_statement: { institution: "pagbank", kind: "checking" },
  c6_statement: { institution: "c6", kind: "checking" },
  c6_invoice: { institution: "c6", kind: "credit_card" },
  pagseguro_invoice: { institution: "pagbank", kind: "credit_card" },
  nubank_statement: { institution: "nubank", kind: "checking" },
  bradesco_statement: { institution: "bradesco", kind: "checking" },
  itau_statement: { institution: "itau", kind: "checking" },
};

export const IMPORT_STATUSES = ["staged", "confirmed", "rejected"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  staged: "Em conferência",
  confirmed: "Confirmado",
  rejected: "Rejeitado",
};

export interface BankAccount {
  id: number;
  name: string;
  kind: "checking" | "credit_card";
  institution: string;
  last_digits: string | null;
  status: string;
}

export interface BankTransaction {
  id: number;
  account_id: number;
  occurred_on: string;
  period: string;
  direction: "inflow" | "outflow";
  amount_cents: number;
  counterparty_raw: string;
  supplier_id: number | null;
  entry_type: string;
  category: string;
  /** revenue | expense | movement | pending — só `expense` carrega `nature`. */
  kind: Kind;
  nature: Nature | null;
  store_id: number | null;
  installment_index: number | null;
  installment_total: number | null;
  /** Lançamento que este neutraliza (mesmo período) — nulo se não houver par confirmado. */
  neutralized_with_id: number | null;
  /** De qual PendingImport (extrato/fatura) este lançamento veio — nulo se criado manualmente. */
  pending_import_id: number | null;
  /** Qual regra de de-para classificou no momento do confirm — nulo se veio do formato do arquivo, ainda pendente, ou manual. */
  mapping_rule_id: number | null;
}

export interface TransactionSummary {
  period_from: string;
  period_to: string;
  transaction_count: number;
  inflow_cents: number;
  outflow_cents: number;
  net_cents: number;
  by_nature: { nature: string; inflow_cents: number; outflow_cents: number; net_cents: number }[];
  by_category: { category: string; outflow_cents: number }[];
  unresolved_count: number;
  /** Total `kind: movement` do período — informativo, nunca soma ao resultado. */
  movement_cents: number;
  pending_count: number;
  pending_cents: number;
}

export interface DailyCashFlow {
  date: string;
  inflow_cents: number;
  outflow_cents: number;
  balance_cents: number;
}

export interface CashFlowSummary {
  from: string;
  to: string;
  account_id: number | null;
  opening_balance_cents: number;
  inflow_cents: number;
  outflow_cents: number;
  closing_balance_cents: number;
  daily: DailyCashFlow[];
}

export interface CashFlowFilter {
  occurred_from: string;
  occurred_to: string;
  account_id?: number;
}

export interface SupplierTotal {
  supplier_id: number;
  outflow_cents: number;
  transaction_count: number;
}

export interface NeutralizationCandidate {
  a_id: number;
  b_id: number;
  reason: "recusado_estornado" | "devolucao_saida";
  amount_cents: number;
}

export interface CounterpartyMapping {
  id: number;
  match_text: string;
  display_name: string;
  supplier_id: number | null;
  entry_type: string;
  category: string;
  nature: Nature | null;
  kind: MappingKind;
  match_type: MatchType;
}

export interface AcquirerFee {
  id: number;
  acquirer: string;
  payment_method: PaymentMethod;
  rate_bps: number;
  effective_from: string;
}

export interface PendingImport {
  id: number;
  account_id: number;
  period: string;
  source: TreasurySource;
  status: ImportStatus;
  object_key: string;
  line_count: number;
  rejected_line_count: number;
  created_at: string;
  updated_at: string;
}

export interface PendingRejection {
  id: number;
  pending_import_id: number;
  row_reference: string;
  reason: string;
  detail: string;
}

export interface PendingTransaction {
  id: number;
  pending_import_id: number;
  occurred_on: string;
  amount_cents: number;
  direction: "inflow" | "outflow";
  counterparty_raw: string;
  source_ref: string;
  installment_index: number | null;
  installment_total: number | null;
  /** Sugestão do parser/de-para — nunca "revenue" aqui: extrato bancário não distingue receita de movimentação sozinho. */
  suggested_kind: Kind | null;
  suggested_entry_type: string | null;
  suggested_category: string | null;
  suggested_nature: Nature | null;
  suggested_supplier_id: number | null;
  proof_object_key: string | null;
  /** Aponta para um `BankTransaction` já confirmado com a mesma data+valor+favorecido — reenvio após confirmar. */
  likely_duplicate_of_id: number | null;
  /** Qual regra de de-para resolveu esta linha — nulo se veio do formato do arquivo (`structuralHint`) ou ainda não resolvida. */
  mapping_rule_id: number | null;
}

export interface PendingImportDetail extends PendingImport {
  transactions: PendingTransaction[];
  rejections: PendingRejection[];
}

export interface UploadStatementsArgs {
  period: string;
  files: { source: TreasurySource; account_id: number; file: File }[];
}

export interface UpdatePendingTransactionArgs {
  import_id: number;
  transaction_id: number;
  suggested_kind?: MappingKind;
  suggested_category?: string;
  suggested_nature?: Nature;
  suggested_supplier_id?: number;
}

export interface AttachProofArgs {
  import_id: number;
  transaction_id: number;
  image: File;
  counterparty_raw?: string;
}

export interface TransactionFilter {
  period?: string;
  from?: string;
  to?: string;
  occurred_from?: string;
  occurred_to?: string;
  account_id?: number;
  nature?: Nature;
  kind?: Kind;
  direction?: "inflow" | "outflow";
  unresolved?: boolean;
}

/**
 * Mesmo dobramento de `normalizeCounterparty` do treasury-service. Usado na
 * tela de conferência de import (`treasury/imports/[period]`) para agrupar
 * `PendingTransaction` por favorecido antes da confirmação — nesse estágio
 * ainda não existe `supplier_id` (só `suggested_supplier_id`, opcional). Já
 * confirmado, `/treasury` agrupa "despesa por fornecedor" pelo `supplier_id`
 * real, não por este texto normalizado.
 */
export function normalizeCounterpartyForGrouping(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function toQuery<T extends object = Record<string, never>>(filter: T = {} as T): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `?${search}` : "";
}

export const treasuryApi = createApi({
  reducerPath: "treasuryApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Transaction", "Account", "Mapping", "Fee", "PendingImport"],
  endpoints: (builder) => ({
    getCategories: builder.query<string[], void>({
      query: () => "/treasury/categories",
      providesTags: ["Mapping"],
    }),
    getTransactionsBySupplier: builder.query<SupplierTotal[], string>({
      query: (period) => `/treasury/transactions/by-supplier?period=${period}`,
      providesTags: ["Transaction"],
    }),
    getNeutralizationCandidates: builder.query<NeutralizationCandidate[], string>({
      query: (period) => `/treasury/transactions/neutralization-candidates?period=${period}`,
      providesTags: ["Transaction"],
    }),
    neutralizeTransactions: builder.mutation<void, { a_id: number; b_id: number }>({
      query: (body) => ({ url: "/treasury/transactions/neutralize", method: "POST", body }),
      invalidatesTags: ["Transaction"],
    }),
    unneutralizeTransaction: builder.mutation<void, number>({
      query: (id) => ({ url: `/treasury/transactions/${id}/unneutralize`, method: "POST" }),
      invalidatesTags: ["Transaction"],
    }),
    getAccounts: builder.query<BankAccount[], void>({
      query: () => "/treasury/accounts",
      providesTags: ["Account"],
    }),
    createAccount: builder.mutation<BankAccount, Partial<BankAccount>>({
      query: (body) => ({ url: "/treasury/accounts", method: "POST", body }),
      invalidatesTags: ["Account"],
    }),
    getTransactions: builder.query<BankTransaction[], TransactionFilter | void>({
      query: (filter) => `/treasury/transactions${toQuery(filter ?? undefined)}`,
      providesTags: ["Transaction"],
    }),
    getTransactionSummary: builder.query<TransactionSummary, TransactionFilter | void>({
      query: (filter) => `/treasury/transactions/summary${toQuery(filter ?? undefined)}`,
      providesTags: ["Transaction"],
    }),
    getCashFlowSummary: builder.query<CashFlowSummary, CashFlowFilter>({
      query: (filter) => `/treasury/transactions/cash-flow${toQuery(filter)}`,
      providesTags: ["Transaction"],
    }),
    createTransaction: builder.mutation<BankTransaction, Partial<BankTransaction>>({
      query: (body) => ({ url: "/treasury/transactions", method: "POST", body }),
      invalidatesTags: ["Transaction"],
    }),
    updateTransaction: builder.mutation<BankTransaction, { id: number } & Partial<BankTransaction>>({
      query: ({ id, ...body }) => ({ url: `/treasury/transactions/${id}`, method: "PATCH", body }),
      invalidatesTags: ["Transaction"],
    }),
    deleteTransaction: builder.mutation<void, number>({
      query: (id) => ({ url: `/treasury/transactions/${id}`, method: "DELETE" }),
      invalidatesTags: ["Transaction"],
    }),
    bulkUpdateTransactions: builder.mutation<
      { updated: number },
      { ids: number[]; nature?: Nature; category?: string }
    >({
      query: (body) => ({ url: "/treasury/transactions/bulk", method: "PATCH", body }),
      invalidatesTags: ["Transaction"],
    }),
    getMappings: builder.query<CounterpartyMapping[], void>({
      query: () => "/treasury/mappings",
      providesTags: ["Mapping"],
    }),
    createMapping: builder.mutation<CounterpartyMapping, Partial<CounterpartyMapping>>({
      query: (body) => ({ url: "/treasury/mappings", method: "POST", body }),
      invalidatesTags: ["Mapping"],
    }),
    updateMapping: builder.mutation<CounterpartyMapping, { id: number } & Partial<CounterpartyMapping>>({
      query: ({ id, ...body }) => ({ url: `/treasury/mappings/${id}`, method: "PATCH", body }),
      invalidatesTags: ["Mapping"],
    }),
    deleteMapping: builder.mutation<void, number>({
      query: (id) => ({ url: `/treasury/mappings/${id}`, method: "DELETE" }),
      invalidatesTags: ["Mapping"],
    }),
    applyMappings: builder.mutation<{ examined: number; classified: number }, string>({
      query: (period) => ({ url: `/treasury/mappings/apply/${period}`, method: "POST" }),
      invalidatesTags: ["Transaction"],
    }),
    getFees: builder.query<AcquirerFee[], void>({
      query: () => "/treasury/fees",
      providesTags: ["Fee"],
    }),
    createFee: builder.mutation<AcquirerFee, Partial<AcquirerFee>>({
      query: (body) => ({ url: "/treasury/fees", method: "POST", body }),
      invalidatesTags: ["Fee"],
    }),
    uploadStatements: builder.mutation<{ queued: { source: TreasurySource }[] }, UploadStatementsArgs>({
      query: ({ period, files }) => {
        const body = new FormData();
        body.append("period", period);
        for (const entry of files) {
          body.append(`${entry.source}_account_id`, String(entry.account_id));
          body.append(entry.source, entry.file);
        }
        return { url: "/treasury/imports/upload", method: "POST", body };
      },
      invalidatesTags: ["PendingImport"],
    }),
    getPendingImports: builder.query<PendingImport[], { period?: string } | void>({
      query: (filter) => `/treasury/imports${filter?.period ? `?period=${filter.period}` : ""}`,
      providesTags: ["PendingImport"],
    }),
    getPendingImport: builder.query<PendingImportDetail, number>({
      query: (id) => `/treasury/imports/${id}`,
      providesTags: (_result, _error, id) => [{ type: "PendingImport", id }],
    }),
    updatePendingTransaction: builder.mutation<PendingTransaction, UpdatePendingTransactionArgs>({
      query: ({ import_id, transaction_id, ...body }) => ({
        url: `/treasury/imports/${import_id}/transactions/${transaction_id}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (_result, _error, { import_id }) => [{ type: "PendingImport", id: import_id }],
    }),
    attachProof: builder.mutation<PendingTransaction, AttachProofArgs>({
      query: ({ import_id, transaction_id, image, counterparty_raw }) => {
        // Mesma ordem do upload de comprovante em /ingestion: o gateway lê
        // request.file() de forma síncrona antes de consumir o stream do
        // arquivo, então campos de valor precisam vir antes da parte do
        // arquivo no multipart.
        const body = new FormData();
        if (counterparty_raw) body.append("counterparty_raw", counterparty_raw);
        body.append("image", image);
        return { url: `/treasury/imports/${import_id}/transactions/${transaction_id}/proof`, method: "POST", body };
      },
      invalidatesTags: (_result, _error, { import_id }) => [{ type: "PendingImport", id: import_id }],
    }),
    confirmImport: builder.mutation<{ confirmed: number }, number>({
      query: (id) => ({ url: `/treasury/imports/${id}/confirm`, method: "POST" }),
      invalidatesTags: (_result, _error, id) => [{ type: "PendingImport", id }, "PendingImport", "Transaction"],
    }),
    rejectImport: builder.mutation<void, number>({
      query: (id) => ({ url: `/treasury/imports/${id}/reject`, method: "POST" }),
      invalidatesTags: (_result, _error, id) => [{ type: "PendingImport", id }, "PendingImport"],
    }),
  }),
});

export const {
  useGetAccountsQuery,
  useCreateAccountMutation,
  useGetCategoriesQuery,
  useGetTransactionsQuery,
  useGetTransactionSummaryQuery,
  useGetCashFlowSummaryQuery,
  useGetTransactionsBySupplierQuery,
  useGetNeutralizationCandidatesQuery,
  useNeutralizeTransactionsMutation,
  useUnneutralizeTransactionMutation,
  useCreateTransactionMutation,
  useUpdateTransactionMutation,
  useDeleteTransactionMutation,
  useBulkUpdateTransactionsMutation,
  useGetMappingsQuery,
  useCreateMappingMutation,
  useUpdateMappingMutation,
  useDeleteMappingMutation,
  useApplyMappingsMutation,
  useGetFeesQuery,
  useCreateFeeMutation,
  useUploadStatementsMutation,
  useGetPendingImportsQuery,
  useGetPendingImportQuery,
  useUpdatePendingTransactionMutation,
  useAttachProofMutation,
  useConfirmImportMutation,
  useRejectImportMutation,
} = treasuryApi;
