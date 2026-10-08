"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PricingProduct } from "@/lib/api/pricing";
import { count, date, money } from "@/lib/format";
import { costOriginText, percent, signedMoney, STATUS_LABEL, STATUS_TONE } from "@/lib/pricing/labels";
import { noRecommendationReason } from "@/lib/pricing/view";

import { CONTRIBUTION_METRIC, type MarginMetric } from "@/lib/pricing/metric";
import { IMPACT_PREMISE } from "./summary-cards";

export const PAGE_SIZES = [10, 25, 50] as const;

/** Vermelho abaixo da margem mínima, amarelo abaixo da meta; acima disso o número fica neutro (cor só onde há problema). */
function marginClass(product: PricingProduct): string {
  if (product.currentMargin === null) return "text-muted-foreground";
  if (product.currentMargin < product.minimumMargin - 1e-9) return "text-destructive";
  if (product.currentMargin < product.targetMargin - 1e-9) return "text-warning";

  return "";
}

/**
 * O centro da tela: produto → problema → preço recomendado → impacto → ação. Quem não tem recomendação mostra "—"
 * e o motivo, nunca um preço inventado.
 */
export function ProductsTable({
  rows,
  total,
  page,
  pages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onOpen,
  showTarget = false,
  metric = CONTRIBUTION_METRIC,
}: {
  rows: PricingProduct[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onOpen: (sku: string) => void;
  /** A coluna Meta só existe quando os produtos têm metas diferentes; com a mesma meta para todos ela vai no cabeçalho da tela. */
  showTarget?: boolean;
  /** The margin the report was computed with (a report of the previous engine is the economic margin, under its own name). */
  metric?: MarginMetric;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Custo utilizado</TableHead>
              <TableHead className="text-right">Preço vigente</TableHead>
              <TableHead className="text-right" title={metric.definition}>
                {metric.name}
              </TableHead>
              {showTarget && <TableHead className="text-right">Meta</TableHead>}
              <TableHead className="text-right">Preço sugerido</TableHead>
              <TableHead className="text-right" title={IMPACT_PREMISE}>
                Impacto mensal estimado
              </TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((product) => {
              const reason = noRecommendationReason(product);

              return (
                <TableRow key={product.sku}>
                  <TableCell>
                    <div className="font-medium">{product.name ?? product.sku}</div>
                    <div className="tabular text-xs text-muted-foreground">
                      {product.categoryLabel} · {product.ean ?? product.sku}
                    </div>
                    {product.newProduct && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        <StatusBadge tone="attention">Produto novo</StatusBadge>
                        {product.newProduct.noSalesHistory && <StatusBadge tone="neutral">Sem histórico de vendas</StatusBadge>}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {money(product.structure?.productCostCents ?? null)}
                    {costOriginText(product.costOrigin) && <div className="text-xs font-normal text-muted-foreground">{costOriginText(product.costOrigin)}</div>}
                    {product.newerCost && (
                      <div className="text-xs font-normal text-warning" title="O período analisado é histórico: este custo é posterior a ele e não entra na margem do período.">
                        Custo novo depois do período: {money(product.newerCost.costCents)} (desde {date(product.newerCost.effectiveFrom)})
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right">{money(product.currentPriceCents)}</TableCell>
                  <TableCell className={`tabular text-right font-medium ${marginClass(product)}`}>{percent(product.currentMargin)}</TableCell>
                  {showTarget && <TableCell className="tabular text-right">{percent(product.targetMargin, 0)}</TableCell>}
                  <TableCell className="tabular min-w-48 text-right">
                    {product.recommendedPriceCents === null ? (
                      <div>
                        <span aria-label="sem recomendação">—</span>
                        {reason && <div className="ml-auto max-w-48 whitespace-normal text-xs font-normal text-muted-foreground">{reason}</div>}
                      </div>
                    ) : (
                      <span className="font-semibold">{money(product.recommendedPriceCents)}</span>
                    )}
                  </TableCell>
                  <TableCell className={`tabular text-right ${(product.impactCentsPerMonth ?? 0) > 0 ? "text-success" : ""}`}>{signedMoney(product.impactCentsPerMonth)}</TableCell>
                  <TableCell>
                    <StatusBadge tone={STATUS_TONE[product.status]}>{STATUS_LABEL[product.status]}</StatusBadge>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => onOpen(product.sku)} aria-label={`Analisar ${product.name ?? product.sku}`}>
                      Analisar
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col items-center justify-between gap-2 text-sm text-muted-foreground sm:flex-row">
        <span>
          Mostrando {count(rows.length)} de {count(total)} produtos
        </span>
        <div className="flex items-center gap-2">
          <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
            <SelectTrigger className="w-32" aria-label="Itens por página">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} por página
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="icon" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Página anterior">
            <ChevronLeft aria-hidden />
          </Button>
          <span className="tabular min-w-20 text-center">
            {page} de {pages}
          </span>
          <Button size="icon" variant="outline" disabled={page >= pages} onClick={() => onPageChange(page + 1)} aria-label="Próxima página">
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
