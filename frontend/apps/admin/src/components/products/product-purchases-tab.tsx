"use client";

import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetPurchasesQuery, type CostSync } from "@/lib/api/purchases";
import type { Product } from "@/lib/api/products";
import { STAGE_LABEL } from "@/lib/purchases/stages";
import { CONDITION_SHORT, formatCents, formatDate } from "@/lib/purchases/money";

const ALERT_TEXT = { large_variation: "Variação grande", closed_month: "Mês já fechado", closed_month_unknown: "Mês fechado? não foi possível saber" } as const;

function costText(sync: CostSync | undefined): string {
  if (!sync || sync.state === null) return "Quando a compra for recebida";
  if (sync.state === "skipped_bonus") return "Bonificação: não cria custo";
  if (sync.state === "skipped_not_received") return "Nada recebido: não cria custo";
  if (sync.state === "pending") return "Enviando…";
  if (sync.state === "failed") return "Falhou ao enviar";

  return sync.state === "unchanged" ? "Igual ao custo vigente" : "Custo criado";
}

/**
 * As compras deste produto, da mais nova para a mais antiga: nota, fornecedor, o que veio da nota (embalagem e preço da embalagem) e o que ela
 * fez no custo do produto. Só leitura do que as compras guardam; uma compra anterior ao registro do original diz "original não registrado".
 */
export function ProductPurchasesTab({ product, supplierName }: { product: Product; supplierName: (id: number | null | undefined) => string | null }) {
  const query = useGetPurchasesQuery({ sku: product.sku });

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Carregando compras…</p>;
  if (query.isError) return <p className="text-sm text-destructive">Não foi possível carregar as compras.</p>;
  const purchases = query.data ?? [];
  if (purchases.length === 0) return <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Nenhuma compra registrada para este produto.</p>;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">Só contam como compra os pedidos recebidos; os demais aparecem com a etapa em que estão. Bonificação não é gasto.</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Fornecedor / nota</TableHead>
            <TableHead className="text-right">Unidades</TableHead>
            <TableHead className="text-right">Custo un.</TableHead>
            <TableHead>Original da nota</TableHead>
            <TableHead>Condição</TableHead>
            <TableHead>Custo no produto</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {purchases.flatMap((purchase) =>
            purchase.items.map((item) => (
              <TableRow key={`${purchase.id}-${item.id}`}>
                <TableCell className="tabular whitespace-normal">
                  {formatDate(purchase.received_on ?? purchase.ordered_on)}
                  <span className="block text-xs text-muted-foreground">{purchase.status === "received" ? "recebida" : STAGE_LABEL[purchase.status]}</span>
                </TableCell>
                <TableCell className="whitespace-normal text-xs">
                  {purchase.supplier_name ?? supplierName(purchase.supplier_id) ?? `Fornecedor ${purchase.supplier_id}`}
                  {purchase.invoice_number ? (
                    <span className="block">
                      <Link className="underline" href={`/purchases/invoices?purchase=${purchase.id}`}>
                        NF {purchase.invoice_number}
                      </Link>
                    </span>
                  ) : (
                    <span className="block text-muted-foreground">sem nota</span>
                  )}
                </TableCell>
                <TableCell className="tabular text-right">{purchase.status === "received" ? (item.received_quantity ?? item.quantity) : item.quantity}</TableCell>
                <TableCell className="tabular text-right">{formatCents(item.unit_cost_cents)}</TableCell>
                <TableCell className="whitespace-normal text-xs">
                  {item.pack_quantity && item.pack_unit_price_cents && item.units_per_pack ? (
                    <>
                      {item.pack_quantity} {item.purchase_unit ?? "emb."} × {formatCents(item.pack_unit_price_cents)}
                      <span className="block text-muted-foreground">{item.units_per_pack} un. por embalagem</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">original não registrado</span>
                  )}
                </TableCell>
                <TableCell>{CONDITION_SHORT[item.condition]}</TableCell>
                <TableCell className="whitespace-normal text-xs">
                  {costText(item.cost_sync)}
                  {item.cost_sync?.previous_cost_cents != null && item.cost_sync.state === "synced" && <span className="block text-muted-foreground">antes {formatCents(item.cost_sync.previous_cost_cents)}</span>}
                  {item.cost_sync?.alerts.map((alert) => (
                    <StatusBadge key={alert} tone="attention">
                      {ALERT_TEXT[alert]}
                    </StatusBadge>
                  ))}
                </TableCell>
              </TableRow>
            )),
          )}
        </TableBody>
      </Table>
    </div>
  );
}
