"use client";

import { useMemo } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetProductCostsQuery, type Product } from "@/lib/api/products";
import { useGetProductAnalysisQuery } from "@/lib/api/supplier-analysis";
import { costChangesWithin, lastMonths } from "@/lib/products/cost-metrics";
import { isoDay } from "@/lib/products/labels";
import { formatCents } from "@/lib/purchases/money";
import { formatFigure, formatMonth } from "@/lib/supplier-analysis/format";

const today = () => new Date().toISOString().slice(0, 10);
const MONTHS_SHOWN = 6;

function monthBounds(month: string): { fromDate: string; toDate: string } {
  const [year, number] = month.split("-").map(Number);

  return { fromDate: `${month}-01`, toDate: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10) };
}

/**
 * A margem do produto mês a mês, lida da MESMA análise de produto das Compras (nenhuma conta nova): cada mês é valorizado ao custo do FIM do mês, a
 * mesma regra do CMV do financeiro — por isso um mês em que o custo mudou no meio vem sinalizado, já que parte das vendas aconteceu ao custo antigo.
 * Um mês antigo nunca usa o custo de hoje.
 */
export function ProductMarginTab({ product }: { product: Product }) {
  const costs = useGetProductCostsQuery(product.id);
  const versions = useMemo(() => costs.data ?? [], [costs.data]);
  const months = useMemo(() => lastMonths(today(), MONTHS_SHOWN), []);

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
        Base do CMV: o custo vigente no último dia de cada mês vale para o mês inteiro (aproximação do financeiro). A margem é a do produto, <strong>(receita − custo do vendido) ÷ receita</strong>, só sobre as vendas
        que têm custo; ela não inclui impostos, taxas, perda nem rateio (isso é a margem econômica da Precificação Inteligente).
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mês</TableHead>
            <TableHead className="text-right">Vendido</TableHead>
            <TableHead className="text-right">Receita</TableHead>
            <TableHead className="text-right">Preço médio</TableHead>
            <TableHead className="text-right">Custo médio</TableHead>
            <TableHead className="text-right">Margem</TableHead>
            <TableHead className="text-right">Markup</TableHead>
            <TableHead>Observação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {months.map((month) => (
            <MarginRow key={month} sku={product.sku} month={month} changes={costChangesWithin(versions, month)} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MarginRow({ sku, month, changes }: { sku: string; month: string; changes: ReturnType<typeof costChangesWithin> }) {
  const { fromDate, toDate } = monthBounds(month);
  const query = useGetProductAnalysisQuery({ sku, fromDate, toDate, compareTo: "prev_month" });
  const movement = query.data?.totals.current;

  if (query.isLoading) {
    return (
      <TableRow>
        <TableCell>{formatMonth(month)}</TableCell>
        <TableCell colSpan={7} className="text-muted-foreground">
          Carregando…
        </TableCell>
      </TableRow>
    );
  }
  if (query.isError || !movement) {
    return (
      <TableRow>
        <TableCell>{formatMonth(month)}</TableCell>
        <TableCell colSpan={7} className="text-destructive">
          Não foi possível calcular este mês.
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell className="tabular">{formatMonth(month)}</TableCell>
      <TableCell className="tabular text-right">{formatFigure(movement.sold, "units")}</TableCell>
      <TableCell className="tabular text-right">{formatFigure(movement.revenueCents, "cents")}</TableCell>
      <TableCell className="tabular text-right">{formatFigure(movement.avgPriceCents, "cents")}</TableCell>
      <TableCell className="tabular text-right">{formatFigure(movement.avgCostCents, "cents")}</TableCell>
      <TableCell className="tabular text-right font-medium">{formatFigure(movement.marginShare, "share")}</TableCell>
      <TableCell className="tabular text-right">{formatFigure(movement.markup, "ratio")}</TableCell>
      <TableCell className="whitespace-normal text-xs">
        {changes.map((change) => (
          <StatusBadge key={change.date} tone="attention">
            Custo mudou em {isoDay(change.date)}: {formatCents(change.from)} → {formatCents(change.to)}
          </StatusBadge>
        ))}
      </TableCell>
    </TableRow>
  );
}
