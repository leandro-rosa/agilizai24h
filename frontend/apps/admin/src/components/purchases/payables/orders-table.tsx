"use client";

import { Fragment, useMemo, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useUndoPaymentMutation, type PayableForm, type PayableOrder, type PayableState } from "@/lib/api/purchases";
import { formatCents, formatDate } from "@/lib/purchases/money";
import { STAGE_LABEL } from "@/lib/purchases/stages";
import { FORM_LABEL, formLabel, STATE_LABEL, STATE_TONE } from "./labels";

const ALL = "all";

export interface TableFilters {
  state: PayableState | typeof ALL;
  supplier: string;
  form: PayableForm | typeof ALL;
  search: string;
  /** Vindo de um alerta da conciliação: só estes pedidos. */
  ids: number[] | null;
  idsLabel: string;
}
export const NO_FILTERS: TableFilters = { state: ALL, supplier: ALL, form: ALL, search: "", ids: null, idsLabel: "" };

/** O filtro é só recorte do que já veio do servidor; as regras (vencido, na entrega…) já chegam calculadas. */
export function applyFilters(orders: PayableOrder[], filters: TableFilters): PayableOrder[] {
  const query = filters.search.trim().toLowerCase();

  return orders.filter(
    (order) =>
      (filters.state === ALL || order.state === filters.state) &&
      (filters.supplier === ALL || String(order.supplier_id) === filters.supplier) &&
      (filters.form === ALL || order.form === filters.form) &&
      (filters.ids === null || filters.ids.includes(order.purchase_id)) &&
      (query === "" ||
        [order.supplier_name ?? "", order.invoice_number ?? "", String(order.purchase_id), ...order.items.map((i) => `${i.sku} ${i.description ?? ""}`)].some((text) => text.toLowerCase().includes(query))),
  );
}

export function OrdersTable({
  orders,
  filters,
  onFilters,
  onPay,
}: {
  orders: PayableOrder[];
  filters: TableFilters;
  onFilters: (next: TableFilters) => void;
  onPay: (id: number) => void;
}) {
  const [undo] = useUndoPaymentMutation();
  const [open, setOpen] = useState<number | null>(null);
  const suppliers = useMemo(() => [...new Map(orders.map((o) => [o.supplier_id, o.supplier_name ?? `Fornecedor ${o.supplier_id}`])).entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")), [orders]);
  const rows = applyFilters(orders, filters);
  const dirty = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const set = (patch: Partial<TableFilters>) => onFilters({ ...filters, ...patch });

  async function undoPayment(id: number) {
    try {
      await undo({ purchase_ids: [id] }).unwrap();
      toast.success("Pagamento desfeito: o pedido voltou para em aberto.");
    } catch (failure) {
      toast.error((failure as { data?: { message?: string } })?.data?.message ?? "Não foi possível desfazer.");
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Status
          <Select value={filters.state} onValueChange={(state) => set({ state: state as TableFilters["state"] })}>
            <SelectTrigger className="w-40" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {(Object.keys(STATE_LABEL) as PayableState[]).map((state) => (
                <SelectItem key={state} value={state}>
                  {STATE_LABEL[state]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Fornecedor
          <Select value={filters.supplier} onValueChange={(supplier) => set({ supplier })}>
            <SelectTrigger className="w-52" aria-label="Fornecedor">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {suppliers.map(([id, name]) => (
                <SelectItem key={id} value={String(id)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Forma de pagamento
          <Select value={filters.form ?? ALL} onValueChange={(form) => set({ form: form as TableFilters["form"] })}>
            <SelectTrigger className="w-44" aria-label="Forma de pagamento">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas</SelectItem>
              {(Object.keys(FORM_LABEL) as (keyof typeof FORM_LABEL)[]).map((form) => (
                <SelectItem key={form} value={form}>
                  {FORM_LABEL[form]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Pedido / NF / produto
          <Input value={filters.search} onChange={(e) => set({ search: e.target.value })} placeholder="Buscar…" aria-label="Buscar" />
        </label>
        {dirty && (
          <Button variant="outline" onClick={() => onFilters(NO_FILTERS)}>
            <X className="size-4" /> Limpar filtros
          </Button>
        )}
      </div>
      {filters.ids !== null && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          Mostrando: {filters.idsLabel}
          <Button variant="ghost" size="sm" onClick={() => set({ ids: null, idsLabel: "" })} aria-label="Tirar o recorte do alerta">
            <X className="size-3" />
          </Button>
        </p>
      )}

      <div className="min-w-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fornecedor</TableHead>
              <TableHead>Pedido / NF</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead>Forma</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma conta com esses filtros.
                </TableCell>
              </TableRow>
            )}
            {rows.map((order) => (
              <Fragment key={order.purchase_id}>
                <TableRow data-testid={`payable-${order.purchase_id}`}>
                  <TableCell className="font-medium">{order.supplier_name ?? `Fornecedor ${order.supplier_id}`}</TableCell>
                  <TableCell>
                    #{order.purchase_id}
                    {order.invoice_number ? ` · NF ${order.invoice_number}` : <span className="text-xs text-muted-foreground"> · sem nota</span>}
                  </TableCell>
                  <TableCell>{STAGE_LABEL[order.status]}</TableCell>
                  <TableCell>{formLabel(order.form)}</TableCell>
                  <TableCell className="tabular">
                    {order.state === "paid" ? `pago ${formatDate(order.paid_on)}` : order.due_on ? `${formatDate(order.due_on)}${order.estimated ? " (previsto)" : ""}` : "—"}
                  </TableCell>
                  <TableCell className="tabular text-right">{formatCents(order.state === "paid" ? order.paid_cents : order.open_cents)}</TableCell>
                  <TableCell>
                    <StatusBadge tone={STATE_TONE[order.state]}>{STATE_LABEL[order.state]}</StatusBadge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {order.state === "paid" ? (
                      <Button variant="ghost" size="sm" onClick={() => undoPayment(order.purchase_id)} aria-label={`Desfazer pagamento do pedido ${order.purchase_id}`}>
                        Desfazer
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => onPay(order.purchase_id)} aria-label={`Dar baixa no pedido ${order.purchase_id}`}>
                        Dar baixa
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" aria-expanded={open === order.purchase_id} onClick={() => setOpen(open === order.purchase_id ? null : order.purchase_id)}>
                      {open === order.purchase_id ? "Ocultar" : "Itens"}
                    </Button>
                  </TableCell>
                </TableRow>
                {open === order.purchase_id && (
                  <TableRow>
                    <TableCell colSpan={8} className="bg-muted/30">
                      <ul className="flex flex-col gap-1 text-sm">
                        {order.items.map((item) => (
                          <li key={item.item_id} className="flex gap-2">
                            <span className="min-w-0 flex-1 truncate">
                              {item.description ?? item.sku} · {item.quantity} un.
                            </span>
                            <span className="text-xs text-muted-foreground">{item.payment_status === "paid" ? `pago ${formatDate(item.paid_on)}` : "em aberto"}</span>
                            <span className="tabular">{formatCents(item.total_cents)}</span>
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
