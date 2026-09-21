"use client";

import { useMemo, useState } from "react";

import { RequestState } from "@/components/request-state";
import { currency } from "@/components/sales/shared";
import type { SalesTabProps } from "@/components/sales/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPct } from "@/lib/financial-kpis";
import { classifyProductMatrix, productSalesRows, sortProducts, type ProductQuadrant, type ProductSortKey } from "@/lib/sales-insights";

const SORT_LABELS: Record<ProductSortKey, string> = {
  quantity: "Mais vendidos",
  revenue: "Maior receita",
  marginCents: "Maior margem R$",
  marginPct: "Maior margem %",
  lowestMargin: "Menor margem",
};

const QUADRANTS: ProductQuadrant[] = ["star", "traffic", "potential", "reevaluate"];

const QUADRANT_META: Record<ProductQuadrant, { label: string; hint: string; tone: string }> = {
  star: { label: "Estrelas", hint: "Alta venda + alta margem — manter disponibilidade e evitar ruptura.", tone: "border-success/40 bg-success/5" },
  traffic: { label: "Geradores de tráfego", hint: "Alta venda + baixa margem — avaliar preço, fornecedor e margem.", tone: "border-warning/40 bg-warning/5" },
  potential: { label: "Potencial", hint: "Baixa venda + alta margem — avaliar exposição e incentivo.", tone: "border-chart-1/40 bg-chart-1/5" },
  reevaluate: { label: "Reavaliar", hint: "Baixa venda + baixa margem — avaliar permanência no mix.", tone: "border-destructive/40 bg-destructive/5" },
};

export function ProductsTab(props: SalesTabProps) {
  const { okCurrent, productBySku, costBySku, isLoading, error, isEmpty, onRetry } = props;
  const [sortKey, setSortKey] = useState<ProductSortKey>("revenue");

  const rows = useMemo(() => productSalesRows(okCurrent, productBySku, costBySku), [okCurrent, productBySku, costBySku]);
  const sorted = useMemo(() => sortProducts(rows, sortKey), [rows, sortKey]);
  const matrix = useMemo(() => classifyProductMatrix(rows), [rows]);

  const matrixByQuadrant = useMemo(() => {
    const map = new Map<ProductQuadrant, typeof matrix>();
    for (const q of QUADRANTS) {
      map.set(
        q,
        matrix
          .filter((r) => r.quadrant === q)
          .sort((a, b) => b.revenueCents - a.revenueCents)
          .slice(0, 6),
      );
    }
    return map;
  }, [matrix]);
  const noMargin = matrix.filter((r) => r.quadrant === null).length;

  return (
    <RequestState
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="Sem detalhe de transação para este período."
      onRetry={onRetry}
    >
      <div className="flex flex-col gap-8">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">Ranking de produtos</h3>
            <Tabs value={sortKey} onValueChange={(v) => setSortKey(v as ProductSortKey)}>
              <TabsList className="h-8 flex-wrap">
                {(Object.keys(SORT_LABELS) as ProductSortKey[]).map((key) => (
                  <TabsTrigger key={key} value={key} className="text-xs">
                    {SORT_LABELS[key]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            O produto mais vendido não é automaticamente o mais importante — compare quantidade, receita e margem lado a
            lado antes de decidir.
          </p>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="tabular text-right">Qtd.</TableHead>
                  <TableHead className="tabular text-right">Receita</TableHead>
                  <TableHead className="tabular text-right">Margem R$</TableHead>
                  <TableHead className="tabular text-right">Margem %</TableHead>
                  <TableHead className="tabular text-right">Participação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      Sem vendas no período.
                    </TableCell>
                  </TableRow>
                ) : (
                  sorted.slice(0, 30).map((row) => (
                    <TableRow key={row.sku}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{row.sku}</TableCell>
                      <TableCell className="max-w-[200px] truncate font-medium">{row.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.category}</TableCell>
                      <TableCell className="tabular text-right">{row.quantity}</TableCell>
                      <TableCell className="tabular text-right">{currency.format(row.revenueCents / 100)}</TableCell>
                      <TableCell className="tabular text-right">{row.margin.marginCents === null ? "—" : currency.format(row.margin.marginCents / 100)}</TableCell>
                      <TableCell className="tabular text-right">{row.margin.marginPct === null ? "—" : formatPct(row.margin.marginPct)}</TableCell>
                      <TableCell className="tabular text-right">{row.shareOfRevenue === null ? "—" : formatPct(row.shareOfRevenue)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div>
          <h3 className="mb-1 text-sm font-medium">Matriz venda × margem</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Alta/baixa é relativo à mediana dos produtos vendidos neste escopo — não um corte absoluto.
            {noMargin > 0 && ` ${noMargin} produto(s) sem custo resolvido não entram na matriz.`}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {QUADRANTS.map((q) => {
              const meta = QUADRANT_META[q];
              const items = matrixByQuadrant.get(q) ?? [];
              return (
                <div key={q} className={`rounded-lg border p-3 ${meta.tone}`}>
                  <p className="text-sm font-medium">{meta.label}</p>
                  <p className="mb-2 text-xs text-muted-foreground">{meta.hint}</p>
                  {items.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum produto neste quadrante.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {items.map((item) => (
                        <li key={item.sku} className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate">{item.name}</span>
                          <span className="tabular shrink-0 text-muted-foreground">{currency.format(item.revenueCents / 100)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </RequestState>
  );
}
