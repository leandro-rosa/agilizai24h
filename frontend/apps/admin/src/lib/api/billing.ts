import { createApi } from "@reduxjs/toolkit/query/react";

import { gatewayBaseQuery } from "./base-query";

export const SEGMENTS = ["company", "condominium"] as const;
export const SEGMENT_LABELS: Record<string, string> = { company: "Empresa", condominium: "Condomínio" };

export const CONTRACT_KINDS = ["partnership", "monthly_fee", "revenue_share", "coffee_break"] as const;
export const CONTRACT_KIND_LABELS: Record<string, string> = {
  partnership: "Parceria",
  monthly_fee: "Mensalidade",
  revenue_share: "Repasse",
  coffee_break: "Coffee break",
};

export const INVOICE_KINDS = ["monthly_fee", "coffee_break", "revenue_share", "other"] as const;
export const INVOICE_KIND_LABELS: Record<string, string> = {
  monthly_fee: "Mensalidade",
  coffee_break: "Coffee break",
  revenue_share: "Repasse",
  other: "Outro",
};

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  issued: "Emitida",
  paid: "Paga",
  cancelled: "Cancelada",
};

export interface Client {
  id: number;
  name: string;
  legal_name: string;
  tax_id: string;
  segment: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  _count?: { sites: number; contracts: number };
}

export interface ClientSite {
  id: number;
  client_id: number;
  code: string;
  tax_id: string | null;
  address: string;
  city: string;
  employees: number | null;
  employees_and_clients: number | null;
  service_providers: number | null;
  visitors: number | null;
  weighted_daily_traffic: number | null;
  store_id: number | null;
}

export interface Contract {
  id: number;
  client_id: number;
  reference: string;
  kind: string;
  monthly_fee_cents: number;
  revenue_share_bps: number;
  convenience_fee_bps: number;
  payment_term_days: number;
  starts_on: string;
  ends_on: string | null;
  status: string;
  document_url: string | null;
  client?: Client;
  stores?: { contract_id: number; store_id: number }[];
}

export interface Invoice {
  id: number;
  client_id: number;
  contract_id: number | null;
  number: string;
  purchase_order: string | null;
  service_sheet: string | null;
  kind: string;
  period: string;
  amount_cents: number;
  issued_on: string;
  payment_term_days: number;
  due_on: string;
  paid_on: string | null;
  status: string;
  client?: Client;
}

export interface AgingView {
  reference_date: string;
  open_amount_cents: number;
  overdue_amount_cents: number;
  buckets: { key: string; label: string; invoice_count: number; amount_cents: number }[];
}

export const billingApi = createApi({
  reducerPath: "billingApi",
  baseQuery: gatewayBaseQuery,
  tagTypes: ["Client", "Contract", "Invoice"],
  endpoints: (builder) => ({
    getClients: builder.query<Client[], void>({
      query: () => "/billing/clients",
      providesTags: ["Client"],
    }),
    getClient: builder.query<Client & { sites: ClientSite[] }, number>({
      query: (id) => `/billing/clients/${id}`,
      providesTags: ["Client"],
    }),
    createClient: builder.mutation<Client, Partial<Client>>({
      query: (body) => ({ url: "/billing/clients", method: "POST", body }),
      invalidatesTags: ["Client"],
    }),
    updateClient: builder.mutation<Client, { id: number } & Partial<Client>>({
      query: ({ id, ...body }) => ({ url: `/billing/clients/${id}`, method: "PATCH", body }),
      invalidatesTags: ["Client"],
    }),
    createSite: builder.mutation<ClientSite, { id: number } & Partial<ClientSite>>({
      query: ({ id, ...body }) => ({ url: `/billing/clients/${id}/sites`, method: "POST", body }),
      invalidatesTags: ["Client"],
    }),
    updateSite: builder.mutation<ClientSite, { id: number; siteId: number } & Partial<ClientSite>>({
      query: ({ id, siteId, ...body }) => ({
        url: `/billing/clients/${id}/sites/${siteId}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: ["Client"],
    }),
    getContracts: builder.query<Contract[], void>({
      query: () => "/billing/contracts",
      providesTags: ["Contract"],
    }),
    createContract: builder.mutation<Contract, Partial<Contract> & { store_ids?: number[] }>({
      query: (body) => ({ url: "/billing/contracts", method: "POST", body }),
      invalidatesTags: ["Contract"],
    }),
    updateContract: builder.mutation<Contract, { id: number } & Partial<Contract> & { store_ids?: number[] }>({
      query: ({ id, ...body }) => ({ url: `/billing/contracts/${id}`, method: "PATCH", body }),
      invalidatesTags: ["Contract"],
    }),
    getInvoices: builder.query<Invoice[], { client_id?: number; period?: string; status?: string } | void>({
      query: (filter) => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(filter ?? {})) {
          if (value !== undefined && value !== "") params.set(key, String(value));
        }
        const search = params.toString();
        return `/billing/invoices${search ? `?${search}` : ""}`;
      },
      providesTags: ["Invoice"],
    }),
    getAging: builder.query<AgingView, void>({
      query: () => "/billing/invoices/aging",
      providesTags: ["Invoice"],
    }),
    createInvoice: builder.mutation<Invoice, Partial<Invoice>>({
      query: (body) => ({ url: "/billing/invoices", method: "POST", body }),
      invalidatesTags: ["Invoice"],
    }),
    updateInvoice: builder.mutation<Invoice, { id: number } & Partial<Invoice>>({
      query: ({ id, ...body }) => ({ url: `/billing/invoices/${id}`, method: "PATCH", body }),
      invalidatesTags: ["Invoice"],
    }),
    payInvoice: builder.mutation<Invoice, { id: number; paid_on: string }>({
      query: ({ id, paid_on }) => ({ url: `/billing/invoices/${id}/pay`, method: "POST", body: { paid_on } }),
      invalidatesTags: ["Invoice"],
    }),
  }),
});

export const {
  useGetClientsQuery,
  useGetClientQuery,
  useCreateClientMutation,
  useUpdateClientMutation,
  useCreateSiteMutation,
  useUpdateSiteMutation,
  useGetContractsQuery,
  useCreateContractMutation,
  useUpdateContractMutation,
  useGetInvoicesQuery,
  useGetAgingQuery,
  useCreateInvoiceMutation,
  useUpdateInvoiceMutation,
  usePayInvoiceMutation,
} = billingApi;
