"use client";

import { useMemo } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PricingProduct } from "@/lib/api/pricing";
import { money } from "@/lib/format";
import { costBreakdown } from "@/lib/pricing/breakdown";
import { percent } from "@/lib/pricing/labels";

/** A composição do preço atual do produto, componente a componente, do custo à contribuição: o que o motor mandou, sem recalcular nada. */
export function StructureTable({ product }: { product: PricingProduct }) {
  const breakdown = useMemo(() => costBreakdown(product), [product]);

  return (
      <section aria-labelledby="structure" className="flex flex-col gap-2">
        <h3 id="structure" className="text-sm font-semibold">Estrutura de custos considerada</h3>
        {breakdown === null ? (
          <p className="text-sm text-muted-foreground">Sem estrutura de custos calculada: faltam dados para este produto.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Componente</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">% sobre o preço</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdown.rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="whitespace-normal">
                      {row.label}
                      {row.detail && <div className="max-w-sm whitespace-normal text-xs text-muted-foreground">{row.detail}</div>}
                    </TableCell>
                    <TableCell className="tabular text-right">{row.key === "voucher" ? "—" : money(Math.round(row.cents))}</TableCell>
                    <TableCell className="tabular text-right">{row.key === "voucher" ? "—" : percent(row.shareOfPrice)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>Custos que o preço cobre (a diferença para o preço é a contribuição)</TableCell>
                  <TableCell className="tabular text-right">{money(Math.round(breakdown.economicCostCents))}</TableCell>
                  <TableCell className="tabular text-right">{percent(breakdown.economicCostShare)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">{breakdown.statement}</p>
          </>
        )}
      </section>
  );
}
