import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

export type Condition = "paid" | "bonus" | "on_sale";
export type PaymentStatus = "pending" | "paid";
export type SettlementState = "proposal" | "confirmed" | "paid";

export interface PurchaseItem {
  id: number;
  sku: string;
  description: string | null;
  quantity: number;
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
  invoice_number: string | null;
  invoice_key: string | null;
  notes: string | null;
  items: PurchaseItem[];
  /** Gasto: itens pagos ao custo. Consignado só é devido conforme vende; bonificação não custa nada. */
  paid_cents: number;
  on_sale_cents: number;
  bonus_units: number;
}

export interface NewPurchaseItem {
  sku: string;
  description?: string;
  quantity: number;
  unit_cost_cents: number;
  condition: Condition;
}

export interface NewPurchase {
  supplier_id: number;
  ordered_on: string;
  invoice_number?: string;
  invoice_key?: string;
  invoice_object_key?: string;
  origin?: "manual" | "nfe";
  notes?: string;
  items: NewPurchaseItem[];
}

export interface InvoicePreviewItem {
  line: number;
  code: string;
  description: string;
  quantity: number;
  unit_cost_cents: number;
  total_cents: number;
  sku: string | null;
  product_name: string | null;
  unresolved_reason: "no_match" | "fractional_quantity" | "package_unknown" | null;
  conversion: string | null;
}

export interface InvoicePreview {
  object_key: string;
  number: string;
  key: string | null;
  issued_on: string;
  issuer: { tax_id: string; name: string };
  supplier: { id: number; name: string } | null;
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
  tagTypes: ["Purchase", "Settlement"],
  endpoints: (builder) => ({
    getPurchases: builder.query<Purchase[], { supplierId?: number; from?: string; to?: string; invoicesOnly?: boolean } | void>({
      query: (args) => {
        const params = new URLSearchParams();
        if (args?.supplierId) params.set("supplier_id", String(args.supplierId));
        if (args?.from) params.set("from", args.from);
        if (args?.to) params.set("to", args.to);
        if (args?.invoicesOnly) params.set("invoices_only", "true");
        const query = params.toString();
        return `/purchases${query ? `?${query}` : ""}`;
      },
      providesTags: ["Purchase"],
    }),
    createPurchase: builder.mutation<Purchase, NewPurchase>({
      query: (body) => ({ url: "/purchases", method: "POST", body }),
      invalidatesTags: ["Purchase", "Settlement"],
    }),
    updatePurchaseItem: builder.mutation<PurchaseItem, { itemId: number; changes: { condition?: Condition; payment_status?: PaymentStatus; paid_on?: string; payment_note?: string } }>({
      query: ({ itemId, changes }) => ({ url: `/purchases/items/${itemId}`, method: "PATCH", body: changes }),
      invalidatesTags: ["Purchase", "Settlement"],
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
