import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

export type Condition = "paid" | "bonus" | "on_sale";
export type PaymentStatus = "pending" | "paid";
export type SettlementState = "proposal" | "confirmed" | "paid";
export type Stage = "requisition" | "awaiting_invoice" | "invoiced" | "awaiting_receipt" | "received";
export type PaymentTerm = "on_receipt" | "due_date";
export type PaymentMethod = "boleto" | "transfer" | "other";

export interface PurchaseItem {
  id: number;
  sku: string;
  description: string | null;
  /** Unidades pedidas. */
  quantity: number;
  /** Unidades recebidas (só depois de recebido) e a diferença para o pedido (positivo = faltou). */
  received_quantity: number | null;
  difference: number | null;
  unit_cost_cents: number;
  condition: Condition;
  payment_status: PaymentStatus;
  paid_on: string | null;
  payment_note: string | null;
  total_cents: number;
}

export interface Purchase {
  id: number;
  supplier_id: number;
  supplier_name: string | null;
  ordered_on: string;
  origin: "manual" | "nfe";
  status: Stage;
  invoice_number: string | null;
  invoice_key: string | null;
  without_invoice: boolean;
  notes: string | null;
  created_by: string | null;
  sent_at: string | null;
  sent_by: string | null;
  invoiced_at: string | null;
  invoiced_by: string | null;
  received_on: string | null;
  received_at: string | null;
  received_by: string | null;
  expected_delivery_on: string | null;
  payment_term: PaymentTerm | null;
  payment_due_on: string | null;
  payment_method: PaymentMethod | null;
  /** O dia em que o pagamento vence: o do recebimento (paga ao receber) ou o do boleto; vazio enquanto não se sabe. */
  payment_due_effective: string | null;
  /** Prazo de entrega vencido sem recebimento. */
  late: boolean;
  /** Há item pago pendente e o vencimento passou. */
  overdue: boolean;
  items: PurchaseItem[];
  /** Gasto: itens pagos ao custo. Consignado só é devido conforme vende; bonificação não custa nada. */
  paid_cents: number;
  on_sale_cents: number;
  bonus_units: number;
}

export interface NewPurchaseItem {
  sku: string;
  /** Código do item na nota do fornecedor; quando a pessoa escolheu o produto à mão, o vínculo fica salvo para as próximas notas. */
  supplier_code?: string;
  description?: string;
  quantity: number;
  unit_cost_cents: number;
  condition: Condition;
  /** Só ao criar já recebido. */
  received_quantity?: number;
}

export interface NewPurchase {
  supplier_id: number;
  ordered_on: string;
  invoice_number?: string;
  invoice_key?: string;
  invoice_object_key?: string;
  origin?: "manual" | "nfe";
  notes?: string;
  /** Etapa em que o pedido entra. Omitida = já recebido (lançamento antigo). */
  stage?: Stage;
  without_invoice?: boolean;
  received_on?: string;
  expected_delivery_on?: string;
  payment_term?: PaymentTerm;
  payment_due_on?: string;
  payment_method?: PaymentMethod;
  items: NewPurchaseItem[];
}

/** Uma linha do pedido editado: com `id` altera o item; sem, é linha nova; o que não vier é removido. */
export interface EditItem {
  id?: number;
  sku: string;
  description?: string;
  quantity: number;
  unit_cost_cents: number;
  condition: Condition;
  /** Só em pedido recebido. */
  received_quantity?: number;
}

export interface OrderChanges {
  expected_delivery_on?: string;
  payment_term?: PaymentTerm;
  payment_due_on?: string;
  payment_method?: PaymentMethod;
  notes?: string;
  ordered_on?: string;
  supplier_id?: number;
  /** Vazio apaga o número. */
  invoice_number?: string;
  invoice_key?: string;
  without_invoice?: boolean;
  received_on?: string;
  items?: EditItem[];
}

export interface TransitionBody {
  to: Stage;
  invoice_number?: string;
  invoice_key?: string;
  without_invoice?: boolean;
  received_on?: string;
  received?: { item_id: number; quantity: number }[];
  note?: string;
}

export interface EmailPreview {
  /** E-mail do cadastro do fornecedor; vazio = não dá para enviar até informar um. */
  to: string | null;
  supplier_name: string | null;
  subject: string;
  default_message: string;
  text: string;
  html: string;
  attachment: { suggested_filename: string };
  /** SMTP configurado. Sem isso nada é enviado. */
  configured: boolean;
  already_sent: boolean;
  sent: { to: string; subject: string; result: string; error: string | null; sent_by: string | null; created_at: string }[];
}

export interface SendEmailBody {
  to: string;
  message?: string;
  subject?: string;
  attachment_base64?: string;
  attachment_name?: string;
  resend?: boolean;
  save_to_supplier?: boolean;
}

export interface PendingPaymentGroup {
  /** Dia de vencimento; vazio = paga ao receber, ainda não recebido. */
  due_on: string | null;
  total_cents: number;
  overdue: boolean;
  items: { purchase_id: number; item_id: number; supplier_name: string | null; sku: string; description: string | null; quantity: number; total_cents: number }[];
}

export type PayableState = "overdue" | "upcoming" | "on_delivery" | "undated" | "paid";
export type PayableForm = "on_delivery" | PaymentMethod | null;

export interface PayableOrder {
  purchase_id: number;
  supplier_id: number;
  supplier_name: string | null;
  invoice_number: string | null;
  status: Stage;
  form: PayableForm;
  /** O vencimento, ou a entrega prevista quando "paga na entrega" e ainda não recebido (ESTIMATIVA: `estimated`). */
  due_on: string | null;
  estimated: boolean;
  state: PayableState;
  open_cents: number;
  paid_cents: number;
  paid_on: string | null;
  items: { item_id: number; sku: string; description: string | null; quantity: number; total_cents: number; payment_status: PaymentStatus; paid_on: string | null }[];
}

export interface Payables {
  month: string;
  today: string;
  summary: {
    open_cents: number;
    open_orders: number;
    overdue_cents: number;
    overdue_orders: number;
    due_7d_cents: number;
    due_7d_orders: number;
    on_delivery_cents: number;
    on_delivery_orders: number;
    paid_month_cents: number;
    paid_month_orders: number;
    forecast_month_cents: number;
  };
  series: { month: string; paid_cents: number; to_pay_cents: number; overdue_cents: number; on_delivery_cents: number }[];
  upcoming: PayableOrder[];
  commitments: { next_7_days_cents: number; next_30_days_cents: number; paid_month_cents: number };
  orders: PayableOrder[];
  reconciliation: {
    funnel: { orders: number; invoiced: number; received: number; paid: number };
    received_without_payment: { count: number; cents: number; purchase_ids: number[] };
    paid_without_invoice: { count: number; purchase_ids: number[] };
    awaiting_receipt: { count: number; purchase_ids: number[] };
    awaiting_invoice: { count: number; purchase_ids: number[] };
  };
}

export interface HistoryEntry {
  from_status: Stage | null;
  to_status: Stage;
  actor: string | null;
  note: string | null;
  created_at: string;
}

export interface InvoicePreviewItem {
  line: number;
  code: string;
  description: string;
  /** Como veio na nota: quantidade e preço da unidade de medida da nota (muitas vezes um fardo/caixa). */
  quantity: number;
  unit_cost_cents: number;
  total_cents: number;
  unit: string | null;
  sku: string | null;
  product_name: string | null;
  unresolved_reason: "no_match" | null;
  /** Como a linha achou o produto: código de barras, código do fornecedor já vinculado, ou código igual ao SKU. */
  matched_by: "ean" | "supplier_code" | "sku" | null;
  /** Só para linha sem produto: parecidos do catálogo. SUGESTÃO; nada é aplicado sem a pessoa aceitar. */
  suggestions: { sku: string; name: string; score: number; measure_differs: boolean }[];
  /** Unidades dentro de uma unidade da nota, só como SUGESTÃO (cadastro do produto, senão lida da descrição: "6P", "12UN"). */
  pack_size_suggested: number | null;
  pack_source: "catalogue" | "description" | null;
}

export interface InvoicePreview {
  object_key: string;
  number: string;
  key: string | null;
  issued_on: string;
  issuer: { tax_id: string; name: string };
  supplier: { id: number; name: string } | null;
  /** Como o fornecedor foi reconhecido: CNPJ exato, nome do emitente cadastrado como alias (de-para) ou raiz do CNPJ (outra filial). */
  matched_by: "tax_id" | "alias" | "cnpj_root" | null;
  duplicate_of: number | null;
  items: InvoicePreviewItem[];
}

export interface SettlementLine {
  itemId: number;
  sku: string;
  unitCostCents: number;
  delivered: number;
  openBefore: number;
  sold: number;
  expired: number;
  returned: number;
  unsold: number;
  owedUnits: number;
  owedCents: number;
  writeOffCapped: boolean;
}

export interface Settlement {
  id: number;
  supplier_id: number;
  supplier_name: string | null;
  week_start: string;
  week_end: string;
  state: SettlementState;
  /** Uma proposta ainda não é devida: só conta depois de confirmada. */
  counts_as_owed: boolean;
  owed_cents: number;
  partial: boolean;
  evidence: {
    lines: SettlementLine[];
    soldNotCovered: Record<string, number>;
    quality: { salesUnknown: boolean; monthsWithoutDatedReceipts: string[]; storesMissing: number };
    formula: string;
  };
  confirmed_at: string | null;
  paid_on: string | null;
  payment_note: string | null;
}

export interface WriteOff {
  item_id: number;
  expired?: number;
  returned?: number;
}

export const purchasesApi = createApi({
  reducerPath: "purchasesApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Purchase", "Settlement", "Payments"],
  endpoints: (builder) => ({
    getPurchases: builder.query<Purchase[], { supplierId?: number; from?: string; to?: string; invoicesOnly?: boolean; status?: Stage; openOnly?: boolean } | void>({
      query: (args) => {
        const params = new URLSearchParams();
        if (args?.supplierId) params.set("supplier_id", String(args.supplierId));
        if (args?.from) params.set("from", args.from);
        if (args?.to) params.set("to", args.to);
        if (args?.invoicesOnly) params.set("invoices_only", "true");
        if (args?.status) params.set("status", args.status);
        if (args?.openOnly) params.set("open_only", "true");
        const query = params.toString();
        return `/purchases${query ? `?${query}` : ""}`;
      },
      providesTags: ["Purchase"],
    }),
    createPurchase: builder.mutation<Purchase, NewPurchase>({
      query: (body) => ({ url: "/purchases", method: "POST", body }),
      invalidatesTags: ["Purchase", "Settlement", "Payments"],
    }),
    updatePurchaseItem: builder.mutation<PurchaseItem, { itemId: number; changes: { condition?: Condition; payment_status?: PaymentStatus; paid_on?: string; payment_note?: string } }>({
      query: ({ itemId, changes }) => ({ url: `/purchases/items/${itemId}`, method: "PATCH", body: changes }),
      invalidatesTags: ["Purchase", "Settlement"],
    }),
    getPurchase: builder.query<Purchase, number>({
      query: (id) => `/purchases/${id}`,
      providesTags: ["Purchase"],
    }),
    getHistory: builder.query<HistoryEntry[], number>({
      query: (id) => `/purchases/${id}/history`,
      providesTags: ["Purchase"],
    }),
    transitionPurchase: builder.mutation<Purchase, { id: number } & TransitionBody>({
      query: ({ id, ...body }) => ({ url: `/purchases/${id}/transition`, method: "POST", body }),
      invalidatesTags: ["Purchase", "Settlement", "Payments"],
    }),
    updateOrder: builder.mutation<Purchase, { id: number; changes: OrderChanges }>({
      query: ({ id, changes }) => ({ url: `/purchases/${id}`, method: "PATCH", body: changes }),
      invalidatesTags: ["Purchase", "Payments"],
    }),
    deletePurchase: builder.mutation<void, number>({
      query: (id) => ({ url: `/purchases/${id}`, method: "DELETE" }),
      invalidatesTags: ["Purchase", "Settlement", "Payments"],
    }),
    getEmailPreview: builder.query<EmailPreview, { id: number; message?: string }>({
      query: ({ id, message }) => `/purchases/${id}/email-preview${message ? `?message=${encodeURIComponent(message)}` : ""}`,
      providesTags: ["Purchase"],
    }),
    sendOrderEmail: builder.mutation<{ order: Purchase; email: { to: string; subject: string; message_id: string } }, { id: number } & SendEmailBody>({
      query: ({ id, ...body }) => ({ url: `/purchases/${id}/send`, method: "POST", body }),
      invalidatesTags: ["Purchase", "Payments"],
    }),
    getPayables: builder.query<Payables, { month?: string } | void>({
      query: (args) => `/payables${args?.month ? `?month=${args.month}` : ""}`,
      providesTags: ["Purchase", "Payments"],
    }),
    payOrders: builder.mutation<{ paid_items: number; paid_cents: number }, { purchase_ids: number[]; paid_on?: string; method?: PaymentMethod; note?: string }>({
      query: (body) => ({ url: "/payables/pay", method: "POST", body }),
      invalidatesTags: ["Purchase", "Payments"],
    }),
    undoPayment: builder.mutation<{ reopened_items: number }, { purchase_ids: number[] }>({
      query: (body) => ({ url: "/payables/undo", method: "POST", body }),
      invalidatesTags: ["Purchase", "Payments"],
    }),
    getPendingPayments: builder.query<{ total_cents: number; groups: PendingPaymentGroup[] }, void>({
      query: () => "/purchases/payments/pending",
      providesTags: ["Purchase", "Payments"],
    }),
    /** Lê a NF-e e mostra o que seria registrado. Não grava nada. */
    previewInvoice: builder.mutation<InvoicePreview, File>({
      query: (file) => {
        const body = new FormData();
        body.append("file", file);
        return { url: "/purchases/import", method: "POST", body };
      },
    }),
    getSettlements: builder.query<Settlement[], { supplierId?: number; state?: SettlementState } | void>({
      query: (args) => {
        const params = new URLSearchParams();
        if (args?.supplierId) params.set("supplier_id", String(args.supplierId));
        if (args?.state) params.set("state", args.state);
        const query = params.toString();
        return `/settlements${query ? `?${query}` : ""}`;
      },
      providesTags: ["Settlement"],
    }),
    getOpenTotal: builder.query<{ confirmed_cents: number; proposals: number }, void>({
      query: () => "/settlements/open-total",
      providesTags: ["Settlement"],
    }),
    proposeSettlement: builder.mutation<Settlement, { supplier_id: number; week_start: string; write_offs?: WriteOff[] }>({
      query: (body) => ({ url: "/settlements/propose", method: "POST", body }),
      invalidatesTags: ["Settlement"],
    }),
    confirmSettlement: builder.mutation<Settlement, { id: number; accept_partial?: boolean }>({
      query: ({ id, ...body }) => ({ url: `/settlements/${id}/confirm`, method: "POST", body }),
      invalidatesTags: ["Settlement"],
    }),
    paySettlement: builder.mutation<Settlement, { id: number; paid_on?: string; note?: string }>({
      query: ({ id, ...body }) => ({ url: `/settlements/${id}/pay`, method: "POST", body }),
      invalidatesTags: ["Settlement"],
    }),
  }),
});

export const {
  useGetPurchaseQuery,
  useGetHistoryQuery,
  useTransitionPurchaseMutation,
  useUpdateOrderMutation,
  useDeletePurchaseMutation,
  useGetEmailPreviewQuery,
  useSendOrderEmailMutation,
  useGetPendingPaymentsQuery,
  useGetPayablesQuery,
  usePayOrdersMutation,
  useUndoPaymentMutation,
  useGetPurchasesQuery,
  useCreatePurchaseMutation,
  useUpdatePurchaseItemMutation,
  usePreviewInvoiceMutation,
  useGetSettlementsQuery,
  useGetOpenTotalQuery,
  useProposeSettlementMutation,
  useConfirmSettlementMutation,
  usePaySettlementMutation,
} = purchasesApi;
